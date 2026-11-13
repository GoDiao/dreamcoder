import type {
  KANBAN_CARD_STATUSES,
  KANBAN_PRIORITIES,
  KANBAN_ROLES,
  KANBAN_UPDATE_KINDS,
  KanbanCommand,
} from '../../entrypoints/sdk/controlSchemas.js'
import type { KanbanOrigin } from '../../entrypoints/sdk/coreSchemas.js'

export type KanbanActor = { kind: 'human' } | { kind: 'session'; sessionId: string }
export type CardStatus = (typeof KANBAN_CARD_STATUSES)[number]
export type CardPriority = (typeof KANBAN_PRIORITIES)[number]
export type AssignmentRole = (typeof KANBAN_ROLES)[number]
export type UpdateKind = (typeof KANBAN_UPDATE_KINDS)[number] | 'blocked' | 'changes_requested' | 'accepted'
export type NotificationPurpose = KanbanOrigin['purpose']

export const NEW_SESSION = 'new-session'

export type Assignment = {
  id: string
  role: AssignmentRole
  status: 'active' | 'revoked'
  sessionId: string
  assignedBy: KanbanActor
  note?: string
  assignedAt: string
  endedAt?: string
  reason?: string
}

export type CardUpdate = { id: string; kind: UpdateKind; text: string; links?: string[]; actor: KanbanActor; at: string }
export type Delivery = { id: string; summary: string; links: string[]; actor: KanbanActor; at: string }

export type Card = {
  id: number
  title: string
  description: string
  acceptance: string[]
  parent: number | null
  priority: CardPriority
  status: CardStatus
  blockedFrom: CardStatus | null
  order: number
  archived: boolean
  dependsOn: number[]
  assignments: Assignment[]
  updates: CardUpdate[]
  deliveries: Delivery[]
  createdBy: KanbanActor
  createdAt: string
  updatedAt: string
}

export type FailedNotification = { seq: number; card: number; to: string; purpose: NotificationPurpose; error: string; body: string }

export type Board = {
  project: string
  nextCard: number
  version: number
  cards: Record<number, Card>
  failedNotifications: Record<number, FailedNotification>
}

export type KanbanEventBody =
  | { type: 'board_created'; project: string }
  | {
      type: 'card_created'
      card: number
      title: string
      description: string
      acceptance: string[]
      parent: number | null
      priority: CardPriority
      status: 'backlog' | 'todo'
    }
  | { type: 'card_edited'; card: number; title?: string; description?: string; acceptance?: string[]; priority?: CardPriority }
  | { type: 'card_moved'; card: number; status: 'backlog' | 'todo'; order: number }
  | { type: 'status_changed'; card: number; from: CardStatus; to: CardStatus; reason?: string }
  | { type: 'dependency_added'; card: number; dependsOn: number }
  | { type: 'dependency_removed'; card: number; dependsOn: number }
  | { type: 'assigned'; card: number; assignment: string; role: AssignmentRole; sessionId: string; note?: string }
  | { type: 'assignment_revoked'; card: number; assignment: string; reason: string }
  | { type: 'update_added'; card: number; update: string; kind: UpdateKind; text: string; links?: string[]; notify?: string[] }
  | { type: 'delivery_submitted'; card: number; delivery: string; summary: string; links: string[] }
  | { type: 'notification_sent'; card: number; to: string; purpose: NotificationPurpose; resends?: number }
  | { type: 'notification_failed'; card: number; to: string; purpose: NotificationPurpose; error: string; body: string }
  | { type: 'card_archived'; card: number }
  | { type: 'card_unarchived'; card: number }

export type KanbanEvent = KanbanEventBody & { seq: number; at: string; actor: KanbanActor }

export type KanbanErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'INVALID_TRANSITION'
  | 'NOT_READY'
  | 'WOULD_CYCLE'
  | 'REVIEWER_IS_OWNER'
  | 'NO_OWNER'

export type KanbanServiceErrorCode = KanbanErrorCode | 'CONFLICT' | 'START_FAILED'

export type SessionFact = { exists: boolean; projectRoot: string | null; title: string; running: boolean }

export type CommandContext = {
  newId: () => string
  sessions: ReadonlyMap<string, SessionFact>
}

export type CommandResult =
  | { ok: true; events: KanbanEventBody[]; warnings: string[] }
  | { ok: false; code: KanbanErrorCode; message: string }

const OPEN: CardStatus[] = ['backlog', 'todo', 'in_progress', 'blocked', 'review']
const OPEN_STATUSES: ReadonlySet<CardStatus> = new Set(OPEN)

export function emptyBoard(project: string): Board {
  return { project, nextCard: 1, version: 0, cards: {}, failedNotifications: {} }
}

function findAssignment(card: Card, id: string): Assignment | undefined {
  return card.assignments.find((assignment) => assignment.id === id)
}

function dropFailedNotifications(board: Board, card: number, to?: string): void {
  for (const failed of Object.values(board.failedNotifications)) {
    if (failed.card === card && (to === undefined || failed.to === to)) delete board.failedNotifications[failed.seq]
  }
}

export function applyEvent(board: Board, event: KanbanEvent): void {
  board.version = event.seq
  const touch = (card: Card) => {
    card.updatedAt = event.at
  }
  switch (event.type) {
    case 'board_created':
      board.project = event.project
      return
    case 'card_created':
      board.cards[event.card] = {
        id: event.card,
        title: event.title,
        description: event.description,
        acceptance: [...event.acceptance],
        parent: event.parent,
        priority: event.priority,
        status: event.status,
        blockedFrom: null,
        order: event.card,
        archived: false,
        dependsOn: [],
        assignments: [],
        updates: [],
        deliveries: [],
        createdBy: event.actor,
        createdAt: event.at,
        updatedAt: event.at,
      }
      board.nextCard = Math.max(board.nextCard, event.card + 1)
      return
    case 'notification_sent':
      if (event.resends !== undefined) delete board.failedNotifications[event.resends]
      return
    case 'notification_failed':
      board.failedNotifications[event.seq] = {
        seq: event.seq,
        card: event.card,
        to: event.to,
        purpose: event.purpose,
        error: event.error,
        body: event.body,
      }
      return
  }

  const card = board.cards[event.card]
  if (!card) return
  touch(card)
  switch (event.type) {
    case 'card_edited':
      if (event.title !== undefined) card.title = event.title
      if (event.description !== undefined) card.description = event.description
      if (event.acceptance !== undefined) card.acceptance = [...event.acceptance]
      if (event.priority !== undefined) card.priority = event.priority
      return
    case 'card_moved':
      card.status = event.status
      card.order = event.order
      return
    case 'status_changed':
      card.blockedFrom = event.to === 'blocked' ? event.from : null
      card.status = event.to
      if (!OPEN_STATUSES.has(event.to)) dropFailedNotifications(board, card.id)
      return
    case 'dependency_added':
      if (!card.dependsOn.includes(event.dependsOn)) card.dependsOn.push(event.dependsOn)
      return
    case 'dependency_removed':
      card.dependsOn = card.dependsOn.filter((id) => id !== event.dependsOn)
      return
    case 'assigned':
      card.assignments.push({
        id: event.assignment,
        role: event.role,
        status: 'active',
        sessionId: event.sessionId,
        assignedBy: event.actor,
        ...(event.note ? { note: event.note } : {}),
        assignedAt: event.at,
      })
      return
    case 'assignment_revoked': {
      const assignment = findAssignment(card, event.assignment)
      if (!assignment) return
      assignment.status = 'revoked'
      assignment.endedAt = event.at
      assignment.reason = event.reason
      dropFailedNotifications(board, card.id, assignment.sessionId)
      return
    }
    case 'update_added':
      card.updates.push({ id: event.update, kind: event.kind, text: event.text, ...(event.links?.length ? { links: [...event.links] } : {}), actor: event.actor, at: event.at })
      return
    case 'delivery_submitted':
      card.deliveries.push({ id: event.delivery, summary: event.summary, links: [...event.links], actor: event.actor, at: event.at })
      return
    case 'card_archived':
      card.archived = true
      return
    case 'card_unarchived':
      card.archived = false
      return
  }
}

export function boardFromEvents(events: readonly KanbanEvent[]): Board | null {
  const first = events[0]
  if (!first || first.type !== 'board_created') return null
  const board = emptyBoard(first.project)
  for (const event of events) applyEvent(board, event)
  return board
}

export function activeAssignments(card: Card): Assignment[] {
  return card.assignments.filter((assignment) => assignment.status === 'active')
}

export function ownerOf(card: Card): string | null {
  return activeAssignments(card).find((assignment) => assignment.role === 'owner')?.sessionId ?? null
}

export function reviewerOf(card: Card): string | null {
  return activeAssignments(card).find((assignment) => assignment.role === 'reviewer')?.sessionId ?? null
}

export function childrenOf(board: Board, card: Card): Card[] {
  return Object.values(board.cards).filter((other) => other.parent === card.id)
}

export function waitingOn(board: Board, card: Card): number[] {
  return card.dependsOn.filter((id) => board.cards[id]?.status !== 'done')
}

export function wouldCycle(board: Board, card: number, dependsOn: number): boolean {
  const stack = [dependsOn]
  const seen = new Set<number>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === card) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(board.cards[id]?.dependsOn ?? []))
  }
  return false
}

const CARD_ROLES = ['owner', 'reviewer', 'creator'] as const
type CardRole = (typeof CARD_ROLES)[number]

export function creatorOf(card: Card): string | null {
  return card.createdBy.kind === 'session' ? card.createdBy.sessionId : null
}

const ROLE_HOLDER: Record<CardRole, (card: Card) => string | null> = {
  owner: ownerOf,
  reviewer: reviewerOf,
  creator: creatorOf,
}

export function rolesOf(card: Card, sessionId: string): CardRole[] {
  return CARD_ROLES.filter((role) => ROLE_HOLDER[role](card) === sessionId)
}

export function mayCreateUnder(card: Card, sessionId: string): boolean {
  return ownerOf(card) === sessionId || creatorOf(card) === sessionId
}

const ROLE_NAME: Record<CardRole, string> = {
  owner: 'its owner',
  reviewer: 'its reviewer',
  creator: 'the session that created it',
}

type Permission = { roles: readonly CardRole[] | 'any'; action: string }

const PERMISSIONS: Record<KanbanCommand['type'], Permission> = {
  create_card: { roles: 'any', action: 'create a card' },
  add_update: { roles: 'any', action: 'add an update' },
  edit_card: { roles: ['owner', 'creator'], action: 'edit the card' },
  add_dependency: { roles: ['owner', 'creator'], action: 'change its dependencies' },
  remove_dependency: { roles: ['owner', 'creator'], action: 'change its dependencies' },
  block: { roles: ['owner', 'creator'], action: 'mark it blocked' },
  unblock: { roles: ['owner', 'creator'], action: 'unblock it' },
  assign: { roles: ['owner', 'creator'], action: 'assign another session to it' },
  start: { roles: ['owner'], action: 'start it' },
  submit: { roles: ['owner'], action: 'submit its result' },
  request_changes: { roles: ['reviewer'], action: 'request changes' },
  accept: { roles: ['reviewer'], action: 'accept it' },
  move_card: { roles: ['creator'], action: 'move it between Backlog and Todo' },
  reset: { roles: ['creator'], action: 'send it back to Todo' },
  cancel: { roles: ['creator'], action: 'cancel it' },
  revoke_assignment: { roles: ['creator'], action: 'revoke an assignment' },
  reopen: { roles: [], action: 'reopen it' },
  archive: { roles: [], action: 'archive it' },
  unarchive: { roles: [], action: 'unarchive it' },
  resend_notification: { roles: [], action: 'resend a notification' },
}

function joinOr(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items.at(-1)}` : items[0]!
}

function commandCard(board: Board, command: KanbanCommand): Card | undefined {
  if ('card' in command) return board.cards[command.card]
  if ('assignment' in command) return findAssignmentOnBoard(board, command.assignment)?.card
  return undefined
}

function assignsItself(command: KanbanCommand, actor: KanbanActor): boolean {
  return command.type === 'assign' && actor.kind === 'session' && 'sessionId' in command.target && command.target.sessionId === actor.sessionId
}

function checkPermission(board: Board, command: KanbanCommand, actor: KanbanActor): CommandResult | null {
  const { roles, action } = PERMISSIONS[command.type]
  if (actor.kind === 'human' || roles === 'any' || assignsItself(command, actor)) return null
  const card = commandCard(board, command)
  if (!card && roles.length) return null
  if (card && roles.some((role) => ROLE_HOLDER[role](card) === actor.sessionId)) return null
  const who = joinOr([...roles.map((role) => ROLE_NAME[role]), 'a person'])
  return fail('FORBIDDEN', card ? `Only ${who} can ${action}: card #${card.id}.` : `Only ${who} can ${action}.`)
}

const ok = (events: KanbanEventBody[], warnings: string[] = []): CommandResult => ({ ok: true, events, warnings })
const fail = (code: KanbanErrorCode, message: string): CommandResult => ({ ok: false, code, message })

function transition(card: Card, to: CardStatus, reason?: string): KanbanEventBody {
  return { type: 'status_changed', card: card.id, from: card.status, to, ...(reason ? { reason } : {}) }
}

function cardList(cards: readonly Card[]): string {
  return cards.map((each) => `#${each.id}`).join(', ')
}

function cancellationEvents(
  board: Board,
  card: Card,
  command: Extract<KanbanCommand, { type: 'cancel' }>,
): KanbanEventBody[] {
  const cancelled = new Set([card.id])
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of Object.values(board.cards)) {
      if (cancelled.has(candidate.id) || !OPEN_STATUSES.has(candidate.status)) continue
      const child = command.cancelChildren === true && candidate.parent !== null && cancelled.has(candidate.parent)
      const dependent = command.cancelDependents === true && candidate.dependsOn.some((id) => cancelled.has(id))
      if (!child && !dependent) continue
      cancelled.add(candidate.id)
      changed = true
    }
  }
  const cards = [card, ...[...cancelled]
    .filter((id) => id !== card.id)
    .sort((a, b) => a - b)
    .map((id) => board.cards[id]!)]
  const events: KanbanEventBody[] = cards.map((candidate) => transition(candidate, 'cancelled', command.reason))
  for (const candidate of Object.values(board.cards).sort((a, b) => a.id - b.id)) {
    for (const dependency of candidate.dependsOn.filter((id) => cancelled.has(id))) {
      events.push({ type: 'dependency_removed', card: candidate.id, dependsOn: dependency })
    }
  }
  return events
}

function requireStatus(card: Card, allowed: CardStatus[], action: string): CommandResult | null {
  return allowed.includes(card.status)
    ? null
    : fail('INVALID_TRANSITION', `Cannot ${action} card #${card.id} while it is ${card.status}.`)
}

function checkTarget(board: Board, sessionId: string, context: CommandContext): CommandResult | null {
  if (sessionId === NEW_SESSION) return null
  const fact = context.sessions.get(sessionId)
  if (!fact?.exists) return fail('INVALID_REQUEST', `Session ${sessionId} does not exist.`)
  if (fact.projectRoot !== board.project) return fail('INVALID_REQUEST', `Session ${sessionId} belongs to another project.`)
  return null
}

export function findAssignmentOnBoard(board: Board, id: string): { card: Card; assignment: Assignment } | null {
  for (const card of Object.values(board.cards)) {
    const assignment = findAssignment(card, id)
    if (assignment) return { card, assignment }
  }
  return null
}

export function validateCommand(
  board: Board,
  command: KanbanCommand,
  actor: KanbanActor,
  context: CommandContext,
): CommandResult {
  const denied = checkPermission(board, command, actor)
  if (denied) return denied

  switch (command.type) {
    case 'create_card': {
      if (command.parent !== undefined && !board.cards[command.parent]) return fail('NOT_FOUND', `Card #${command.parent} does not exist.`)
      for (const dependency of command.dependsOn ?? []) {
        if (!board.cards[dependency]) return fail('NOT_FOUND', `Card #${dependency} does not exist.`)
      }
      const id = board.nextCard
      const events: KanbanEventBody[] = [
        {
          type: 'card_created',
          card: id,
          title: command.title,
          description: command.description ?? '',
          acceptance: command.acceptance ?? [],
          parent: command.parent ?? null,
          priority: command.priority ?? 'normal',
          status: command.status ?? 'backlog',
        },
      ]
      for (const dependency of new Set(command.dependsOn ?? [])) {
        events.push({ type: 'dependency_added', card: id, dependsOn: dependency })
      }
      return ok(events)
    }

    case 'revoke_assignment': {
      const found = findAssignmentOnBoard(board, command.assignment)
      if (!found) return fail('NOT_FOUND', `Assignment ${command.assignment} does not exist.`)
      const { card, assignment } = found
      if (assignment.status !== 'active') {
        return fail('INVALID_TRANSITION', `Assignment ${assignment.id} is ${assignment.status}, not active.`)
      }
      return ok([{ type: 'assignment_revoked', card: card.id, assignment: assignment.id, reason: command.reason }])
    }

    case 'resend_notification':
      if (!board.failedNotifications[command.notification]) {
        return fail('NOT_FOUND', `Notification ${command.notification} has no failed delivery to resend.`)
      }
      return ok([])
  }
  const card = board.cards[command.card]
  if (!card) return fail('NOT_FOUND', `Card #${command.card} does not exist.`)
  return validateCardCommand(board, card, command, actor, context)
}

type CardCommand = Exclude<KanbanCommand, { type: 'create_card' | 'revoke_assignment' | 'resend_notification' }>

function validateCardCommand(board: Board, card: Card, command: CardCommand, actor: KanbanActor, context: CommandContext): CommandResult {
  switch (command.type) {
    case 'edit_card': {
      const fields: Omit<Extract<KanbanEventBody, { type: 'card_edited' }>, 'type' | 'card'> = {}
      if (command.title !== undefined) fields.title = command.title
      if (command.description !== undefined) fields.description = command.description
      if (command.acceptance !== undefined) fields.acceptance = command.acceptance
      if (command.priority !== undefined) fields.priority = command.priority
      if (Object.keys(fields).length === 0) return fail('INVALID_REQUEST', 'Nothing to edit.')
      return ok([{ type: 'card_edited', card: card.id, ...fields }])
    }

    case 'move_card': {
      const invalid = requireStatus(card, ['backlog', 'todo'], 'move')
      if (invalid) return invalid
      return ok([{ type: 'card_moved', card: card.id, status: command.status, order: command.order ?? card.order }])
    }

    case 'start': {
      const invalid = requireStatus(card, ['backlog', 'todo'], 'start')
      if (invalid) return invalid
      if (ownerOf(card) === null) return fail('NO_OWNER', `Card #${card.id} has no active owner.`)
      const blocking = waitingOn(board, card)
      if (blocking.length) {
        return fail('NOT_READY', `Card #${card.id} waits on ${blocking.map((id) => `#${id}`).join(', ')}.`)
      }
      return ok([transition(card, 'in_progress')])
    }

    case 'block': {
      const invalid = requireStatus(card, ['todo', 'in_progress'], 'block')
      if (invalid) return invalid
      return ok([
        transition(card, 'blocked', command.reason),
        { type: 'update_added', card: card.id, update: context.newId(), kind: 'blocked', text: command.reason },
      ])
    }

    case 'unblock': {
      const invalid = requireStatus(card, ['blocked'], 'unblock')
      if (invalid) return invalid
      return ok([transition(card, card.blockedFrom ?? 'todo')])
    }

    case 'submit': {
      const invalid = requireStatus(card, ['in_progress'], 'submit')
      if (invalid) return invalid
      const open = childrenOf(board, card).filter((child) => OPEN_STATUSES.has(child.status))
      const warnings = open.length
        ? [`Card #${card.id} still has unfinished sub-cards: ${cardList(open)}.`]
        : []
      return ok(
        [
          { type: 'delivery_submitted', card: card.id, delivery: context.newId(), summary: command.summary, links: command.links ?? [] },
          transition(card, 'review'),
        ],
        warnings,
      )
    }

    case 'request_changes': {
      const invalid = requireStatus(card, ['review'], 'request changes on')
      if (invalid) return invalid
      return ok([
        transition(card, 'in_progress', command.reason),
        { type: 'update_added', card: card.id, update: context.newId(), kind: 'changes_requested', text: command.reason, ...(command.links?.length ? { links: command.links } : {}) },
      ])
    }

    case 'accept': {
      const invalid = requireStatus(card, ['review'], 'accept')
      if (invalid) return invalid
      return ok([
        { type: 'update_added', card: card.id, update: context.newId(), kind: 'accepted', text: command.summary, ...(command.links?.length ? { links: command.links } : {}) },
        transition(card, 'done'),
      ])
    }

    case 'reset': {
      const invalid = requireStatus(card, ['in_progress', 'blocked'], 'reset')
      if (invalid) return invalid
      return ok([transition(card, 'todo', command.reason)])
    }

    case 'cancel': {
      const invalid = requireStatus(card, OPEN, 'cancel')
      if (invalid) return invalid
      return ok(cancellationEvents(board, card, command))
    }

    case 'reopen': {
      const invalid = requireStatus(card, ['done', 'cancelled'], 'reopen')
      if (invalid) return invalid
      return ok([transition(card, 'todo', command.reason)])
    }

    case 'add_dependency':
    case 'remove_dependency': {
      if (!board.cards[command.dependsOn]) return fail('NOT_FOUND', `Card #${command.dependsOn} does not exist.`)
      if (command.type === 'remove_dependency') {
        if (!card.dependsOn.includes(command.dependsOn)) {
          return fail('INVALID_REQUEST', `Card #${card.id} does not depend on #${command.dependsOn}.`)
        }
        return ok([{ type: 'dependency_removed', card: card.id, dependsOn: command.dependsOn }])
      }
      if (card.dependsOn.includes(command.dependsOn)) {
        return fail('INVALID_REQUEST', `Card #${card.id} already depends on #${command.dependsOn}.`)
      }
      if (wouldCycle(board, card.id, command.dependsOn)) {
        return fail('WOULD_CYCLE', `Card #${card.id} depending on #${command.dependsOn} would form a cycle.`)
      }
      return ok([{ type: 'dependency_added', card: card.id, dependsOn: command.dependsOn }])
    }

    case 'add_update': {
      if (command.notify && actor.kind !== 'human') return fail('FORBIDDEN', 'Only a person can notify other sessions with a comment.')
      return ok([
        {
          type: 'update_added',
          card: card.id,
          update: context.newId(),
          kind: command.kind,
          text: command.text,
          ...(command.notify ? { notify: [...command.notify] } : {}),
        },
      ])
    }

    case 'assign': {
      const invalid = requireStatus(card, OPEN, 'assign')
      if (invalid) return invalid
      const sessionId = 'sessionId' in command.target ? command.target.sessionId : NEW_SESSION
      if (command.role === 'reviewer' && actor.kind === 'session' && sessionId !== actor.sessionId && creatorOf(card) !== actor.sessionId) {
        return fail('FORBIDDEN', `Only the session that created card #${card.id} or a person can choose its reviewer.`)
      }
      const invalidTarget = checkTarget(board, sessionId, context)
      if (invalidTarget) return invalidTarget
      const active = activeAssignments(card)
      const replacing = active.find((each) => each.role === command.role)
      if (replacing?.sessionId === sessionId) {
        return fail('INVALID_REQUEST', `Session ${sessionId} is already the ${command.role} of card #${card.id}.`)
      }
      if (active.some((each) => each.role !== command.role && each.sessionId === sessionId)) {
        return fail('REVIEWER_IS_OWNER', `Session ${sessionId} would both own and review card #${card.id}.`)
      }
      return ok([
        ...(replacing ? [{ type: 'assignment_revoked', card: card.id, assignment: replacing.id, reason: 'Reassigned to another session.' } as const] : []),
        { type: 'assigned', card: card.id, assignment: context.newId(), role: command.role, sessionId, ...(command.note ? { note: command.note } : {}) },
      ])
    }

    case 'archive':
    case 'unarchive': {
      if (card.archived === (command.type === 'archive')) {
        return fail('INVALID_REQUEST', `Card #${card.id} is already ${card.archived ? 'archived' : 'not archived'}.`)
      }
      return ok([{ type: command.type === 'archive' ? 'card_archived' : 'card_unarchived', card: card.id }])
    }
  }
}

export type InboxItem =
  | { kind: 'review'; card: number }
  | { kind: 'blocked'; card: number }
  | { kind: 'owner_missing'; card: number }

export function inboxFor(board: Board, sessionExists: (sessionId: string) => boolean): InboxItem[] {
  const items: InboxItem[] = []
  const cards = Object.values(board.cards)
    .filter((card) => !card.archived)
    .sort((a, b) => a.id - b.id)
  for (const card of cards) {
    const reviewer = reviewerOf(card)
    if (card.status === 'review' && (reviewer === null || !sessionExists(reviewer))) items.push({ kind: 'review', card: card.id })
    if (card.status === 'blocked') items.push({ kind: 'blocked', card: card.id })
    const owner = ownerOf(card)
    if (owner !== null && OPEN_STATUSES.has(card.status) && !sessionExists(owner)) {
      items.push({ kind: 'owner_missing', card: card.id })
    }
  }
  return items
}

export type HandledKind = 'assigned' | 'accepted' | 'changes_requested' | 'unblocked'

export type HandledItem = { seq: number; at: string; kind: HandledKind; card: number }

const HANDLED_LIMIT = 20

function handledKind(event: KanbanEvent): HandledKind | null {
  switch (event.type) {
    case 'assigned':
      return 'assigned'
    case 'status_changed':
      if (event.from === 'review') return event.to === 'done' ? 'accepted' : event.to === 'in_progress' ? 'changes_requested' : null
      return event.from === 'blocked' && event.to !== 'cancelled' ? 'unblocked' : null
    default:
      return null
  }
}

export function handledBy(events: readonly KanbanEvent[]): HandledItem[] {
  const items: HandledItem[] = []
  for (let index = events.length - 1; index >= 0 && items.length < HANDLED_LIMIT; index -= 1) {
    const event = events[index]!
    if (event.actor.kind !== 'human' || !('card' in event)) continue
    const kind = handledKind(event)
    if (kind) items.push({ seq: event.seq, at: event.at, kind, card: event.card })
  }
  return items
}

export function sessionsOnBoard(board: Board): Set<string> {
  const sessions = new Set<string>()
  for (const card of Object.values(board.cards)) {
    const creator = creatorOf(card)
    if (creator) sessions.add(creator)
    for (const assignment of card.assignments) sessions.add(assignment.sessionId)
  }
  return sessions
}

export type CardView = Card & {
  owner: string | null
  reviewer: string | null
  waitingOn: number[]
  children: number[]
  failedNotifications: number[]
}

export function cardView(board: Board, card: Card): CardView {
  return {
    ...card,
    owner: ownerOf(card),
    reviewer: reviewerOf(card),
    waitingOn: waitingOn(board, card),
    children: childrenOf(board, card).map((child) => child.id).sort((a, b) => a - b),
    failedNotifications: Object.values(board.failedNotifications)
      .filter((notification) => notification.card === card.id)
      .map((notification) => notification.seq),
  }
}

export function eventsForCard(events: readonly KanbanEvent[], card: number): KanbanEvent[] {
  return events.filter((event) => 'card' in event && event.card === card)
}

export type BoardSessionInfo = { title: string; exists: boolean; running: boolean }

export type BoardView = {
  key: string
  project: string
  version: number
  cards: CardView[]
  sessions: Record<string, BoardSessionInfo>
  inbox?: InboxItem[]
  handled?: HandledItem[]
  etag: string
}

export type BoardListing = { key: string; project: string }
