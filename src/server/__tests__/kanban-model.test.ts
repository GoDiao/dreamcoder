import { describe, expect, it } from 'bun:test'
import type { KanbanCommand } from '../../entrypoints/sdk/controlSchemas.js'
import {
  NEW_SESSION,
  applyEvent,
  emptyBoard,
  handledBy,
  inboxFor,
  mayCreateUnder,
  ownerOf,
  reviewerOf,
  rolesOf,
  validateCommand,
  type Board,
  type KanbanActor,
  type KanbanErrorCode,
  type KanbanEvent,
  type KanbanEventBody,
  type SessionFact,
} from '../services/kanbanModel.js'

const PROJECT = '/repo'
const human: KanbanActor = { kind: 'human' }
const as = (sessionId: string): KanbanActor => ({ kind: 'session', sessionId })
const a = as('a')
const b = as('b')
const c = as('c')
const other = as('other')

function facts(extra: Record<string, Partial<SessionFact>> = {}): Map<string, SessionFact> {
  const ids = ['a', 'b', 'c', 'other', ...Object.keys(extra)]
  return new Map(ids.map((id) => [id, { exists: true, projectRoot: PROJECT, title: id, running: false, ...extra[id] }]))
}

class Harness {
  board: Board = emptyBoard(PROJECT)
  events: KanbanEvent[] = []
  private seq = 0
  private ids = 0
  sessions = facts()

  constructor() {
    this.apply({ type: 'board_created', project: PROJECT }, human)
  }

  apply(body: KanbanEventBody, actor: KanbanActor): void {
    this.seq += 1
    const event = { ...body, seq: this.seq, at: new Date(Date.UTC(2026, 10, 6, 0, 0, this.seq)).toISOString(), actor } as KanbanEvent
    this.events.push(event)
    applyEvent(this.board, event)
  }

  try(command: KanbanCommand, actor: KanbanActor) {
    return validateCommand(this.board, command, actor, { newId: () => `id-${++this.ids}`, sessions: this.sessions })
  }

  run(command: KanbanCommand, actor: KanbanActor): string[] {
    const result = this.try(command, actor)
    if (!result.ok) throw new Error(`${command.type} failed: ${result.code} ${result.message}`)
    for (const event of result.events) this.apply(event, actor)
    return result.warnings
  }

  reject(command: KanbanCommand, actor: KanbanActor, code: KanbanErrorCode): void {
    const result = this.try(command, actor)
    expect(result.ok ? 'accepted' : result.code).toBe(code)
  }

  card(title: string, actor: KanbanActor, extra: Partial<Extract<KanbanCommand, { type: 'create_card' }>> = {}): number {
    const id = this.board.nextCard
    this.run({ type: 'create_card', title, status: 'todo', ...extra }, actor)
    return id
  }

  assign(card: number, role: 'owner' | 'reviewer', sessionId: string): string {
    this.run({ type: 'assign', card, role, target: { sessionId } }, human)
    return this.board.cards[card]!.assignments.at(-1)!.id
  }

  status(card: number): string {
    return this.board.cards[card]!.status
  }
}

function splitExample() {
  const h = new Harness()
  const t1 = h.card('Auth refactor', human)
  h.assign(t1, 'owner', 'a')
  const t2 = h.card('OAuth module', a, { parent: t1 })
  h.assign(t2, 'owner', 'b')
  h.assign(t2, 'reviewer', 'a')
  return { h, t1, t2 }
}

function submitted(h: Harness, card: number, owner: KanbanActor) {
  h.run({ type: 'start', card }, owner)
  h.run({ type: 'submit', card, summary: 'done' }, owner)
}

describe('roles on a card', () => {
  it('keeps the owner, reviewer and creator on the card itself, whatever happens above it', () => {
    const { h, t1, t2 } = splitExample()
    const card = () => h.board.cards[t2]!
    expect(rolesOf(card(), 'a')).toEqual(['reviewer', 'creator'])
    expect(rolesOf(card(), 'b')).toEqual(['owner'])

    h.assign(t1, 'owner', 'c')
    expect([ownerOf(card()), reviewerOf(card()), rolesOf(card(), 'a')]).toEqual(['b', 'a', ['reviewer', 'creator']])
  })

  it('lets a session create right away only under a card it owns or created', () => {
    const { h, t1, t2 } = splitExample()
    expect(mayCreateUnder(h.board.cards[t1]!, 'a')).toBe(true)
    expect(mayCreateUnder(h.board.cards[t2]!, 'a')).toBe(true)
    expect(mayCreateUnder(h.board.cards[t2]!, 'b')).toBe(true)
    expect(mayCreateUnder(h.board.cards[t1]!, 'b')).toBe(false)
  })
})

describe('permission table', () => {
  it('lets the creator and a person move between Backlog and Todo', () => {
    const { h, t2 } = splitExample()
    h.run({ type: 'move_card', card: t2, status: 'backlog' }, a)
    h.reject({ type: 'move_card', card: t2, status: 'todo' }, b, 'FORBIDDEN')
    h.run({ type: 'move_card', card: t2, status: 'todo' }, human)
    expect(h.status(t2)).toBe('todo')
  })

  it('lets only the owner start, once it has an owner and its dependencies are done', () => {
    const { h, t1, t2 } = splitExample()
    const dependency = h.card('Schema', human)
    h.run({ type: 'add_dependency', card: t2, dependsOn: dependency }, b)

    h.reject({ type: 'start', card: t2 }, a, 'FORBIDDEN')
    h.reject({ type: 'start', card: t2 }, b, 'NOT_READY')

    h.assign(dependency, 'owner', 'c')
    submitted(h, dependency, c)
    h.run({ type: 'accept', card: dependency, summary: 'checked' }, human)

    h.run({ type: 'start', card: t2 }, b)
    expect(h.status(t2)).toBe('in_progress')

    const unowned = h.card('Unowned', a, { parent: t1 })
    h.reject({ type: 'start', card: unowned }, human, 'NO_OWNER')
  })

  it('lets the owner start a card straight from Backlog', () => {
    const { h, t1 } = splitExample()
    const planned = h.card('Planned', a, { parent: t1, status: 'backlog' })
    h.assign(planned, 'owner', 'b')
    h.run({ type: 'start', card: planned }, b)
    expect(h.status(planned)).toBe('in_progress')
  })

  it('lets the owner, the creator and a person block and unblock, returning to the earlier status', () => {
    const { h, t2 } = splitExample()
    h.run({ type: 'start', card: t2 }, b)
    h.reject({ type: 'block', card: t2, reason: 'x' }, other, 'FORBIDDEN')
    h.run({ type: 'block', card: t2, reason: 'waiting for keys' }, b)
    expect(h.status(t2)).toBe('blocked')
    expect(h.board.cards[t2]!.updates.at(-1)).toMatchObject({ kind: 'blocked', text: 'waiting for keys' })
    h.run({ type: 'unblock', card: t2 }, a)
    expect(h.status(t2)).toBe('in_progress')
    h.run({ type: 'block', card: t2, reason: 'again' }, human)
    h.run({ type: 'unblock', card: t2 }, human)
    expect(h.status(t2)).toBe('in_progress')
  })

  it('lets only the owner submit, moves the card to Review and never to Done', () => {
    const { h, t2 } = splitExample()
    h.run({ type: 'start', card: t2 }, b)
    h.reject({ type: 'submit', card: t2, summary: 'x' }, a, 'FORBIDDEN')
    h.run({ type: 'submit', card: t2, summary: 'tokens issued', links: ['https://example.test/pr/1'] }, b)
    expect(h.status(t2)).toBe('review')
    expect(h.board.cards[t2]!.deliveries[0]).toMatchObject({ summary: 'tokens issued', links: ['https://example.test/pr/1'] })
    h.reject({ type: 'submit', card: t2, summary: 'again' }, b, 'INVALID_TRANSITION')
  })

  it('warns, without refusing, when a card is submitted with unfinished sub-cards', () => {
    const { h, t1, t2 } = splitExample()
    h.run({ type: 'start', card: t1 }, a)
    const warnings = h.run({ type: 'submit', card: t1, summary: 'module ready' }, a)
    expect(warnings).toEqual([`Card #${t1} still has unfinished sub-cards: #${t2}.`])
    expect(h.status(t1)).toBe('review')
  })

  it('tells a session that cancels a card which open cards wait on it and which sub-cards are unfinished', () => {
    const { h } = splitExample()
    const root = h.card('Docs', c)
    const child = h.card('Guide', c, { parent: root })
    const waiting = h.card('Release notes', human, { dependsOn: [root] })
    const finished = h.card('Old notes', human, { dependsOn: [root] })
    h.run({ type: 'cancel', card: finished }, human)

    const warnings = h.run({ type: 'cancel', card: root, reason: 'plan changed' }, c)

    expect(h.status(root)).toBe('cancelled')
    expect(warnings).toEqual([
      `#${waiting} still depend on card #${root} and cannot start until it is done. Remove that dependency from them, or cancel them too.`,
      `Card #${root} still has unfinished sub-cards: #${child}. Cancel them too if they are no longer needed.`,
    ])
  })

  it('does not repeat the cancel impact to a person, whose confirmation already listed it', () => {
    const { h, t1 } = splitExample()
    h.card('Release notes', human, { dependsOn: [t1] })
    expect(h.run({ type: 'cancel', card: t1 }, human)).toEqual([])
  })

  it('lets the reviewer and a person request changes and accept', () => {
    const { h, t2 } = splitExample()
    submitted(h, t2, b)
    h.reject({ type: 'request_changes', card: t2, reason: 'x' }, b, 'FORBIDDEN')
    h.reject({ type: 'accept', card: t2, summary: 'checked' }, b, 'FORBIDDEN')
    h.run({ type: 'request_changes', card: t2, reason: 'add tests', links: ['/repo/review.md'] }, a)
    expect(h.status(t2)).toBe('in_progress')
    expect(h.board.cards[t2]!.updates.at(-1)).toMatchObject({ kind: 'changes_requested', text: 'add tests', links: ['/repo/review.md'] })
    h.run({ type: 'submit', card: t2, summary: 'v2' }, b)
    h.run({ type: 'request_changes', card: t2, reason: 'docs' }, human)
    h.run({ type: 'submit', card: t2, summary: 'v3' }, b)
    h.run({ type: 'accept', card: t2, summary: 'checked', links: ['/repo/review.md'] }, a)
    expect(h.status(t2)).toBe('done')
    expect(h.board.cards[t2]!.updates.at(-1)).toMatchObject({ kind: 'accepted', text: 'checked', links: ['/repo/review.md'], actor: a })
  })

  it('leaves acceptance to a person when the card has no reviewer, even for its creator', () => {
    const { h, t1 } = splitExample()
    const solo = h.card('Solo', a, { parent: t1 })
    h.assign(solo, 'owner', 'c')
    submitted(h, solo, c)
    h.reject({ type: 'accept', card: solo, summary: 'checked' }, a, 'FORBIDDEN')
    h.reject({ type: 'accept', card: solo, summary: 'checked' }, c, 'FORBIDDEN')
    h.run({ type: 'accept', card: solo, summary: 'checked' }, human)
    expect(h.status(solo)).toBe('done')
  })

  it('does not finish a parent when all its sub-cards are done', () => {
    const { h, t1, t2 } = splitExample()
    submitted(h, t2, b)
    h.run({ type: 'accept', card: t2, summary: 'checked' }, a)
    expect(h.status(t1)).toBe('todo')
  })

  it('lets the creator and a person reset or cancel, and only a person reopen', () => {
    const { h, t2 } = splitExample()
    h.run({ type: 'start', card: t2 }, b)
    h.reject({ type: 'reset', card: t2 }, b, 'FORBIDDEN')
    h.run({ type: 'reset', card: t2, reason: 'replan' }, a)
    expect(h.status(t2)).toBe('todo')
    h.reject({ type: 'cancel', card: t2 }, b, 'FORBIDDEN')
    h.run({ type: 'cancel', card: t2 }, a)
    expect(h.status(t2)).toBe('cancelled')
    h.reject({ type: 'reopen', card: t2 }, a, 'FORBIDDEN')
    h.run({ type: 'reopen', card: t2 }, human)
    expect(h.status(t2)).toBe('todo')
  })

  it('refuses transitions from the wrong status', () => {
    const { h, t2 } = splitExample()
    h.reject({ type: 'submit', card: t2, summary: 'x' }, b, 'INVALID_TRANSITION')
    h.reject({ type: 'accept', card: t2, summary: 'checked' }, a, 'INVALID_TRANSITION')
    h.reject({ type: 'unblock', card: t2 }, b, 'INVALID_TRANSITION')
    h.reject({ type: 'reopen', card: t2 }, human, 'INVALID_TRANSITION')
  })

  it('names who may act when it refuses', () => {
    const { h, t2 } = splitExample()
    const result = h.try({ type: 'cancel', card: t2 }, b)
    expect(result.ok ? null : result.message).toBe(`Only the session that created it or a person can cancel it: card #${t2}.`)
  })
})

describe('commands outside the transition table', () => {
  it('lets any session create a card anywhere and records it as the creator', () => {
    const { h, t1 } = splitExample()
    const top = h.card('Top level', other)
    const elsewhere = h.card('Under A', other, { parent: t1 })
    expect(h.board.cards[top]!.createdBy).toEqual(other)
    expect(h.board.cards[elsewhere]!.parent).toBe(t1)
    h.reject({ type: 'create_card', title: 'x', parent: 99 }, other, 'NOT_FOUND')
  })

  it('lets the owner, the creator and a person edit a card', () => {
    const { h, t2 } = splitExample()
    h.run({ type: 'edit_card', card: t2, title: 'OAuth module v2' }, b)
    h.run({ type: 'edit_card', card: t2, acceptance: ['issues tokens'], priority: 'high' }, a)
    h.reject({ type: 'edit_card', card: t2, title: 'x' }, other, 'FORBIDDEN')
    h.reject({ type: 'edit_card', card: t2 }, human, 'INVALID_REQUEST')
    expect(h.board.cards[t2]).toMatchObject({ title: 'OAuth module v2', acceptance: ['issues tokens'], priority: 'high' })
  })

  it('refuses a dependency cycle, including on the card itself', () => {
    const { h, t1, t2 } = splitExample()
    const sibling = h.card('Sibling', a, { parent: t1 })
    h.run({ type: 'add_dependency', card: sibling, dependsOn: t2 }, human)
    h.reject({ type: 'add_dependency', card: t2, dependsOn: sibling }, human, 'WOULD_CYCLE')
    h.reject({ type: 'add_dependency', card: t2, dependsOn: t2 }, human, 'WOULD_CYCLE')
    h.run({ type: 'remove_dependency', card: sibling, dependsOn: t2 }, a)
    h.run({ type: 'add_dependency', card: t2, dependsOn: sibling }, b)
  })

  it('records updates from any session; only a person notifies', () => {
    const { h, t2 } = splitExample()
    h.run({ type: 'add_update', card: t2, kind: 'progress', text: 'half way' }, b)
    h.run({ type: 'add_update', card: t2, kind: 'comment', text: 'seen this' }, other)
    h.reject({ type: 'add_update', card: t2, kind: 'comment', text: 'x', notify: ['creator'] }, b, 'FORBIDDEN')
    h.run({ type: 'add_update', card: t2, kind: 'comment', text: 'looks good', notify: ['creator'] }, human)
    expect(h.board.cards[t2]!.updates.map((update) => [update.kind, update.actor])).toEqual([
      ['progress', b],
      ['comment', other],
      ['comment', human],
    ])
  })

  it('lets the owner or the creator assign an owner, only the creator choose a reviewer, and any session assign itself', () => {
    const { h, t1 } = splitExample()
    const fresh = h.card('Fresh', a, { parent: t1 })
    h.run({ type: 'assign', card: fresh, role: 'owner', target: { sessionId: 'c' } }, a)
    expect(h.board.cards[fresh]!.assignments.at(-1)).toMatchObject({ status: 'active', sessionId: 'c', assignedBy: a })
    h.reject({ type: 'assign', card: fresh, role: 'reviewer', target: { sessionId: 'b' } }, other, 'FORBIDDEN')
    h.reject({ type: 'assign', card: fresh, role: 'reviewer', target: { sessionId: 'b' } }, c, 'FORBIDDEN')
    h.reject({ type: 'assign', card: fresh, role: 'reviewer', target: { newSession: true } }, c, 'FORBIDDEN')
    h.run({ type: 'assign', card: fresh, role: 'reviewer', target: { sessionId: 'b' } }, a)
    h.run({ type: 'assign', card: fresh, role: 'owner', target: { sessionId: 'other' } }, c)
    h.run({ type: 'assign', card: fresh, role: 'reviewer', target: { sessionId: 'c' } }, c)
    expect([ownerOf(h.board.cards[fresh]!), reviewerOf(h.board.cards[fresh]!)]).toEqual(['other', 'c'])
  })

  it('drops a failed notification once its assignment ends or its card closes', () => {
    const { h, t1, t2 } = splitExample()
    const failed = (card: number, to: string) => h.apply({ type: 'notification_failed', card, to, purpose: 'assignment', error: 'offline', body: 'brief' }, human)
    const pending = () => Object.values(h.board.failedNotifications).map((each) => [each.card, each.to])
    failed(t2, 'b')
    failed(t2, 'a')
    failed(t1, 'a')

    h.assign(t2, 'owner', 'c')
    expect(pending()).toEqual([[t2, 'a'], [t1, 'a']])

    h.run({ type: 'cancel', card: t2 }, human)
    expect(pending()).toEqual([[t1, 'a']])
  })

  it('assigns a new session with a placeholder the service fills in', () => {
    const { h, t1 } = splitExample()
    const card = h.card('Fresh', a, { parent: t1 })
    const result = h.try({ type: 'assign', card, role: 'owner', target: { newSession: true } }, a)
    expect(result.ok && result.events).toEqual([{ type: 'assigned', card, assignment: expect.any(String), role: 'owner', sessionId: NEW_SESSION }])
  })

  it('refuses a target that does not exist or belongs to another project', () => {
    const { h, t2 } = splitExample()
    h.sessions = facts({ gone: { exists: false }, elsewhere: { projectRoot: '/other' } })
    h.reject({ type: 'assign', card: t2, role: 'reviewer', target: { sessionId: 'gone' } }, human, 'INVALID_REQUEST')
    h.reject({ type: 'assign', card: t2, role: 'reviewer', target: { sessionId: 'elsewhere' } }, human, 'INVALID_REQUEST')
  })

  it('lets the creator and a person revoke; a revoked owner can no longer work on the card', () => {
    const { h, t2 } = splitExample()
    const assignment = h.board.cards[t2]!.assignments.find((each) => each.sessionId === 'b')!
    h.reject({ type: 'revoke_assignment', assignment: assignment.id, reason: 'x' }, b, 'FORBIDDEN')
    h.run({ type: 'revoke_assignment', assignment: assignment.id, reason: 'reassigning' }, a)
    h.reject({ type: 'start', card: t2 }, b, 'FORBIDDEN')
  })

  it('leaves archiving to a person', () => {
    const { h, t2 } = splitExample()
    h.reject({ type: 'archive', card: t2 }, a, 'FORBIDDEN')
    h.run({ type: 'archive', card: t2 }, human)
    expect(h.board.cards[t2]!.archived).toBe(true)
  })
})

describe('assignment invariants', () => {
  it('keeps one active owner and one active reviewer per card; assigning replaces the current one', () => {
    const { h, t2 } = splitExample()
    h.reject({ type: 'assign', card: t2, role: 'owner', target: { sessionId: 'b' } }, human, 'INVALID_REQUEST')

    const replaced = h.try({ type: 'assign', card: t2, role: 'owner', target: { sessionId: 'c' } }, a)
    expect(replaced.ok && replaced.events.map((event) => event.type)).toEqual(['assignment_revoked', 'assigned'])
    h.run({ type: 'assign', card: t2, role: 'owner', target: { sessionId: 'c' } }, a)
    expect(ownerOf(h.board.cards[t2]!)).toBe('c')
    expect(h.board.cards[t2]!.assignments.filter((assignment) => assignment.status === 'active')).toHaveLength(2)

    h.run({ type: 'assign', card: t2, role: 'reviewer', target: { sessionId: 'other' } }, human)
    expect(reviewerOf(h.board.cards[t2]!)).toBe('other')
  })

  it('refuses one session as both owner and reviewer of a card', () => {
    const { h, t2 } = splitExample()
    h.reject({ type: 'assign', card: t2, role: 'reviewer', target: { sessionId: 'b' } }, human, 'REVIEWER_IS_OWNER')
    h.reject({ type: 'assign', card: t2, role: 'owner', target: { sessionId: 'a' } }, human, 'REVIEWER_IS_OWNER')
  })
})

describe('needs me', () => {
  it('lists reviews nobody else accepts, blocked cards and missing owners', () => {
    const { h, t1, t2 } = splitExample()
    submitted(h, t1, a)
    submitted(h, t2, b)
    const top = h.card('Top', human)
    h.assign(top, 'owner', 'c')
    h.run({ type: 'block', card: top, reason: 'needs a decision' }, c)

    expect(inboxFor(h.board, (id) => id !== 'c')).toEqual([
      { kind: 'review', card: t1 },
      { kind: 'blocked', card: top },
      { kind: 'owner_missing', card: top },
    ])
    expect(inboxFor(h.board, (id) => id !== 'a')).toContainEqual({ kind: 'review', card: t2 })
  })

  it('does not list a card cancelled during review as sent back', () => {
    const { h, t2 } = splitExample()
    submitted(h, t2, b)
    h.run({ type: 'cancel', card: t2 }, human)
    expect(handledBy(h.events).map(({ kind }) => kind)).not.toContain('changes_requested')
  })

  it('lists what a person handled, newest first, and skips what sessions did', () => {
    const { h, t1, t2 } = splitExample()
    submitted(h, t1, a)
    h.run({ type: 'accept', card: t1, summary: 'checked' }, human)
    h.run({ type: 'start', card: t2 }, b)
    h.run({ type: 'block', card: t2, reason: 'waiting' }, b)
    h.run({ type: 'unblock', card: t2 }, human)

    expect(handledBy(h.events).map(({ kind, card }) => ({ kind, card }))).toEqual([
      { kind: 'unblocked', card: t2 },
      { kind: 'accepted', card: t1 },
      { kind: 'assigned', card: t2 },
      { kind: 'assigned', card: t2 },
      { kind: 'assigned', card: t1 },
    ])
  })
})
