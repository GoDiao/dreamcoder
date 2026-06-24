import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { handleProxyRequest } from '../proxy/handler.js'
import { ProviderService } from '../services/providerService.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

let tmpDir: string
let originalConfigDir: string | undefined

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-network-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  resetSettingsCache()
}

async function teardown() {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  resetSettingsCache()
  await fs.rm(tmpDir, { recursive: true, force: true })
}

describe('proxy network settings', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('uses configured AI request timeout for non-stream upstream requests', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        network: {
          aiRequestTimeoutMs: 45_000,
          proxy: { mode: 'system', url: '' },
        },
      }),
      'utf-8',
    )

    const svc = new ProviderService()
    const provider = await svc.addProvider({
      presetId: 'custom',
      name: 'OpenAI Proxy',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      apiFormat: 'openai_chat',
      models: {
        main: 'model-main',
        haiku: 'model-main',
        sonnet: 'model-main',
        opus: 'model-main',
      },
    })

    const originalFetch = globalThis.fetch
    const originalTimeout = AbortSignal.timeout
    const timeoutCalls: number[] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(JSON.stringify({
        id: 'chatcmpl-network-timeout',
        object: 'chat.completion',
        created: 0,
        model: 'model-main',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
    AbortSignal.timeout = ((ms: number) => {
      timeoutCalls.push(ms)
      return originalTimeout(ms)
    }) as typeof AbortSignal.timeout

    try {
      const body = {
        model: 'model-main',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
      }
      const req = new Request(
        `http://localhost:3456/proxy/providers/${provider.id}/v1/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const res = await handleProxyRequest(req, new URL(req.url))

      expect(res.status).toBe(200)
      expect(timeoutCalls).toEqual([45_000])
    } finally {
      AbortSignal.timeout = originalTimeout
      globalThis.fetch = originalFetch
    }
  })

  test('uses configured AI request timeout for non-stream Responses upstream requests', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        network: {
          aiRequestTimeoutMs: 45_000,
          proxy: { mode: 'system', url: '' },
        },
      }),
      'utf-8',
    )

    const svc = new ProviderService()
    const provider = await svc.addProvider({
      presetId: 'custom',
      name: 'OpenAI Responses Proxy',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      apiFormat: 'openai_responses',
      models: {
        main: 'model-main',
        haiku: 'model-main',
        sonnet: 'model-main',
        opus: 'model-main',
      },
    })

    const originalFetch = globalThis.fetch
    const originalTimeout = AbortSignal.timeout
    const timeoutCalls: number[] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(JSON.stringify({
        id: 'resp-network-timeout',
        status: 'completed',
        model: 'model-main',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'ok' }],
        }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
    AbortSignal.timeout = ((ms: number) => {
      timeoutCalls.push(ms)
      return originalTimeout(ms)
    }) as typeof AbortSignal.timeout

    try {
      const body = {
        model: 'model-main',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
      }
      const req = new Request(
        `http://localhost:3456/proxy/providers/${provider.id}/v1/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const res = await handleProxyRequest(req, new URL(req.url))

      expect(res.status).toBe(200)
      expect(timeoutCalls).toEqual([45_000])
    } finally {
      AbortSignal.timeout = originalTimeout
      globalThis.fetch = originalFetch
    }
  })

  test('uses configured AI request timeout only while opening streaming upstream requests', async () => {
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

    const svc = new ProviderService()
    const provider = await svc.addProvider({
      presetId: 'custom',
      name: 'OpenAI Proxy',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      apiFormat: 'openai_chat',
      models: {
        main: 'model-main',
        haiku: 'model-main',
        sonnet: 'model-main',
        opus: 'model-main',
      },
    })

    const originalFetch = globalThis.fetch
    const originalTimeout = AbortSignal.timeout
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const timeoutCalls: number[] = []
    const timers: Array<{ ms: number | undefined; cleared: boolean }> = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
            controller.close()
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        },
      )
    }) as typeof fetch
    AbortSignal.timeout = ((ms: number) => {
      timeoutCalls.push(ms)
      return originalTimeout(ms)
    }) as typeof AbortSignal.timeout
    globalThis.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
      const timer = { ms, cleared: false }
      timers.push(timer)
      return timer as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout
    globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>) => {
      const found = timers.find((entry) => entry === timer)
      if (found) found.cleared = true
    }) as typeof clearTimeout

    try {
      const body = {
        model: 'model-main',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      }
      const req = new Request(
        `http://localhost:3456/proxy/providers/${provider.id}/v1/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const res = await handleProxyRequest(req, new URL(req.url))
      await res.text()

      expect(res.status).toBe(200)
      expect(timeoutCalls).toEqual([])
      expect(timers).toEqual([{ ms: 180_000, cleared: true }])
    } finally {
      globalThis.clearTimeout = originalClearTimeout
      globalThis.setTimeout = originalSetTimeout
      AbortSignal.timeout = originalTimeout
      globalThis.fetch = originalFetch
    }
  })
})
