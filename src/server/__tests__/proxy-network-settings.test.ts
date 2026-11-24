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
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
  resetSettingsCache()
}

async function teardown() {
  if (originalConfigDir !== undefined) {
    process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.DREAMCODER_CONFIG_DIR
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
      models: [{ id: 'model-main' }],
    })

    const originalFetch = globalThis.fetch
    const originalTimeout = AbortSignal.timeout
    const timeoutCalls: number[] = []
    globalThis.fetch = Object.assign(mock(async (_url: string | URL | Request, _init?: RequestInit) => {
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
    }), { preconnect: originalFetch.preconnect })
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
      const res = await handleProxyRequest(req, new URL(req.url), { timeout: () => {} })

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
      models: [{ id: 'model-main' }],
    })

    const originalFetch = globalThis.fetch
    const originalTimeout = AbortSignal.timeout
    const timeoutCalls: number[] = []
    globalThis.fetch = Object.assign(mock(async (_url: string | URL | Request, _init?: RequestInit) => {
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
    }), { preconnect: originalFetch.preconnect })
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
      const res = await handleProxyRequest(req, new URL(req.url), { timeout: () => {} })

      expect(res.status).toBe(200)
      expect(timeoutCalls).toEqual([45_000])
    } finally {
      AbortSignal.timeout = originalTimeout
      globalThis.fetch = originalFetch
    }
  })

  test('uses the configured AI request timeout for opening a stream and for idle gaps, and clears it when the stream ends', async () => {
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
      models: [{ id: 'model-main' }],
    })

    const originalFetch = globalThis.fetch
    const originalTimeout = AbortSignal.timeout
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const timeoutCalls: number[] = []
    const timers: Array<{ ms: number | undefined; cleared: boolean }> = []
    globalThis.fetch = Object.assign(mock(async (_url: string | URL | Request, init?: RequestInit) => {
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
    }), { preconnect: originalFetch.preconnect })
    AbortSignal.timeout = ((ms: number) => {
      timeoutCalls.push(ms)
      return originalTimeout(ms)
    }) as typeof AbortSignal.timeout
    globalThis.setTimeout = ((_handler: TimerHandler, ms?: number) => {
      const timer = { ms, cleared: false }
      timers.push(timer)
      return timer
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>) => {
      const found = timers.find((entry) => Object.is(entry, timer))
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
      const res = await handleProxyRequest(req, new URL(req.url), { timeout: () => {} })
      await res.text()

      expect(res.status).toBe(200)
      expect(timeoutCalls).toEqual([])
      expect(timers.length).toBeGreaterThanOrEqual(2)
      expect(timers.every((timer) => timer.ms === 180_000 && timer.cleared)).toBe(true)
    } finally {
      globalThis.clearTimeout = originalClearTimeout
      globalThis.setTimeout = originalSetTimeout
      AbortSignal.timeout = originalTimeout
      globalThis.fetch = originalFetch
    }
  })

  test('keeps a proxied stream open while the upstream pauses longer than the server idle timeout', async () => {
    const encoder = new TextEncoder()
    const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
      encoder.encode(`data: ${JSON.stringify({
        id: 'chatcmpl-slow',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'model-main',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`)
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response(new ReadableStream({
        async start(controller) {
          controller.enqueue(chunk({ role: 'assistant', content: 'before ' }))
          await Bun.sleep(5_000)
          controller.enqueue(chunk({ content: 'after' }, 'stop'))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } }),
    })
    const provider = await new ProviderService().addProvider({
      presetId: 'custom',
      name: 'Slow Upstream',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiKey: 'sk-test',
      apiFormat: 'openai_chat',
      models: [{ id: 'model-main' }],
    })
    const proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      idleTimeout: 1,
      fetch: (req, server) => handleProxyRequest(req, new URL(req.url), server),
    })

    try {
      const res = await fetch(`http://127.0.0.1:${proxy.port}/proxy/providers/${provider.id}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'model-main', max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'hello' }] }),
      })
      const text = await res.text()

      expect(text).toContain('"text":"after"')
      expect(text).toContain('message_stop')
    } finally {
      proxy.stop(true)
      upstream.stop(true)
    }
  }, 15_000)

  test.each([false, true])('aborts the upstream request when the client disconnects before upstream headers (stream: %p)', async (stream) => {
    const upstreamReceived = Promise.withResolvers<void>()
    const upstreamAborted = Promise.withResolvers<string>()
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        req.signal.addEventListener('abort', () => upstreamAborted.resolve('aborted'))
        upstreamReceived.resolve()
        return new Promise<Response>(() => {})
      },
    })
    const provider = await new ProviderService().addProvider({
      presetId: 'custom',
      name: 'Hanging Upstream',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiKey: 'sk-test',
      apiFormat: 'openai_chat',
      models: [{ id: 'model-main' }],
    })
    const proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (req, server) => handleProxyRequest(req, new URL(req.url), server),
    })
    const client = new AbortController()

    try {
      const pending = fetch(`http://127.0.0.1:${proxy.port}/proxy/providers/${provider.id}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'model-main', max_tokens: 64, stream, messages: [{ role: 'user', content: 'hello' }] }),
        signal: client.signal,
      }).catch(() => null)
      await upstreamReceived.promise
      client.abort()
      await pending

      const outcome = await Promise.race([
        upstreamAborted.promise,
        Bun.sleep(3_000).then(() => 'still running'),
      ])
      expect(outcome).toBe('aborted')
    } finally {
      proxy.stop(true)
      upstream.stop(true)
    }
  }, 10_000)
})
