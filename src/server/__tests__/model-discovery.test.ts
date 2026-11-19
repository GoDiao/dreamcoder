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

describe('listed model metadata', () => {
  test('reads OpenRouter context lengths through the provider service, then reads reasoning from the public list', async () => {
    respondWith(() => Response.json({ data: [
      { id: 'vendor/model', name: 'Model', context_length: 131072 },
      { id: 'vendor/other', context_length: 1000000 },
    ] }))
    expect(await new ProviderService().discoverModels({ ...target, baseUrl: 'https://openrouter.ai/api/v1' })).toEqual([
      { id: 'vendor/model', name: 'Model', contextWindow: 131072 },
      { id: 'vendor/other', contextWindow: 1000000 },
    ])
    expect(calls.map(({ url }) => url)).toEqual(['https://openrouter.ai/api/v1/models', 'https://openrouter.ai/api/v1/models'])
  })

  test('prefers max_input_tokens, then context_length, then context_window, and reads output limits separately', async () => {
    respondWith(() => Response.json({ data: [
      { id: 'input', max_input_tokens: 200000, context_length: 300000, context_window: 400000, max_tokens: 64000 },
      { id: 'length', context_length: 300000, context_window: 400000 },
      { id: 'window', context_window: 400000 },
      { id: 'output-only', max_tokens: 64000 },
    ] }))
    expect(await fetchUpstreamModels(target)).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'input', contextWindow: 200000, maxOutputTokens: 64000 },
      { id: 'length', contextWindow: 300000 },
      { id: 'window', contextWindow: 400000 },
      { id: 'output-only', maxOutputTokens: 64000 },
    ] })
    expect(calls).toHaveLength(1)
  })

  test('reads Anthropic-format output limits and image and PDF capabilities', async () => {
    respondWith(() => Response.json({ data: [
      { id: 'vision', max_input_tokens: 1000000, max_tokens: 128000, capabilities: { image_input: { supported: true }, pdf_input: { supported: true } } },
      { id: 'text', max_input_tokens: 200000, max_tokens: 64000, capabilities: { image_input: { supported: false }, pdf_input: { supported: false } } },
    ] }))
    expect(await fetchUpstreamModels({ ...target, apiFormat: 'anthropic' })).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'vision', contextWindow: 1000000, maxOutputTokens: 128000, image: true, pdf: true },
      { id: 'text', contextWindow: 200000, maxOutputTokens: 64000, image: false, pdf: false },
    ] })
  })

  test('reads OpenRouter output limits and input modalities', async () => {
    respondWith(() => Response.json({ data: [
      { id: 'vendor/vision', context_length: 1000000, top_provider: { max_completion_tokens: 65536 }, architecture: { input_modalities: ['text', 'image', 'file'] } },
      { id: 'vendor/text', context_length: 131072, top_provider: { max_completion_tokens: null }, architecture: { input_modalities: ['text'] } },
    ] }))
    expect(await fetchUpstreamModels({ ...target, baseUrl: 'https://openrouter.ai/api/v1' })).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'vendor/vision', contextWindow: 1000000, maxOutputTokens: 65536, image: true, pdf: true },
      { id: 'vendor/text', contextWindow: 131072, image: false },
    ] })
  })

  test('reads OpenRouter reasoning support into thinking control and levels', async () => {
    respondWith(() => Response.json({ data: [
      { id: 'nvidia/nemotron', supported_parameters: ['reasoning'], reasoning: { mandatory: false, supported_efforts: ['high', 'medium', 'none'] } },
      { id: 'z-ai/glm-flash', supported_parameters: ['reasoning'], reasoning: { mandatory: true, supported_efforts: ['max', 'xhigh', 'high', 'low'] } },
      { id: 'vendor/budget-only', supported_parameters: ['reasoning'], reasoning: { mandatory: false } },
      { id: 'vendor/minimal-only', supported_parameters: ['reasoning'], reasoning: { mandatory: true, supported_efforts: ['minimal'] } },
      { id: 'vendor/param-only', supported_parameters: ['include_reasoning', 'reasoning'] },
      { id: 'vendor/plain', supported_parameters: ['temperature'] },
    ] }))
    const models = await fetchUpstreamModels({ ...target, baseUrl: 'https://openrouter.ai/api/v1' })
    const dialect = { reasoningDialect: 'anthropic_adaptive' }
    expect(models).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'nvidia/nemotron', reasoning: { control: 'toggle_effort', levels: ['medium', 'high'] }, ...dialect },
      { id: 'z-ai/glm-flash', reasoning: { control: 'effort', levels: ['low', 'high', 'max'] }, ...dialect },
      { id: 'vendor/budget-only', reasoning: { control: 'toggle_effort', levels: ['low', 'medium', 'high', 'max'] }, ...dialect },
      { id: 'vendor/minimal-only', reasoning: { control: 'always', levels: [] }, ...dialect },
      { id: 'vendor/param-only', reasoning: { control: 'toggle_effort', levels: ['low', 'medium', 'high', 'max'] }, ...dialect },
      { id: 'vendor/plain' },
    ] })
    expect(calls).toHaveLength(2)
  })

  test('reads OpenRouter reasoning for the ids its Anthropic endpoint lists', async () => {
    const chatList = { data: [
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', context_length: 1000000, supported_parameters: ['include_reasoning', 'reasoning', 'reasoning_effort'], reasoning: { mandatory: false, default_enabled: true, supports_max_tokens: true, supported_efforts: ['high', 'medium', 'none'], default_effort: 'high' } },
      { id: '~z-ai/glm-flash-latest', context_length: 1048576, supported_parameters: ['include_reasoning', 'reasoning', 'reasoning_effort'], reasoning: { mandatory: true, default_enabled: true, supported_efforts: ['max', 'high', 'low'], default_effort: 'max' } },
      { id: 'anthropic/claude-opus-4.7', context_length: 1000000, supported_parameters: ['include_reasoning', 'reasoning'], reasoning: { mandatory: false, default_enabled: false, supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low', 'none'] } },
    ] }
    const anthropicList = { data: [
      { id: 'anthropic/nvidia/nemotron-3-ultra-550b-a55b:free[1m]', type: 'model', display_name: 'NVIDIA: Nemotron 3 Ultra (free)', max_input_tokens: 1000000, max_tokens: 65536, capabilities: null },
      { id: 'anthropic/~z-ai/glm-flash-latest[1m]', type: 'model', display_name: 'Z.ai: GLM Flash Latest', max_input_tokens: 1048576, max_tokens: 1048576, capabilities: null },
      { id: 'anthropic/claude-opus-4.7[1m]', type: 'model', display_name: 'Anthropic: Claude Opus 4.7', max_input_tokens: 1000000, max_tokens: 128000, capabilities: null },
    ], has_more: false }
    respondWith(({ init }) => Response.json(new Headers(init?.headers).has('anthropic-version') ? anthropicList : chatList))
    const toggle = { control: 'toggle_effort', levels: ['medium', 'high'] }
    const mandatory = { control: 'effort', levels: ['low', 'high', 'max'] }
    const claude = { control: 'toggle_effort', levels: ['low', 'medium', 'high', 'max'] }
    const dialect = { reasoningDialect: 'anthropic_adaptive' }

    expect(await fetchUpstreamModels({ ...target, baseUrl: 'https://openrouter.ai/api', apiFormat: 'anthropic' })).toMatchObject({ ok: true, models: [
      { id: 'anthropic/nvidia/nemotron-3-ultra-550b-a55b:free[1m]', reasoning: toggle, ...dialect },
      { id: 'anthropic/~z-ai/glm-flash-latest[1m]', reasoning: mandatory, ...dialect },
      { id: 'anthropic/claude-opus-4.7[1m]', reasoning: claude, ...dialect },
    ] })
    expect(await fetchUpstreamModels({ ...target, baseUrl: 'https://openrouter.ai/api/v1' })).toMatchObject({ ok: true, models: [
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', reasoning: toggle, ...dialect },
      { id: '~z-ai/glm-flash-latest', reasoning: mandatory, ...dialect },
      { id: 'anthropic/claude-opus-4.7', reasoning: claude, ...dialect },
    ] })
    expect(calls).toHaveLength(4)
  })

  test('reads reasoning support only from OpenRouter', async () => {
    respondWith(() => Response.json({ data: [
      { id: 'vendor/model', supported_parameters: ['reasoning'], reasoning: { mandatory: false, supported_efforts: ['high', 'none'] } },
    ] }))
    expect(await fetchUpstreamModels(target)).toEqual({ ok: true, httpStatus: 200, models: [{ id: 'vendor/model' }] })
  })

  test('reads Moonshot image support', async () => {
    respondWith(() => Response.json({ data: [
      { id: 'kimi-k2.6', context_length: 262144, supports_image_in: true },
      { id: 'kimi-k2-turbo', context_length: 262144, supports_image_in: false },
    ] }))
    expect(await fetchUpstreamModels({ ...target, baseUrl: 'https://api.moonshot.ai/v1' })).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'kimi-k2.6', contextWindow: 262144, image: true },
      { id: 'kimi-k2-turbo', contextWindow: 262144, image: false },
    ] })
  })

  test('ignores output limits and modalities that do not have the expected type', async () => {
    respondWith(() => Response.json({ data: [
      { id: 'zero', max_tokens: 0 },
      { id: 'text', max_tokens: '64000', supports_image_in: 'yes' },
      { id: 'fraction', max_tokens: 64000.5, capabilities: { image_input: { supported: 'true' } } },
      { id: 'shape', architecture: { input_modalities: 'image' } },
    ] }))
    expect(await fetchUpstreamModels(target)).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'zero' }, { id: 'text' }, { id: 'fraction' }, { id: 'shape' },
    ] })
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

describe('Ollama model metadata', () => {
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

  test('reads vision from the capabilities list', async () => {
    respondWith(({ init }) => {
      if (init?.method !== 'POST') return Response.json({ data: [{ id: 'vision', owned_by: 'library' }, { id: 'text', owned_by: 'library' }] })
      const { model } = JSON.parse(String(init.body)) as { model: string }
      return Response.json({
        model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 32768 },
        capabilities: model === 'vision' ? ['completion', 'vision', 'tools'] : ['completion', 'tools'],
      })
    })
    expect(await fetchUpstreamModels(target)).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'vision', contextWindow: 32768, image: true },
      { id: 'text', contextWindow: 32768, image: false },
    ] })
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
    expect(warning).toHaveBeenCalledWith('[providers] Model metadata lookup failed', {
      source: 'ollama', model: 'http', error: 'Error: HTTP 503 from /api/show',
    })
    expect(warning).toHaveBeenCalledWith('[providers] Model metadata lookup failed', {
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

describe('LM Studio model metadata', () => {
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

  test('reads vision from the capabilities object', async () => {
    respondWith(({ url }) => new URL(url).pathname === '/api/v1/models'
      ? Response.json({ models: [
        { key: 'vision', max_context_length: 131072, capabilities: { vision: true, trained_for_tool_use: true } },
        { key: 'text', max_context_length: 131072, capabilities: { vision: false } },
      ] })
      : Response.json({ data: [{ id: 'vision' }, { id: 'text' }] }))
    expect(await new ProviderService().discoverModels({ ...target, presetId: 'lmstudio', baseUrl: 'http://localhost:1234/v1' })).toEqual([
      { id: 'vision', contextWindow: 131072, image: true },
      { id: 'text', contextWindow: 131072, image: false },
    ])
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
    expect(warning).toHaveBeenCalledWith('[providers] Model metadata lookup failed', expect.objectContaining({ source: 'lmstudio' }))
  })
})

describe('DeepSeek model metadata', () => {
  test('reads the window, output limit and input modalities from the root models endpoint with the key', async () => {
    respondWith(({ url }) => new URL(url).pathname === '/models'
      ? Response.json({ data: [
        { id: 'deepseek-v4-pro', context_window: 1000000, max_output_tokens: 384000, input_modalities: ['text'] },
        { id: 'deepseek-v4-flash', context_window: 1000000, input_modalities: ['text', 'image'] },
      ] })
      : Response.json({ data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }] }))
    expect(await fetchUpstreamModels({ ...target, apiFormat: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic' })).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'deepseek-v4-pro', contextWindow: 1000000, maxOutputTokens: 384000, image: false },
      { id: 'deepseek-v4-flash', contextWindow: 1000000, image: true },
    ] })
    expect(calls.map(({ url }) => url)).toEqual([
      'https://api.deepseek.com/anthropic/v1/models?limit=1000',
      'https://api.deepseek.com/models',
    ])
    expect(calls[1]!.init?.headers).toEqual({ Authorization: 'Bearer test-key' })
  })
})

describe('Qwen model metadata', () => {
  test('reads context_window, max_output_tokens and request_modality from the native models endpoint across pages', async () => {
    respondWith(({ url }) => {
      const parsed = new URL(url)
      if (parsed.pathname !== '/api/v1/models') return Response.json({ data: [{ id: 'qwen-max' }, { id: 'qwen-plus' }, { id: 'qwen-coder' }] })
      return Response.json({ output: parsed.searchParams.get('page_no') === '1'
        ? { total: 3, models: [
          { model: 'qwen-max', model_info: { context_window: 131072, max_input_tokens: 130048, max_output_tokens: 8192 }, inference_metadata: { request_modality: ['Text'] } },
          { model: 'qwen-plus', model_info: { context_window: 1000000 }, inference_metadata: { request_modality: ['Text', 'Image', 'Video'] } },
        ] }
        : { total: 3, models: [{ model: 'qwen-coder', model_info: { max_input_tokens: 262144 } }] } })
    })
    expect(await fetchUpstreamModels({ ...target, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })).toEqual({ ok: true, httpStatus: 200, models: [
      { id: 'qwen-max', contextWindow: 131072, maxOutputTokens: 8192, image: false },
      { id: 'qwen-plus', contextWindow: 1000000, image: true },
      { id: 'qwen-coder' },
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
