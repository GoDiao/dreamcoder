import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ templates: vi.fn() }))

vi.mock('../api/design', () => ({ designApi: { templates: mocks.templates } }))

import { useDesignTemplateStore } from './designTemplateStore'

describe('designTemplateStore', () => {
  afterEach(() => {
    useDesignTemplateStore.setState(useDesignTemplateStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('loads the catalog once and keeps it', async () => {
    mocks.templates.mockResolvedValue({ version: 1, templates: [{ id: 'saas' }] })

    await useDesignTemplateStore.getState().load()
    await useDesignTemplateStore.getState().load()

    expect(mocks.templates).toHaveBeenCalledTimes(1)
    expect(useDesignTemplateStore.getState()).toMatchObject({ items: [{ id: 'saas' }], loaded: true, loading: false, error: null })
  })

  it('does not start a second request while one is running', async () => {
    mocks.templates.mockReturnValue(new Promise(() => {}))

    void useDesignTemplateStore.getState().load()
    await useDesignTemplateStore.getState().load()

    expect(mocks.templates).toHaveBeenCalledTimes(1)
  })

  it('records a failure and tries again on the next load', async () => {
    mocks.templates.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ version: 1, templates: [{ id: 'saas' }] })

    await useDesignTemplateStore.getState().load()
    expect(useDesignTemplateStore.getState()).toMatchObject({ error: 'offline', loaded: false, loading: false })

    await useDesignTemplateStore.getState().load()
    expect(useDesignTemplateStore.getState()).toMatchObject({ error: null, loaded: true })
  })
})
