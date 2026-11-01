import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactListItem } from '../types/artifact'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('../api/artifacts', () => ({ artifactsApi: { list: mocks.list } }))

const item = (name: string): ArtifactListItem => ({
  name,
  artifactsDir: '/repo/dc_artifacts',
  dir: `/repo/dc_artifacts/${name}`,
  workDir: '/repo',
  projectRoot: '/repo',
  branch: null,
  id: `id-${name}`,
  lastOpenedAt: null,
  entryMissing: false,
  thumbnailMtimeMs: null,
  origin: null,
  sessions: [],
  manifest: { version: 1, id: `id-${name}`, kind: 'page', title: name, entry: 'index.html' },
  error: null,
  latestMtimeMs: 1,
})

async function freshStore() {
  vi.resetModules()
  return (await import('./artifactListStore')).useArtifactListStore
}

describe('artifactListStore', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.list.mockReset()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('starts from the cached list so the page can show something at once', async () => {
    localStorage.setItem('dreamcoder-artifacts-cache', JSON.stringify([item('cached')]))
    const store = await freshStore()
    expect(store.getState().items.map((entry) => entry.name)).toEqual(['cached'])
  })

  it('replaces the cache with a fresh list', async () => {
    localStorage.setItem('dreamcoder-artifacts-cache', JSON.stringify([item('cached')]))
    mocks.list.mockResolvedValue({ artifacts: [item('fresh')] })
    const store = await freshStore()

    await store.getState().load()

    expect(store.getState().items.map((entry) => entry.name)).toEqual(['fresh'])
    expect(store.getState().loading).toBe(false)
    expect(JSON.parse(localStorage.getItem('dreamcoder-artifacts-cache')!)).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('dreamcoder-artifacts-cache')!)[0].name).toBe('fresh')
  })

  it('keeps showing the cached list and reports the error when the server fails', async () => {
    localStorage.setItem('dreamcoder-artifacts-cache', JSON.stringify([item('cached')]))
    mocks.list.mockRejectedValue(new Error('offline'))
    const store = await freshStore()

    await store.getState().load()

    expect(store.getState().items.map((entry) => entry.name)).toEqual(['cached'])
    expect(store.getState().error).toBe('offline')
    expect(store.getState().loading).toBe(false)
  })

  it('ignores a corrupted cache', async () => {
    localStorage.setItem('dreamcoder-artifacts-cache', '{nope')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = await freshStore()
    expect(store.getState().items).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('lets only the latest request win', async () => {
    let resolveFirst!: (value: { artifacts: ArtifactListItem[] }) => void
    mocks.list
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ artifacts: [item('second')] })
    const store = await freshStore()

    const first = store.getState().load()
    await store.getState().load()
    resolveFirst({ artifacts: [item('first')] })
    await first

    expect(store.getState().items.map((entry) => entry.name)).toEqual(['second'])
  })
})
