import type { UUID } from 'crypto'
import { describe, expect, it } from 'bun:test'
import type { Message } from '../../types/message.js'
import { unrecordedMessages } from './sidechainTranscript.js'

const message = (uuid: string) => ({ type: 'user', uuid }) as unknown as Message
const uuids = (messages: Message[]) => messages.map(m => m.uuid)

describe('unrecordedMessages', () => {
  it('writes everything into a new transcript', () => {
    const result = unrecordedMessages([message('a'), message('b')], new Set())
    expect(uuids(result.messages)).toEqual(['a', 'b'])
    expect(result.parentUuid).toBeNull()
  })

  it('skips the history a teammate already wrote and chains onto it', () => {
    const recorded = new Set(['a', 'b', 'c'] as UUID[])
    const result = unrecordedMessages(
      [message('a'), message('b'), message('c'), message('d')],
      recorded,
    )
    expect(uuids(result.messages)).toEqual(['d'])
    expect(result.parentUuid).toBe('c' as UUID)
  })

  it('keeps messages added after compaction even if an old one follows', () => {
    const recorded = new Set(['a', 'x'] as UUID[])
    const result = unrecordedMessages(
      [message('a'), message('summary'), message('x'), message('next')],
      recorded,
    )
    expect(uuids(result.messages)).toEqual(['summary', 'next'])
    expect(result.parentUuid).toBe('a' as UUID)
  })

  it('writes nothing when every message is already there', () => {
    const result = unrecordedMessages([message('a')], new Set(['a'] as UUID[]))
    expect(result.messages).toEqual([])
  })
})
