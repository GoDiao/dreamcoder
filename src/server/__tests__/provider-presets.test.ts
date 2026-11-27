import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { handleProvidersApi } from '../api/providers.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'

let tmpDir: string
let originalConfigDir: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-presets-test-'))
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  if (originalConfigDir !== undefined) {
    process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.DREAMCODER_CONFIG_DIR
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeRequest(
  method: string,
  urlStr: string,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const req = new Request(url.toString(), { method })
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

describe('provider presets API', () => {
  test('GET /api/providers/presets returns the configured presets', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/presets')
    const response = await handleProvidersApi(req, url, segments)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ presets: PROVIDER_PRESETS })
  })

  test('configured presets include the built-in custom entry', () => {
    expect(PROVIDER_PRESETS.some((preset) => preset.id === 'custom')).toBe(true)
  })

  test('local Anthropic-compatible presets appear immediately before custom', () => {
    expect(PROVIDER_PRESETS.at(-3)?.id).toBe('lmstudio')
    expect(PROVIDER_PRESETS.at(-2)?.id).toBe('ollama')
    expect(PROVIDER_PRESETS.at(-1)?.id).toBe('custom')
  })

  test('configured presets keep current default model ids aligned with official provider docs', () => {
    const lmstudio = PROVIDER_PRESETS.find((preset) => preset.id === 'lmstudio')
    const ollama = PROVIDER_PRESETS.find((preset) => preset.id === 'ollama')
    const deepseek = PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek')
    const zhipu = PROVIDER_PRESETS.find((preset) => preset.id === 'zhipuglm')
    const kimi = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi')
    const qwen = PROVIDER_PRESETS.find((preset) => preset.id === 'qwen')

    expect(lmstudio?.baseUrl).toBe('http://localhost:1234')
    expect(lmstudio?.apiFormat).toBe('anthropic')
    expect(lmstudio?.authStrategy).toBe('auth_token_empty_api_key')
    expect(lmstudio?.defaultModels).toEqual([{ id: 'qwen/qwen3.6-27b' }])
    expect(ollama?.baseUrl).toBe('http://localhost:11434')
    expect(ollama?.apiFormat).toBe('anthropic')
    expect(ollama?.authStrategy).toBe('auth_token_empty_api_key')
    expect(ollama?.defaultModels).toEqual([{ id: 'qwen3.6:27b' }])
    expect(deepseek?.authStrategy).toBe('auth_token')
    expect(deepseek?.defaultModels).toEqual([
      { id: 'deepseek-v4-pro' },
      { id: 'deepseek-flash' },
    ])
    expect(deepseek?.defaultFastModel).toBe('deepseek-flash')
    expect(deepseek?.defaultEnv).toBeUndefined()
    expect(qwen?.defaultModels).toEqual([
      { id: 'qwen-max' },
      { id: 'qwen-plus' },
      { id: 'qwen3.8-flash' },
    ])
    expect(qwen?.defaultFastModel).toBe('qwen3.8-flash')
    expect(zhipu?.authStrategy).toBe('auth_token')
    expect(zhipu?.defaultModels).toEqual([
      { id: 'glm-5.1' },
      { id: 'glm-5-turbo' },
      { id: 'glm-4.5-air' },
    ])
    expect(zhipu?.defaultFastModel).toBe('glm-4.5-air')
    expect(kimi?.baseUrl).toBe('https://api.kimi.com/coding')
    expect(kimi?.authStrategy).toBe('auth_token')
    expect(kimi?.defaultModels).toEqual([
      { id: 'k3.1-pro' },
      { id: 'kimi-for-coding' },
    ])
    expect(kimi?.defaultEnv).toBeUndefined()
    expect(zhipu?.defaultEnv).toBeUndefined()
  })

  test('configured presets can expose optional API key metadata', () => {
    const lmstudio = PROVIDER_PRESETS.find((preset) => preset.id === 'lmstudio')
    const ollama = PROVIDER_PRESETS.find((preset) => preset.id === 'ollama')
    const deepseek = PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek')
    const kimi = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi')
    const custom = PROVIDER_PRESETS.find((preset) => preset.id === 'custom')

    expect(lmstudio?.needsApiKey).toBe(false)
    expect(lmstudio?.defaultEnv).toEqual({
      ANTHROPIC_AUTH_TOKEN: 'lmstudio',
    })
    expect(ollama?.needsApiKey).toBe(false)
    expect(ollama?.defaultEnv).toEqual({
      ANTHROPIC_AUTH_TOKEN: 'ollama',
    })
    expect(deepseek?.apiKeyUrl).toBe('https://platform.deepseek.com/api_keys')
    expect(kimi?.apiKeyUrl).toBe('https://platform.kimi.com/console/api-keys')
    expect(PROVIDER_PRESETS.some((preset) => 'modelContextWindows' in preset)).toBe(false)
    expect(custom?.authStrategy).toBe('auth_token')
    expect(custom?.defaultEnv).toBeUndefined()
  })
})
