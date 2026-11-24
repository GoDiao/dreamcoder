import { describe, expect, test } from 'bun:test'
import type { Attachment } from '../attachments.js'
import { createAttachmentMessage } from '../attachments.js'
import { createUserMessage, normalizeMessagesForAPI } from '../messages.js'

describe('attachments from older sessions', () => {
  test('a context_efficiency attachment adds nothing to the request', () => {
    const legacy = { type: 'context_efficiency' } as unknown as Attachment
    const normalized = normalizeMessagesForAPI([
      createUserMessage({ content: 'hello' }),
      createAttachmentMessage(legacy),
    ])

    expect(normalized).toHaveLength(1)
    expect(normalized[0]!.message.content).toBe('hello')
  })
})
