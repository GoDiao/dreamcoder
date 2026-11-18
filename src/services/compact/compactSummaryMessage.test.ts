import { describe, expect, test } from 'bun:test'
import { getCompactUserSummaryMessage } from './prompt.js'

describe('message that carries the compaction summary', () => {
  test('points to the transcript for Grep instead of a whole-file Read', () => {
    const text = getCompactUserSummaryMessage('<summary>work so far</summary>', false, '/sessions/abc.jsonl')

    expect(text).toContain('/sessions/abc.jsonl')
    expect(text).toContain('Grep')
    expect(text).not.toContain('read the full transcript')
  })
})
