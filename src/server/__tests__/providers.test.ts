import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ProviderService } from '../services/providerService.js'
import { handleProvidersApi } from '../api/providers.js'
import { handleProxyRequest } from '../proxy/handler.js'
import type { CreateProviderInput } from '../types/provider.js'

let tmpDir: string
let originalConfigDir: string | undefined

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-test-'))
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
}

async function teardown() {
  if (originalConfigDir !== undefined) {
    process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.DREAMCODER_CONFIG_DIR
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
}

function makeRequest(
  method: string,
  urlStr: string,
  body?: Record<string, unknown>,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const req = new Request(url.toString(), init)
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

function sampleInput(overrides?: Partial<CreateProviderInput>): CreateProviderInput {
  return {
    presetId: 'custom',
    name: 'Test Provider',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test-key-123',
    apiFormat: 'anthropic',
    models: [
      { id: 'model-main' },
      { id: 'model-sonnet' },
      { id: 'model-opus' },
      { id: 'model-haiku' },
    ],
    fastModel: 'model-haiku',
    ...overrides,
  }
}

function anthropicStreamResponse(model: string): Response {
  const events = [
    { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_stop' },
  ]
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

async function readSettings(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(tmpDir, 'dreamcoder', 'settings.json'), 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

async function readProvidersConfig(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(tmpDir, 'dreamcoder', 'providers.json'), 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

describe('ProviderService', () => {
  beforeEach(setup)
  afterEach(teardown)

  describe('listProviders', () => {
    test('should return empty array when no providers exist', async () => {
      const svc = new ProviderService()
      const result = await svc.listProviders()
      expect(result).toEqual({ providers: [], activeId: null })
    })

    test('should recover from a malformed providers index after an upgrade', async () => {
      await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'dreamcoder', 'providers.json'), '{not json', 'utf-8')

      const svc = new ProviderService()
      const result = await svc.listProviders()
      const files = await fs.readdir(path.join(tmpDir, 'dreamcoder'))

      expect(result).toEqual({ providers: [], activeId: null })
      expect(files.some((name) => name.startsWith('providers.json.invalid-'))).toBe(true)
    })

    test('should normalize a legacy activeProviderId field', async () => {
      await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
      const provider = {
        id: 'legacy-provider',
        ...sampleInput({ name: 'Legacy Provider' }),
      }
      await fs.writeFile(
        path.join(tmpDir, 'dreamcoder', 'providers.json'),
        JSON.stringify({ activeProviderId: provider.id, providers: [provider] }),
        'utf-8',
      )

      const svc = new ProviderService()
      const result = await svc.listProviders()

      expect(result.activeId).toBe(provider.id)
      expect(result.providers).toHaveLength(1)
      expect(result.providers[0].name).toBe('Legacy Provider')
    })

    test('should return all added providers', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({ name: 'Provider A' }))
      await svc.addProvider(sampleInput({ name: 'Provider B' }))

      const { providers, activeId } = await svc.listProviders()
      expect(providers).toHaveLength(2)
      expect(providers[0].name).toBe('Provider A')
      expect(providers[1].name).toBe('Provider B')
      expect(activeId).toBeNull()
    })
  })

  describe('addProvider', () => {
    test('should add a provider and return it with generated fields', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      expect(provider.id).toBeDefined()
      expect(provider.name).toBe('Test Provider')
      expect(provider.baseUrl).toBe('https://api.example.com')
      expect(provider.apiKey).toBe('sk-test-key-123')
      expect(provider.models[0]?.id).toBe('model-main')
    })

    test('should normalize and de-duplicate model IDs when adding a provider', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        models: [{ id: ' gpt-5.5 ' }, { id: 'gpt-5.5' }],
        fastModel: undefined,
      }))

      expect(provider.models).toEqual([{ id: 'gpt-5.5' }])

      const config = await readProvidersConfig()
      expect((config.providers as Array<{ models: unknown }>)[0]?.models).toEqual(provider.models)
    })

    test('should reject a fast model outside the provider model list', async () => {
      const svc = new ProviderService()
      await expect(svc.addProvider(sampleInput({ fastModel: 'missing-model' }))).rejects.toThrow(
        'Fast model must be one of the provider models',
      )
    })

    test('new providers should not be auto-activated', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      expect(provider.id).toBeDefined()
      const { activeId } = await svc.listProviders()
      expect(activeId).toBeNull()
    })

    test('adding a provider should not sync settings until activated', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput())

      await expect(fs.readFile(path.join(tmpDir, 'dreamcoder', 'settings.json'), 'utf-8')).rejects.toThrow()
    })

    test('custom providers declare thinking and effort capability passthrough for user-defined models', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        models: [{ id: 'deepseek-ai/DeepSeek-V4-Pro' }],
        fastModel: undefined,
      }))

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('deepseek-ai/DeepSeek-V4-Pro')
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toBe(
        'thinking,effort,adaptive_thinking,max_effort',
      )
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES).toBe(
        'thinking,effort,adaptive_thinking,max_effort',
      )
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES).toBe(
        'thinking,effort,adaptive_thinking,max_effort',
      )
    })

    test('DeepSeek preset follows the global thinking toggle instead of forcing disabled thinking', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        models: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }],
        fastModel: 'deepseek-v4-flash',
      }))

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.DREAMCODER_SEND_DISABLED_THINKING).toBeUndefined()
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toBe(
        'thinking,effort,adaptive_thinking,max_effort',
      )
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES).toBe(
        'thinking,effort,adaptive_thinking,max_effort',
      )
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES).toBe(
        'thinking,effort,adaptive_thinking,max_effort',
      )
    })

    test('adding additional providers should keep activeId unchanged', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({ name: 'First' }))
      const second = await svc.addProvider(sampleInput({ name: 'Second' }))

      expect(second.id).toBeDefined()
      const { activeId } = await svc.listProviders()
      expect(activeId).toBeNull()
    })

    test('should preserve optional notes field', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({ notes: 'dev environment' }))

      expect(provider.notes).toBe('dev environment')
    })

    test('should preserve optional auto compact window', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({ autoCompactWindow: 64000 }))

      expect(provider.autoCompactWindow).toBe(64000)
    })

    test('should preserve optional model context windows', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        modelContextWindows: {
          'model-main': 300000,
          'model-haiku': 128000,
        },
      }))

      expect(provider.modelContextWindows).toEqual({
        'model-main': 300000,
        'model-haiku': 128000,
      })
    })
  })

  describe('getProvider', () => {
    test('should return the provider by id', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput())

      const fetched = await svc.getProvider(added.id)
      expect(fetched.id).toBe(added.id)
      expect(fetched.name).toBe(added.name)
    })

    test('treats a leftover ChatGPT Official active id as no active provider', async () => {
      await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'dreamcoder', 'providers.json'),
        JSON.stringify({ activeId: 'openai-official', providers: [] }),
        'utf-8',
      )

      const svc = new ProviderService()
      const result = await svc.listProviders()

      expect(result.activeId).toBeNull()
      expect(result.providers).toEqual([])
    })

    test('should throw 404 for non-existent id', async () => {
      const svc = new ProviderService()

      try {
        await svc.getProvider('non-existent-id')
        expect(true).toBe(false)
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(404)
      }
    })
  })

  describe('updateProvider', () => {
    test('should update provider fields', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput())

      const updated = await svc.updateProvider(added.id, {
        name: 'Updated Name',
        baseUrl: 'https://new-api.example.com',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.baseUrl).toBe('https://new-api.example.com')
      expect(updated.apiKey).toBe('sk-test-key-123')
    })

    test('should throw 404 for non-existent provider', async () => {
      const svc = new ProviderService()

      try {
        await svc.updateProvider('non-existent-id', { name: 'X' })
        expect(true).toBe(false)
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(404)
      }
    })

    test('updating active provider should re-sync settings.json', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput())
      await svc.activateProvider(added.id)

      await svc.updateProvider(added.id, {
        baseUrl: 'https://new-api.example.com',
        apiKey: 'sk-new-key',
      })

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_BASE_URL).toBe('https://new-api.example.com')
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-new-key')
      expect(env.ANTHROPIC_API_KEY).toBe('')
      expect(env.ANTHROPIC_MODEL).toBe('model-main')
    })

    test('updating active provider should override and clear auto compact window', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput({ autoCompactWindow: 64000 }))
      await svc.activateProvider(added.id)

      let settings = await readSettings()
      let env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('64000')

      await svc.updateProvider(added.id, { autoCompactWindow: 32000 })

      settings = await readSettings()
      env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('32000')

      await svc.updateProvider(added.id, { autoCompactWindow: null })

      settings = await readSettings()
      env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined()
    })

    test('should use the selected model for all primary runtime roles', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        models: [{ id: 'gpt-5.5' }],
        fastModel: undefined,
      }))

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_MODEL).toBe('gpt-5.5')
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gpt-5.5')
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('gpt-5.5')
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gpt-5.5')
    })

    test('updating active provider should override and clear model context windows', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput({
        modelContextWindows: { 'model-main': 300000 },
      }))
      await svc.activateProvider(added.id)

      let settings = await readSettings()
      let env = settings.env as Record<string, string>
      expect(JSON.parse(env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toEqual({
        'model-main': 300000,
      })

      await svc.updateProvider(added.id, {
        modelContextWindows: { 'model-main': 500000 },
      })

      settings = await readSettings()
      env = settings.env as Record<string, string>
      expect(JSON.parse(env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toEqual({
        'model-main': 500000,
      })

      await svc.updateProvider(added.id, { modelContextWindows: null })

      settings = await readSettings()
      env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS).toBeUndefined()
    })
  })

  describe('deleteProvider', () => {
    test('should delete an inactive provider', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({ name: 'First' }))
      const second = await svc.addProvider(sampleInput({ name: 'Second' }))

      await svc.deleteProvider(second.id)

      const { providers } = await svc.listProviders()
      expect(providers).toHaveLength(1)
      expect(providers[0].name).toBe('First')
    })

    test('should throw 409 when deleting an active provider', async () => {
      const svc = new ProviderService()
      const active = await svc.addProvider(sampleInput())
      await svc.activateProvider(active.id)

      try {
        await svc.deleteProvider(active.id)
        expect(true).toBe(false)
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(409)
      }
    })

    test('should throw 404 when deleting non-existent provider', async () => {
      const svc = new ProviderService()

      try {
        await svc.deleteProvider('non-existent-id')
        expect(true).toBe(false)
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(404)
      }
    })
  })

  describe('activateProvider', () => {
    test('should activate a provider with a valid model', async () => {
      const svc = new ProviderService()
      const first = await svc.addProvider(sampleInput({ name: 'First' }))
      const second = await svc.addProvider(
        sampleInput({
          name: 'Second',
          baseUrl: 'https://second-api.example.com',
          apiKey: 'sk-second-key',
        }),
      )

      await svc.activateProvider(second.id)

      const { activeId, providers } = await svc.listProviders()
      expect(activeId).toBe(second.id)
      expect(providers.find((p) => p.id === first.id)).toBeDefined()
      expect(providers.find((p) => p.id === second.id)).toBeDefined()
    })

    test('should write correct settings.json on activation', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({ name: 'First' }))
      const second = await svc.addProvider(
        sampleInput({
          name: 'Second',
          baseUrl: 'https://second-api.example.com',
          apiKey: 'sk-second-key',
        }),
      )

      await svc.activateProvider(second.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_BASE_URL).toBe('https://second-api.example.com')
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-second-key')
      expect(env.ANTHROPIC_API_KEY).toBe('')
      expect(env.ANTHROPIC_MODEL).toBe('model-main')
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('model-haiku')
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('model-main')
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('model-main')
      expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBe('model-haiku')
      expect(env.CLAUDE_CODE_ATTRIBUTION_HEADER).toBe('0')
      expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined()

      const selectedEnv = await svc.getProviderRuntimeEnv(second.id, 'model-opus')
      expect(selectedEnv.ANTHROPIC_MODEL).toBe('model-opus')
      expect(selectedEnv.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('model-opus')
      expect(selectedEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('model-opus')
      expect(selectedEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('model-haiku')
      expect(selectedEnv.ANTHROPIC_SMALL_FAST_MODEL).toBe('model-haiku')
    })

    test('should preserve attribution header for Claude-prefixed provider models', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        models: [
          { id: 'Claude Sonnet 4.6' },
          { id: 'Claude Haiku 4.5' },
          { id: 'Claude Opus 4.7' },
        ],
        fastModel: 'Claude Haiku 4.5',
      }))

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_ATTRIBUTION_HEADER).toBe('1')

      const runtimeEnv = await svc.getProviderRuntimeEnv(provider.id)
      expect(runtimeEnv.CLAUDE_CODE_ATTRIBUTION_HEADER).toBe('1')
    })

    test('should honor provider auth env strategies on activation and runtime env', async () => {
      const svc = new ProviderService()

      const apiKeyProvider = await svc.addProvider(sampleInput({
        apiKey: 'sk-api-key',
        authStrategy: 'api_key',
      }))
      await svc.activateProvider(apiKeyProvider.id)
      let env = (await readSettings()).env as Record<string, string>
      expect(env.ANTHROPIC_API_KEY).toBe('sk-api-key')
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()

      const bearerProvider = await svc.addProvider(sampleInput({
        apiKey: 'sk-bearer',
        authStrategy: 'auth_token_empty_api_key',
      }))
      await svc.activateProvider(bearerProvider.id)
      env = (await readSettings()).env as Record<string, string>
      expect(env.ANTHROPIC_API_KEY).toBe('')
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-bearer')

      const dualProvider = await svc.addProvider(sampleInput({
        apiKey: 'sk-dual',
        authStrategy: 'dual_same_token',
      }))
      const runtimeEnv = await svc.getProviderRuntimeEnv(dualProvider.id)
      expect(runtimeEnv.ANTHROPIC_API_KEY).toBe('sk-dual')
      expect(runtimeEnv.ANTHROPIC_AUTH_TOKEN).toBe('sk-dual')

      const dummyProvider = await svc.addProvider(sampleInput({
        apiKey: '',
        authStrategy: 'dual_dummy',
      }))
      const dummyRuntimeEnv = await svc.getProviderRuntimeEnv(dummyProvider.id)
      expect(dummyRuntimeEnv.ANTHROPIC_API_KEY).toBe('dummy')
      expect(dummyRuntimeEnv.ANTHROPIC_AUTH_TOKEN).toBe('dummy')
    })

    test('proxy providers keep proxy-managed auth regardless of auth strategy', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        apiFormat: 'openai_chat',
        authStrategy: 'auth_token',
      }))

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_API_KEY).toBe('proxy-managed')
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    })

    test('should include preset default env on activation and runtime env', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'kimi',
        baseUrl: 'https://api.kimi.com/coding',
      }))

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.DREAMCODER_SEND_DISABLED_THINKING).toBe('1')
      expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined()
      expect(JSON.parse(env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toEqual({
        'kimi-k2.6': 262144,
        'kimi-k2.5': 262144,
      })

      const runtimeEnv = await svc.getProviderRuntimeEnv(provider.id)
      expect(runtimeEnv.DREAMCODER_SEND_DISABLED_THINKING).toBe('1')
      expect(runtimeEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined()
      expect(JSON.parse(runtimeEnv.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toEqual({
        'kimi-k2.6': 262144,
        'kimi-k2.5': 262144,
      })
    })

    test('auth status treats preset default auth as active provider auth', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'lmstudio',
        apiKey: '',
        authStrategy: 'auth_token_empty_api_key',
        models: [{ id: 'lmstudio-model' }],
        fastModel: undefined,
      }))
      await svc.activateProvider(provider.id)

      const status = await svc.checkAuthStatus()

      expect(status).toEqual({
        hasAuth: true,
        source: 'dreamcoder-provider',
        activeProvider: provider.name,
      })
    })

    test('auth status treats dummy proxy auth as active provider auth', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        apiKey: '',
        apiFormat: 'openai_chat',
      }))
      await svc.activateProvider(provider.id)

      const status = await svc.checkAuthStatus()

      expect(status).toEqual({
        hasAuth: true,
        source: 'dreamcoder-provider',
        activeProvider: provider.name,
      })
    })

    test('provider auto compact window should override preset default env on activation and runtime env', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        presetId: 'custom',
        autoCompactWindow: 32000,
      }))

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('32000')

      const runtimeEnv = await svc.getProviderRuntimeEnv(provider.id)
      expect(runtimeEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('32000')
    })

    test('should preserve existing settings.json fields on activation', async () => {
      await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'dreamcoder', 'settings.json'),
        JSON.stringify({ theme: 'dark', env: { CUSTOM_VAR: 'keep-me' } }),
      )

      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      expect(settings.theme).toBe('dark')
      const env = settings.env as Record<string, string>
      expect(env.CUSTOM_VAR).toBe('keep-me')
      expect(env.ANTHROPIC_BASE_URL).toBe('https://api.example.com')
    })

    test('should not modify the original settings.json in the config dir', async () => {
      const original = {
        effortLevel: 'high',
        env: { ANTHROPIC_BASE_URL: 'https://original.example.com', ANTHROPIC_API_KEY: 'original-key' },
      }
      await fs.writeFile(path.join(tmpDir, 'settings.json'), JSON.stringify(original))

      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())
      await svc.activateProvider(provider.id)

      const raw = await fs.readFile(path.join(tmpDir, 'settings.json'), 'utf-8')
      expect(JSON.parse(raw)).toEqual(original)
      const env = (await readSettings()).env as Record<string, string>
      expect(env.ANTHROPIC_BASE_URL).toBe('https://api.example.com')
    })

    test('should recover malformed managed settings before activation sync', async () => {
      await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'dreamcoder', 'settings.json'), '{not json', 'utf-8')

      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      await svc.activateProvider(provider.id)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      const files = await fs.readdir(path.join(tmpDir, 'dreamcoder'))

      expect(env.ANTHROPIC_BASE_URL).toBe('https://api.example.com')
      expect(files.some((name) => name.startsWith('settings.json.invalid-'))).toBe(true)
    })

    test('should throw 404 for non-existent provider id', async () => {
      const svc = new ProviderService()

      try {
        await svc.activateProvider('non-existent-id')
        expect(true).toBe(false)
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(404)
      }
    })

    test('activeId should be persisted in providers.json', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      await svc.activateProvider(provider.id)

      const config = await readProvidersConfig()
      expect(config.activeId).toBe(provider.id)
    })
  })

  describe('getProviderForProxy', () => {
    test('should return null when no provider is active', async () => {
      const svc = new ProviderService()
      const active = await svc.getProviderForProxy()
      expect(active).toBeNull()
    })

    test('should return the active provider proxy config', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())
      await svc.activateProvider(provider.id)

      const active = await svc.getProviderForProxy()
      expect(active).not.toBeNull()
      expect(active!.baseUrl).toBe(provider.baseUrl)
      expect(active!.apiKey).toBe(provider.apiKey)
      expect(active!.apiFormat).toBe('anthropic')
    })
  })

  describe('handleProxyRequest', () => {
    test('injects Claude Code billing attribution with compat version and signed CCH', async () => {
      const originalFetch = globalThis.fetch
      const originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
      delete process.env.CLAUDE_CODE_ENTRYPOINT
      const calls: Array<{ body: Record<string, unknown> }> = []
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> })
        return new Response(JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof fetch

      try {
        const svc = new ProviderService()
        const provider = await svc.addProvider(sampleInput({ apiFormat: 'openai_chat' }))
        await svc.activateProvider(provider.id)

        const req = new Request('http://localhost:3456/proxy/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4',
            max_tokens: 64,
            messages: [{ role: 'user', content: 'hello from proxy' }],
          }),
        })

        const res = await handleProxyRequest(req, new URL(req.url))
        expect(res.status).toBe(200)

        const system = calls[0].body.messages as Array<Record<string, string>>
        expect(system[0].role).toBe('system')
        expect(system[0].content).toMatch(
          /^x-anthropic-billing-header: cc_version=2\.1\.92\.693; cc_entrypoint=unknown; cch=[0-9a-f]{5};$/,
        )
      } finally {
        globalThis.fetch = originalFetch
        if (originalEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
        else process.env.CLAUDE_CODE_ENTRYPOINT = originalEntrypoint
      }
    })
  })

  describe('discoverModels', () => {
    test('fetches, names, and de-duplicates OpenAI-compatible models', async () => {
      let requestPath = ''
      let authorization = ''
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(req) {
          requestPath = new URL(req.url).pathname
          authorization = req.headers.get('authorization') ?? ''
          return Response.json({
            data: [
              { id: 'gpt-main', name: 'GPT Main' },
              { id: 'gpt-main', name: 'Duplicate' },
              { id: 'gpt-fast', display_name: 'GPT Fast' },
            ],
          })
        },
      })

      try {
        const models = await new ProviderService().discoverModels({
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          apiKey: 'secret',
          apiFormat: 'openai_chat',
          authStrategy: 'api_key',
        })
        expect(requestPath).toBe('/v1/models')
        expect(authorization).toBe('Bearer secret')
        expect(models).toEqual([
          { id: 'gpt-main', name: 'GPT Main' },
          { id: 'gpt-fast', name: 'GPT Fast' },
        ])
      } finally {
        server.stop(true)
      }
    })

    test('uses Anthropic model-list headers without exposing discovery to browser CORS', async () => {
      let apiKey = ''
      let anthropicVersion = ''
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(req) {
          apiKey = req.headers.get('x-api-key') ?? ''
          anthropicVersion = req.headers.get('anthropic-version') ?? ''
          return Response.json({ data: [{ id: 'claude-test', display_name: 'Claude Test' }] })
        },
      })

      try {
        const models = await new ProviderService().discoverModels({
          baseUrl: `http://127.0.0.1:${server.port}`,
          apiKey: 'anthropic-secret',
          apiFormat: 'anthropic',
          authStrategy: 'api_key',
        })
        expect(apiKey).toBe('anthropic-secret')
        expect(anthropicVersion).toBe('2023-06-01')
        expect(models).toEqual([{ id: 'claude-test', name: 'Claude Test' }])
      } finally {
        server.stop(true)
      }
    })

    test('reports an unsupported model endpoint without changing provider data', async () => {
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch() {
          return new Response('not found', { status: 404 })
        },
      })

      try {
        const service = new ProviderService()
        const provider = await service.addProvider(sampleInput({
          baseUrl: `http://127.0.0.1:${server.port}`,
        }))
        await expect(service.discoverProviderModels(provider.id)).rejects.toThrow('HTTP 404')
        expect((await service.getProvider(provider.id)).models).toEqual(provider.models)
      } finally {
        server.stop(true)
      }
    })
  })

  describe('testProvider', () => {
    test('should use preset default auth for saved no-key Anthropic-compatible providers', async () => {
      const originalFetch = globalThis.fetch
      const calls: Array<{ headers: Record<string, string> }> = []
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push({ headers: init?.headers as Record<string, string> })
        return anthropicStreamResponse('lmstudio-model')
      }) as typeof fetch

      try {
        const svc = new ProviderService()
        const provider = await svc.addProvider(sampleInput({
          presetId: 'lmstudio',
          apiKey: '',
          authStrategy: 'auth_token_empty_api_key',
          models: [{ id: 'lmstudio-model' }],
          fastModel: undefined,
        }))

        const result = await svc.testProvider(provider.id)

        expect(result.connectivity.success).toBe(true)
        expect(calls[0].headers.Authorization).toBe('Bearer lmstudio')
        expect(calls[0].headers['x-api-key']).toBeUndefined()
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('testProviderConfig', () => {
    test('should use auth strategy headers for Anthropic-compatible tests', async () => {
      const originalFetch = globalThis.fetch
      const calls: Array<{ url: string; headers: Record<string, string> }> = []
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          headers: init?.headers as Record<string, string>,
        })
        return anthropicStreamResponse('model-main')
      }) as typeof fetch

      try {
        const svc = new ProviderService()
        await svc.testProviderConfig({
          baseUrl: 'https://api.example.com/anthropic',
          apiKey: 'sk-bearer',
          modelId: 'model-main',
          authStrategy: 'auth_token',
          apiFormat: 'anthropic',
        })
        await svc.testProviderConfig({
          baseUrl: 'https://api.example.com/anthropic',
          apiKey: 'sk-api',
          modelId: 'model-main',
          authStrategy: 'api_key',
          apiFormat: 'anthropic',
        })
        await svc.testProviderConfig({
          baseUrl: 'https://api.example.com/anthropic',
          apiKey: 'sk-dual',
          modelId: 'model-main',
          authStrategy: 'dual_same_token',
          apiFormat: 'anthropic',
        })

        expect(calls[0].headers.Authorization).toBe('Bearer sk-bearer')
        expect(calls[0].headers['x-api-key']).toBeUndefined()
        expect(calls[1].headers['x-api-key']).toBe('sk-api')
        expect(calls[1].headers.Authorization).toBeUndefined()
        expect(calls[2].headers['x-api-key']).toBe('sk-dual')
        expect(calls[2].headers.Authorization).toBe('Bearer sk-dual')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('tests OpenAI Chat providers through the same streaming path as chat', async () => {
      const originalFetch = globalThis.fetch
      const calls: Array<{ url: string; body: Record<string, unknown> }> = []
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
        const chunk = {
          id: 'c1',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'gpt-main',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }) as typeof fetch

      try {
        const svc = new ProviderService()
        const result = await svc.testProviderConfig({
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-or',
          modelId: 'gpt-main',
          apiFormat: 'openai_chat',
        })

        expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
        expect(calls[0].body.stream).toBe(true)
        expect(result).toEqual({
          connectivity: expect.objectContaining({ success: true, modelUsed: 'gpt-main', httpStatus: 200 }),
        })
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test.each([
      ['a JSON error body', '{"error":{"message":"invalid api key"}}', 'invalid api key'],
      ['an HTML page', '<html>hi</html>', 'no valid Chat Completions chunks'],
      ['an SSE error chunk', 'data: {"error":{"message":"quota exceeded"}}\n\n', 'quota exceeded'],
      ['an empty body', '', 'no valid Chat Completions chunks'],
    ])('fails OpenAI Chat tests when a 200 response carries %s', async (_label, body, expectedError) => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = mock(async () => new Response(body, { status: 200 })) as unknown as typeof fetch

      try {
        const svc = new ProviderService()
        const result = await svc.testProviderConfig({
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
          modelId: 'gpt-main',
          apiFormat: 'openai_chat',
        })

        expect(result.connectivity.success).toBe(false)
        expect(result.connectivity.error).toContain(expectedError)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('shows the upstream message when a Responses stream fails', async () => {
      const originalFetch = globalThis.fetch
      const body = 'event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed","error":{"message":"quota exceeded"}}}\n\n'
      globalThis.fetch = mock(async () => new Response(body, { status: 200 })) as unknown as typeof fetch

      try {
        const svc = new ProviderService()
        const result = await svc.testProviderConfig({
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
          modelId: 'gpt-main',
          apiFormat: 'openai_responses',
        })

        expect(result.connectivity).toMatchObject({ success: false, error: 'quota exceeded' })
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('passes OpenAI Chat tests when the model stops at max_tokens before any text', async () => {
      const originalFetch = globalThis.fetch
      const chunks = [
        { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-main', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
        { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-main', choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
      ]
      const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
      globalThis.fetch = mock(async () => new Response(body, { status: 200 })) as unknown as typeof fetch

      try {
        const svc = new ProviderService()
        const result = await svc.testProviderConfig({
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
          modelId: 'gpt-main',
          apiFormat: 'openai_chat',
        })

        expect(result.connectivity.success).toBe(true)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('reports a failed test when the stream ends without message_stop', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = mock(async () => new Response('', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })) as unknown as typeof fetch

      try {
        const svc = new ProviderService()
        const result = await svc.testProviderConfig({
          baseUrl: 'https://api.example.com/anthropic',
          apiKey: 'sk-api',
          modelId: 'model-main',
          apiFormat: 'anthropic',
        })

        expect(result.connectivity.success).toBe(false)
        expect(result.connectivity.error).toContain('message_stop')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('should use configured network timeout for provider tests', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'settings.json'),
        JSON.stringify({
          network: {
            aiRequestTimeoutMs: 180_000,
            proxy: { mode: 'system', url: '' },
          },
        }),
        'utf-8',
      )
      const originalFetch = globalThis.fetch
      const originalSetTimeout = globalThis.setTimeout
      const timeoutCalls: Array<number | undefined> = []
      globalThis.fetch = mock(async (_url: string | URL | Request, _init?: RequestInit) => {
        return anthropicStreamResponse('model-main')
      }) as typeof fetch
      globalThis.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
        timeoutCalls.push(ms)
        return originalSetTimeout(handler, ms, ...args)
      }) as typeof setTimeout

      try {
        const svc = new ProviderService()
        await svc.testProviderConfig({
          baseUrl: 'https://api.example.com/anthropic',
          apiKey: 'sk-api',
          modelId: 'model-main',
          authStrategy: 'api_key',
          apiFormat: 'anthropic',
        })

        expect(timeoutCalls[0]).toBe(180_000)
        expect(timeoutCalls.every((ms) => ms !== undefined && ms <= 180_000)).toBe(true)
      } finally {
        globalThis.setTimeout = originalSetTimeout
        globalThis.fetch = originalFetch
      }
    })
  })
})

describe('Providers API', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('GET /api/providers should return empty list initially', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers')
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { providers: unknown[] }
    expect(body.providers).toEqual([])
  })

  test('GET /api/providers should list added providers', async () => {
    const svc = new ProviderService()
    await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest('GET', '/api/providers')
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { providers: { name: string; apiKey: string }[] }
    expect(body.providers).toHaveLength(1)
    expect(body.providers[0].name).toBe('Test Provider')
    expect(body.providers[0].apiKey).toBe('sk-test-key-123')
  })

  test('POST /api/providers should create a provider', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/providers', {
      presetId: 'custom',
      name: 'New Provider',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      apiFormat: 'anthropic',
      autoCompactWindow: 64000,
      models: [{ id: 'gpt-4' }, { id: 'gpt-4-haiku' }],
      fastModel: 'gpt-4-haiku',
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(201)
    const body = (await res.json()) as { provider: { name: string; models: Array<{ id: string }>; autoCompactWindow: number } }
    expect(body.provider.name).toBe('New Provider')
    expect(body.provider.models[0]?.id).toBe('gpt-4')
    expect(body.provider.autoCompactWindow).toBe(64000)
  })

  test('POST /api/providers should return 400 for invalid input', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/providers', {
      name: '',
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(400)
  })

  test('POST /api/providers should return 400 for invalid auto compact window', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/providers', {
      presetId: 'custom',
      name: 'New Provider',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      apiFormat: 'anthropic',
      autoCompactWindow: 8000,
      models: [{ id: 'gpt-4' }],
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(400)
  })

  test('POST /api/providers should reject duplicate model IDs', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/providers', {
      presetId: 'custom',
      name: 'Duplicate Models',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      apiFormat: 'anthropic',
      models: [{ id: 'gpt-4' }, { id: 'gpt-4' }],
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(400)
  })

  test('GET /api/providers/:id should return a provider', async () => {
    const svc = new ProviderService()
    const added = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest('GET', `/api/providers/${added.id}`)
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { provider: { id: string; name: string } }
    expect(body.provider.id).toBe(added.id)
  })

  test('GET /api/providers/:id should return 404 for unknown id', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/unknown-id')
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(404)
  })

  test('PUT /api/providers/:id should update a provider', async () => {
    const svc = new ProviderService()
    const added = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest('PUT', `/api/providers/${added.id}`, {
      name: 'Renamed Provider',
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { provider: { name: string } }
    expect(body.provider.name).toBe('Renamed Provider')
  })

  test('DELETE /api/providers/:id should delete an inactive provider', async () => {
    const svc = new ProviderService()
    await svc.addProvider(sampleInput({ name: 'First' }))
    const second = await svc.addProvider(sampleInput({ name: 'Second' }))

    const { req, url, segments } = makeRequest('DELETE', `/api/providers/${second.id}`)
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test('DELETE /api/providers/:id should return 409 for active provider', async () => {
    const svc = new ProviderService()
    const active = await svc.addProvider(sampleInput())
    await svc.activateProvider(active.id)

    const { req, url, segments } = makeRequest('DELETE', `/api/providers/${active.id}`)
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(409)
  })

  test('POST /api/providers/:id/activate should activate a provider', async () => {
    const svc = new ProviderService()
    await svc.addProvider(sampleInput({ name: 'First' }))
    const second = await svc.addProvider(
      sampleInput({
        name: 'Second',
        baseUrl: 'https://second.example.com',
        apiKey: 'sk-second',
      }),
    )

    const { req, url, segments } = makeRequest(
      'POST',
      `/api/providers/${second.id}/activate`,
    )
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)

    const settings = await readSettings()
    const env = settings.env as Record<string, string>
    expect(env.ANTHROPIC_BASE_URL).toBe('https://second.example.com')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-second')
    expect(env.ANTHROPIC_API_KEY).toBe('')
    expect(env.ANTHROPIC_MODEL).toBe('model-main')
  })

  test('POST /api/providers/:id/activate should not require modelId', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest(
      'POST',
      `/api/providers/${provider.id}/activate`,
      {},
    )
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
  })

  test('POST /api/providers/:id/activate should ignore modelId because session runtime selects the model', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest(
      'POST',
      `/api/providers/${provider.id}/activate`,
      { modelId: 'non-existent-model' },
    )
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
  })

  test('should return 405 for unsupported methods', async () => {
    const { req, url, segments } = makeRequest('PATCH', '/api/providers')
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(405)
  })
})
