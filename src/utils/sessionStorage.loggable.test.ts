import { describe, expect, test } from 'bun:test'
import type { Message } from '../types/message.js'
import { isLoggableMessage } from './sessionStorage.js'

const attachment = (type: string) =>
  ({ type: 'attachment', uuid: 'a-1', timestamp: '2026-01-01T00:00:00.000Z', attachment: { type, prompt: 'hi' } }) as unknown as Message

describe('isLoggableMessage', () => {
  test('keeps messages queued during a turn', () => {
    expect(isLoggableMessage(attachment('queued_command'))).toBe(true)
  })

  test.each(['file', 'nested_memory', 'skill_listing', 'date_change', 'edited_text_file', 'hook_additional_context'])(
    'keeps a %s attachment so a restarted CLI sees the same history',
    (type) => {
      expect(isLoggableMessage(attachment(type))).toBe(true)
    },
  )

  test('drops progress messages', () => {
    expect(isLoggableMessage({ type: 'progress', uuid: 'p-1' } as unknown as Message)).toBe(false)
  })
})
