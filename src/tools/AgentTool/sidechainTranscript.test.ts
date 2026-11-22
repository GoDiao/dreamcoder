import type { UUID } from 'crypto'
import { describe, expect, it } from 'bun:test'
import type { Message } from '../../types/message.js'
import { unrecordedMessages } from './sidechainTranscript.js'

const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
const C = '00000000-0000-4000-8000-000000000003'
const D = '00000000-0000-4000-8000-000000000004'
const X = '00000000-0000-4000-8000-000000000005'
const SUMMARY = '00000000-0000-4000-8000-000000000006'
const NEXT = '00000000-0000-4000-8000-000000000007'

const message = (uuid: UUID) => ({ type: 'user', uuid }) as unknown as Message
const uuids = (messages: Message[]) => messages.map(m => m.uuid)

describe('unrecordedMessages', () => {
  it('writes everything into a new transcript', () => {
    const result = unrecordedMessages([message(A), message(B)], new Set())
    expect(uuids(result.messages)).toEqual([A, B])
    expect(result.parentUuid).toBeNull()
  })

  it('skips the history a teammate already wrote and chains onto it', () => {
    const recorded = new Set<UUID>([A, B, C])
    const result = unrecordedMessages(
      [message(A), message(B), message(C), message(D)],
      recorded,
    )
    expect(uuids(result.messages)).toEqual([D])
    expect(result.parentUuid).toBe(C)
  })

  it('keeps messages added after compaction even if an old one follows', () => {
    const recorded = new Set<UUID>([A, X])
    const result = unrecordedMessages(
      [message(A), message(SUMMARY), message(X), message(NEXT)],
      recorded,
    )
    expect(uuids(result.messages)).toEqual([SUMMARY, NEXT])
    expect(result.parentUuid).toBe(A)
  })

  it('writes nothing when every message is already there', () => {
    const result = unrecordedMessages([message(A)], new Set<UUID>([A]))
    expect(result.messages).toEqual([])
  })
})
