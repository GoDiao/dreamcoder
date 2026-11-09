import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { diagnosticsService } from '../services/diagnosticsService.js'
import type { UserMessageOrigin } from '../../entrypoints/sdk/coreSchemas.js'
import type { SessionParent } from '../../utils/sessionBranching.js'
import type { SessionFact } from '../services/kanbanModel.js'
import { createKanban, KanbanError, type KanbanService, type KanbanServiceErrorCode } from '../services/kanbanService.js'

const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR
const human = { kind: 'human' } as const

let configDir: string
let project: string
let facts: Map<string, SessionFact>
let kanban: KanbanService

function fact(overrides: Partial<SessionFact> = {}): SessionFact {
  return { exists: true, projectRoot: project, title: 'session', running: false, ...overrides }
}

type Delivery = { sessionId: string; content: string; origin: UserMessageOrigin }

let deliveries: Delivery[]
let failDeliveryTo: Set<string>
let created: Array<{ sessionId: string; workDir: string; parent?: SessionParent; title: string; repository?: unknown }>
let discarded: string[]

function service(): KanbanService {
  let id = 0
  return createKanban({
    sessionInfo: async (sessionId) => {
      const found = facts.get(sessionId)
      return found ? { title: found.title, exists: found.exists, running: found.running } : { title: '', exists: false, running: false }
    },
    sessionWorkspace: async (sessionId) => ({ projectRoot: facts.get(sessionId)?.projectRoot ?? null, workDir: facts.get(sessionId)?.projectRoot ?? '' }),
    deliver: async (sessionId, content, origin) => {
      if (failDeliveryTo.has(sessionId)) return { ok: false, message: 'CLI did not start' }
      deliveries.push({ sessionId, content, origin })
      return { ok: true }
    },
    createLinkedSession: async (options) => {
      const sessionId = `new-${created.length + 1}`
      created.push({ sessionId, ...options })
      facts.set(sessionId, fact({ title: options.title }))
      return sessionId
    },
    discardSession: async (sessionId) => {
      discarded.push(sessionId)
      facts.delete(sessionId)
    },
    newId: () => `id-${++id}`,
  })
}

async function boardFile(key: string): Promise<string> {
  return path.join(configDir, 'boards', key, 'events.jsonl')
}

async function expectKanbanError(work: Promise<unknown>, code: KanbanServiceErrorCode): Promise<void> {
  const error = await work.then(() => null, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(KanbanError)
  expect((error as KanbanError).code).toBe(code)
}

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-config-'))
  project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-project-')))
  process.env.DREAMCODER_CONFIG_DIR = configDir
  facts = new Map([
    ['planner', fact({ title: 'Planner' })],
    ['worker', fact({ title: 'Worker' })],
    ['reviewer', fact({ title: 'Reviewer' })],
  ])
  deliveries = []
  failDeliveryTo = new Set()
  created = []
  discarded = []
  kanban = service()
})

afterEach(async () => {
  if (configDirAtLoad === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  await fs.rm(configDir, { recursive: true, force: true })
  await fs.rm(project, { recursive: true, force: true })
})

describe('kanban service', () => {
  it('creates one board per project, from any directory inside it', async () => {
    const nested = path.join(project, '.claude', 'worktrees', 'task')
    await fs.mkdir(nested, { recursive: true })

    const view = await kanban.createBoard(nested)

    expect(view).toMatchObject({ project, cards: [], inbox: [] })
    expect(await kanban.listBoards()).toEqual([{ key: view.key, project }])
    await expectKanbanError(kanban.createBoard(project), 'CONFLICT')
  })

  it('restores the board from its log after a restart', async () => {
    const { key } = await kanban.createBoard(project)
    await kanban.execute(key, { type: 'create_card', title: 'Write docs', status: 'todo', acceptance: ['links work'] }, human)
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)
    await kanban.execute(key, { type: 'start', card: 1 }, { kind: 'session', sessionId: 'worker' })
    const before = await kanban.view(key, human)

    const restarted = service()
    const after = await restarted.view(key, human)

    expect(after).toEqual(before)
    expect(after.cards[0]).toMatchObject({ title: 'Write docs', status: 'in_progress', owner: 'worker' })
  })

  it('records who did what and when for each card', async () => {
    const { key } = await kanban.createBoard(project)
    await kanban.execute(key, { type: 'create_card', title: 'A' }, { kind: 'session', sessionId: 'planner' })
    await kanban.execute(key, { type: 'edit_card', card: 1, priority: 'high' }, human)

    const history = await kanban.history(key, 1)

    expect(history.map((event) => [event.type, event.actor])).toEqual([
      ['card_created', { kind: 'session', sessionId: 'planner' }],
      ['card_edited', human],
    ])
    expect(history.every((event) => !Number.isNaN(Date.parse(event.at)))).toBe(true)
  })

  it('skips a half-written last line and keeps the events before it', async () => {
    const { key } = await kanban.createBoard(project)
    await kanban.execute(key, { type: 'create_card', title: 'Kept' }, human)
    await fs.appendFile(await boardFile(key), '{"type":"card_created","card":2,"ti')

    const view = await service().view(key, human)

    expect(view.cards.map((card) => card.title)).toEqual(['Kept'])
  })

  it('applies concurrent commands one at a time without losing events', async () => {
    const { key } = await kanban.createBoard(project)

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => kanban.execute(key, { type: 'create_card', title: `Card ${index}` }, human)),
    )

    const lines = (await fs.readFile(await boardFile(key), 'utf-8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(lines.map((event) => event.seq)).toEqual(Array.from({ length: lines.length }, (_, index) => index + 1))
    const created = lines.filter((event) => event.type === 'card_created')
    expect(new Set(created.map((event) => event.card))).toEqual(new Set(Array.from({ length: 20 }, (_, index) => index + 1)))
    expect((await service().view(key, human)).cards).toHaveLength(20)
  })

  it('leaves the board unchanged and records a diagnostic when the log cannot be written', async () => {
    const recorded = spyOn(diagnosticsService, 'recordEvent').mockImplementation(async () => {})
    const { key } = await kanban.createBoard(project)
    const file = await boardFile(key)
    await fs.chmod(file, 0o444)

    const error = await kanban.execute(key, { type: 'create_card', title: 'Lost' }, human).then(() => null, (caught) => caught)

    await fs.chmod(file, 0o644)
    expect(error).toBeInstanceOf(Error)
    expect((await kanban.view(key, human)).cards).toEqual([])
    expect(recorded).toHaveBeenCalledWith(expect.objectContaining({ type: 'kanban_write_failed' }))
    recorded.mockRestore()
  })

  it('returns a validation failure as a typed error without writing', async () => {
    const { key } = await kanban.createBoard(project)
    await kanban.execute(key, { type: 'create_card', title: 'A', status: 'todo' }, human)
    const before = await fs.readFile(await boardFile(key), 'utf-8')

    await expectKanbanError(kanban.execute(key, { type: 'start', card: 1 }, human), 'NO_OWNER')
    await expectKanbanError(kanban.execute(key, { type: 'start', card: 1 }, { kind: 'session', sessionId: 'worker' }), 'FORBIDDEN')

    expect(await fs.readFile(await boardFile(key), 'utf-8')).toBe(before)
  })

  it('changes the etag when a session starts, stops or disappears, without a board event', async () => {
    const { key } = await kanban.createBoard(project)
    await kanban.execute(key, { type: 'create_card', title: 'A', status: 'todo' }, human)
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)
    const idle = await kanban.view(key, human)

    facts.set('worker', fact({ title: 'Worker', running: true }))
    const running = await kanban.view(key, human)
    expect(running.version).toBe(idle.version)
    expect(running.etag).not.toBe(idle.etag)
    expect(running.sessions.worker).toEqual({ title: 'Worker', exists: true, running: true })

    facts.set('worker', fact({ exists: false }))
    const deleted = await kanban.view(key, human)
    expect(deleted.etag).not.toBe(running.etag)
    expect(deleted.inbox).toEqual([{ kind: 'owner_missing', card: 1 }])

    expect((await kanban.view(key, human)).etag).toBe(deleted.etag)
  })

  it('does not reach the file system for an unknown or malformed key', async () => {
    await expectKanbanError(kanban.view('..%2F..%2Fetc', human), 'NOT_FOUND')
    await expectKanbanError(kanban.view('../../etc', human), 'NOT_FOUND')
    await expectKanbanError(kanban.view('no-such-board', human), 'NOT_FOUND')
  })

  it('finds the board of a session through its project, and creates it when asked', async () => {
    facts.set('elsewhere', fact({ projectRoot: '/other' }))
    expect(await kanban.boardForSession('worker')).toBeNull()

    const key = await kanban.boardForSession('worker', true)

    expect(await kanban.listBoards()).toEqual([{ key: key!, project }])
    expect(await kanban.boardForSession('planner')).toBe(key)
    expect(await kanban.boardForSession('elsewhere')).toBeNull()
    expect(await kanban.boardForSession('missing', true)).toBeNull()
  })

  it('gives two sessions adding the first cards at once the same new board', async () => {
    const [first, second] = await Promise.all([kanban.boardForSession('worker', true), kanban.boardForSession('planner', true)])

    expect(second).toBe(first)
    expect(await kanban.listBoards()).toEqual([{ key: first!, project }])
  })

  it('names the card a command created or changed', async () => {
    const { key } = await kanban.createBoard(project)

    expect((await kanban.execute(key, { type: 'create_card', title: 'First' }, human)).card).toBe(1)
    expect((await kanban.execute(key, { type: 'create_card', title: 'Second' }, human)).card).toBe(2)
    expect((await kanban.execute(key, { type: 'edit_card', card: 1, priority: 'high' }, human)).card).toBe(1)
  })

  it('shows a session the whole board, without the inbox, and lists the sessions that created cards', async () => {
    const { key } = await kanban.createBoard(project)
    await kanban.execute(key, { type: 'create_card', title: 'Mine', status: 'todo' }, human)
    await kanban.execute(key, { type: 'create_card', title: 'Theirs', status: 'todo' }, { kind: 'session', sessionId: 'planner' })
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)

    const view = await kanban.view(key, { kind: 'session', sessionId: 'worker' })

    expect(view.cards.map((card) => card.title)).toEqual(['Mine', 'Theirs'])
    expect(Object.keys(view.sessions)).toEqual(['planner', 'worker'])
    expect(view.inbox).toBeUndefined()
  })
})

describe('kanban notifications', () => {
  const planner = { kind: 'session', sessionId: 'planner' } as const
  const worker = { kind: 'session', sessionId: 'worker' } as const

  async function boardWithCard(actor: { kind: 'human' } | { kind: 'session'; sessionId: string } = human) {
    const { key } = await kanban.createBoard(project)
    await kanban.execute(key, { type: 'create_card', title: 'OAuth module', status: 'todo', description: 'Add OAuth login.', acceptance: ['tokens refresh'] }, actor)
    deliveries = []
    return key
  }

  async function logTypes(key: string): Promise<string[]> {
    return (await fs.readFile(await boardFile(key), 'utf-8')).trim().split('\n').map((line) => JSON.parse(line).type)
  }

  function sent() {
    return deliveries.map((delivery) => [delivery.sessionId, delivery.origin.kind === 'kanban' && delivery.origin.purpose])
  }

  it('sends an existing session its assignment with the card, who accepts it and the acceptance criteria', async () => {
    const key = await boardWithCard()

    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' }, note: 'start with the docs' }, human)

    expect(deliveries).toHaveLength(1)
    const [delivery] = deliveries
    expect(delivery!.sessionId).toBe('worker')
    expect(delivery!.origin).toEqual({ kind: 'kanban', project, card: { id: 1, title: 'OAuth module' }, purpose: 'assignment' })
    expect(delivery!.content).toContain('Card #1: OAuth module')
    expect(delivery!.content).toContain('Created by the person.\nIt has no reviewer; the person accepts it.')
    expect(delivery!.content).toContain('Note from the person: start with the docs')
    expect(delivery!.content).toContain('Add OAuth login.')
    expect(delivery!.content).toContain('- tokens refresh')
    expect((await logTypes(key)).slice(-2)).toEqual(['assigned', 'notification_sent'])
  })

  it('starts a new session on its own when the person assigns it, records the assignment and then delivers to it', async () => {
    const key = await boardWithCard()

    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { newSession: true }, repository: { worktree: true } }, human)

    expect(created).toEqual([{ sessionId: 'new-1', workDir: project, repository: { worktree: true }, title: '#1 OAuth module' }])
    expect(sent()).toEqual([['new-1', 'assignment']])
    const lines = (await fs.readFile(await boardFile(key), 'utf-8')).trim().split('\n').map((line) => JSON.parse(line))
    const assigned = lines.findIndex((event) => event.type === 'assigned')
    expect(lines[assigned].sessionId).toBe('new-1')
    expect(lines[assigned + 1].type).toBe('notification_sent')
    expect((await kanban.view(key, human)).cards[0]!.owner).toBe('new-1')
  })

  it('starts a new session the person assigns under the session that created the card', async () => {
    const key = await boardWithCard(planner)

    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { newSession: true } }, human)

    expect(created.map(({ sessionId, parent }) => [sessionId, parent])).toEqual([['new-1', { sessionId: 'planner', kind: 'assigned' }]])
  })

  it('revokes the assignment and removes the session when a new session cannot start', async () => {
    const key = await boardWithCard(planner)
    failDeliveryTo.add('new-1')

    await expectKanbanError(kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { newSession: true } }, human), 'START_FAILED')

    expect(discarded).toEqual(['new-1'])
    const view = await kanban.view(key, human)
    expect(view.cards[0]!.owner).toBeNull()
    expect(view.cards[0]!.assignments[0]).toMatchObject({ status: 'revoked', sessionId: 'new-1', reason: 'The new session could not be started: CLI did not start' })
    expect((await logTypes(key)).slice(-2)).toEqual(['assigned', 'assignment_revoked'])
  })

  it('still records the notifications it sent before a new session failed to start', async () => {
    const key = await boardWithCard(planner)
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)
    failDeliveryTo.add('new-1')

    await expectKanbanError(kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { newSession: true } }, human), 'START_FAILED')

    expect((await logTypes(key)).slice(-4)).toEqual(['assignment_revoked', 'assigned', 'notification_sent', 'assignment_revoked'])
  })

  it('validates before a caller launches the new session, then assigns it without notifying it', async () => {
    const key = await boardWithCard(planner)
    let launched = 0
    const launch = async () => {
      launched += 1
      facts.set('child', fact({ title: 'Child' }))
      return 'child'
    }

    await expectKanbanError(kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { newSession: true } }, worker, launch), 'FORBIDDEN')
    expect(launched).toBe(0)

    const outcome = await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { newSession: true } }, planner, launch)

    expect(launched).toBe(1)
    expect(created).toEqual([])
    expect(outcome.view.cards[0]!.owner).toBe('child')
    expect(deliveries).toEqual([])
  })

  it('tells a session when its assignment is revoked and then refuses its work on the card', async () => {
    const key = await boardWithCard()
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)
    const assignment = (await kanban.view(key, human)).cards[0]!.assignments[0]!.id
    deliveries = []

    await kanban.execute(key, { type: 'revoke_assignment', assignment, reason: 'moving it to another session' }, human)

    expect(deliveries).toEqual([
      expect.objectContaining({
        sessionId: 'worker',
        origin: expect.objectContaining({ purpose: 'revocation' }),
        content: expect.stringContaining('moving it to another session'),
      }),
    ])
    await expectKanbanError(kanban.execute(key, { type: 'start', card: 1 }, worker), 'FORBIDDEN')
  })

  it('sends a comment from the person to the owner, and to the creator when asked', async () => {
    const key = await boardWithCard(planner)
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)
    await kanban.execute(key, { type: 'assign', card: 1, role: 'reviewer', target: { sessionId: 'reviewer' } }, human)
    deliveries = []

    await kanban.execute(key, { type: 'add_update', card: 1, kind: 'comment', text: 'use PKCE' }, human)
    expect(deliveries.map((delivery) => delivery.sessionId)).toEqual(['worker'])

    deliveries = []
    await kanban.execute(key, { type: 'add_update', card: 1, kind: 'comment', text: 'and rotate keys', notify: ['creator'] }, human)
    expect(deliveries.map((delivery) => delivery.sessionId)).toEqual(['worker', 'planner'])
    expect(deliveries[0]!.content).toContain('and rotate keys')

    deliveries = []
    await kanban.execute(key, { type: 'add_update', card: 1, kind: 'comment', text: 'noted' }, worker)
    expect(deliveries).toEqual([])
  })

  it('reports a submission to the reviewer and the creator, and a blocker to the creator, not to the session parent', async () => {
    const key = await boardWithCard(planner)
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)
    await kanban.execute(key, { type: 'assign', card: 1, role: 'reviewer', target: { sessionId: 'reviewer' } }, human)
    await kanban.execute(key, { type: 'start', card: 1 }, worker)
    deliveries = []

    await kanban.execute(key, { type: 'block', card: 1, reason: 'no test keys' }, worker)
    await kanban.execute(key, { type: 'unblock', card: 1 }, planner)
    await kanban.execute(key, { type: 'submit', card: 1, summary: 'issues tokens', links: ['https://example.test/pr/2'] }, worker)

    expect(sent()).toEqual([
      ['planner', 'blocked'],
      ['worker', 'unblocked'],
      ['reviewer', 'review'],
      ['planner', 'review'],
    ])
    expect(deliveries[0]!.content).toContain('no test keys')
    expect(deliveries[1]!.content).toContain('Unblocked by Planner')
    expect(deliveries[2]!.content).toContain('issues tokens')
    expect(deliveries[2]!.content).toContain('Reviewer, who accepts it: Reviewer (session:reviewer)')
  })

  it('tells only the creator about a submission the person accepts', async () => {
    const key = await boardWithCard(planner)
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)
    await kanban.execute(key, { type: 'start', card: 1 }, worker)
    deliveries = []

    await kanban.execute(key, { type: 'submit', card: 1, summary: 'module done' }, worker)

    expect(sent()).toEqual([['planner', 'review']])
    expect(deliveries[0]!.content).toContain('It has no reviewer; the person accepts it.')
  })

  it('tells the owner when changes are requested, and when the card is reset or cancelled, with the reason and the report file', async () => {
    const key = await boardWithCard()
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)
    await kanban.execute(key, { type: 'start', card: 1 }, worker)
    await kanban.execute(key, { type: 'submit', card: 1, summary: 'login works' }, worker)
    deliveries = []

    await kanban.execute(key, { type: 'request_changes', card: 1, reason: 'see the review', links: ['/repo/review-1.md'] }, human)
    await kanban.execute(key, { type: 'reset', card: 1, reason: 'scope changed' }, human)
    await kanban.execute(key, { type: 'cancel', card: 1, reason: 'not needed' }, human)

    expect(sent()).toEqual([
      ['worker', 'changes_requested'],
      ['worker', 'reset'],
      ['worker', 'cancelled'],
    ])
    expect(deliveries[0]!.content).toContain('Changes requested by the person:\nsee the review\nLinks:\n- /repo/review-1.md')
    expect(deliveries[1]!.content).toContain('Sent back to Todo by the person.\nReason: scope changed')
    expect(deliveries[2]!.content).toContain('Cancelled by the person.\nReason: not needed')
  })

  it('stores a file link from a session as an absolute path in its working directory and leaves other links alone', async () => {
    const key = await boardWithCard()
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)
    await kanban.execute(key, { type: 'start', card: 1 }, worker)
    await fs.mkdir(path.join(project, 'docs'))
    await fs.writeFile(path.join(project, 'docs', 'report.md'), '# Report')

    const outcome = await kanban.execute(key, {
      type: 'submit',
      card: 1,
      summary: 'done',
      links: ['docs/report.md', 'feat/oauth', 'https://example.test/pr/1'],
    }, worker)

    expect(outcome.view.cards[0]!.deliveries[0]!.links).toEqual([path.join(project, 'docs', 'report.md'), 'feat/oauth', 'https://example.test/pr/1'])

    await kanban.execute(key, { type: 'assign', card: 1, role: 'reviewer', target: { sessionId: 'planner' } }, human)
    const accepted = await kanban.execute(key, { type: 'accept', card: 1, summary: 'read it', links: ['docs/report.md'] }, { kind: 'session', sessionId: 'planner' })
    expect(accepted.view.cards[0]!.updates.at(-1)).toMatchObject({ kind: 'accepted', links: [path.join(project, 'docs', 'report.md')] })
  })

  it('makes a session the role it assigned itself, replacing the holder, without notifying it', async () => {
    const key = await boardWithCard()
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'planner' } }, human)
    deliveries = []

    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, worker)

    expect((await kanban.view(key, human)).cards[0]!.owner).toBe('worker')
    expect(sent()).toEqual([['planner', 'revocation']])
  })

  it('does not notify a creator about its own action', async () => {
    const key = await boardWithCard(planner)
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)
    deliveries = []

    await kanban.execute(key, { type: 'block', card: 1, reason: 'waiting' }, planner)

    expect(deliveries).toEqual([])
  })

  it('keeps a command that succeeded when its notification fails, and lets the person resend it', async () => {
    const key = await boardWithCard()
    failDeliveryTo.add('worker')

    const outcome = await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)

    expect(outcome.warnings).toEqual(['The assignment notification to session worker was not delivered: CLI did not start'])
    const card = outcome.view.cards[0]!
    expect(card.owner).toBe('worker')
    expect(card.failedNotifications).toHaveLength(1)

    failDeliveryTo.clear()
    const resent = await kanban.execute(key, { type: 'resend_notification', notification: card.failedNotifications[0]! }, human)

    expect(resent.warnings).toEqual([])
    expect(resent.view.cards[0]!.failedNotifications).toEqual([])
    expect(deliveries.map((delivery) => delivery.sessionId)).toEqual(['worker'])
    expect(deliveries[0]!.content).toContain('Card #1: OAuth module')
  })

  it('records a notification to a deleted creator as not delivered without trying to start it', async () => {
    const key = await boardWithCard(planner)
    await kanban.execute(key, { type: 'assign', card: 1, role: 'owner', target: { sessionId: 'worker' } }, human)
    await kanban.execute(key, { type: 'start', card: 1 }, worker)
    facts.set('planner', fact({ exists: false }))
    deliveries = []

    const outcome = await kanban.execute(key, { type: 'submit', card: 1, summary: 'done' }, worker)

    expect(deliveries).toEqual([])
    expect(outcome.warnings).toEqual(['The review notification to session planner was not delivered: The session no longer exists.'])
    expect(outcome.view.cards[0]!.status).toBe('review')
  })
})
