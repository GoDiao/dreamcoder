import {
  SDKControlKanbanCommandRequestSchema,
  SDKControlKanbanQueryRequestSchema,
  type KanbanCommand,
  type KanbanSessionCommand,
  type SDKControlKanbanCommandResponse,
  type SDKControlKanbanQueryRequest,
  type SDKControlKanbanQueryResponse,
} from '../../entrypoints/sdk/controlSchemas.js'
import { KANBAN_CREATE_TOOL_NAME } from '../../tools/KanbanListTool/constants.js'
import { errorMessage } from '../../utils/errors.js'
import { conversationService, type HostRequest } from './conversationService.js'
import { mayCreateUnder, rolesOf, type BoardView, type CardView, type KanbanActor, type KanbanEvent } from './kanbanModel.js'
import { DEFAULT_REVIEW_INSTRUCTIONS, assignmentBody } from './kanbanNotifications.js'
import { KanbanError, type KanbanService, type LaunchSession } from './kanbanService.js'
import type { CardAssigneeStart, StartedSession } from './sessionLinksService.js'

const KANBAN_REQUEST_SUBTYPES = new Set(['kanban_query', 'kanban_command'])
const NO_BOARD = `This project has no board yet. When the user asks for one, or asks you to track work on it, create its first card with ${KANBAN_CREATE_TOOL_NAME}: the board is created with it once the user approves.`
const RECENT_UPDATES = 10


function sessionRef(view: BoardView, sessionId: string | null): { sessionId: string; title: string } | null {
  return sessionId ? { sessionId, title: view.sessions[sessionId]?.title ?? '' } : null
}

function actorRef(view: BoardView, actor: KanbanActor): { sessionId: string; title: string } | 'the person' {
  return actor.kind === 'human' ? 'the person' : sessionRef(view, actor.sessionId)!
}

function listItem(view: BoardView, card: CardView, sessionId: string): Record<string, unknown> {
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    priority: card.priority,
    parent: card.parent,
    owner: sessionRef(view, card.owner),
    waitingOn: card.waitingOn,
    myRoles: rolesOf(card, sessionId),
  }
}

function summaryOf(view: BoardView, id: number): Record<string, unknown> {
  const card = view.cards.find((each) => each.id === id)
  return card ? { id, title: card.title, status: card.status } : { id }
}

function updateItem(view: BoardView, update: CardView['updates'][number]): Record<string, unknown> {
  return {
    kind: update.kind,
    text: update.text,
    ...(update.links ? { links: update.links } : {}),
    by: actorRef(view, update.actor),
    at: update.at,
  }
}

function cardDetail(view: BoardView, card: CardView, sessionId: string, history = false): Record<string, unknown> {
  const updates = history ? card.updates : card.updates.slice(-RECENT_UPDATES)
  const deliveries = history ? card.deliveries : card.deliveries.slice(-1)
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    priority: card.priority,
    description: card.description,
    acceptance: card.acceptance,
    parent: card.parent === null ? null : summaryOf(view, card.parent),
    children: card.children.map((id) => summaryOf(view, id)),
    dependsOn: card.dependsOn.map((id) => summaryOf(view, id)),
    waitingOn: card.waitingOn,
    owner: sessionRef(view, card.owner),
    reviewer: sessionRef(view, card.reviewer) ?? 'none: the person accepts the card',
    createdBy: actorRef(view, card.createdBy),
    myRoles: rolesOf(card, sessionId),
    assignments: card.assignments
      .filter((assignment) => assignment.status === 'active')
      .map((assignment) => ({
        id: assignment.id,
        role: assignment.role,
        session: sessionRef(view, assignment.sessionId),
        ...assignmentInstructions(assignment),
      })),
    updates: updates.map((update) => updateItem(view, update)),
    deliveries: deliveries.map((delivery) => ({ summary: delivery.summary, links: delivery.links, at: delivery.at })),
    ...(updates.length < card.updates.length ? { earlierUpdates: card.updates.length - updates.length } : {}),
    ...(deliveries.length < card.deliveries.length ? { earlierDeliveries: card.deliveries.length - deliveries.length } : {}),
  }
}

function assignmentInstructions(assignment: CardView['assignments'][number]): { instructions?: string } {
  if (assignment.role === 'reviewer') return { instructions: assignment.note ?? DEFAULT_REVIEW_INSTRUCTIONS }
  return assignment.note ? { instructions: assignment.note } : {}
}

function boardCommand(command: KanbanSessionCommand, sessionId: string): KanbanCommand {
  if (command.type !== 'assign') return command
  return { ...command, target: command.target === 'self' ? { sessionId } : command.target }
}

function findCard(view: BoardView, id: number): CardView {
  const card = view.cards.find((each) => each.id === id)
  if (!card) throw new KanbanError('NOT_FOUND', `Card #${id} does not exist.`)
  return card
}

export function createKanbanControl(kanban: KanbanService) {
  async function boardFor(sessionId: string, create = false): Promise<string> {
    const key = await kanban.boardForSession(sessionId, create)
    if (!key) throw new Error(NO_BOARD)
    return key
  }

  async function query(sessionId: string, request: SDKControlKanbanQueryRequest): Promise<SDKControlKanbanQueryResponse> {
    const actor: KanbanActor = { kind: 'session', sessionId }
    if (request.create) {
      const key = await kanban.boardForSession(sessionId)
      if (!key) return { approval: 'board' }
      const { parent } = request.create
      if (parent === undefined) return { approval: 'task' }
      const card = (await kanban.view(key, actor)).cards.find((each) => each.id === parent)
      return { approval: !card || mayCreateUnder(card, sessionId) ? null : 'task' }
    }
    const view = await kanban.view(await boardFor(sessionId), actor)
    const board = { project: view.project }
    if (request.card !== undefined) return { board, card: cardDetail(view, findCard(view, request.card), sessionId, request.history) }
    const mine = (request.list?.scope ?? 'mine') === 'mine'
    const statuses = request.list?.status
    const cards = view.cards
      .filter((card) => !card.archived)
      .filter((card) => !mine || rolesOf(card, sessionId).length > 0)
      .filter((card) => !statuses || statuses.includes(card.status))
      .map((card) => listItem(view, card, sessionId))
    return { board, cards }
  }

  async function command(sessionId: string, request: unknown): Promise<SDKControlKanbanCommandResponse> {
    const parsed = SDKControlKanbanCommandRequestSchema().safeParse(request)
    if (!parsed.success) throw new Error(`Invalid kanban_command request: ${parsed.error.issues[0]?.message ?? 'unknown shape'}`)
    const key = await boardFor(sessionId, parsed.data.command.type === 'create_card')
    const { view, warnings, card: touched } = await kanban.execute(key, boardCommand(parsed.data.command, sessionId), { kind: 'session', sessionId })
    const card = touched === undefined ? undefined : view.cards.find((each) => each.id === touched)
    return { ...(card ? { card: cardDetail(view, card, sessionId) } : {}), warnings }
  }

  async function startAssignee(sessionId: string, start: CardAssigneeStart, launch: LaunchSession): Promise<StartedSession> {
    const actor: KanbanActor = { kind: 'session', sessionId }
    const { card, role, instructions } = start
    const key = await boardFor(sessionId)
    const { view, events } = await kanban.execute(key, { type: 'assign', card, role, target: { newSession: true }, note: instructions }, actor, launch)
    const assigned = events.find((event): event is Extract<KanbanEvent, { type: 'assigned' }> => event.type === 'assigned')!
    const started = { sessionId: assigned.sessionId, card, assignment: assigned.assignment }
    const titles = (id: string) => view.sessions[id]?.title || 'a session'
    return {
      sessionId: started.sessionId,
      message: assignmentBody(findCard(view, card), role, instructions, actor, titles),
      abandon: (reason) => kanban.abandonNewSession(key, started, reason),
    }
  }

  return {
    startAssignee,

    handleControlRequest(sessionId: string, cliMsg: HostRequest): boolean {
      return conversationService.answerHostRequest(sessionId, cliMsg, KANBAN_REQUEST_SUBTYPES, async (subtype) => {
        if (subtype === 'kanban_command') return command(sessionId, cliMsg.request)
        const parsed = SDKControlKanbanQueryRequestSchema().safeParse(cliMsg.request)
        if (!parsed.success) throw new Error(`Invalid kanban_query request: ${parsed.error.issues[0]?.message ?? 'unknown shape'}`)
        return query(sessionId, parsed.data)
      }, (error) => error instanceof KanbanError ? `${error.code}: ${error.message}` : errorMessage(error))
    },
  }
}
