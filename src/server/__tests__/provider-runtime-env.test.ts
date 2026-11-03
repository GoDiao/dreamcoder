import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import {
  mergeActiveProviderManagedEnv,
  readActiveProviderManagedEnv,
  resolveProviderDefaultModel,
  normalizeProvidersIndex,
} from '../services/providerRuntimeEnv.js'
import type { SavedProvider } from '../types/provider.js'

let tmpDir: string

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

describe('providerRuntimeEnv', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-runtime-env-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('derives native Anthropic provider env from the active provider index', async () => {
    await writeJson(path.join(tmpDir, 'dreamcoder', 'providers.json'), {
      activeId: 'provider-1',
      providers: [
        {
          id: 'provider-1',
          presetId: 'custom',
          name: 'Active Provider',
          apiKey: 'sk-active',
          authStrategy: 'auth_token',
          baseUrl: 'https://api.example.com/anthropic',
          apiFormat: 'anthropic',
          models: [{ id: 'active-main' }, { id: 'active-sonnet' }],
        },
      ],
    })

    const env = readActiveProviderManagedEnv(tmpDir)

    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://api.example.com/anthropic',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: 'sk-active',
      ANTHROPIC_MODEL: 'active-main',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'active-main',
      ANTHROPIC_SMALL_FAST_MODEL: 'active-main',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'active-main',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'active-main',
    })
  })

  test('resolves a valid managed env model and ignores stale saved model keys', () => {
    const provider = {
      id: 'provider-1',
      presetId: 'custom',
      name: 'Provider',
      apiKey: 'key',
      baseUrl: 'https://api.example.com',
      apiFormat: 'anthropic',
      models: [{ id: 'model-main' }, { id: 'model-selected' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies SavedProvider

    expect(resolveProviderDefaultModel(provider, {
      model: 'stale-saved-model',
      env: { ANTHROPIC_MODEL: 'model-selected' },
    })).toBe('model-selected')
    expect(resolveProviderDefaultModel(provider, {
      model: 'model-selected',
      env: { ANTHROPIC_MODEL: 'also-stale' },
    })).toBe('model-main')
  })

  test('strips a trailing /v1 from native Anthropic base URLs', async () => {
    await writeJson(path.join(tmpDir, 'dreamcoder', 'providers.json'), {
      activeId: 'provider-1',
      providers: [
        {
          id: 'provider-1',
          presetId: 'custom',
          name: 'Active Provider',
          apiKey: 'sk-active',
          baseUrl: 'https://api.example.com/anthropic/v1/',
          apiFormat: 'anthropic',
          models: [{ id: 'm' }],
        },
      ],
    })

    expect(readActiveProviderManagedEnv(tmpDir)?.ANTHROPIC_BASE_URL).toBe('https://api.example.com/anthropic')
  })

  test('active provider env overrides stale proxy settings while preserving unrelated env', async () => {
    await writeJson(path.join(tmpDir, 'dreamcoder', 'providers.json'), {
      activeId: 'provider-1',
      providers: [
        {
          id: 'provider-1',
          presetId: 'custom',
          name: 'Sub2API',
          apiKey: 'sk-sub2api',
          authStrategy: 'auth_token',
          baseUrl: 'https://sub2api.example.com',
          apiFormat: 'anthropic',
          models: [{ id: 'gpt-5.5' }],
        },
      ],
    })

    const env = mergeActiveProviderManagedEnv(
      {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456/proxy',
        ANTHROPIC_API_KEY: 'proxy-managed',
        ANTHROPIC_MODEL: 'deepseek-v4-pro',
        DISABLE_AUTOUPDATER: '1',
      },
      tmpDir,
    )

    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://sub2api.example.com',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: 'sk-sub2api',
      ANTHROPIC_MODEL: 'gpt-5.5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5.5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-5.5',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.5',
      DISABLE_AUTOUPDATER: '1',
    })
  })

  test('normalizes decision providers without widening model providers', () => {
    const index = normalizeProvidersIndex({
      activeId: null,
      providers: [],
      activeDecisionProviderId: 'local',
      decisionProviders: [
        {
          id: 'local',
          presetId: 'custom',
          name: 'Loopback',
          deployment: 'hosted',
          apiFormat: 'openai_chat',
          baseUrl: 'http://127.0.0.1:9000/v1',
          apiKey: '',
          models: [{ id: 'guard' }],
        },
        {
          id: 'remote',
          presetId: 'custom',
          name: 'LAN',
          deployment: 'local',
          apiFormat: 'openai_chat',
          baseUrl: 'http://192.168.1.10:9000/v1',
          apiKey: 'secret',
          models: [{ id: 'guard' }],
        },
      ],
    })

    expect(index?.activeDecisionProviderId).toBe('local')
    expect(index?.decisionProviders.map((provider) => provider.deployment)).toEqual([
      'local',
      'hosted',
    ])
    expect(index?.providers).toEqual([])
  })

  test('repairs invalid models saved for a curated decision provider preset', () => {
    const index = normalizeProvidersIndex({
      activeId: null,
      providers: [],
      activeDecisionProviderId: 'openai',
      decisionProviders: [{
        id: 'openai',
        presetId: 'openai',
        name: 'OpenAI Decisions',
        deployment: 'hosted',
        apiFormat: 'openai_decisions',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'secret',
        models: [{ id: 'gpt-3.5-turbogpt-5.6-lunagpt-6-luna' }],
      }],
    })

    expect(index?.decisionProviders[0]?.models).toEqual([{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }])
  })

  test('defaults missing decision provider fields for legacy indexes', () => {
    const index = normalizeProvidersIndex({ activeId: null, providers: [] })

    expect(index?.activeDecisionProviderId).toBeNull()
    expect(index?.decisionProviders).toEqual([])
  })
})
