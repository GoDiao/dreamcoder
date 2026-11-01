import { describe, expect, test } from 'bun:test'
import {
  roughTokenCountEstimation,
  roughTokenCountEstimationForBlock,
} from '../../services/tokenEstimation.js'
import { estimateTokensForContextMessages } from '../analyzeContext.js'

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

describe('estimateTokensForContextMessages', () => {
  test('counts a large base64 image near 2000 tokens instead of hundreds of thousands', () => {
    const tokens = estimateTokensForContextMessages([largeImageUserMessage()], [])
    expect(tokens).toBeGreaterThanOrEqual(1_500)
    expect(tokens).toBeLessThanOrEqual(2_500)
    expect(tokens).toBeLessThan(100_000)
  })

  test('counts a tool_result that holds a large base64 image near 2000 tokens', () => {
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
    expect(tokens).toBeGreaterThanOrEqual(1_500)
    expect(tokens).toBeLessThanOrEqual(2_500)
    expect(tokens).toBeLessThan(100_000)
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
    expect(tokens).toBeLessThan(100_000)
  })
})

describe('roughTokenCountEstimationForBlock', () => {
  test('scores an image block as 2000 tokens', () => {
    expect(
      roughTokenCountEstimationForBlock({
        type: 'image',
        source: largeImageSource(),
      }),
    ).toBe(2000)
  })

  test('scores a document block as 2000 tokens', () => {
    expect(
      roughTokenCountEstimationForBlock({
        type: 'document',
        source: largeDocumentSource(),
      }),
    ).toBe(2000)
  })

  test('scores a tool_result that holds a large image as 2000 tokens', () => {
    expect(
      roughTokenCountEstimationForBlock({
        type: 'tool_result',
        tool_use_id: 'toolu_screenshot',
        content: [
          {
            type: 'image',
            source: largeImageSource(),
          },
        ],
      }),
    ).toBe(2000)
  })
})
