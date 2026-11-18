import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { truncateHeadForPTLRetry } from '../../compact/compact.js'
import { createAssistantMessage, createUserMessage } from '../../../utils/messages.js'
import type { Message } from '../../../types/message.js'
import { classifyAPIError, getAssistantMessageFromError, isPromptTooLongMessage } from '../errors.js'

const openRouterOverflow =
  "This endpoint's maximum context length is 128000 tokens. However, you requested about 270016 tokens (270000 of text input, 16 in the output). Please reduce the length of the input, or use the context-compression plugin to compress your prompt automatically."

function apiError(status: number | undefined, message: string): APIError {
  const body = { type: 'error', error: { type: 'invalid_request_error', message } }
  return new APIError(status, body, undefined, new Headers())
}

function conversation(): Message[] {
  const turn = 'x'.repeat(80_000)
  const messages: Message[] = [createUserMessage({ content: turn })]
  for (let i = 0; i < 10; i += 1) {
    messages.push(createAssistantMessage({ content: `step ${i}` }))
    messages.push(createUserMessage({ content: turn }))
  }
  return messages
}

describe('context overflow from third-party providers', () => {
  let originalApiKey: string | undefined

  beforeAll(() => {
    originalApiKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-test'
  })

  afterAll(() => {
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalApiKey
  })

  test.each([
    ['the proxy', 400, 'prompt is too long: 270016 tokens > 128000 maximum · ' + openRouterOverflow],
    ['a direct provider', 400, openRouterOverflow],
    ['a direct provider stream', undefined, openRouterOverflow],
  ])('an overflow reported by %s drops enough old rounds to fit on the compact retry', (_source, status, message) => {
    const error = apiError(status, message)

    const reply = getAssistantMessageFromError(error, 'gpt-4o-mini')
    const truncated = truncateHeadForPTLRetry(conversation(), reply)

    expect(isPromptTooLongMessage(reply)).toBe(true)
    expect(classifyAPIError(error)).toBe('prompt_too_long')
    expect(truncated).toHaveLength(7)
  })

  test.each([
    'Your input exceeds the context window of this model. Please adjust your input and try again.',
    'Range of input length should be [1, 129024]',
    'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).',
    'Invalid request: Your request exceeded model token limit: 131072',
    'Invalid request: total message token length 140000 exceed model limit 131072',
    'Prompt exceeds max length',
  ])('recognizes "%s" as a context overflow', (message) => {
    expect(isPromptTooLongMessage(getAssistantMessageFromError(apiError(400, message), 'model'))).toBe(true)
  })

  test('does not treat an unrelated 400 as a context overflow', () => {
    const reply = getAssistantMessageFromError(apiError(400, 'max_tokens must be at most 8192'), 'model')

    expect(isPromptTooLongMessage(reply)).toBe(false)
  })
})
