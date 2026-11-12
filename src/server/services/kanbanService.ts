import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { KanbanCommand, KanbanRepositoryOptions } from '../../entrypoints/sdk/controlSchemas.js'
import type { UserMessageOrigin } from '../../entrypoints/sdk/coreSchemas.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { resolveProjectRoot } from '../../utils/projectRoot.js'
import type { LinkedSessionOptions } from './sessionLinksService.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import { diagnosticsService } from './diagnosticsService.js'
import { readJsonlFile } from './jsonlFile.js'
import {
  NEW_SESSION,
  applyEvent,
  boardFromEvents,
  cardView,
  creatorOf,
  emptyBoard,
  eventsForCard,
  handledBy,
  inboxFor,
  sessionsOnBoard,
  validateCommand,
  type Board,
  type BoardListing,
  type BoardSessionInfo,
  type BoardView,
  type FailedNotification,
  type KanbanActor,
  type KanbanServiceErrorCode,
  type KanbanEvent,
  type KanbanEventBody,
  type NotificationPurpose,
  type SessionFact,
} from './kanbanModel.js'
import { kanbanOrigin, planNotifications, type PlannedNotification } from './kanbanNotifications.js'

const BOARD_KEY_PATTERN = /^[A-Za-z0-9-]+$/
const EVENTS_FILE = 'events.jsonl'
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const FIRST_LINE_BYTES = 64 * 1024

const ERROR_STATUS: Record<KanbanServiceErrorCode, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_REQUEST: 400,
  INVALID_TRANSITION: 409,
  NOT_READY: 409,
  WOULD_CYCLE: 409,
  REVIEWER_IS_OWNER: 409,
  NO_OWNER: 409,
  CONFLICT: 409,
  START_FAILED: 502,
}

export class KanbanError extends Error {
  readonly status: number

  constructor(
    readonly code: KanbanServiceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'KanbanError'
    this.status = ERROR_STATUS[code]
  }
}

export type CommandOutcome = { view: BoardView; warnings: string[]; events: KanbanEvent[]; card?: number }

export type KanbanDeps = {
  sessionInfo: (sessionId: string) => Promise<BoardSessionInfo>
  sessionWorkspace: (sessionId: string) => Promise<{ projectRoot: string | null; workDir: string }>
  deliver: (sessionId: string, content: string, origin: UserMessageOrigin) => Promise<{ ok: boolean; message?: string }>
  createLinkedSession: (options: LinkedSessionOptions) => Promise<string>
  discardSession: (sessionId: string) => Promise<void>
  newId?: () => string
  now?: () => Date
}

type LoadedBoard = { board: Board; events: KanbanEvent[] }

type NewSession = { sessionId: string; card: number; assignment: string }

export type LaunchSession = () => Promise<string>

type Committed = {
  warnings: string[]
  events: KanbanEvent[]
  notifications: PlannedNotification[]
  newSession?: NewSession
  resend?: FailedNotification
}

function boardsDir(): string {
  return path.join(getClaudeConfigHomeDir(), 'boards')
}

function eventsPath(key: string): string {
  return path.join(boardsDir(), key, EVENTS_FILE)
}

function digest(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex')
}

async function readFirstLine(filePath: string): Promise<string | null> {
  const handle = await fs.open(filePath, 'r').catch(() => null)
  if (!handle) return null
  try {
    const buffer = Buffer.alloc(FIRST_LINE_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, FIRST_LINE_BYTES, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf-8')
    const end = text.indexOf('\n')
    return end === -1 ? text : text.slice(0, end)
  } finally {
    await handle.close()
  }
}

function commandSessionIds(command: KanbanCommand): string[] {
  return command.type === 'assign' && 'sessionId' in command.target ? [command.target.sessionId] : []
}

async function resolveLink(link: string, workDir: string): Promise<string> {
  if (!workDir || URL_SCHEME.test(link)) return link
  const absolute = path.resolve(workDir, link)
  const stat = await fs.stat(absolute).catch(() => null)
  return stat?.isFile() ? absolute : link
}

export function createKanban(deps: KanbanDeps) {
  const newId = deps.newId ?? randomUUID
  const now = deps.now ?? (() => new Date())
  const loaded = new Map<string, Promise<LoadedBoard>>()
  const queues = new Map<string, Promise<unknown>>()

  function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve()
    const next = previous.then(work, work)
    queues.set(key, next.catch(() => undefined))
    return next
  }

  async function read(key: string): Promise<LoadedBoard> {
    if (!BOARD_KEY_PATTERN.test(key)) throw new KanbanError('NOT_FOUND', 'No such board.')
    const events = await readJsonlFile<KanbanEvent>(eventsPath(key))
    const board = boardFromEvents(events)
    if (!board) throw new KanbanError('NOT_FOUND', 'No such board.')
    return { board, events }
  }

  function load(key: string): Promise<LoadedBoard> {
    const cached = loaded.get(key)
    if (cached) return cached
    const reading = read(key)
    loaded.set(key, reading)
    reading.catch(() => loaded.delete(key))
    return reading
  }

  async function append(key: string, state: LoadedBoard, bodies: KanbanEventBody[], actor: KanbanActor): Promise<KanbanEvent[]> {
    if (bodies.length === 0) return []
    const at = now().toISOString()
    const events = bodies.map((body, index) => ({ ...body, seq: state.board.version + index + 1, at, actor }) as KanbanEvent)
    const filePath = eventsPath(key)
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.appendFile(filePath, events.map((event) => JSON.stringify(event) + '\n').join(''), 'utf-8')
    } catch (error) {
      void diagnosticsService.recordEvent({
        type: 'kanban_write_failed',
        severity: 'error',
        summary: errorMessage(error),
        details: { board: key, events: bodies.map((body) => body.type) },
      })
      throw error
    }
    for (const event of events) {
      applyEvent(state.board, event)
      state.events.push(event)
    }
    return events
  }

  async function infoFor(sessionIds: Iterable<string>): Promise<Map<string, BoardSessionInfo>> {
    const ids = [...new Set(sessionIds)]
    const infos = await Promise.all(ids.map((id) => deps.sessionInfo(id)))
    return new Map(ids.map((id, index) => [id, infos[index]!]))
  }

  async function factsFor(sessionIds: Iterable<string>): Promise<Map<string, SessionFact>> {
    const infos = await infoFor(sessionIds)
    const facts = new Map<string, SessionFact>()
    await Promise.all(
      [...infos].map(async ([id, info]) => {
        facts.set(id, { ...info, projectRoot: info.exists ? (await deps.sessionWorkspace(id)).projectRoot : null })
      }),
    )
    return facts
  }

  async function buildView(key: string, state: LoadedBoard, actor: KanbanActor): Promise<BoardView> {
    const { board } = state
    const cards = Object.values(board.cards)
      .sort((a, b) => a.id - b.id)
      .map((card) => cardView(board, card))
    const infos = await infoFor(sessionsOnBoard(board))
    const sessions = Object.fromEntries([...infos].sort(([a], [b]) => a.localeCompare(b)))
    const exists = (id: string) => infos.get(id)?.exists ?? false
    const body = {
      key,
      project: board.project,
      version: board.version,
      cards,
      sessions,
      ...(actor.kind === 'human' ? { inbox: inboxFor(board, exists), handled: handledBy(state.events) } : {}),
    }
    return { ...body, etag: digest(body) }
  }

  async function startNewSession(
    state: LoadedBoard,
    bodies: KanbanEventBody[],
    repository: KanbanRepositoryOptions | undefined,
    launch: LaunchSession | undefined,
  ): Promise<NewSession | undefined> {
    const assigned = bodies.find(
      (body): body is Extract<KanbanEventBody, { type: 'assigned' }> => body.type === 'assigned' && body.sessionId === NEW_SESSION,
    )
    if (!assigned) return undefined
    const card = state.board.cards[assigned.card]!
    const parent = creatorOf(card)
    const created = launch
      ? launch()
      : deps.createLinkedSession({
          workDir: state.board.project,
          ...(repository ? { repository } : {}),
          ...(parent ? { parent: { sessionId: parent, kind: 'assigned' as const } } : {}),
          title: `#${card.id} ${card.title}`,
        })
    const sessionId = await created.catch((error: unknown) => {
      throw new KanbanError('START_FAILED', `The new session could not be created: ${errorMessage(error)}`)
    })
    assigned.sessionId = sessionId
    return { sessionId, card: card.id, assignment: assigned.assignment }
  }

  async function withResolvedLinks(command: KanbanCommand, actor: KanbanActor): Promise<KanbanCommand> {
    if (actor.kind !== 'session' || !('links' in command) || !command.links?.length) return command
    const { workDir } = await deps.sessionWorkspace(actor.sessionId)
    return { ...command, links: await Promise.all(command.links.map((link) => resolveLink(link, workDir))) }
  }

  async function plan(state: LoadedBoard, events: KanbanEvent[], command: KanbanCommand['type'], quietFor?: string): Promise<PlannedNotification[]> {
    const sessions = await infoFor(sessionsOnBoard(state.board))
    return planNotifications(state.board, events, (id) => sessions.get(id)?.title || 'a session', command)
      .filter((notification) => notification.to !== quietFor && (notification.purpose !== 'revocation' || sessions.get(notification.to)?.exists))
  }

  async function deliver(state: LoadedBoard, notification: PlannedNotification): Promise<string | null> {
    const info = await deps.sessionInfo(notification.to)
    if (!info.exists) return 'The session no longer exists.'
    const origin = kanbanOrigin(state.board, notification.purpose, notification.card)
    const result = await deps
      .deliver(notification.to, notification.body, origin)
      .catch((error: unknown) => ({ ok: false, message: errorMessage(error) }))
    return result.ok ? null : (result.message || 'The session could not be started.')
  }

  async function sendAll(key: string, committed: Committed): Promise<string[]> {
    const state = await load(key)
    const warnings: string[] = []
    const outcomes: KanbanEventBody[] = []
    for (const notification of committed.notifications) {
      const error = await deliver(state, notification)
      const { card, to, purpose } = notification
      const started = committed.newSession
      if (error && started && to === started.sessionId && purpose === 'assignment') {
        await abandon(key, started, error, outcomes)
        throw new KanbanError('START_FAILED', `The new session could not be started: ${error}`)
      }
      if (error) {
        warnings.push(`The ${purpose} notification to session ${to} was not delivered: ${error}`)
        outcomes.push({ type: 'notification_failed', card, to, purpose, error, body: notification.body })
      } else {
        outcomes.push({ type: 'notification_sent', card, to, purpose })
      }
    }
    if (outcomes.length) {
      await serialize(key, async () => {
        await append(key, await load(key), outcomes, { kind: 'human' })
      })
    }
    return warnings
  }

  async function abandon(key: string, started: NewSession, error: string, outcomes: KanbanEventBody[] = []): Promise<void> {
    await serialize(key, async () => {
      await append(key, await load(key), [
        ...outcomes,
        { type: 'assignment_revoked', card: started.card, assignment: started.assignment, reason: `The new session could not be started: ${error}` },
      ], { kind: 'human' })
    })
    await deps.discardSession(started.sessionId)
  }

  async function boardExists(key: string): Promise<boolean> {
    return loaded.has(key) || Boolean(await readFirstLine(eventsPath(key)))
  }

  async function resend(key: string, failed: FailedNotification): Promise<string[]> {
    const state = await load(key)
    const error = await deliver(state, failed)
    if (error) return [`The ${failed.purpose} notification to session ${failed.to} was not delivered: ${error}`]
    await serialize(key, async () => {
      await append(key, await load(key), [
        { type: 'notification_sent', card: failed.card, to: failed.to, purpose: failed.purpose, resends: failed.seq },
      ], { kind: 'human' })
    })
    return []
  }

  return {
    async listBoards(): Promise<BoardListing[]> {
      const entries = await fs.readdir(boardsDir(), { withFileTypes: true }).catch(() => [])
      const boards: BoardListing[] = []
      for (const entry of entries) {
        if (!entry.isDirectory() || !BOARD_KEY_PATTERN.test(entry.name)) continue
        const line = await readFirstLine(eventsPath(entry.name))
        if (!line) continue
        try {
          const first = JSON.parse(line) as KanbanEvent
          if (first.type === 'board_created') boards.push({ key: entry.name, project: first.project })
        } catch {
          console.warn(`[Kanban] Skipping board ${entry.name}: its first event is not valid JSON`)
        }
      }
      return boards.sort((a, b) => a.project.localeCompare(b.project))
    },

    async createBoard(project: string): Promise<BoardView> {
      const actor: KanbanActor = { kind: 'human' }
      const root = await resolveProjectRoot(project)
      const key = sanitizePath(root)
      await serialize(key, async () => {
        if (await boardExists(key)) {
          throw new KanbanError('CONFLICT', 'This project already has a board.')
        }
        const state: LoadedBoard = { board: emptyBoard(root), events: [] }
        await append(key, state, [{ type: 'board_created', project: root }], actor)
        loaded.set(key, Promise.resolve(state))
      })
      return buildView(key, await load(key), actor)
    },

    async boardForSession(sessionId: string, create = false): Promise<string | null> {
      const fact = (await factsFor([sessionId])).get(sessionId)!
      if (!fact.exists || !fact.projectRoot) return null
      const key = sanitizePath(fact.projectRoot)
      if (await boardExists(key)) return key
      if (!create) return null
      await this.createBoard(fact.projectRoot).catch((error: unknown) => {
        if (!(error instanceof KanbanError && error.code === 'CONFLICT')) throw error
      })
      return key
    },

    async view(key: string, actor: KanbanActor): Promise<BoardView> {
      return buildView(key, await load(key), actor)
    },

    async execute(key: string, requested: KanbanCommand, actor: KanbanActor, launch?: LaunchSession): Promise<CommandOutcome> {
      const command = await withResolvedLinks(requested, actor)
      const committed = await serialize(key, async (): Promise<Committed> => {
        const state = await load(key)
        const sessions = await factsFor(commandSessionIds(command))
        const result = validateCommand(state.board, command, actor, { newId, sessions })
        if (!result.ok) throw new KanbanError(result.code, result.message)
        if (command.type === 'resend_notification') {
          return { warnings: [], events: [], notifications: [], resend: state.board.failedNotifications[command.notification] }
        }
        const newSession = await startNewSession(state, result.events, command.type === 'assign' ? command.repository : undefined, launch)
        let events: KanbanEvent[]
        try {
          events = await append(key, state, result.events, actor)
        } catch (error) {
          if (newSession) await deps.discardSession(newSession.sessionId)
          throw error
        }
        const quietFor = launch ? newSession?.sessionId : undefined
        return { warnings: result.warnings, events, notifications: await plan(state, events, command.type, quietFor), ...(newSession ? { newSession } : {}) }
      })
      const warnings = [
        ...committed.warnings,
        ...(committed.resend ? await resend(key, committed.resend) : await sendAll(key, committed)),
      ]
      const touched = committed.events.find((event): event is Extract<KanbanEvent, { card: number }> => 'card' in event)
      return {
        view: await buildView(key, await load(key), actor),
        warnings,
        events: committed.events,
        ...(touched ? { card: touched.card } : {}),
      }
    },

    abandonNewSession: abandon,

    async history(key: string, card: number): Promise<KanbanEvent[]> {
      const state = await load(key)
      if (!state.board.cards[card]) throw new KanbanError('NOT_FOUND', `Card #${card} does not exist.`)
      return eventsForCard(state.events, card)
    },

    clear(): void {
      loaded.clear()
      queues.clear()
    },
  }
}

export type KanbanService = ReturnType<typeof createKanban>
