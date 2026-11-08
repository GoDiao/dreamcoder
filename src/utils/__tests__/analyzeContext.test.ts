import { describe, expect, test } from 'bun:test'
import type {
  AssistantMessage,
  AttachmentMessage,
  UserMessage,
} from '../../types/message.js'
import { roughTokenCountEstimation } from '../../services/tokenEstimation.js'
import { jsonStringify } from '../slowOperations.js'
import {
  estimateTokensForContextMessages,
  processAssistantMessage,
  processAttachment,
  processUserMessage,
  type MessageBreakdown,
} from '../analyzeContext.js'

const LARGE_BASE64 = 'A'.repeat(800_000)

function largeImageSource() {
  return {
    type: 'base64' as const,
    media_type: 'image/png' as const,
    data: LARGE_BASE64,
  }
}

function largeDocumentSource() {
  return {
    type: 'base64' as const,
    media_type: 'application/pdf' as const,
    data: LARGE_BASE64,
  }
}

function largeImageUserMessage() {
  return {
    role: 'user' as const,
    content: [
      {
        type: 'image' as const,
        source: largeImageSource(),
      },
    ],
  }
}

function emptyMessageBreakdown(): MessageBreakdown {
  return {
    totalTokens: 0,
    toolCallTokens: 0,
    toolResultTokens: 0,
    attachmentTokens: 0,
    assistantMessageTokens: 0,
    userMessageTokens: 0,
    toolCallsByType: new Map(),
    toolResultsByType: new Map(),
    attachmentsByType: new Map(),
  }
}

function largeImageFileAttachment() {
  return {
    type: 'file' as const,
    filename: '/tmp/screenshot.png',
    displayPath: 'screenshot.png',
    content: {
      type: 'image' as const,
      file: {
        base64: LARGE_BASE64,
        type: 'image/png' as const,
        originalSize: 600_000,
      },
    },
  }
}

describe('estimateTokensForContextMessages', () => {
  test('counts a large base64 image as 2000 tokens instead of hundreds of thousands', () => {
    const tokens = estimateTokensForContextMessages([largeImageUserMessage()], [])
    expect(tokens).toBe(2000)
  })

  test('counts a tool_result that holds a large base64 image as 2000 tokens', () => {
    const tokens = estimateTokensForContextMessages(
      [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_screenshot',
              content: [
                {
                  type: 'image',
                  source: largeImageSource(),
                },
              ],
            },
          ],
        },
      ],
      [],
    )
    expect(tokens).toBe(2000)
  })

  test('counts a large base64 document as 2000 tokens', () => {
    const tokens = estimateTokensForContextMessages(
      [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: largeDocumentSource(),
            },
          ],
        },
      ],
      [],
    )
    expect(tokens).toBe(2000)
  })

  test('counts text plus an image with the image flat estimate instead of stringify length', () => {
    const text = 'Here is the screenshot from the browser tool.'
    const tokens = estimateTokensForContextMessages(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text },
            {
              type: 'image',
              source: largeImageSource(),
            },
          ],
        },
      ],
      [],
    )
    const textTokens = roughTokenCountEstimation(text)
    expect(tokens).toBe(textTokens + 2000)
  })
})

describe('processUserMessage', () => {
  test('scores a tool_result image as 2000 tokens in the tool result breakdown', () => {
    const breakdown = emptyMessageBreakdown()
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_screenshot',
            content: [
              {
                type: 'image',
                source: largeImageSource(),
              },
            ],
          },
        ],
      },
    } as UserMessage

    processUserMessage(
      message,
      breakdown,
      new Map([['toolu_screenshot', 'screenshot']]),
    )

    expect(breakdown.toolResultTokens).toBe(2000)
    expect(breakdown.toolResultsByType.get('screenshot')).toBe(2000)
    expect(breakdown.userMessageTokens).toBe(0)
  })
})

describe('processAssistantMessage', () => {
  test('scores an image block as 2000 tokens instead of the base64 length', () => {
    const breakdown = emptyMessageBreakdown()
    const message = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'image',
            source: largeImageSource(),
          },
        ],
      },
    } as AssistantMessage

    processAssistantMessage(message, breakdown)

    expect(breakdown.assistantMessageTokens).toBe(2000)
    expect(breakdown.toolCallTokens).toBe(0)
  })

  test('scores a tool call with the per-block estimator', () => {
    const breakdown = emptyMessageBreakdown()
    const block = {
      type: 'tool_use' as const,
      id: 'toolu_screenshot',
      name: 'screenshot',
      input: { url: 'https://example.com' },
    }
    const message = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [block],
      },
    } as AssistantMessage

    processAssistantMessage(message, breakdown)

    const perBlock = roughTokenCountEstimation(
      block.name + jsonStringify(block.input),
    )
    expect(breakdown.toolCallTokens).toBe(perBlock)
    expect(breakdown.toolCallsByType.get('screenshot')).toBe(perBlock)
    expect(perBlock).not.toBe(roughTokenCountEstimation(jsonStringify(block)))
  })
})

describe('processAttachment', () => {
  test('scores a file attachment image as 2000 tokens plus the Read wrapper', () => {
    const attachment = largeImageFileAttachment()
    const breakdown = emptyMessageBreakdown()
    const message = {
      type: 'attachment',
      attachment,
    } as AttachmentMessage

    processAttachment(message, breakdown)

    expect(breakdown.attachmentTokens).toBe(2030)
    expect(breakdown.attachmentsByType.get('file')).toBe(2030)
    expect(roughTokenCountEstimation(jsonStringify(attachment))).toBeGreaterThan(
      100_000,
    )
  })
})
