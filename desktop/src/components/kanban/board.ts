import type { BoardView, CardStatus, CardView, KanbanActor, KanbanAssignment, KanbanCommand, KanbanServiceErrorCode } from '@protocol'
import { apiErrorCode } from '../../api/client'
import type { TranslationKey } from '../../i18n'

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

export const BOARD_COLUMNS = ['backlog', 'todo', 'in_progress', 'blocked', 'review', 'done'] as const satisfies readonly CardStatus[]
export const ALL_STATUSES = [...BOARD_COLUMNS, 'cancelled'] as const satisfies readonly CardStatus[]
export const KANBAN_POLLING = { intervalMs: 3_000, focusMinMs: 1_000 }

export const COMPACT_FOLDED: ReadonlySet<CardStatus> = new Set(['backlog', 'done'])

export const STATUS_LABEL: Record<CardStatus, TranslationKey> = {
  backlog: 'kanban.status.backlog',
  todo: 'kanban.status.todo',
  in_progress: 'kanban.status.in_progress',
  blocked: 'kanban.status.blocked',
  review: 'kanban.status.review',
  done: 'kanban.status.done',
  cancelled: 'kanban.status.cancelled',
}

export const PRIORITY_LABEL: Record<CardView['priority'], TranslationKey> = {
  high: 'kanban.priority.high',
  normal: 'kanban.priority.normal',
  low: 'kanban.priority.low',
}

export const ROLE_LABEL: Record<KanbanAssignment['role'], TranslationKey> = {
  owner: 'kanban.role.owner',
  reviewer: 'kanban.role.reviewer',
}

const ERROR_LABEL: Record<KanbanServiceErrorCode, TranslationKey> = {
  FORBIDDEN: 'kanban.error.FORBIDDEN',
  NOT_FOUND: 'kanban.error.NOT_FOUND',
  INVALID_REQUEST: 'kanban.error.INVALID_REQUEST',
  INVALID_TRANSITION: 'kanban.error.INVALID_TRANSITION',
  NOT_READY: 'kanban.error.NOT_READY',
  WOULD_CYCLE: 'kanban.error.WOULD_CYCLE',
  REVIEWER_IS_OWNER: 'kanban.error.REVIEWER_IS_OWNER',
  NO_OWNER: 'kanban.error.NO_OWNER',
  CONFLICT: 'kanban.error.CONFLICT',
  START_FAILED: 'kanban.error.START_FAILED',
}

export function kanbanErrorMessage(t: Translate, error: unknown): string {
  const code = apiErrorCode(error)
  if (code && code in ERROR_LABEL) return t(ERROR_LABEL[code as KanbanServiceErrorCode])
  return t('kanban.error.unexpected', { message: error instanceof Error ? error.message : String(error) })
}

export type MoveIntent =
  | { kind: 'command'; command: KanbanCommand }
  | { kind: 'reason'; type: 'block' | 'cancel' | 'request_changes' | 'reopen'; required: boolean }
  | { kind: 'report'; type: 'submit' | 'accept' }

export function moveIntent(card: CardView, to: CardStatus): MoveIntent | null {
  const from = card.status
  if (from === to) return null
  const id = card.id
  if (to === 'cancelled') return from === 'done' ? null : { kind: 'reason', type: 'cancel', required: false }
  if ((from === 'done' || from === 'cancelled') && to === 'todo') return { kind: 'reason', type: 'reopen', required: false }
  switch (to) {
    case 'backlog':
      return from === 'todo' ? { kind: 'command', command: { type: 'move_card', card: id, status: 'backlog' } } : null
    case 'todo':
      if (from === 'backlog') return { kind: 'command', command: { type: 'move_card', card: id, status: 'todo' } }
      if (from === 'in_progress') return { kind: 'command', command: { type: 'reset', card: id } }
      if (from === 'blocked') return { kind: 'command', command: card.blockedFrom === 'todo' ? { type: 'unblock', card: id } : { type: 'reset', card: id } }
      return null
    case 'in_progress':
      if (from === 'todo') return { kind: 'command', command: { type: 'start', card: id } }
      if (from === 'blocked' && card.blockedFrom === 'in_progress') return { kind: 'command', command: { type: 'unblock', card: id } }
      if (from === 'review') return { kind: 'reason', type: 'request_changes', required: true }
      return null
    case 'blocked':
      return from === 'todo' || from === 'in_progress' ? { kind: 'reason', type: 'block', required: true } : null
    case 'review':
      return from === 'in_progress' ? { kind: 'report', type: 'submit' } : null
    case 'done':
      return from === 'review' ? { kind: 'report', type: 'accept' } : null
  }
}

export function sessionTitle(view: BoardView, sessionId: string | null): string | null {
  if (!sessionId) return null
  return view.sessions[sessionId]?.title || null
}

export function actorName(t: Translate, view: BoardView, actor: KanbanActor): string {
  return actor.kind === 'human' ? t('kanban.actor.you') : sessionTitle(view, actor.sessionId) ?? t('kanban.actor.session')
}

export type AssigneeState = { kind: 'none' } | { kind: 'missing' } | { kind: 'session'; sessionId: string; title: string; running: boolean }

export function assigneeState(view: BoardView, sessionId: string | null): AssigneeState {
  if (!sessionId) return { kind: 'none' }
  const info = view.sessions[sessionId]
  if (!info?.exists) return { kind: 'missing' }
  return { kind: 'session', sessionId, title: info.title, running: info.running }
}

export function activeAssignee(view: BoardView, card: CardView): { role: KanbanAssignment['role']; state: AssigneeState } {
  const role = card.status === 'review' && card.reviewer ? 'reviewer' : 'owner'
  return { role, state: assigneeState(view, card[role]) }
}

export function assignmentInstructions(card: CardView, role: KanbanAssignment['role']): string | null {
  return card.assignments.find((assignment) => assignment.status === 'active' && assignment.role === role)?.note ?? null
}

export function waitingForYou(view: BoardView, card: number): boolean {
  return (view.inbox ?? []).some((item) => item.card === card)
}

export function blockReason(card: CardView): string | null {
  return [...card.updates].reverse().find((update) => update.kind === 'blocked')?.text ?? null
}

export function cardNote(t: Translate, card: CardView): string | null {
  if (card.status === 'blocked') {
    const reason = blockReason(card)
    return reason ? t('kanban.card.blocked', { reason }) : null
  }
  if (card.waitingOn.length && (card.status === 'todo' || card.status === 'backlog')) {
    return t('kanban.card.waitingOn', { cards: card.waitingOn.map((id) => `#${id}`).join(' ') })
  }
  const latest = [...card.updates].reverse().find((update) => update.kind === 'progress' || update.kind === 'decision')
  return latest?.text ?? null
}

export function cardTitle(view: BoardView, id: number): string | null {
  return view.cards.find((card) => card.id === id)?.title ?? null
}

export function cardStatus(view: BoardView, id: number): CardStatus | null {
  return view.cards.find((card) => card.id === id)?.status ?? null
}

export function cancelImpact(view: BoardView, card: CardView): { dependents: number[]; children: number[] } {
  const open = view.cards.filter((each) => each.status !== 'done' && each.status !== 'cancelled')
  return {
    dependents: open.filter((each) => each.dependsOn.includes(card.id)).map((each) => each.id),
    children: open.filter((each) => each.parent === card.id).map((each) => each.id),
  }
}

export function waitedBy(view: BoardView, id: number): number[] {
  return view.cards.filter((card) => card.dependsOn.includes(id)).map((card) => card.id)
}

const SHORT_TITLE_LENGTH = 24

export function shortTitle(title: string): string {
  return title.length > SHORT_TITLE_LENGTH ? `${title.slice(0, SHORT_TITLE_LENGTH).trimEnd()}…` : title
}

export type TreeRow = { card: CardView; depth: number; childCount: number; doneChildren: number }

export function cardTreeRows(cards: readonly CardView[], collapsed: ReadonlySet<number>): TreeRow[] {
  const ids = new Set(cards.map((card) => card.id))
  const children = new Map<number, CardView[]>()
  const roots: CardView[] = []
  for (const card of cards) {
    if (card.parent !== null && ids.has(card.parent)) children.set(card.parent, [...(children.get(card.parent) ?? []), card])
    else roots.push(card)
  }
  const rows: TreeRow[] = []
  const walk = (card: CardView, depth: number) => {
    const kids = children.get(card.id) ?? []
    rows.push({ card, depth, childCount: kids.length, doneChildren: kids.filter((kid) => kid.status === 'done').length })
    if (!collapsed.has(card.id)) for (const kid of kids) walk(kid, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  return rows
}

export type LinkTarget = { kind: 'url'; url: string } | { kind: 'file'; path: string }

export function linkTarget(link: string, author: KanbanActor): LinkTarget | null {
  if (/^https?:\/\//i.test(link)) return { kind: 'url', url: link }
  const absolute = link.startsWith('/') || /^[A-Za-z]:[\\/]/.test(link)
  return absolute && author.kind === 'session' ? { kind: 'file', path: link } : null
}
