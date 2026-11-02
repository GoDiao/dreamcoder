import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ systemCatalog: vi.fn() }))

vi.mock('../api/design', () => ({ designApi: { systemCatalog: mocks.systemCatalog } }))

import { useDesignSystemStore } from './designSystemStore'

describe('designSystemStore', () => {
  afterEach(() => {
    useDesignSystemStore.setState(useDesignSystemStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('loads the library once and keeps its systems', async () => {
    mocks.systemCatalog.mockResolvedValue({ version: 1, systems: [{ id: 'paper' }] })

    await useDesignSystemStore.getState().load()
    await useDesignSystemStore.getState().load()

    expect(mocks.systemCatalog).toHaveBeenCalledTimes(1)
    expect(useDesignSystemStore.getState()).toMatchObject({ items: [{ id: 'paper' }], loaded: true, loading: false, error: null })
  })

  it('records a failure and tries again on the next load', async () => {
    mocks.systemCatalog.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ version: 1, systems: [{ id: 'paper' }] })

    await useDesignSystemStore.getState().load()
    expect(useDesignSystemStore.getState()).toMatchObject({ error: 'offline', loaded: false })

    await useDesignSystemStore.getState().load()
    expect(useDesignSystemStore.getState()).toMatchObject({ error: null, loaded: true })
  })
})
