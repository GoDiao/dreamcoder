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

    expect(lmstudio?.baseUrl).toBe('http://localhost:1234')
    expect(lmstudio?.apiFormat).toBe('anthropic')
    expect(lmstudio?.authStrategy).toBe('auth_token_empty_api_key')
    expect(lmstudio?.defaultModels.main).toBe('qwen/qwen3.6-27b')
    expect(ollama?.baseUrl).toBe('http://localhost:11434')
    expect(ollama?.apiFormat).toBe('anthropic')
    expect(ollama?.authStrategy).toBe('auth_token_empty_api_key')
    expect(ollama?.defaultModels.main).toBe('qwen3.6:27b')
    expect(deepseek?.authStrategy).toBe('auth_token')
    expect(deepseek?.defaultModels.main).toBe('deepseek-v4-pro')
    expect(deepseek?.defaultModels.haiku).toBe('deepseek-v4-flash')
    expect(deepseek?.defaultModels.sonnet).toBe('deepseek-v4-pro')
    expect(deepseek?.defaultModels.opus).toBe('deepseek-v4-pro')
    expect(deepseek?.defaultEnv?.DREAMCODER_SEND_DISABLED_THINKING).toBeUndefined()
    expect(deepseek?.defaultEnv?.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toBe(
      'thinking,effort,adaptive_thinking,max_effort',
    )
    expect(zhipu?.authStrategy).toBe('auth_token')
    expect(zhipu?.defaultModels.main).toBe('glm-5.1')
    expect(zhipu?.defaultModels.haiku).toBe('glm-4.5-air')
    expect(zhipu?.defaultModels.sonnet).toBe('glm-5-turbo')
    expect(zhipu?.defaultModels.opus).toBe('glm-5.1')
    expect(kimi?.baseUrl).toBe('https://api.kimi.com/coding')
    expect(kimi?.authStrategy).toBe('auth_token')
    expect(kimi?.defaultModels.main).toBe('kimi-k2.6')
    expect(kimi?.defaultEnv?.DREAMCODER_SEND_DISABLED_THINKING).toBe('1')
  })

  test('powertokens preset is a valid OpenAI-compatible provider entry', () => {
    const powertokens = PROVIDER_PRESETS.find((preset) => preset.id === 'powertokens')

    expect(powertokens).toBeDefined()
    expect(powertokens?.name).toBe('PowerTokens')
    expect(powertokens?.baseUrl).toBe('https://api.powertokens.ai')
    expect(powertokens?.apiFormat).toBe('openai_chat')
    expect(powertokens?.needsApiKey).toBe(true)
    expect(powertokens?.authStrategy).toBe('api_key')
    expect(powertokens?.apiKeyUrl).toContain('https://powertokens.ai')
    expect(powertokens?.defaultModels.main).toBe('glm-5.2')
    expect(powertokens?.defaultModels.haiku).toBe('glm-4.7-flash')
    expect(powertokens?.defaultModels.sonnet).toBe('MiniMax-M3')
    expect(powertokens?.defaultModels.opus).toBe('deepseek-v3-2-251201')
  })

  test('configured presets can expose optional API key metadata', () => {
    const lmstudio = PROVIDER_PRESETS.find((preset) => preset.id === 'lmstudio')
    const ollama = PROVIDER_PRESETS.find((preset) => preset.id === 'ollama')
    const deepseek = PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek')
    const zhipu = PROVIDER_PRESETS.find((preset) => preset.id === 'zhipuglm')
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
    expect(deepseek?.modelContextWindows?.['deepseek-v4-pro']).toBe(1000000)
    expect(deepseek?.modelContextWindows?.['deepseek-v4-flash']).toBe(1000000)
    expect(zhipu?.defaultEnv?.DREAMCODER_SEND_DISABLED_THINKING).toBe('1')
    expect(zhipu?.modelContextWindows?.['glm-5.1']).toBe(200000)
    expect(zhipu?.modelContextWindows?.['glm-4.5-air']).toBe(128000)
    expect(kimi?.apiKeyUrl).toBe('https://platform.kimi.com/console/api-keys')
    expect(kimi?.modelContextWindows?.['kimi-k2.6']).toBe(262144)
    expect(custom?.authStrategy).toBe('auth_token')
    expect(custom?.defaultEnv).toBeUndefined()
  })

  test('GET and PUT /api/providers/settings read and write dreamcoder settings.json', async () => {
    const initial = {
      env: {
        ANTHROPIC_MODEL: 'glm-5.1',
      },
      model: 'glm-5.1',
    }
    await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'dreamcoder', 'settings.json'),
      JSON.stringify(initial, null, 2),
      'utf-8',
    )

    const getReq = makeRequest('GET', '/api/providers/settings')
    const getRes = await handleProvidersApi(getReq.req, getReq.url, getReq.segments)
    expect(getRes.status).toBe(200)
    expect(await getRes.json()).toEqual(initial)

    const updateBody = {
      model: 'kimi-k2.6',
      env: {
        ANTHROPIC_MODEL: 'kimi-k2.6',
      },
    }
    const putReq = makeRequest('PUT', '/api/providers/settings', updateBody)
    const putRes = await handleProvidersApi(putReq.req, putReq.url, putReq.segments)
    expect(putRes.status).toBe(200)

    const updatedRaw = await fs.readFile(path.join(tmpDir, 'dreamcoder', 'settings.json'), 'utf-8')
    expect(JSON.parse(updatedRaw)).toEqual(updateBody)
  })
})
