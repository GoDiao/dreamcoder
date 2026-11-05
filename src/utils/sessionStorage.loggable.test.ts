import { describe, expect, test } from 'bun:test'
import type { Message } from '../types/message.js'
import { isLoggableMessage } from './sessionStorage.js'

const attachment = (type: string) =>
  ({ type: 'attachment', uuid: 'a-1', timestamp: '2026-01-01T00:00:00.000Z', attachment: { type, prompt: 'hi' } }) as unknown as Message

describe('isLoggableMessage', () => {
  test('keeps messages queued during a turn', () => {
    expect(isLoggableMessage(attachment('queued_command'))).toBe(true)
  })

  test('still drops other attachments', () => {
    expect(isLoggableMessage(attachment('date_change'))).toBe(false)
  })
})
