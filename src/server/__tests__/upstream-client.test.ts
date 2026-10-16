import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { normalizeUpstreamBaseUrl } from '../upstream/baseUrl.js'
import { resolveUpstreamTarget, sendToUpstream, type UpstreamTarget } from '../upstream/client.js'
import type { AnthropicRequest } from '../proxy/transform/types.js'
import type { SavedProvider } from '../types/provider.js'

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

let tmpDir: string
let originalConfigDir: string | undefined
let originalFetch: typeof globalThis.fetch
let calls: Call[]

function mockFetch(respond: () => Response) {
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return respond()
  }) as typeof fetch
}

function target(overrides?: Partial<UpstreamTarget>): UpstreamTarget {
  return {
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test',
    apiFormat: 'anthropic',
    authStrategy: 'api_key',
    ...overrides,
  }
}

const request: AnthropicRequest = {
  model: 'model-main[1m]',
  max_tokens: 16,
  messages: [{ role: 'user', content: 'hello' }],
}

const anthropicMessage = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'model-main',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
}

const openaiChatMessage = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 0,
  model: 'model-main',
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}

describe('upstream client', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'upstream-client-test-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    originalFetch = globalThis.fetch
    calls = []
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('normalizes trailing slashes and a trailing /v1', () => {
    expect(normalizeUpstreamBaseUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api')
    expect(normalizeUpstreamBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com')
    expect(normalizeUpstreamBaseUrl(' https://api.example.com// ')).toBe('https://api.example.com')
    expect(normalizeUpstreamBaseUrl('https://api.example.com/anthropic')).toBe('https://api.example.com/anthropic')
  })

  test.each([
    ['anthropic', '/v1/messages', anthropicMessage],
    ['openai_chat', '/v1/chat/completions', openaiChatMessage],
    ['openai_responses', '/v1/responses', {
      id: 'resp_1',
      object: 'response',
      model: 'model-main',
      status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }],
  ] as const)('%s requests go to %s and come back as an Anthropic message', async (apiFormat, suffix, upstreamBody) => {
    mockFetch(() => Response.json(upstreamBody))

    const result = await sendToUpstream(target({ apiFormat, baseUrl: 'https://api.example.com/v1' }), request)

    expect(calls[0].url).toBe(`https://api.example.com${suffix}`)
    expect(calls[0].body.model).toBe('model-main')
    expect(result.ok && 'message' in result && result.message.type).toBe('message')
    expect(result.ok && 'message' in result && result.message.content[0]).toMatchObject({ type: 'text', text: 'ok' })
  })

  test.each([
    ['api_key', { 'x-api-key': 'sk-test' }, ['authorization']],
    ['auth_token', { Authorization: 'Bearer sk-test' }, ['x-api-key']],
    ['auth_token_empty_api_key', { Authorization: 'Bearer sk-test' }, ['x-api-key']],
    ['dual_same_token', { 'x-api-key': 'sk-test', Authorization: 'Bearer sk-test' }, []],
    ['dual_dummy', { 'x-api-key': 'dummy', Authorization: 'Bearer dummy' }, []],
  ] as const)('anthropic auth strategy %s sets the expected headers', async (authStrategy, expected, absent) => {
    mockFetch(() => Response.json(anthropicMessage))

    await sendToUpstream(target({ authStrategy }), request)

    expect(calls[0].headers).toMatchObject(expected)
    for (const header of absent) {
      expect(Object.keys(calls[0].headers).map((key) => key.toLowerCase())).not.toContain(header)
    }
  })

  test('OpenAI formats always use bearer auth regardless of auth strategy', async () => {
    mockFetch(() => Response.json(openaiChatMessage))

    await sendToUpstream(target({ apiFormat: 'openai_chat', authStrategy: 'api_key' }), request)

    expect(calls[0].headers.Authorization).toBe('Bearer sk-test')
    expect(calls[0].headers['x-api-key']).toBeUndefined()
  })

  test('converts OpenAI Chat streams into Anthropic SSE', async () => {
    const chunks = [
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'model-main', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] },
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'model-main', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]
    const sse = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
    mockFetch(() => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))

    const result = await sendToUpstream(target({ apiFormat: 'openai_chat' }), { ...request, stream: true })

    expect(result.ok && 'stream' in result).toBe(true)
    const text = await new Response((result as { stream: ReadableStream<Uint8Array> }).stream).text()
    expect(text).toContain('message_start')
    expect(text).toContain('"text":"ok"')
    expect(text).toContain('message_stop')
  })

  test('reports upstream HTTP errors with status and body', async () => {
    mockFetch(() => new Response('model not found', { status: 404 }))

    const result = await sendToUpstream(target({ apiFormat: 'openai_chat' }), request)

    expect(result).toEqual({ ok: false, httpStatus: 404, error: 'Upstream returned HTTP 404: model not found' })
  })

  test('rejects responses that do not match the declared format', async () => {
    mockFetch(() => Response.json({ hello: 'world' }))

    const result = await sendToUpstream(target({ apiFormat: 'openai_chat' }), request)

    expect(result).toEqual({
      ok: false,
      httpStatus: 502,
      error: 'Response missing choices — not a valid Chat Completions endpoint',
    })
  })

  test('reports network failures without throwing', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('connect ECONNREFUSED')
    }) as unknown as typeof fetch

    const result = await sendToUpstream(target(), request)

    expect(result).toEqual({ ok: false, error: 'connect ECONNREFUSED' })
  })

  test('resolves preset default auth for providers saved without a key', () => {
    const provider: SavedProvider = {
      id: 'p1',
      presetId: 'lmstudio',
      name: 'LM Studio',
      apiKey: '',
      baseUrl: 'http://localhost:1234',
      apiFormat: 'anthropic',
      runtimeKind: 'anthropic_compatible',
      models: { main: 'm', haiku: 'm', sonnet: 'm', opus: 'm' },
    }

    expect(resolveUpstreamTarget(provider)).toEqual({
      baseUrl: 'http://localhost:1234',
      apiKey: 'lmstudio',
      apiFormat: 'anthropic',
      authStrategy: 'auth_token_empty_api_key',
    })
  })
})
