import type { BoardView, CardView, KanbanAssignment } from '@protocol'

export const FIXTURE_PROJECT = '/work/alpha'
export const FIXTURE_BOARD = 'work-alpha'

export function fixtureAssignment(id: string, role: KanbanAssignment['role'], sessionId: string): KanbanAssignment {
  return {
    id,
    role,
    status: 'active',
    sessionId,
    assignedBy: { kind: 'session', sessionId: 'planner' },
    assignedAt: '2026-11-07T00:00:00.000Z',
  }
}

export function fixtureCard(id: number, extra: Partial<CardView> = {}): CardView {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    acceptance: [],
    parent: null,
    priority: 'normal',
    status: 'todo',
    blockedFrom: null,
    order: id,
    archived: false,
    dependsOn: [],
    assignments: [],
    updates: [],
    deliveries: [],
    createdBy: { kind: 'human' },
    createdAt: '2026-11-07T00:00:00.000Z',
    updatedAt: '2026-11-07T00:00:00.000Z',
    owner: null,
    reviewer: null,
    waitingOn: [],
    children: [],
    failedNotifications: [],
    ...extra,
  }
}

export function fixtureView(cards: CardView[], extra: Partial<BoardView> = {}): BoardView {
  return {
    key: FIXTURE_BOARD,
    project: FIXTURE_PROJECT,
    version: 1,
    cards,
    sessions: { planner: { title: 'Planner', exists: true, running: false } },
    inbox: [],
    handled: [],
    etag: 'etag-1',
    ...extra,
  }
}
