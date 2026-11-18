import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import Anthropic, { APIError } from '@anthropic-ai/sdk'
import { CannotRetryError, withRetry } from '../withRetry.js'

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'] as const
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>

function errorBody(message: string, type = 'api_error', code?: string) {
  return { type: 'error', error: { type, message, ...(code && { code }) } }
}

async function firstOutcome(error: APIError): Promise<{ retried: boolean; retryInMs?: number; attempts: number }> {
  let attempts = 0
  const generator = withRetry(
    async () => ({}) as Anthropic,
    async () => {
      attempts += 1
      throw error
    },
    { model: 'model-main', thinkingConfig: { type: 'disabled' }, maxRetries: 3 },
  )
  try {
    const step = await generator.next()
    const message = step.value as { retryInMs?: number }
    await generator.return(undefined as never)
    return { retried: true, retryInMs: message.retryInMs, attempts }
  } catch (err) {
    expect(err).toBeInstanceOf(CannotRetryError)
    return { retried: false, attempts }
  }
}

describe('retrying provider errors', () => {
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    delete process.env.ANTHROPIC_BASE_URL
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  test('does not retry a quota error the proxy reports as 402', async () => {
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:3456/proxy'
    const error = APIError.generate(
      402,
      errorBody('You exceeded your current quota, please check your plan and billing details.', 'billing_error'),
      undefined,
      new Headers({ 'x-should-retry': 'false' }),
    )

    expect(await firstOutcome(error)).toEqual({ retried: false, attempts: 1 })
  })

  test('does not retry a quota error a direct third-party provider reports as 429', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.moonshot.cn/anthropic'
    const error = APIError.generate(
      429,
      errorBody('Your account has exceeded the current quota.', 'exceeded_current_quota_error'),
      undefined,
      new Headers(),
    )

    expect(await firstOutcome(error)).toEqual({ retried: false, attempts: 1 })
  })

  test('does not retry a 401 from a direct third-party provider', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://open.bigmodel.cn/api/anthropic'
    const error = APIError.generate(401, errorBody('invalid api key', 'authentication_error'), undefined, new Headers())

    expect(await firstOutcome(error)).toEqual({ retried: false, attempts: 1 })
  })

  test('keeps retrying a 401 on the Anthropic API', async () => {
    const error = APIError.generate(401, errorBody('invalid x-api-key', 'authentication_error'), undefined, new Headers())

    expect(await firstOutcome(error)).toMatchObject({ retried: true, attempts: 1 })
  })

  test('waits as long as the retry-after header the proxy passes on', async () => {
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:3456/proxy'
    const error = APIError.generate(
      429,
      errorBody('Rate limit reached, please try again in 20s.', 'rate_limit_error'),
      undefined,
      new Headers({ 'retry-after': '20' }),
    )

    expect(await firstOutcome(error)).toEqual({ retried: true, retryInMs: 20_000, attempts: 1 })
  })
})
