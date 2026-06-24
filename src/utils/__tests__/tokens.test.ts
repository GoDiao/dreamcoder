import { describe, expect, test } from 'bun:test'
import { getCurrentUsage } from '../tokens.js'

describe('getCurrentUsage', () => {
  test('skips zero placeholder usage and returns the latest meaningful usage', () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          model: 'gpt-5.5',
          content: [{ type: 'text', text: 'older' }],
          usage: {
            input_tokens: 123,
            output_tokens: 45,
            cache_creation_input_tokens: 6,
            cache_read_input_tokens: 7,
          },
        },
      },
      {
        type: 'assistant',
        message: {
          model: 'gpt-5.5',
          content: [{ type: 'text', text: 'placeholder' }],
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
    ] as const

    expect(getCurrentUsage(messages as never)).toEqual({
      input_tokens: 123,
      output_tokens: 45,
      cache_creation_input_tokens: 6,
      cache_read_input_tokens: 7,
    })
  })
})
