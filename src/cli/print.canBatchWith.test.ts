import { describe, expect, test } from 'bun:test'
import type { QueuedCommand } from '../types/textInputTypes.js'
import { canBatchWith } from './print.js'

const session = (
  sessionId: string,
  purpose = 'message',
  summary?: string,
): QueuedCommand => ({
  mode: 'prompt',
  value: 'x',
  origin: { kind: 'session', sessionId, name: 'n', purpose, summary },
})

const human: QueuedCommand = { mode: 'prompt', value: 'x' }

describe('canBatchWith origin', () => {
  test('merges messages with the same origin', () => {
    expect(canBatchWith(session('a'), session('a'))).toBe(true)
    expect(canBatchWith(human, { ...human })).toBe(true)
  })

  test('does not merge a human prompt with a session message', () => {
    expect(canBatchWith(human, session('a'))).toBe(false)
    expect(canBatchWith(session('a'), human)).toBe(false)
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
