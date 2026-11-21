import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { handleProvidersApi } from '../api/providers.js'
import { ProviderService } from '../services/providerService.js'
import type { CreateProviderInput, SavedProvider } from '../types/provider.js'
import { MODEL_RULES_ENV_KEY, type CliModelRulesEnv } from '../../utils/model/modelRules.js'
import { useTestModelsDevCatalog } from './fixtures/modelsDevCatalog.js'

useTestModelsDevCatalog()

let tmpDir: string
let originalConfigDir: string | undefined
let originalFetch: typeof globalThis.fetch

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'model-rules-providers-'))
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  originalFetch = globalThis.fetch
  globalThis.fetch = mock(async () => Response.json({ data: [] })) as unknown as typeof fetch
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function input(overrides?: Partial<CreateProviderInput>): CreateProviderInput {
  return {
    presetId: 'custom',
    name: 'Rules Provider',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test',
    apiFormat: 'openai_chat',
    runtimeKind: 'anthropic_compatible',
    models: [{ id: 'model-main' }, { id: 'model-fast' }],
    fastModel: 'model-fast',
    ...overrides,
  }
}

function request(method: string, pathname: string, body?: unknown) {
  const url = new URL(pathname, 'http://localhost:3456')
  const req = new Request(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  return { req, url, segments: url.pathname.split('/').filter(Boolean) }
}

async function call(method: string, pathname: string, body?: unknown): Promise<Response> {
  const { req, url, segments } = request(method, pathname, body)
  return handleProvidersApi(req, url, segments)
}

async function writeUserSettings(settings: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(tmpDir, 'settings.json'), JSON.stringify(settings), 'utf-8')
}

async function writeProviders(providers: SavedProvider[], activeId: string | null = null): Promise<void> {
  await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
  await fs.writeFile(
    path.join(tmpDir, 'dreamcoder', 'providers.json'),
    JSON.stringify({ schemaVersion: 2, activeId, providers }),
    'utf-8',
  )
}

function rulesEnv(env: Record<string, string>): CliModelRulesEnv {
  return JSON.parse(env[MODEL_RULES_ENV_KEY]!) as CliModelRulesEnv
}

function anthropicStream(model: string): Response {
  const events = [
    { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [] } },
    { type: 'message_stop' },
  ]
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

function captureAnthropicBodies(): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = []
  globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    bodies.push(body)
    return anthropicStream(String(body.model))
  }) as unknown as typeof fetch
  return bodies
}

describe('model overrides storage', () => {
  test('addProvider keeps modelOverrides and updateProvider replaces and clears them', async () => {
    const svc = new ProviderService()
    const added = await svc.addProvider(input({ modelOverrides: { 'model-main': { contextWindow: 300000 } } }))
    expect(added.modelOverrides).toEqual({ 'model-main': { contextWindow: 300000 } })

    const updated = await svc.updateProvider(added.id, { modelOverrides: { 'model-fast': { image: false } } })
    expect(updated.modelOverrides).toEqual({ 'model-fast': { image: false } })

    const cleared = await svc.updateProvider(added.id, { modelOverrides: {} })
    expect(cleared.modelOverrides).toEqual({})
  })

  test('updateProvider keeps discovered models unless baseUrl or apiFormat changes', async () => {
    await writeProviders([{
      ...input(),
      id: 'p1',
      discoveredModels: { 'model-main': { contextWindow: 500000 } },
      discoveredAt: '2026-11-18T00:00:00.000Z',
    } as SavedProvider])
    const svc = new ProviderService()

    const renamed = await svc.updateProvider('p1', { name: 'Renamed' })
    expect(renamed.discoveredModels).toEqual({ 'model-main': { contextWindow: 500000 } })
    expect(renamed.discoveredAt).toBe('2026-11-18T00:00:00.000Z')

    const sameUrl = await svc.updateProvider('p1', { baseUrl: 'https://api.example.com' })
    expect(sameUrl.discoveredModels).toBeDefined()

    const moved = await svc.updateProvider('p1', { baseUrl: 'https://other.example.com' })
    expect(moved.discoveredModels).toBeUndefined()
    expect(moved.discoveredAt).toBeUndefined()

    await writeProviders([{
      ...input(),
      id: 'p2',
      discoveredModels: { 'model-main': { contextWindow: 500000 } },
      discoveredAt: '2026-11-18T00:00:00.000Z',
    } as SavedProvider])
    const reformatted = await svc.updateProvider('p2', { apiFormat: 'openai_responses' })
    expect(reformatted.discoveredModels).toBeUndefined()
    expect(reformatted.discoveredAt).toBeUndefined()
  })

  test('the create API ignores discoveredModels sent by a client', async () => {
    const res = await call('POST', '/api/providers', {
      ...input(),
      discoveredModels: { 'model-main': { contextWindow: 500000 } },
    })
    expect(res.status).toBe(201)
    const { provider } = await res.json() as { provider: SavedProvider }
    expect(provider.discoveredModels).toBeUndefined()
  })
})

describe('model overrides validation', () => {
  test('rejects reserved extraBody keys', async () => {
    const res = await call('POST', '/api/providers', input({
      modelOverrides: { 'model-main': { extraBody: { messages: [] } } },
    }))
    expect(res.status).toBe(400)
  })

  test('rejects extraBody overrides on anthropic-format providers', async () => {
    const res = await call('POST', '/api/providers', input({
      apiFormat: 'anthropic',
      modelOverrides: { 'model-main': { extraBody: { temperature: 0.2 } } },
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'MODEL_OVERRIDE_EXTRA_BODY_ANTHROPIC' })
  })

  test('rejects an update that switches a provider with extraBody overrides to anthropic', async () => {
    const svc = new ProviderService()
    const added = await svc.addProvider(input({
      modelOverrides: { 'model-main': { extraBody: { temperature: 0.2 } } },
    }))
    const res = await call('PUT', `/api/providers/${added.id}`, { apiFormat: 'anthropic' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'MODEL_OVERRIDE_EXTRA_BODY_ANTHROPIC' })
  })

  test('rejects two override keys that normalize to the same model id', async () => {
    const res = await call('POST', '/api/providers', input({
      modelOverrides: {
        'gpt-5.4': { contextWindow: 300000 },
        'GPT-5-4[1m]': { contextWindow: 400000 },
      },
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'MODEL_OVERRIDE_DUPLICATE' })
  })

  test('rejects a reasoningDialect that does not fit the apiFormat', async () => {
    const res = await call('POST', '/api/providers', input({
      modelOverrides: { 'model-main': { reasoningDialect: 'anthropic_adaptive' } },
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'MODEL_OVERRIDE_DIALECT_MISMATCH' })
  })

  test('accepts a reasoningDialect that fits the apiFormat', async () => {
    const res = await call('POST', '/api/providers', input({
      modelOverrides: { 'model-main': { reasoningDialect: 'thinking_type', extraBody: { top_k: 20 } } },
    }))
    expect(res.status).toBe(201)
  })
})

describe('DREAMCODER_MODEL_RULES', () => {
  test('getProviderRuntimeEnv writes rules for every model the CLI may call', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(input({
      presetId: 'deepseek',
      apiFormat: 'anthropic',
      baseUrl: 'https://api.deepseek.com/anthropic',
      models: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }, { id: 'glm-5.1' }],
      fastModel: 'deepseek-v4-flash',
    }))

    const env = await svc.getProviderRuntimeEnv(provider.id, 'Session-Model[1m]')
    const rules = rulesEnv(env)

    expect(Object.keys(rules.models).sort()).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro', 'glm-5-1', 'session-model'])
    expect(rules.models['deepseek-v4-pro']).toMatchObject({
      contextWindow: 1048576,
      thinkingWhenOn: 'adaptive',
      thinkingWhenOff: 'disabled',
      effortLevels: ['low', 'high', 'max'],
    })
    expect(rules.models['session-model']).toEqual(rules.fallback)
    expect(rules.defaultEffort).toBe('medium')
  })

  test('defaultEffort comes from the user effort setting', async () => {
    await writeUserSettings({ effort: 'high' })
    const svc = new ProviderService()
    const provider = await svc.addProvider(input())

    expect(rulesEnv(await svc.getProviderRuntimeEnv(provider.id)).defaultEffort).toBe('high')

    await writeUserSettings({ effort: 'bogus' })
    expect(rulesEnv(await svc.getProviderRuntimeEnv(provider.id)).defaultEffort).toBe('medium')
  })

  test('official Anthropic providers get no rules variable', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(input({
      apiFormat: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: [{ id: 'claude-opus-4-7' }],
      fastModel: undefined,
    }))

    const env = await svc.getProviderRuntimeEnv(provider.id)
    expect(env[MODEL_RULES_ENV_KEY]).toBeUndefined()
  })

  test('activation does not write the rules variable into settings.json', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(input())
    await svc.activateProvider(provider.id)

    const settings = JSON.parse(await fs.readFile(path.join(tmpDir, 'dreamcoder', 'settings.json'), 'utf-8')) as {
      env: Record<string, string>
    }
    expect(settings.env[MODEL_RULES_ENV_KEY]).toBeUndefined()
    expect(settings.env.ANTHROPIC_MODEL).toBe('model-main')
  })

  test('runtime env no longer carries the retired capability, window and thinking variables', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(input({
      presetId: 'kimi',
      apiFormat: 'anthropic',
      baseUrl: 'https://api.kimi.com/coding',
      models: [{ id: 'kimi-k2.6' }],
      fastModel: undefined,
    }))
    const env = await svc.getProviderRuntimeEnv(provider.id)

    expect(env.DREAMCODER_SEND_DISABLED_THINKING).toBeUndefined()
    expect(env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS).toBeUndefined()
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toBeUndefined()
    expect(rulesEnv(env).models['kimi-k2-6']?.thinkingWhenOff).toBe('disabled')
  })
})

describe('GET /api/providers resolvedModels', () => {
  test('lists the resolved view per model, and none for official providers', async () => {
    const svc = new ProviderService()
    const deepseek = await svc.addProvider(input({
      apiFormat: 'anthropic',
      baseUrl: 'https://api.deepseek.com/anthropic',
      models: [{ id: 'deepseek-v4-pro' }, { id: 'mystery-model' }],
      fastModel: undefined,
    }))
    const official = await svc.addProvider(input({
      apiFormat: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: [{ id: 'claude-opus-4-7' }],
      fastModel: undefined,
    }))

    const res = await call('GET', '/api/providers')
    const body = await res.json() as {
      providers: Array<SavedProvider & { resolvedModels?: Record<string, Record<string, unknown>> }>
    }
    const deepseekView = body.providers.find((provider) => provider.id === deepseek.id)!.resolvedModels!
    const officialEntry = body.providers.find((provider) => provider.id === official.id)!

    expect(deepseekView['deepseek-v4-pro']).toMatchObject({
      effortLevels: ['low', 'high', 'max'],
      appliedEffort: { low: 'low', medium: 'high', high: 'high', max: 'max' },
      usedFallback: false,
    })
    expect(deepseekView['mystery-model']).toMatchObject({ usedFallback: true, effortLevels: [] })
    expect('resolvedModels' in officialEntry).toBe(false)
  })
})

describe('connection test thinking fields', () => {
  test('testProviderConfig disables thinking for a toggle model and sends no thinking for a none model', async () => {
    const bodies = captureAnthropicBodies()
    const svc = new ProviderService()
    const form = { baseUrl: 'https://llm.example.com/anthropic', apiKey: 'sk', apiFormat: 'anthropic' as const, authStrategy: 'api_key' as const }

    await svc.testProviderConfig({ ...form, modelId: 'glm-4.5-air' })
    await svc.testProviderConfig({ ...form, modelId: 'mystery-model' })

    expect(bodies[0]!.thinking).toEqual({ type: 'disabled' })
    expect(bodies[1]!.thinking).toBeUndefined()
    expect(bodies[1]!.output_config).toBeUndefined()
  })

  test('testProviderConfig sends the weakest level and no disabled thinking for an always model', async () => {
    const bodies = captureAnthropicBodies()
    const svc = new ProviderService()

    await svc.testProviderConfig({
      baseUrl: 'https://api.minimax.io/anthropic',
      apiKey: 'sk',
      apiFormat: 'anthropic',
      authStrategy: 'api_key',
      modelId: 'MiniMax-M3.1-Flash',
    })

    expect(bodies[0]!.thinking).toBeUndefined()
    expect(bodies[0]!.output_config).toEqual({ effort: 'low' })
  })

  test('testProviderConfig keeps the plain request for official Anthropic', async () => {
    const bodies = captureAnthropicBodies()
    const svc = new ProviderService()

    await svc.testProviderConfig({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk',
      apiFormat: 'anthropic',
      authStrategy: 'api_key',
      modelId: 'claude-haiku-4-5',
    })

    expect(bodies[0]!.thinking).toBeUndefined()
    expect(bodies[0]!.output_config).toBeUndefined()
  })

  test('testProvider resolves rules from the saved provider with the form overrides applied', async () => {
    const bodies = captureAnthropicBodies()
    const svc = new ProviderService()
    const saved = await svc.addProvider(input({
      baseUrl: 'https://api.moonshot.ai/v1',
      apiFormat: 'openai_chat',
      models: [{ id: 'kimi-for-coding' }],
      fastModel: undefined,
    }))

    await svc.testProvider(saved.id, { baseUrl: 'https://api.kimi.com/coding', apiFormat: 'anthropic' })

    expect(bodies[0]!.thinking).toEqual({ type: 'disabled' })
  })

  test('testProvider treats a form switched to the official address as official', async () => {
    const bodies = captureAnthropicBodies()
    const svc = new ProviderService()
    const saved = await svc.addProvider(input({
      apiFormat: 'anthropic',
      baseUrl: 'https://llm.example.com/anthropic',
      models: [{ id: 'claude-haiku-4-5' }],
      fastModel: undefined,
    }))

    await svc.testProvider(saved.id)
    await svc.testProvider(saved.id, { baseUrl: 'https://api.anthropic.com' })

    expect(bodies[0]!.thinking).toEqual({ type: 'disabled' })
    expect(bodies[1]!.thinking).toBeUndefined()
  })
})
