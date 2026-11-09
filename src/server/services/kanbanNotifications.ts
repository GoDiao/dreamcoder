import type { KanbanCommand } from '../../entrypoints/sdk/controlSchemas.js'
import type { KanbanOrigin } from '../../entrypoints/sdk/coreSchemas.js'
import {
  activeAssignments,
  creatorOf,
  findAssignmentOnBoard,
  ownerOf,
  reviewerOf,
  type Board,
  type AssignmentRole,
  type Card,
  type KanbanActor,
  type KanbanEvent,
  type NotificationPurpose,
} from './kanbanModel.js'

const SUMMARY_LIMIT = 500

export type PlannedNotification = { to: string; purpose: NotificationPurpose; card: number; body: string }

export type SessionTitles = (sessionId: string) => string

export function kanbanOrigin(board: Board, purpose: NotificationPurpose, card: number): KanbanOrigin {
  return { kind: 'kanban', project: board.project, card: { id: card, title: board.cards[card]?.title ?? '' }, purpose }
}

function sessionLabel(sessionId: string, titles: SessionTitles): string {
  return `${titles(sessionId)} (session:${sessionId})`
}

function actorLabel(actor: KanbanActor, titles: SessionTitles): string {
  return actor.kind === 'human' ? 'the person' : sessionLabel(actor.sessionId, titles)
}

function heading(card: Card): string {
  return `Card #${card.id}: ${card.title}`
}

function truncate(text: string): string {
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT)}…` : text
}

type StatusNotice = { purpose: NotificationPurpose; line: string; reviewerToo?: boolean }

const STATUS_NOTICES: Partial<Record<KanbanCommand['type'], StatusNotice>> = {
  unblock: { purpose: 'unblocked', line: 'Unblocked by' },
  reset: { purpose: 'reset', line: 'Sent back to Todo by' },
  cancel: { purpose: 'cancelled', line: 'Cancelled by', reviewerToo: true },
  reopen: { purpose: 'reopened', line: 'Reopened and moved back to Todo by' },
}

function linkLines(links: readonly string[] | undefined): string[] {
  return links?.length ? ['Links:', ...links.map((link) => `- ${link}`)] : []
}

function reviewLine(card: Card, titles: SessionTitles): string {
  const reviewer = reviewerOf(card)
  return reviewer ? `Reviewer, who accepts it: ${sessionLabel(reviewer, titles)}` : 'It has no reviewer; the person accepts it.'
}

export const DEFAULT_REVIEW_INSTRUCTIONS =
  'Check the delivery against each acceptance criterion: read the changes, run the tests, and try it where it can be tried. Accept it with a report of what you checked and how, or request changes with the reason and a link to your review report.'

function deliveryLines(summary: string, links: readonly string[]): string[] {
  return [`Summary: ${summary}`, ...linkLines(links)]
}

function reviewStart(card: Card): string[] {
  const delivery = card.deliveries.at(-1)
  return card.status === 'review' && delivery
    ? ['It is already submitted and waits for your review now.', ...deliveryLines(delivery.summary, delivery.links)]
    : ['You are told when the owner submits it.']
}

function acceptanceLines(card: Card): string[] {
  return card.acceptance.length ? ['', 'Acceptance criteria:', ...card.acceptance.map((item) => `- ${item}`)] : []
}

function reviewInstructions(note: string | undefined, assignedBy: KanbanActor, titles: SessionTitles): string[] {
  return note
    ? ['', `Review instructions from ${actorLabel(assignedBy, titles)}:`, note]
    : ['', 'Review instructions:', DEFAULT_REVIEW_INSTRUCTIONS]
}

export function assignmentBody(card: Card, role: AssignmentRole, note: string | undefined, assignedBy: KanbanActor, titles: SessionTitles): string {
  const lines = [heading(card), `You are assigned as its ${role}.`]
  if (role === 'owner') lines.push('You do this card. When it is too big, split it into sub-cards with KanbanCreate. Its creator sets the acceptance criteria and chooses the reviewer: when a criterion looks unclear, wrong or out of reach, ask the creator instead of changing it.')
  lines.push(`Created by ${actorLabel(card.createdBy, titles)}.`, reviewLine(card, titles))
  if (role === 'reviewer') lines.push(...reviewStart(card), ...reviewInstructions(note, assignedBy, titles))
  else if (note) lines.push(`Note from ${actorLabel(assignedBy, titles)}: ${note}`)
  if (card.description) lines.push('', 'Summary:', truncate(card.description))
  lines.push(...acceptanceLines(card))
  return lines.join('\n')
}

function reviewRequest(card: Card, submitted: string, titles: SessionTitles): string {
  const reviewer = activeAssignments(card).find((assignment) => assignment.role === 'reviewer')
  if (!reviewer) return submitted
  return [submitted, ...reviewInstructions(reviewer.note, reviewer.assignedBy, titles), ...acceptanceLines(card)].join('\n')
}

export function planNotifications(
  board: Board,
  events: readonly KanbanEvent[],
  titles: SessionTitles,
  command?: KanbanCommand['type'],
): PlannedNotification[] {
  const planned: PlannedNotification[] = []
  const push = (actor: KanbanActor, to: string | null, purpose: NotificationPurpose, card: number, body: string) => {
    if (!to || (actor.kind === 'session' && actor.sessionId === to)) return
    if (planned.some((each) => each.to === to && each.purpose === purpose && each.card === card)) return
    planned.push({ to, purpose, card, body })
  }

  for (const event of events) {
    if (!('card' in event)) continue
    const card = board.cards[event.card]
    if (!card) continue

    switch (event.type) {
      case 'assigned':
        push(event.actor, event.sessionId, 'assignment', card.id, assignmentBody(card, event.role, event.note, event.actor, titles))
        break
      case 'assignment_revoked': {
        const assignment = findAssignmentOnBoard(board, event.assignment)?.assignment
        if (!assignment) break
        push(event.actor, assignment.sessionId, 'revocation', card.id, `${heading(card)}\nYou are no longer its ${assignment.role}. Reason: ${event.reason}`)
        break
      }
      case 'update_added': {
        if (event.kind === 'changes_requested') {
          const lines = [heading(card), `Changes requested by ${actorLabel(event.actor, titles)}:`, event.text, ...linkLines(event.links)]
          push(event.actor, ownerOf(card), 'changes_requested', card.id, lines.join('\n'))
          break
        }
        if (event.kind === 'accepted') {
          const lines = [heading(card), `Accepted by ${actorLabel(event.actor, titles)}. It is done.`, 'Review report:', event.text, ...linkLines(event.links)]
          push(event.actor, ownerOf(card), 'accepted', card.id, lines.join('\n'))
          push(event.actor, creatorOf(card), 'accepted', card.id, lines.join('\n'))
          break
        }
        if (event.kind !== 'comment' || event.actor.kind !== 'human') break
        const body = `${heading(card)}\nComment from the person:\n${event.text}`
        push(event.actor, ownerOf(card), 'comment', card.id, body)
        if (event.notify?.includes('creator')) push(event.actor, creatorOf(card), 'comment', card.id, body)
        break
      }
      case 'delivery_submitted': {
        const body = [heading(card), `Submitted by ${actorLabel(event.actor, titles)}.`, ...deliveryLines(event.summary, event.links), reviewLine(card, titles)].join('\n')
        push(event.actor, reviewerOf(card), 'review', card.id, reviewRequest(card, body, titles))
        push(event.actor, creatorOf(card), 'review', card.id, body)
        break
      }
      case 'status_changed': {
        if (event.to === 'blocked') {
          push(event.actor, creatorOf(card), 'blocked', card.id, `${heading(card)}\nMarked blocked by ${actorLabel(event.actor, titles)}: ${event.reason ?? ''}`)
          break
        }
        const notice = command ? STATUS_NOTICES[command] : undefined
        if (!notice) break
        const lines = [heading(card), `${notice.line} ${actorLabel(event.actor, titles)}.`]
        if (event.reason) lines.push(`Reason: ${event.reason}`)
        push(event.actor, ownerOf(card), notice.purpose, card.id, lines.join('\n'))
        if (notice.reviewerToo) push(event.actor, reviewerOf(card), notice.purpose, card.id, lines.join('\n'))
        break
      }
    }
  }
  return planned
}
