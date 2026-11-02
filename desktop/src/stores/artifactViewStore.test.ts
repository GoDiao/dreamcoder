import { beforeEach, describe, expect, it, vi } from 'vitest'

async function freshStore() {
  vi.resetModules()
  return (await import('./artifactViewStore')).useArtifactViewStore
}

describe('artifactViewStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('remembers the artifact being viewed so a restart can show it again', async () => {
    const store = await freshStore()
    store.getState().open({ id: 'id-1', name: 'report', title: 'Report' })

    const restored = await freshStore()
    expect(restored.getState().viewing).toEqual({ id: 'id-1', name: 'report', title: 'Report' })
  })

  it('forgets it when the viewer is closed', async () => {
    const store = await freshStore()
    store.getState().open({ id: 'id-1', name: 'report', title: 'Report' })
    store.getState().close()

    expect(store.getState().viewing).toBeNull()
    expect((await freshStore()).getState().viewing).toBeNull()
  })

  it('ignores stored data of the wrong shape', async () => {
    localStorage.setItem('dreamcoder-artifact-view', JSON.stringify({ id: 5 }))
    expect((await freshStore()).getState().viewing).toBeNull()
    localStorage.setItem('dreamcoder-artifact-view', '{nope')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await freshStore()).getState().viewing).toBeNull()
    warn.mockRestore()
  })

  it('shows the design mode in place of a viewed artifact and back, without remembering it across restarts', async () => {
    const store = await freshStore()
    store.getState().open({ id: 'id-1', name: 'report', title: 'Report' })
    store.getState().openDesign()

    expect(store.getState()).toMatchObject({ viewing: null, designing: true })
    expect((await freshStore()).getState()).toMatchObject({ viewing: null, designing: false })

    store.getState().open({ id: 'id-2', name: 'other', title: 'Other' })
    expect(store.getState()).toMatchObject({ viewing: { id: 'id-2' }, designing: false })

    store.getState().openDesign()
    store.getState().closeDesign()
    expect(store.getState().designing).toBe(false)
  })
})
