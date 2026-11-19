import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { diagnosticsService, type DiagnosticEventInput } from '../services/diagnosticsService.js'
import { normalizeUpstreamBaseUrl } from '../upstream/baseUrl.js'
import { fetchUpstreamModels, resolveUpstreamTarget, sendToUpstream, type UpstreamTarget } from '../upstream/client.js'
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

function upstream(overrides?: Partial<UpstreamTarget>) {
  const resolved = target(overrides)
  return { target: resolved, provider: { baseUrl: resolved.baseUrl, apiFormat: resolved.apiFormat } }
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
    originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
    process.env.DREAMCODER_CONFIG_DIR = tmpDir
    originalFetch = globalThis.fetch
    calls = []
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
    else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
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

    const result = await sendToUpstream(upstream({ apiFormat, baseUrl: 'https://api.example.com/v1' }), request)

    expect(calls[0].url).toBe(`https://api.example.com${suffix}`)
    expect(calls[0].body.model).toBe('model-main')
    expect(result.ok && 'message' in result && result.message.type).toBe('message')
    expect(result.ok && 'message' in result && result.message.content[0]).toMatchObject({ type: 'text', text: 'ok' })
  })

  test.each([
    ['openai_chat', 'https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
    ['openai_chat', 'https://ark.cn-beijing.volces.com/api/v3/', 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'],
    ['openai_chat', 'https://generativelanguage.googleapis.com/v1beta/openai', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
    ['openai_responses', 'https://api.openai.com/v1', 'https://api.openai.com/v1/responses'],
    ['openai_responses', 'https://api.openai.com', 'https://api.openai.com/v1/responses'],
    ['openai_chat', 'https://relay.example.com/openai-compatible', 'https://relay.example.com/openai-compatible/v1/chat/completions'],
  ] as const)('%s base URL %s is used as %s', async (apiFormat, baseUrl, expected) => {
    mockFetch(() => Response.json(apiFormat === 'openai_chat' ? openaiChatMessage : {
      id: 'resp_1',
      object: 'response',
      model: 'model-main',
      status: 'completed',
      output: [],
    }))

    await sendToUpstream(upstream({ apiFormat, baseUrl }), request)

    expect(calls[0].url).toBe(expected)
  })

  test('lists OpenAI-format models under a base URL that already ends in a version', async () => {
    let requestPath = ''
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        requestPath = new URL(req.url).pathname
        return Response.json({ data: [{ id: 'glm-4.6' }] })
      },
    })

    try {
      const result = await fetchUpstreamModels(target({
        apiFormat: 'openai_chat',
        baseUrl: `http://127.0.0.1:${server.port}/api/paas/v4`,
      }))

      expect(requestPath).toBe('/api/paas/v4/models')
      expect(result.ok && result.models).toEqual([{ id: 'glm-4.6' }])
    } finally {
      server.stop(true)
    }
  })

  test.each([
    ['api_key', { 'x-api-key': 'sk-test' }, ['authorization']],
    ['auth_token', { Authorization: 'Bearer sk-test' }, ['x-api-key']],
    ['auth_token_empty_api_key', { Authorization: 'Bearer sk-test' }, ['x-api-key']],
    ['dual_same_token', { 'x-api-key': 'sk-test', Authorization: 'Bearer sk-test' }, []],
    ['dual_dummy', { 'x-api-key': 'dummy', Authorization: 'Bearer dummy' }, []],
  ] as const)('anthropic auth strategy %s sets the expected headers', async (authStrategy, expected, absent) => {
    mockFetch(() => Response.json(anthropicMessage))

    await sendToUpstream(upstream({ authStrategy }), request)

    expect(calls[0].headers).toMatchObject(expected)
    for (const header of absent) {
      expect(Object.keys(calls[0].headers).map((key) => key.toLowerCase())).not.toContain(header)
    }
  })

  test('OpenAI formats always use bearer auth regardless of auth strategy', async () => {
    mockFetch(() => Response.json(openaiChatMessage))

    await sendToUpstream(upstream({ apiFormat: 'openai_chat', authStrategy: 'api_key' }), request)

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

    const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), { ...request, stream: true })

    expect(result.ok && 'stream' in result).toBe(true)
    const text = await new Response((result as { stream: ReadableStream<Uint8Array> }).stream).text()
    expect(text).toContain('message_start')
    expect(text).toContain('"text":"ok"')
    expect(text).toContain('message_stop')
  })

  test('reports an upstream HTTP error with its status, an Anthropic error type and the plain body', async () => {
    mockFetch(() => new Response('model not found', { status: 404 }))

    const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), request)

    expect(result).toEqual({ ok: false, httpStatus: 404, errorType: 'not_found_error', error: 'model not found', headers: {} })
  })

  test('reads the message out of a JSON error body and keeps the retry and request id headers', async () => {
    mockFetch(() => Response.json(
      { error: { message: 'Rate limit reached for gpt-4.1, please try again in 20s.', type: 'requests', code: 'rate_limit_exceeded' } },
      { status: 429, headers: { 'retry-after': '20', 'retry-after-ms': '20000', 'x-request-id': 'req_abc', 'set-cookie': 'a=b' } },
    ))

    const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), request)

    expect(result).toEqual({
      ok: false,
      httpStatus: 429,
      errorType: 'rate_limit_error',
      error: 'Rate limit reached for gpt-4.1, please try again in 20s.',
      headers: { 'retry-after': '20', 'retry-after-ms': '20000', 'x-request-id': 'req_abc', 'request-id': 'req_abc' },
    })
  })

  test('keeps at most 500 characters of a long provider message', async () => {
    mockFetch(() => Response.json({ error: { message: 'x'.repeat(5000) } }, { status: 500 }))

    const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), request)

    expect(result.ok === false && result.error).toBe('x'.repeat(500))
  })

  test.each([
    ['OpenAI insufficient_quota', 429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } }],
    ['Moonshot exceeded_current_quota_error', 429, { error: { message: 'Your account has exceeded the current quota.', type: 'exceeded_current_quota_error' } }],
    ['Zhipu 1113', 429, { error: { code: '1113', message: '余额不足或无可用资源包,请充值。' } }],
    ['DeepSeek 402', 402, { error: { message: 'Insufficient Balance', type: 'unknown_error' } }],
    ['OpenRouter 402', 402, { error: { message: 'Insufficient credits. Add more using https://openrouter.ai/settings/credits', code: 402 } }],
  ])('reports %s as a billing error the CLI does not retry', async (_kind, status, body) => {
    mockFetch(() => Response.json(body, { status }))

    const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), request)

    expect(result).toMatchObject({ ok: false, httpStatus: 402, errorType: 'billing_error', headers: { 'x-should-retry': 'false' } })
  })

  test.each([
    [401, 'authentication_error'],
    [403, 'permission_error'],
  ] as const)('tells the CLI not to retry a %i from the provider', async (status, type) => {
    mockFetch(() => Response.json({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }, { status }))

    const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), request)

    expect(result).toEqual({
      ok: false,
      httpStatus: status,
      errorType: type,
      error: 'Incorrect API key provided',
      headers: { 'x-should-retry': 'false' },
    })
  })

  test.each([
    ['a quota error', { error: { message: 'You exceeded your current quota.', code: 'insufficient_quota' } }, 402, 'billing_error'],
    ['an unknown error', { error: { message: 'something broke' } }, 502, 'api_error'],
  ] as const)('maps %s inside a 2xx body by its content', async (_kind, body, status, type) => {
    mockFetch(() => Response.json(body))

    const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), request)

    expect(result).toMatchObject({ ok: false, httpStatus: status, errorType: type })
  })

  test.each([
    [
      'an OpenRouter message with token counts',
      { error: { message: "This endpoint's maximum context length is 128000 tokens. However, you requested about 270016 tokens (270000 of text input, 16 in the output).", code: 400 } },
      "prompt is too long: 270016 tokens > 128000 maximum · This endpoint's maximum context length is 128000 tokens. However, you requested about 270016 tokens (270000 of text input, 16 in the output).",
    ],
    [
      'an OpenAI error code',
      { error: { message: 'Your input exceeds the context window of this model.', type: 'invalid_request_error', code: 'context_length_exceeded' } },
      'prompt is too long · Your input exceeds the context window of this model.',
    ],
    [
      'a Zhipu business code',
      { error: { code: '1261', message: 'Prompt exceeds max length' } },
      'prompt is too long · Prompt exceeds max length',
    ],
  ])('turns a context overflow reported as %s into the Anthropic prompt-too-long error', async (_kind, body, message) => {
    mockFetch(() => Response.json(body, { status: 400 }))

    const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), request)

    expect(result).toEqual({ ok: false, httpStatus: 400, errorType: 'invalid_request_error', error: message, headers: {} })
  })

  test('rejects responses that do not match the declared format', async () => {
    mockFetch(() => Response.json({ hello: 'world' }))

    const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), request)

    expect(result).toEqual({
      ok: false,
      httpStatus: 502,
      error: 'Response missing choices — not a valid Chat Completions endpoint',
    })
  })

  test.each([
    ['content_filter', 400, 'invalid_request_error', "The provider's content filter stopped the reply (finish_reason: content_filter)."],
    ['insufficient_system_resource', 502, 'api_error', 'The provider stopped the reply because of an error on its side (finish_reason: insufficient_system_resource).'],
  ] as const)('reports a non-streaming reply that ended with %s as an error', async (reason, status, type, message) => {
    mockFetch(() => Response.json({ ...openaiChatMessage, choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: reason }] }))

    const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), request)

    expect(result).toEqual({ ok: false, httpStatus: status, errorType: type, error: message, headers: {} })
  })

  test('reports conversion failures as 502 instead of throwing', async () => {
    mockFetch(() => Response.json({ choices: [{}] }))

    const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), request)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.httpStatus).toBe(502)
  })

  test('reports network failures without throwing', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('connect ECONNREFUSED')
    }) as unknown as typeof fetch

    const result = await sendToUpstream(upstream(), request)

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
      models: [{ id: 'm' }],
    }

    expect(resolveUpstreamTarget(provider)).toEqual({
      providerId: 'p1',
      baseUrl: 'http://localhost:1234',
      apiKey: 'lmstudio',
      apiFormat: 'anthropic',
      authStrategy: 'auth_token_empty_api_key',
    })
  })

  describe('extra headers and query parameters', () => {
    test('adds configured headers first and lets auth and content type from the provider settings win', async () => {
      mockFetch(() => Response.json(openaiChatMessage))

      await sendToUpstream(upstream({
        apiFormat: 'openai_chat',
        baseUrl: 'https://example.openai.azure.com/openai/v1',
        extraHeaders: { 'HTTP-Referer': 'https://dreamcoder.dev', authorization: 'Bearer from-config', 'content-type': 'text/plain' },
        queryParams: { 'api-version': '2024-10-21' },
      }), request)

      expect(calls[0].url).toBe('https://example.openai.azure.com/openai/v1/chat/completions?api-version=2024-10-21')
      expect(calls[0].headers).toEqual({
        'HTTP-Referer': 'https://dreamcoder.dev',
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-test',
      })
    })

    test('lists models with the configured headers and query parameters', async () => {
      let seen = { search: '', referer: '' }
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(req) {
          seen = { search: new URL(req.url).search, referer: req.headers.get('http-referer') ?? '' }
          return Response.json({ data: [{ id: 'm' }] })
        },
      })

      try {
        await fetchUpstreamModels(target({
          apiFormat: 'openai_chat',
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          extraHeaders: { 'HTTP-Referer': 'https://dreamcoder.dev' },
          queryParams: { 'api-version': '2024-10-21' },
        }))

        expect(seen).toEqual({ search: '?api-version=2024-10-21', referer: 'https://dreamcoder.dev' })
      } finally {
        server.stop(true)
      }
    })

    test('reports an invalid configured header instead of throwing', async () => {
      const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json(openaiChatMessage) })

      try {
        const result = await sendToUpstream(upstream({
          apiFormat: 'openai_chat',
          baseUrl: `http://127.0.0.1:${server.port}`,
          extraHeaders: { 'Bad Header': 'x' },
        }), request)

        expect(result.ok).toBe(false)
        expect(result.ok === false && result.error).toContain('Bad Header')
      } finally {
        server.stop(true)
      }
    })
  })

  describe('stream idle timeout', () => {
    const encoder = new TextEncoder()

    async function readWithGuard(stream: ReadableStream<Uint8Array>): Promise<string> {
      return Promise.race([
        new Response(stream).text(),
        Bun.sleep(3_000).then(() => 'still waiting'),
      ])
    }

    function hangingUpstream(start: (controller: ReadableStreamDefaultController<Uint8Array>) => void, onCancel: () => void) {
      return new Response(new ReadableStream<Uint8Array>({ start, cancel: onCancel }), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    test('ends a stream with an error and cancels the upstream when no event reaches the client in time', async () => {
      let upstreamCancelled = false
      mockFetch(() => hangingUpstream((controller) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hi' }, finish_reason: null }] })}\n\n`))
      }, () => { upstreamCancelled = true }))

      const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), { ...request, stream: true }, { timeoutMs: 300 })
      const text = await readWithGuard((result as { stream: ReadableStream<Uint8Array> }).stream)

      expect(text).toContain('"text":"Hi"')
      expect(text).toMatch(/event: error\ndata: .*No response from the provider/)
      expect(upstreamCancelled).toBe(true)
    })

    test('keep-alive comments become ping events but do not count as activity', async () => {
      let timer: ReturnType<typeof setInterval> | undefined
      mockFetch(() => hangingUpstream((controller) => {
        timer = setInterval(() => controller.enqueue(encoder.encode(': OPENROUTER PROCESSING\n\n')), 50)
      }, () => clearInterval(timer)))

      try {
        const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), { ...request, stream: true }, { timeoutMs: 300 })
        const text = await readWithGuard((result as { stream: ReadableStream<Uint8Array> }).stream)

        expect(text).toContain('event: ping\ndata: {"type":"ping"}')
        expect(text).toContain('event: error')
      } finally {
        clearInterval(timer)
      }
    })

    test('upstream events that produce nothing for the client do not count as activity', async () => {
      let timer: ReturnType<typeof setInterval> | undefined
      mockFetch(() => hangingUpstream((controller) => {
        controller.enqueue(encoder.encode('event: response.created\ndata: {"type":"response.created","response":{"id":"r1"}}\n\n'))
        timer = setInterval(() => controller.enqueue(encoder.encode('event: response.in_progress\ndata: {"type":"response.in_progress"}\n\n')), 50)
      }, () => clearInterval(timer)))

      try {
        const result = await sendToUpstream(upstream({ apiFormat: 'openai_responses' }), { ...request, stream: true }, { timeoutMs: 300 })
        const text = await readWithGuard((result as { stream: ReadableStream<Uint8Array> }).stream)

        expect(text).toContain('event: message_start')
        expect(text).toContain('event: error')
      } finally {
        clearInterval(timer)
      }
    })
  })

  describe('diagnostics', () => {
    let events: DiagnosticEventInput[]
    let recordSpy: ReturnType<typeof spyOn>

    beforeEach(() => {
      events = []
      recordSpy = spyOn(diagnosticsService, 'recordEvent').mockImplementation(async (event) => {
        events.push(event)
      })
    })

    afterEach(() => {
      recordSpy.mockRestore()
    })

    const upstreamEvents = () => events.filter((event) => event.type === 'upstream_request')
    const chatChunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
      `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'model-main', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`

    test('records a successful request without the key or the request body', async () => {
      mockFetch(() => Response.json(openaiChatMessage, { headers: { 'x-request-id': 'req_123' } }))

      await sendToUpstream(upstream({ apiFormat: 'openai_chat', providerId: 'p1' }), request)

      expect(upstreamEvents()).toHaveLength(1)
      const [event] = upstreamEvents()
      expect(event!.severity).toBe('info')
      expect(event!.details).toMatchObject({
        providerId: 'p1',
        model: 'model-main',
        host: 'api.example.com',
        apiFormat: 'openai_chat',
        stream: false,
        status: 200,
        requestId: 'req_123',
        outcome: 'completed',
      })
      expect(typeof (event!.details as { durationMs: unknown }).durationMs).toBe('number')
      expect(JSON.stringify(event)).not.toContain('sk-test')
      expect(JSON.stringify(event)).not.toContain('hello')
    })

    test('records an upstream HTTP error as a warning', async () => {
      mockFetch(() => new Response('slow down', { status: 429 }))

      await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), request)

      expect(upstreamEvents()).toHaveLength(1)
      expect(upstreamEvents()[0]!.severity).toBe('warn')
      expect(upstreamEvents()[0]!.details).toMatchObject({ status: 429, outcome: 'error', error: 'slow down' })
    })

    test('records an error reported in the middle of a stream when the stream ends', async () => {
      mockFetch(() => new Response(
        chatChunk({ role: 'assistant', content: 'Hi' }) + 'data: {"error":{"message":"overloaded"}}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ))

      const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), { ...request, stream: true })
      expect(upstreamEvents()).toHaveLength(0)
      await new Response((result as { stream: ReadableStream<Uint8Array> }).stream).text()

      expect(upstreamEvents()).toHaveLength(1)
      expect(upstreamEvents()[0]!.severity).toBe('warn')
      expect(upstreamEvents()[0]!.details).toMatchObject({ stream: true, status: 200, outcome: 'error', error: 'overloaded' })
    })

    test('records a request the client aborted before the upstream answered', async () => {
      globalThis.fetch = mock((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'))
        if (init?.signal?.aborted) abort()
        init?.signal?.addEventListener('abort', abort)
      })) as unknown as typeof fetch
      const client = new AbortController()

      const pending = sendToUpstream(upstream({ apiFormat: 'openai_chat' }), request, { signal: client.signal })
      client.abort()
      const result = await pending

      expect(result.ok).toBe(false)
      expect(upstreamEvents()).toHaveLength(1)
      expect(upstreamEvents()[0]!.severity).toBe('info')
      expect(upstreamEvents()[0]!.details).toMatchObject({ outcome: 'client_aborted' })
    })

    test('records a client that disconnects as a disconnect when the upstream read fails first', async () => {
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(chatChunk({ role: 'assistant', content: 'Hi' })))
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')))
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } })) as unknown as typeof fetch
      const client = new AbortController()

      const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), { ...request, stream: true }, { signal: client.signal })
      const reader = (result as { stream: ReadableStream<Uint8Array> }).stream.getReader()
      await reader.read()
      client.abort()
      await reader.read().catch(() => null)

      expect(upstreamEvents()).toHaveLength(1)
      expect(upstreamEvents()[0]!.details).toMatchObject({ stream: true, outcome: 'client_disconnected' })
    })

    test('records an idle timeout as its own outcome', async () => {
      mockFetch(() => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(chatChunk({ role: 'assistant', content: 'Hi' })))
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } }))

      const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), { ...request, stream: true }, { timeoutMs: 200 })
      await new Response((result as { stream: ReadableStream<Uint8Array> }).stream).text()

      expect(upstreamEvents()).toHaveLength(1)
      expect(upstreamEvents()[0]!.severity).toBe('warn')
      expect(upstreamEvents()[0]!.details).toMatchObject({ stream: true, outcome: 'idle_timeout' })
    })

    test('records a client that disconnects in the middle of a stream', async () => {
      mockFetch(() => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(chatChunk({ role: 'assistant', content: 'Hi' })))
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } }))

      const result = await sendToUpstream(upstream({ apiFormat: 'openai_chat' }), { ...request, stream: true })
      const reader = (result as { stream: ReadableStream<Uint8Array> }).stream.getReader()
      await reader.read()
      await reader.cancel('client gone')

      expect(upstreamEvents()).toHaveLength(1)
      expect(upstreamEvents()[0]!.details).toMatchObject({ stream: true, outcome: 'client_disconnected' })
    })
  })
})
