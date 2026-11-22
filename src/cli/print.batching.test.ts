import { describe, expect, test } from 'bun:test'
import type { UserMessageOrigin } from '../entrypoints/sdk/coreSchemas.js'
import type { QueuedCommand } from '../types/textInputTypes.js'
import { canBatchWith, mergeBatchedCommands } from './print.js'

type SessionOrigin = Extract<UserMessageOrigin, { kind: 'session' }>
type KanbanOrigin = Extract<UserMessageOrigin, { kind: 'kanban' }>

const session = (
  sessionId: string,
  purpose: SessionOrigin['purpose'] = 'message',
  summary?: string,
): QueuedCommand => ({
  mode: 'prompt',
  value: 'x',
  origin: { kind: 'session', sessionId, name: 'n', purpose, summary },
})

const human: QueuedCommand = { mode: 'prompt', value: 'x' }

const kanban = (card: number, purpose: KanbanOrigin['purpose'] = 'comment', project = '/repo'): QueuedCommand => ({
  mode: 'prompt',
  value: 'x',
  origin: { kind: 'kanban', project, card: { id: card, title: `Card ${card}` }, purpose },
})

describe('canBatchWith origin', () => {
  test('merges messages with the same origin', () => {
    expect(canBatchWith(session('a'), session('a'))).toBe(true)
    expect(canBatchWith(human, { ...human })).toBe(true)
  })

  test('does not merge a human prompt with a session message', () => {
    expect(canBatchWith(human, session('a'))).toBe(false)
    expect(canBatchWith(session('a'), human)).toBe(false)
  })

  test('merges board notifications only for the same card and purpose', () => {
    expect(canBatchWith(kanban(1), kanban(1))).toBe(true)
    expect(canBatchWith(kanban(1), kanban(2))).toBe(false)
    expect(canBatchWith(kanban(1, 'comment'), kanban(1, 'review'))).toBe(false)
    expect(canBatchWith(kanban(1, 'comment', '/a'), kanban(1, 'comment', '/b'))).toBe(false)
    expect(canBatchWith(kanban(1), session('a'))).toBe(false)
    expect(canBatchWith(human, kanban(1))).toBe(false)
  })

  test('does not merge messages from different sessions', () => {
    expect(canBatchWith(session('a'), session('b'))).toBe(false)
  })

  test('does not merge messages with different purposes', () => {
    expect(canBatchWith(session('a', 'message'), session('a', 'report'))).toBe(
      false,
    )
  })

  test('does not merge messages with different summaries', () => {
    expect(canBatchWith(session('a', 'report', 'one'), session('a', 'report', 'two'))).toBe(false)
    expect(canBatchWith(session('a', 'report', 'one'), session('a', 'report', 'one'))).toBe(true)
  })
})

describe('mergeBatchedCommands', () => {
  const report = (id: string) => ({
    id,
    message: `report ${id}`,
    origin: { kind: 'session' as const, sessionId: 'child', name: 'c', purpose: 'report' as const },
  })

  test('keeps the reports of every merged command in order', () => {
    const merged = mergeBatchedCommands([
      { mode: 'prompt', value: 'first', uuid: '00000000-0000-4000-8000-000000000001', reports: [report('r1')] },
      { mode: 'prompt', value: 'second', uuid: '00000000-0000-4000-8000-000000000002' },
      { mode: 'prompt', value: 'third', uuid: '00000000-0000-4000-8000-000000000003', reports: [report('r2'), report('r3')] },
    ])

    expect(merged.value).toBe('first\nsecond\nthird')
    expect(merged.uuid).toBe('00000000-0000-4000-8000-000000000003')
    expect(merged.reports?.map(r => r.id)).toEqual(['r1', 'r2', 'r3'])
  })
})
