import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { fetchUpstreamModels, type UpstreamTarget } from '../upstream/client.js'
import { handleProvidersApi } from '../api/providers.js'
import { ProviderService } from '../services/providerService.js'

type Call = { url: string; init?: RequestInit }
const target: UpstreamTarget = {
  baseUrl: 'https://provider.invalid/v1/',
  apiKey: 'test-key',
  apiFormat: 'openai_chat',
  authStrategy: 'api_key',
}
let configDir: string
let originalConfigDir: string | undefined
let originalFetch: typeof fetch
let calls: Call[]
let warning: ReturnType<typeof spyOn>

function respondWith(respond: (call: Call) => Response | Promise<Response>) {
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
}

function paths(): string[] {
  return calls.map(({ url }) => new URL(url).pathname)
}

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'model-discovery-'))
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  process.env.DREAMCODER_CONFIG_DIR = configDir
  originalFetch = globalThis.fetch
  calls = []
  warning = spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  warning.mockRestore()
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await rm(configDir, { recursive: true, force: true })
})

describe('listed context windows', () => {
  test('reads OpenRouter context lengths through the provider service with one request', async () => {
    respondWith(() => Response.json({ data: [
      { id: 'vendor/model', name: 'Model', context_length: 131072 },
      { id: 'vendor/other', context_length: 1000000 },
    ] }))
    expect(await new ProviderService().discoverModels({ ...target, baseUrl: 'https://openrouter.ai/api/v1' })).toEqual([
      { id: 'vendor/model', name: 'Model', contextWindow: 131072 },
      { id: 'vendor/other', contextWindow: 1000000 },
    ])
    expect(calls.map(({ url }) => url)).toEqual(['https://openrouter.ai/api/v1/models'])
  })

  test('prefers max_input_tokens, then context_length, then context_window, and ignores output limits', async () => {
    respondWith(() => Response.json({ data: [
      { id: 'input', max_input_tokens: 200000, context_length: 300000, context_window: 400000, max_tokens: 64000 },
      { id: 'length', context_length: 300000, context_window: 400000 },
      { id: 'window', context_window: 400000 },
      { id: 'output-only', max_tokens: 64000 },
    ] }))
    expect(await fetchUpstreamModels(target)).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'input', contextWindow: 200000 },
      { id: 'length', contextWindow: 300000 },
      { id: 'window', contextWindow: 400000 },
      { id: 'output-only' },
    ] })
    expect(calls).toHaveLength(1)
  })

  test('ignores values outside the stored range instead of clamping or coercing them', async () => {
    const values = [15999, 10000001, 32768.5, '32768', null, 16000, 10000000]
    respondWith(() => Response.json({ data: values.map((context_length, index) => ({ id: `model-${index}`, context_length })) }))
    expect(await fetchUpstreamModels(target)).toEqual({ ok: true, httpStatus: 200, models: values.map((_, index) => ({
      id: `model-${index}`,
      ...(index === 5 ? { contextWindow: 16000 } : index === 6 ? { contextWindow: 10000000 } : {}),
    })) })
  })

  test('reads Anthropic input windows across pages', async () => {
    respondWith(({ url }) => Response.json(new URL(url).searchParams.has('after_id')
      ? { data: [{ id: 'second', max_input_tokens: 1000000 }], has_more: false }
      : { data: [{ id: 'first', max_input_tokens: 200000 }], has_more: true, last_id: 'first' }))
    expect(await fetchUpstreamModels({ ...target, apiFormat: 'anthropic' })).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'first', contextWindow: 200000 },
      { id: 'second', contextWindow: 1000000 },
    ] })
    expect(calls).toHaveLength(2)
  })

  test('makes no extra requests for providers without a dedicated source', async () => {
    respondWith(() => Response.json({ data: [{ id: 'qwen3:8b', owned_by: 'other' }] }))
    for (const baseUrl of ['http://localhost:11434', 'http://localhost:1234', 'https://api.deepseek.com.evil.invalid/v1']) {
      expect(await fetchUpstreamModels({ ...target, baseUrl })).toEqual({ ok: true, httpStatus: 200, models: [{ id: 'qwen3:8b' }] })
    }
    expect(paths()).toEqual(['/v1/models', '/v1/models', '/v1/models'])
  })
})

describe('Ollama context windows', () => {
  test.each(['anthropic', 'openai_chat'] as const)('recognizes Ollama from the list in %s mode and reads the architecture key', async (apiFormat) => {
    respondWith(({ init }) => {
      if (init?.method !== 'POST') return Response.json({ data: [
        { id: 'qwen3:8b', owned_by: 'library' },
        { id: 'user/custom:latest', owned_by: 'user' },
      ] })
      const { model } = JSON.parse(String(init.body)) as { model: string }
      return Response.json({ model_info: model === 'qwen3:8b'
        ? { 'general.architecture': 'qwen3', 'other.context_length': 999999, 'qwen3.context_length': 131072 }
        : { 'llama.context_length': 32768 } })
    })
    expect(await fetchUpstreamModels({ ...target, apiFormat, baseUrl: 'https://provider.invalid/ollama/v1/' })).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'qwen3:8b', contextWindow: 131072 },
      { id: 'user/custom:latest', contextWindow: 32768 },
    ] })
    expect(paths()).toEqual(['/ollama/v1/models', '/ollama/api/show', '/ollama/api/show'])
    expect(calls.slice(1).map(({ init }) => init?.body)).toEqual([
      JSON.stringify({ model: 'qwen3:8b' }), JSON.stringify({ model: 'user/custom:latest' }),
    ])
  })

  test('uses the Ollama preset when the list has only user models', async () => {
    respondWith(({ init }) => init?.method === 'POST'
      ? Response.json({ model_info: { 'general.architecture': 'llama', 'llama.context_length': 65536 } })
      : Response.json({ data: [{ id: 'user/custom:latest', owned_by: 'user' }] }))
    expect(await new ProviderService().discoverModels({ ...target, presetId: 'ollama', baseUrl: 'http://localhost:11434' })).toEqual([
      { id: 'user/custom:latest', contextWindow: 65536 },
    ])
    expect(paths()).toEqual(['/v1/models', '/api/show'])
  })

  test('keeps the other models when one lookup fails and logs the failure with its model', async () => {
    const ids = ['http', 'network', 'json', 'small', 'valid']
    respondWith(({ init }) => {
      if (init?.method !== 'POST') return Response.json({ data: ids.map((id) => ({ id, owned_by: 'library' })) })
      const { model } = JSON.parse(String(init.body)) as { model: string }
      if (model === 'http') return new Response('failed', { status: 503 })
      if (model === 'network') throw new TypeError('offline')
      if (model === 'json') return new Response('{')
      return Response.json({ model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': model === 'small' ? 4096 : 32768 } })
    })
    expect(await fetchUpstreamModels(target)).toEqual({ ok: true, httpStatus: 200, models: ids.map((id) => ({
      id, ...(id === 'valid' ? { contextWindow: 32768 } : {}),
    })) })
    expect(warning).toHaveBeenCalledTimes(3)
    expect(warning).toHaveBeenCalledWith('[providers] Context window lookup failed', {
      source: 'ollama', model: 'http', error: 'Error: HTTP 503 from /api/show',
    })
    expect(warning).toHaveBeenCalledWith('[providers] Context window lookup failed', {
      source: 'ollama', model: 'network', error: 'TypeError: offline',
    })
  })

  test('limits concurrent lookups to four', async () => {
    let active = 0
    let peak = 0
    const ids = Array.from({ length: 11 }, (_, index) => `model-${index}`)
    respondWith(async ({ init }) => {
      if (init?.method !== 'POST') return Response.json({ data: ids.map((id) => ({ id, owned_by: 'library' })) })
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return Response.json({ model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 32768 } })
    })
    expect(await fetchUpstreamModels(target)).toEqual({ ok: true, httpStatus: 200, models: ids.map((id) => ({ id, contextWindow: 32768 })) })
    expect(peak).toBe(4)
    expect(calls).toHaveLength(12)
  })
})

describe('LM Studio context windows', () => {
  test('passes the preset through the API and reads max_context_length by model key', async () => {
    respondWith(({ url }) => new URL(url).pathname === '/proxy/api/v1/models'
      ? Response.json({ models: [
        { key: 'qwen/model', max_context_length: 131072 },
        { key: 'too-small', max_context_length: 8000 },
        { key: 'missing', max_context_length: null },
      ] })
      : Response.json({ data: ['qwen/model', 'too-small', 'missing', 'unlisted'].map((id) => ({ id })) }))
    const url = new URL('http://server.invalid/api/providers/models')
    const response = await handleProvidersApi(new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...target, apiFormat: 'anthropic', presetId: 'lmstudio', baseUrl: 'https://provider.invalid/proxy/v1/' }),
    }), url, ['api', 'providers', 'models'])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ models: [
      { id: 'qwen/model', contextWindow: 131072 },
      { id: 'too-small' },
      { id: 'missing' },
      { id: 'unlisted' },
    ] })
    expect(paths()).toEqual(['/proxy/v1/models', '/proxy/api/v1/models'])
  })

  test.each(['http', 'json', 'network'])('keeps the listed models after a %s failure and logs it', async (failure) => {
    respondWith(({ url }) => {
      if (!url.endsWith('/api/v1/models')) return Response.json({ data: [{ id: 'model', context_length: 32768 }] })
      if (failure === 'http') return new Response('not available', { status: 404 })
      if (failure === 'json') return new Response('{')
      throw new TypeError('offline')
    })
    expect(await new ProviderService().discoverModels({ ...target, presetId: 'lmstudio' })).toEqual([{ id: 'model', contextWindow: 32768 }])
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith('[providers] Context window lookup failed', expect.objectContaining({ source: 'lmstudio' }))
  })
})

describe('DeepSeek context windows', () => {
  test('reads context_window from the root models endpoint with the key', async () => {
    respondWith(({ url }) => new URL(url).pathname === '/models'
      ? Response.json({ data: [
        { id: 'deepseek-v4-pro', context_window: 1000000, max_output_tokens: 384000 },
        { id: 'deepseek-v4-flash', context_window: 1000000 },
      ] })
      : Response.json({ data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }] }))
    expect(await fetchUpstreamModels({ ...target, apiFormat: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic' })).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'deepseek-v4-pro', contextWindow: 1000000 },
      { id: 'deepseek-v4-flash', contextWindow: 1000000 },
    ] })
    expect(calls.map(({ url }) => url)).toEqual([
      'https://api.deepseek.com/anthropic/v1/models?limit=1000',
      'https://api.deepseek.com/models',
    ])
    expect(calls[1]!.init?.headers).toEqual({ Authorization: 'Bearer test-key' })
  })
})

describe('Qwen context windows', () => {
  test('reads max_input_tokens from the native models endpoint across pages', async () => {
    respondWith(({ url }) => {
      const parsed = new URL(url)
      if (parsed.pathname !== '/api/v1/models') return Response.json({ data: [{ id: 'qwen-max' }, { id: 'qwen-plus' }, { id: 'qwen-coder' }] })
      return Response.json({ output: parsed.searchParams.get('page_no') === '1'
        ? { total: 3, models: [
          { model: 'qwen-max', model_info: { context_window: 131072, max_input_tokens: 130048 } },
          { model: 'qwen-plus', model_info: { context_window: 1000000 } },
        ] }
        : { total: 3, models: [{ model: 'qwen-coder', model_info: { max_input_tokens: 262144 } }] } })
    })
    expect(await fetchUpstreamModels({ ...target, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'qwen-max', contextWindow: 130048 },
      { id: 'qwen-plus', contextWindow: 1000000 },
      { id: 'qwen-coder', contextWindow: 262144 },
    ] })
    expect(calls.slice(1).map(({ url }) => url)).toEqual([
      'https://dashscope.aliyuncs.com/api/v1/models?page_no=1&page_size=100',
      'https://dashscope.aliyuncs.com/api/v1/models?page_no=2&page_size=100',
    ])
  })

  test('stops paging when a page is empty', async () => {
    respondWith(({ url }) => new URL(url).pathname === '/api/v1/models'
      ? Response.json({ output: { total: 50, models: [] } })
      : Response.json({ data: [{ id: 'qwen-max' }] }))
    expect(await fetchUpstreamModels({ ...target, baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' })).toEqual({
      ok: true, httpStatus: 200, models: [{ id: 'qwen-max' }],
    })
    expect(calls).toHaveLength(2)
  })
})
