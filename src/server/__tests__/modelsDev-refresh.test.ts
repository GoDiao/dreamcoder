import { afterEach, beforeEach, describe, expect, mock, spyOn, test, type Mock } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import type { ModelsDevCatalog, ModelsDevData } from '../services/modelsDev/catalog.js'
import { loadModelsDevCache, refreshModelsDev, startModelsDevRefresh } from '../services/modelsDev/modelsDevRefresh.js'
import { bundledModelsDevData, currentModelsDevData, setModelsDevData } from '../services/modelsDev/modelsDevStore.js'
import { resolveModelRules } from '../services/modelRules/resolveModelRules.js'

type Call = { url: string; init?: RequestInit }

const HOUR = 60 * 60 * 1000

let tmpDir: string
let originalConfigDir: string | undefined
let originalFetch: typeof globalThis.fetch
let calls: Call[]
let warn: Mock<typeof console.warn>

function catalogWith(output: number): ModelsDevCatalog {
  return { openai: { api: 'https://api.openai.com/v1', models: { 'test-model': { limit: { context: 200_000, output } } } } }
}

function dataAt(time: number, output = 1_000, etag?: string): ModelsDevData {
  return { fetchedAt: new Date(time).toISOString(), ...(etag && { etag }), catalog: catalogWith(output) }
}

function cacheFile(): string {
  return path.join(tmpDir, 'dreamcoder', 'cache', 'models-dev.json')
}

async function writeCacheFile(content: unknown): Promise<void> {
  await fs.mkdir(path.dirname(cacheFile()), { recursive: true })
  await fs.writeFile(cacheFile(), typeof content === 'string' ? content : JSON.stringify(content))
}

async function readCacheFile(): Promise<ModelsDevData | undefined> {
  try {
    return JSON.parse(await fs.readFile(cacheFile(), 'utf-8')) as ModelsDevData
  } catch {
    return undefined
  }
}

function respondWith(respond: () => Response | Promise<Response>): void {
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return respond()
  }) as unknown as typeof fetch
}

function testModelOutput(): number {
  return resolveModelRules({ baseUrl: 'https://relay.test/v1', apiFormat: 'openai_chat' }, 'test-model').maxOutputTokens
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'models-dev-refresh-'))
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  originalFetch = globalThis.fetch
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
  calls = []
  warn = spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  warn.mockRestore()
  setModelsDevData(null)
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('loadModelsDevCache', () => {
  test('uses a cache newer than the bundled snapshot', async () => {
    const cached = dataAt(Date.parse(bundledModelsDevData().fetchedAt) + HOUR, 2_000)
    await writeCacheFile(cached)
    await loadModelsDevCache()
    expect(currentModelsDevData()).toEqual(cached)
    expect(testModelOutput()).toBe(2_000)
  })

  test('keeps the bundled snapshot when the cache is older', async () => {
    await writeCacheFile(dataAt(Date.parse(bundledModelsDevData().fetchedAt) - HOUR, 2_000))
    await loadModelsDevCache()
    expect(currentModelsDevData()).toBe(bundledModelsDevData())
  })

  test('ignores a damaged cache and logs it', async () => {
    await writeCacheFile('{"fetchedAt": "not json')
    await loadModelsDevCache()
    expect(currentModelsDevData()).toBe(bundledModelsDevData())
    expect(String(warn.mock.calls[0]?.[0])).toContain('[modelsDev] ignoring invalid cache')
  })
})

describe('refreshModelsDev', () => {
  test('replaces the catalog and writes the cache on 200, so the next resolve uses it', async () => {
    setModelsDevData(dataAt(Date.now() - 2 * HOUR, 1_000))
    respondWith(() => Response.json(catalogWith(3_000), { headers: { etag: '"v2"' } }))
    await refreshModelsDev()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://models.dev/api.json')
    expect(testModelOutput()).toBe(3_000)
    const cached = await readCacheFile()
    expect(cached?.etag).toBe('"v2"')
    expect(cached?.catalog).toEqual(catalogWith(3_000))
    expect(Date.now() - Date.parse(cached!.fetchedAt)).toBeLessThan(HOUR)
  })

  test('sends the ETag and only updates the time on 304', async () => {
    const before = dataAt(Date.now() - 2 * HOUR, 1_000, '"v1"')
    setModelsDevData(before)
    respondWith(() => new Response(null, { status: 304 }))
    await refreshModelsDev()
    expect(new Headers(calls[0]!.init?.headers).get('If-None-Match')).toBe('"v1"')
    const current = currentModelsDevData()
    expect(current.catalog).toEqual(before.catalog)
    expect(current.etag).toBe('"v1"')
    expect(Date.parse(current.fetchedAt)).toBeGreaterThan(Date.parse(before.fetchedAt))
    expect((await readCacheFile())?.fetchedAt).toBe(current.fetchedAt)
  })

  test.each([
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['a server error', () => new Response('down', { status: 503 })],
    ['a body that is not JSON', () => new Response('<html>', { status: 200 })],
    ['a catalog with no providers', () => Response.json({})],
  ] as const)('keeps the current catalog after %s', async (_name, respond) => {
    const before = dataAt(Date.now() - 2 * HOUR, 1_000)
    setModelsDevData(before)
    respondWith(respond as () => Response | Promise<Response>)
    await refreshModelsDev()
    expect(currentModelsDevData()).toBe(before)
    expect(await readCacheFile()).toBeUndefined()
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain('[modelsDev] refresh failed')
  })

  test('sends one request when two refreshes overlap', async () => {
    setModelsDevData(dataAt(Date.now() - 2 * HOUR))
    respondWith(() => Response.json(catalogWith(3_000)))
    await Promise.all([refreshModelsDev(), refreshModelsDev()])
    expect(calls).toHaveLength(1)
  })
})

describe('startModelsDevRefresh', () => {
  test('fetches at once when the catalog is more than an hour old', async () => {
    setModelsDevData(dataAt(Date.now() - 2 * HOUR))
    respondWith(() => Response.json(catalogWith(3_000)))
    const stop = await startModelsDevRefresh()
    stop()
    expect(calls).toHaveLength(1)
    expect(testModelOutput()).toBe(3_000)
  })

  test('does not fetch when the catalog is less than an hour old', async () => {
    setModelsDevData(dataAt(Date.now() - HOUR / 2))
    respondWith(() => Response.json(catalogWith(3_000)))
    const stop = await startModelsDevRefresh()
    stop()
    expect(calls).toHaveLength(0)
  })
})
