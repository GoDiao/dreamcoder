import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import { handleProxyRequest } from '../proxy/handler.js'
import { normalizeSavedProvider } from '../services/providerRuntimeEnv.js'
import { ProviderService } from '../services/providerService.js'
import { CURRENT_PROVIDER_INDEX_SCHEMA_VERSION } from '../services/persistentStorageMigrations.js'
import type { SavedProvider } from '../types/provider.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

const baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode'
const endpoint = `${baseUrl}/v1/chat/completions`
const preset = PROVIDER_PRESETS.find((entry) => entry.id === 'qwen')!
const provider: SavedProvider = {
  id: 'saved-qwen',
  presetId: 'qwen',
  name: 'My Qwen',
  baseUrl,
  apiKey: 'fake-qwen-key',
  apiFormat: 'openai_chat',
  runtimeKind: 'anthropic_compatible',
  models: { main: 'qwen-max', haiku: 'qwen-turbo', sonnet: 'qwen-plus', opus: 'qwen-max' },
  notes: 'Keep my settings',
}

describe('Qwen request URLs', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let originalFetch: typeof fetch
  let calls: Array<{ url: string; method?: string; authorization: string | null }>

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-provider-test-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    resetSettingsCache()
    calls = []
    originalFetch = globalThis.fetch
    // Capture the actual transport boundary; never contact DashScope.
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, authorization: new Headers(init?.headers).get('Authorization') })
      const body = JSON.parse(String(init?.body))
      if (body.stream) {
        return new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      }
      return Response.json({
        id: 'chatcmpl-fake-qwen', object: 'chat.completion', created: 0, model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    }) as typeof fetch
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    resetSettingsCache()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('tests an unsaved preset at the single-v1 endpoint in both connection-test steps', async () => {
    const result = await new ProviderService().testProviderConfig({
      baseUrl: preset.baseUrl,
      apiKey: provider.apiKey,
      modelId: preset.defaultModels.main,
      apiFormat: preset.apiFormat,
    })
    expect(result.connectivity.success).toBe(true)
    expect(result.proxy?.success).toBe(true)
    expect(calls.map((call) => call.url)).toEqual([endpoint, endpoint])
  })

  test.each([baseUrl, `${baseUrl}/`, `${baseUrl}/v1`, `${baseUrl}/v1/`])(
    'tests and chats with saved Qwen base URL %s', async (savedBaseUrl) => {
      const saved = { ...provider, baseUrl: savedBaseUrl }
      const indexPath = path.join(tmpDir, 'dreamcoder', 'providers.json')
      await fs.mkdir(path.dirname(indexPath), { recursive: true })
      const raw = JSON.stringify({ schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION, activeId: saved.id, providers: [saved] })
      await fs.writeFile(indexPath, raw)
      const svc = new ProviderService()
      const result = await svc.testProvider(saved.id)
      expect(result.connectivity.success).toBe(true)
      expect(result.proxy?.success).toBe(true)

      for (const route of ['/proxy/v1/messages', `/proxy/providers/${saved.id}/v1/messages`]) {
        for (const stream of [false, true]) {
          const req = new Request(`http://localhost:3456${route}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: saved.models.main, max_tokens: 64, messages: [{ role: 'user', content: 'hello' }], stream }),
          })
          const response = await handleProxyRequest(req, new URL(req.url))
          expect(response.status).toBe(200)
          await response.text()
        }
      }
      expect(calls).toEqual(Array.from({ length: 6 }, () => ({ url: endpoint, method: 'POST', authorization: 'Bearer fake-qwen-key' })))
      // Reading old configurations must not rewrite users' files.
      expect(await fs.readFile(indexPath, 'utf-8')).toBe(raw)
      const updated = await svc.updateProvider(saved.id, { name: 'Renamed Qwen' })
      const expectedBase = savedBaseUrl.replace(/\/+$/, '') === `${baseUrl}/v1` ? baseUrl : savedBaseUrl
      expect(updated).toEqual({ ...saved, name: 'Renamed Qwen', baseUrl: expectedBase })
      expect((await new ProviderService().getProvider(saved.id)).baseUrl).toBe(expectedBase)
    },
  )

  test.each([
    { baseUrl: 'https://proxy.example.com/compatible-mode/v1' },
    { baseUrl: `${baseUrl}/custom/v1` },
    { baseUrl: `${baseUrl}/v1?tenant=custom` },
    { baseUrl: `${baseUrl}/v1`, presetId: 'custom' },
    { baseUrl: `${baseUrl}/v1`, apiFormat: 'anthropic' as const },
    { baseUrl: `${baseUrl}/v1`, apiFormat: 'openai_responses' as const },
  ])('preserves customized or unrelated configuration %j', (overrides) => {
    const saved = { ...provider, ...overrides }
    expect(normalizeSavedProvider(saved)).toEqual(saved)
  })
})
