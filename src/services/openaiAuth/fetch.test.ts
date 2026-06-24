import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { OPENAI_CODEX_API_ENDPOINT } from './client.js'
import { buildOpenAICodexFetch } from './fetch.js'
import { clearOpenAIOAuthTokenCache } from './storage.js'

describe('buildOpenAICodexFetch', () => {
  let tmpDir: string
  let originalTokenFile: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openai-codex-fetch-'))
    originalTokenFile = process.env.OPENAI_CODEX_OAUTH_FILE
    process.env.OPENAI_CODEX_OAUTH_FILE = path.join(tmpDir, 'openai-oauth.json')
    clearOpenAIOAuthTokenCache()
    await fs.writeFile(
      process.env.OPENAI_CODEX_OAUTH_FILE,
      JSON.stringify({
        accessToken: 'access-for-chatgpt',
        refreshToken: 'refresh-for-chatgpt',
        expiresAt: Date.now() + 60 * 60_000,
        accountId: 'acct_fetch',
        email: 'user@example.com',
      }),
      'utf-8',
    )
  })

  afterEach(async () => {
    if (originalTokenFile === undefined) {
      delete process.env.OPENAI_CODEX_OAUTH_FILE
    } else {
      process.env.OPENAI_CODEX_OAUTH_FILE = originalTokenFile
    }
    clearOpenAIOAuthTokenCache()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('maps Anthropic messages to ChatGPT Codex responses endpoint with account header', async () => {
    const upstreamCalls: Array<{
      url: string
      headers: Record<string, string>
      body: Record<string, unknown>
    }> = []
    const fetchOverride: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers)
      upstreamCalls.push({
        url: String(input),
        headers: Object.fromEntries(headers.entries()),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      })
      return Response.json({
        id: 'resp_123',
        object: 'response',
        created_at: 1_779_118_000,
        model: 'gpt-5.5',
        status: 'completed',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ok' }],
        }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      })
    }

    const openAIFetch = buildOpenAICodexFetch(fetchOverride, 'test')
    const response = await openAIFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-5.5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Say ok' }],
      }),
    })

    expect(upstreamCalls).toHaveLength(1)
    expect(upstreamCalls[0].url).toBe(OPENAI_CODEX_API_ENDPOINT)
    expect(upstreamCalls[0].headers.authorization).toBe('Bearer access-for-chatgpt')
    expect(upstreamCalls[0].headers['chatgpt-account-id']).toBe('acct_fetch')
    expect(upstreamCalls[0].body.model).toBe('gpt-5.5')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      type: 'message',
      model: 'gpt-5.5',
      content: [{ type: 'text', text: 'ok' }],
    })
  })

  test('uses streamed Codex responses even for non-streaming Anthropic callers', async () => {
    const upstreamCalls: Array<{
      url: string
      body: Record<string, unknown>
    }> = []
    const fetchOverride: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      upstreamCalls.push({
        url: String(input),
        body,
      })
      return new Response([
        'event: response.completed',
        'data: {"response":{"id":"resp_456","object":"response","created_at":1779118000,"model":"gpt-5.5","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"streamed ok"}]}],"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}',
        '',
      ].join('\n'), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    const openAIFetch = buildOpenAICodexFetch(fetchOverride, 'test')
    const response = await openAIFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-5.5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Say ok' }],
      }),
    })

    expect(upstreamCalls).toHaveLength(1)
    expect(upstreamCalls[0].url).toBe(OPENAI_CODEX_API_ENDPOINT)
    expect(upstreamCalls[0].body.stream).toBe(true)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    await expect(response.json()).resolves.toMatchObject({
      type: 'message',
      model: 'gpt-5.5',
      content: [{ type: 'text', text: 'streamed ok' }],
    })
  })
})
