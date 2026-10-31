import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { BrowserHostChannel } from './hostChannel.js'
import { FakeDesktop } from './testSupport.js'
import { BrowserTrustError, BrowserTrustStore, defaultTrustFilePath, normalizeTrustedOrigin } from './trustStore.js'

let dir: string
let file: string
let warn: ReturnType<typeof spyOn>
let error: ReturnType<typeof spyOn>
let originalConfigDir: string | undefined

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-trust-'))
  file = path.join(dir, 'dreamcoder', 'browser-trust.json')
  warn = spyOn(console, 'warn').mockImplementation(() => undefined)
  error = spyOn(console, 'error').mockImplementation(() => undefined)
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
})

afterEach(async () => {
  warn.mockRestore()
  error.mockRestore()
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await fs.rm(dir, { recursive: true, force: true })
})

function newStore() {
  return new BrowserTrustStore({ getFilePath: () => file })
}

describe('normalizeTrustedOrigin', () => {
  test('keeps exact https origins in their canonical form', () => {
    expect(normalizeTrustedOrigin('https://example.com')).toBe('https://example.com')
    expect(normalizeTrustedOrigin('https://Example.COM/')).toBe('https://example.com')
    expect(normalizeTrustedOrigin('https://example.com:443')).toBe('https://example.com')
    expect(normalizeTrustedOrigin('https://example.com:8443')).toBe('https://example.com:8443')
  })

  test.each([
    ['a plain http origin', 'http://example.com'],
    ['a wildcard host', 'https://*.example.com'],
    ['a path', 'https://example.com/docs'],
    ['a query', 'https://example.com?a=1'],
    ['a fragment', 'https://example.com#top'],
    ['credentials', 'https://user:secret@example.com'],
    ['a backslash path', 'https://example.com\\evil.test'],
    ['another scheme', 'file:///etc/passwd'],
    ['a bare host', 'example.com'],
    ['surrounding whitespace', ' https://example.com'],
    ['an empty string', ''],
    ['a non-string', 42],
  ])('rejects %s', (_label, input) => {
    expect(normalizeTrustedOrigin(input)).toBeNull()
  })
})

describe('BrowserTrustStore', () => {
  test('lives under the dreamcoder config directory', () => {
    process.env.DREAMCODER_CONFIG_DIR = dir
    expect(defaultTrustFilePath()).toBe(path.join(dir, 'dreamcoder', 'browser-trust.json'))
  })

  test('adds, lists and removes origins and persists them', async () => {
    const store = newStore()
    expect(await store.list()).toEqual([])
    expect(await store.add('https://example.com/')).toEqual(['https://example.com'])
    expect(await store.add('https://example.com')).toEqual(['https://example.com'])
    expect(await store.add('https://docs.example.org')).toEqual(['https://example.com', 'https://docs.example.org'])

    const fresh = newStore()
    expect(await fresh.list()).toEqual(['https://example.com', 'https://docs.example.org'])
    expect(await fresh.has('https://example.com')).toBe(true)
    expect(await fresh.has('https://sub.example.com')).toBe(false)

    expect(await fresh.remove('https://example.com')).toEqual(['https://docs.example.org'])
    expect(await fresh.remove('https://example.com')).toEqual(['https://docs.example.org'])
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ schemaVersion: 1, origins: ['https://docs.example.org'] })
  })

  test('writes atomically and leaves no temporary file behind', async () => {
    const store = newStore()
    await store.add('https://example.com')
    expect(await fs.readdir(path.dirname(file))).toEqual(['browser-trust.json'])
  })

  test('refuses an origin that is not an exact https origin and writes nothing', async () => {
    const store = newStore()
    await expect(store.add('https://*.example.com')).rejects.toMatchObject({ code: 'invalid_origin' })
    await expect(store.add('https://example.com/path')).rejects.toBeInstanceOf(BrowserTrustError)
    await expect(store.remove('http://example.com')).rejects.toMatchObject({ code: 'invalid_origin' })
    await expect(fs.access(file)).rejects.toThrow()
  })

  test('treats a missing file as an empty list', async () => {
    expect(await newStore().list()).toEqual([])
    expect(await newStore().has('https://example.com')).toBe(false)
  })

  test('treats a corrupt file as empty, keeps a copy of it and recovers on the next write', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '{not json', 'utf-8')
    const store = newStore()
    expect(await store.list()).toEqual([])
    expect(warn).toHaveBeenCalled()
    const files = await fs.readdir(path.dirname(file))
    expect(files.some((name) => name.startsWith('browser-trust.json.invalid-'))).toBe(true)
    expect(await store.add('https://example.com')).toEqual(['https://example.com'])
  })

  test('treats a file of the wrong shape as empty', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ origins: 'https://example.com' }), 'utf-8')
    expect(await newStore().list()).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  test('drops invalid entries from a hand-edited file and keeps the valid ones', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({ origins: ['https://example.com', 'https://*.evil.test', 'http://plain.test', 7, 'https://example.com'] }),
      'utf-8',
    )
    expect(await newStore().list()).toEqual(['https://example.com'])
  })

  test('answers has with false and logs when the file cannot be read', async () => {
    await fs.mkdir(file, { recursive: true })
    expect(await newStore().has('https://example.com')).toBe(false)
    expect(error).toHaveBeenCalled()
  })

  test('keeps every origin when adds run at the same time', async () => {
    const store = newStore()
    await Promise.all(['https://a.test', 'https://b.test', 'https://c.test'].map((origin) => store.add(origin)))
    expect((await store.list()).sort()).toEqual(['https://a.test', 'https://b.test', 'https://c.test'])
  })

  test('refuses to grow past the limit', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const origins = Array.from({ length: 500 }, (_, index) => `https://site${index}.test`)
    await fs.writeFile(file, JSON.stringify({ origins }), 'utf-8')
    await expect(newStore().add('https://one-more.test')).rejects.toMatchObject({ code: 'limit' })
  })

  test('handle dispatches the three operations', async () => {
    const store = newStore()
    expect(await store.handle({ op: 'add', origin: 'https://example.com' })).toEqual(['https://example.com'])
    expect(await store.handle({ op: 'list' })).toEqual(['https://example.com'])
    expect(await store.handle({ op: 'remove', origin: 'https://example.com' })).toEqual([])
    await expect(store.handle({ op: 'add' })).rejects.toMatchObject({ code: 'invalid_origin' })
  })
})

async function resultsReached(desktop: FakeDesktop, count: number) {
  const deadline = Date.now() + 2000
  while (desktop.trustResults.length < count && Date.now() < deadline) await Bun.sleep(1)
}

describe('trust requests over the channel', () => {
  test('the desktop can list, add and remove and gets the origins back', async () => {
    const channel = new BrowserHostChannel()
    const desktop = new FakeDesktop(channel)
    const store = newStore()
    channel.setTrustHandler((request) => store.handle(request))

    desktop.sendTrust('a', 'add', 'https://example.com')
    await resultsReached(desktop, 1)
    desktop.sendTrust('b', 'list')
    await resultsReached(desktop, 2)
    desktop.sendTrust('c', 'remove', 'https://example.com')
    await resultsReached(desktop, 3)

    expect(desktop.trustResults).toEqual([
      { type: 'trust_result', id: 'a', ok: true, origins: ['https://example.com'] },
      { type: 'trust_result', id: 'b', ok: true, origins: ['https://example.com'] },
      { type: 'trust_result', id: 'c', ok: true, origins: [] },
    ])
  })

  test('an invalid origin comes back as an error with its code', async () => {
    const channel = new BrowserHostChannel()
    const desktop = new FakeDesktop(channel)
    const store = newStore()
    channel.setTrustHandler((request) => store.handle(request))

    desktop.sendTrust('a', 'add', 'https://*.example.com')
    await resultsReached(desktop, 1)

    expect(desktop.trustResults).toEqual([
      { type: 'trust_result', id: 'a', ok: false, error: { code: 'invalid_origin', message: expect.stringContaining('exact https origins') } },
    ])
    await expect(fs.access(file)).rejects.toThrow()
  })
})
