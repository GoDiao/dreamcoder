import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { handleProvidersApi } from '../api/providers.js'
import { ProviderService } from '../services/providerService.js'
import type { CreateProviderInput, SavedProvider } from '../types/provider.js'

type Call = { url: string; init?: RequestInit }

let tmpDir: string
let originalConfigDir: string | undefined
let originalFetch: typeof globalThis.fetch
let calls: Call[]
let warning: ReturnType<typeof spyOn>

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'model-rules-discovery-'))
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  originalFetch = globalThis.fetch
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
  calls = []
  warning = spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  warning.mockRestore()
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function respondWith(respond: (call: Call) => Response | Promise<Response>) {
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init }
    calls.push(call)
    return respond(call)
  }) as unknown as typeof fetch
}

function listing(): Response {
  return Response.json({ data: [
    { id: 'model-main', context_length: 300000, top_provider: { max_completion_tokens: 32000 }, architecture: { input_modalities: ['text', 'image'] } },
    { id: 'model-fast', context_length: 131072 },
    { id: 'model-plain' },
    { id: 'unlisted-model', context_length: 1000000 },
  ] })
}

function input(overrides?: Partial<CreateProviderInput>): CreateProviderInput {
  return {
    presetId: 'custom',
    name: 'Discovery Provider',
    baseUrl: 'https://api.example.invalid/v1',
    apiKey: 'sk-test',
    apiFormat: 'openai_chat',
    runtimeKind: 'anthropic_compatible',
    models: [{ id: 'model-main' }, { id: 'model-fast[1m]' }, { id: 'model-plain' }],
    ...overrides,
  }
}

function saved(overrides?: Partial<SavedProvider>): SavedProvider {
  const { runtimeKind: _runtimeKind, ...rest } = input()
  return {
    ...rest,
    id: 'p1',
    runtimeKind: 'anthropic_compatible',
    apiFormat: 'openai_chat',
    discoveredModels: { 'model-main': { contextWindow: 200000 } },
    discoveredAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

async function writeIndex(providers: unknown[]): Promise<void> {
  await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
  await fs.writeFile(
    path.join(tmpDir, 'dreamcoder', 'providers.json'),
    JSON.stringify({ schemaVersion: 2, activeId: null, providers }),
    'utf-8',
  )
}

async function readStored(id: string): Promise<SavedProvider | undefined> {
  const raw = await fs.readFile(path.join(tmpDir, 'dreamcoder', 'providers.json'), 'utf-8')
  return (JSON.parse(raw) as { providers: SavedProvider[] }).providers.find((provider) => provider.id === id)
}

async function call(method: string, pathname: string, body?: unknown): Promise<Response> {
  const url = new URL(pathname, 'http://localhost:3456')
  const req = new Request(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  return handleProvidersApi(req, url, url.pathname.split('/').filter(Boolean))
}

type SaveResponse = { provider: SavedProvider; modelDiscovery?: { ok: boolean; error: string } }

describe('model metadata on save', () => {
  test('creating a provider stores metadata for its own models only, using its headers and query parameters', async () => {
    respondWith(listing)
    const res = await call('POST', '/api/providers', input({
      extraHeaders: { 'X-Title': 'DreamCoder' },
      queryParams: { 'api-version': '2026-01-01' },
    }))
    expect(res.status).toBe(201)
    const body = await res.json() as SaveResponse
    expect(body).not.toHaveProperty('modelDiscovery')
    expect(body.provider.discoveredModels).toEqual({
      'model-main': { contextWindow: 300000, maxOutputTokens: 32000, image: true },
      'model-fast': { contextWindow: 131072 },
    })
    expect(Date.parse(body.provider.discoveredAt!)).not.toBeNaN()
    expect(await readStored(body.provider.id)).toEqual(body.provider)
    expect(calls.map(({ url }) => url)).toEqual(['https://api.example.invalid/v1/models?api-version=2026-01-01'])
    expect(calls[0]!.init?.headers).toMatchObject({ 'X-Title': 'DreamCoder' })
  })

  test('updating a provider fetches again from the new address', async () => {
    await writeIndex([saved()])
    respondWith(listing)
    const res = await call('PUT', '/api/providers/p1', { baseUrl: 'https://other.example.invalid/v1' })
    expect(res.status).toBe(200)
    const body = await res.json() as SaveResponse
    expect(body.provider.discoveredModels?.['model-main']).toEqual({ contextWindow: 300000, maxOutputTokens: 32000, image: true })
    expect(calls.map(({ url }) => url)).toEqual(['https://other.example.invalid/v1/models'])
  })

  test('a failed fetch keeps the saved change and the old metadata, logs the reason and returns a warning', async () => {
    await writeIndex([saved()])
    respondWith(() => new Response('unavailable', { status: 503 }))
    const res = await call('PUT', '/api/providers/p1', { name: 'Renamed' })
    expect(res.status).toBe(200)
    const body = await res.json() as SaveResponse
    expect(body.provider.name).toBe('Renamed')
    expect(body.provider.discoveredModels).toEqual({ 'model-main': { contextWindow: 200000 } })
    expect(body.provider.discoveredAt).toBe('2026-11-01T00:00:00.000Z')
    expect(body.modelDiscovery?.ok).toBe(false)
    expect(body.modelDiscovery?.error).toContain('503')
    expect(await readStored('p1')).toMatchObject({ name: 'Renamed', discoveredModels: { 'model-main': { contextWindow: 200000 } } })
    expect(warning).toHaveBeenCalledWith('[providers] Model metadata refresh failed', {
      providerId: 'p1',
      error: body.modelDiscovery!.error,
    })
  })

  test('a failed fetch on create still creates the provider', async () => {
    respondWith(() => { throw new TypeError('offline') })
    const res = await call('POST', '/api/providers', input())
    expect(res.status).toBe(201)
    const body = await res.json() as SaveResponse
    expect(body.modelDiscovery).toEqual({ ok: false, error: expect.stringContaining('offline') })
    expect(body.provider.discoveredModels).toBeUndefined()
    expect(await readStored(body.provider.id)).toBeDefined()
  })

  test('a stalled listing gives up after the save timeout and still saves the provider', async () => {
    respondWith(({ init }) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    }))
    const startedAt = Date.now()
    const res = await call('POST', '/api/providers', input())
    expect(Date.now() - startedAt).toBeLessThan(15_000)
    expect(res.status).toBe(201)
    const body = await res.json() as SaveResponse
    expect(body.modelDiscovery).toEqual({ ok: false, error: expect.stringContaining('timed out (10s)') })
    expect(await readStored(body.provider.id)).toBeDefined()
  }, 30_000)

  test('a base URL without a scheme still saves the provider and returns a warning', async () => {
    respondWith(listing)
    const res = await call('POST', '/api/providers', input({ baseUrl: 'api.deepseek.com' }))
    expect(res.status).toBe(201)
    const body = await res.json() as SaveResponse
    expect(body.modelDiscovery).toEqual({ ok: false, error: expect.any(String) })
    expect(await readStored(body.provider.id)).toBeDefined()
  })

  test('re-reads the index before writing, so a change made during the fetch is kept', async () => {
    await writeIndex([saved(), saved({ id: 'p2', name: 'Other' })])
    respondWith(async () => {
      await new ProviderService().updateProvider('p2', { name: 'Changed meanwhile' })
      return listing()
    })
    const res = await call('POST', '/api/providers/p1/refresh-models')
    expect(res.status).toBe(200)
    expect((await readStored('p2'))?.name).toBe('Changed meanwhile')
    expect((await readStored('p1'))?.discoveredModels?.['model-fast']).toEqual({ contextWindow: 131072 })
  })
})

describe('POST /api/providers/:id/refresh-models', () => {
  test('replaces the stored metadata and returns the provider', async () => {
    await writeIndex([saved()])
    respondWith(listing)
    const res = await call('POST', '/api/providers/p1/refresh-models')
    expect(res.status).toBe(200)
    const body = await res.json() as SaveResponse
    expect(body).not.toHaveProperty('modelDiscovery')
    expect(body.provider.discoveredModels).toEqual({
      'model-main': { contextWindow: 300000, maxOutputTokens: 32000, image: true },
      'model-fast': { contextWindow: 131072 },
    })
    expect(body.provider.discoveredAt).not.toBe('2026-11-01T00:00:00.000Z')
  })

  test('removes old metadata when the provider no longer reports any for its models', async () => {
    await writeIndex([saved()])
    respondWith(() => Response.json({ data: [{ id: 'model-main' }, { id: 'unlisted-model', context_length: 1000000 }] }))
    const res = await call('POST', '/api/providers/p1/refresh-models')
    const body = await res.json() as SaveResponse
    expect(body.provider).not.toHaveProperty('discoveredModels')
    expect(body.provider.discoveredAt).not.toBe('2026-11-01T00:00:00.000Z')
    expect(await readStored('p1')).not.toHaveProperty('discoveredModels')
  })

  test('returns the warning and keeps the stored metadata when the fetch fails', async () => {
    await writeIndex([saved()])
    respondWith(() => new Response('denied', { status: 401 }))
    const res = await call('POST', '/api/providers/p1/refresh-models')
    expect(res.status).toBe(200)
    const body = await res.json() as SaveResponse
    expect(body.modelDiscovery?.ok).toBe(false)
    expect(await readStored('p1')).toEqual(saved())
  })

  test('returns 404 for an unknown provider', async () => {
    respondWith(listing)
    const res = await call('POST', '/api/providers/missing/refresh-models')
    expect(res.status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  test('rejects other methods', async () => {
    await writeIndex([saved()])
    const res = await call('GET', '/api/providers/p1/refresh-models')
    expect(res.status).toBe(405)
  })
})

describe('POST /api/providers/models', () => {
  test('sends the extra headers and query parameters from the form', async () => {
    respondWith(listing)
    const res = await call('POST', '/api/providers/models', {
      baseUrl: 'https://azure.example.invalid/openai/v1',
      apiKey: 'sk-test',
      apiFormat: 'openai_chat',
      extraHeaders: { 'api-key': 'header-value' },
      queryParams: { 'api-version': '2026-01-01' },
    })
    expect(res.status).toBe(200)
    expect(calls.map(({ url }) => url)).toEqual(['https://azure.example.invalid/openai/v1/models?api-version=2026-01-01'])
    expect(calls[0]!.init?.headers).toMatchObject({ 'api-key': 'header-value' })
  })
})

describe('hand-written overrides in providers.json', () => {
  test('drops each invalid field, keeps the valid ones and the provider, and logs what was dropped', async () => {
    await writeIndex([saved({
      modelOverrides: {
        'model-main': { contextWindow: 12, maxOutputTokens: 64000, reasoningLevels: ['huge'], image: true },
        'model-plain': { pdf: 'yes', unknownField: 1 },
        'model-fast': 'not an object',
      } as unknown as SavedProvider['modelOverrides'],
    })])
    const provider = await new ProviderService().getProvider('p1')
    expect(provider.modelOverrides).toEqual({
      'model-main': { maxOutputTokens: 64000, image: true },
      'model-plain': {},
    })
    expect(warning).toHaveBeenCalledWith('[providers] Dropped invalid model override', { providerId: 'p1', model: 'model-main', field: 'contextWindow' })
    expect(warning).toHaveBeenCalledWith('[providers] Dropped invalid model override', { providerId: 'p1', model: 'model-main', field: 'reasoningLevels' })
    expect(warning).toHaveBeenCalledWith('[providers] Dropped invalid model override', { providerId: 'p1', model: 'model-plain', field: 'pdf' })
    expect(warning).toHaveBeenCalledWith('[providers] Dropped invalid model override', { providerId: 'p1', model: 'model-plain', field: 'unknownField' })
    expect(warning).toHaveBeenCalledWith('[providers] Dropped invalid model override', { providerId: 'p1', model: 'model-fast', field: '*' })
  })

  test('drops a modelOverrides value that is not an object', async () => {
    await writeIndex([saved({ modelOverrides: [] as unknown as SavedProvider['modelOverrides'] })])
    const provider = await new ProviderService().getProvider('p1')
    expect(provider).not.toHaveProperty('modelOverrides')
    expect(provider.name).toBe('Discovery Provider')
    expect(warning).toHaveBeenCalledWith('[providers] Dropped invalid model override', { providerId: 'p1', model: '*', field: '*' })
  })
})
