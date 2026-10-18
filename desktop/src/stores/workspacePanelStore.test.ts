import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type HoistedVi = typeof vi & {
  hoisted?: <T>(factory: () => T) => T
}

if (typeof (vi as HoistedVi).hoisted !== 'function') {
  ;(vi as HoistedVi).hoisted = <T>(factory: () => T) => factory()
}

const mocks = vi.hoisted(() => ({
  getWorkspaceStatusMock: vi.fn(),
  getWorkspaceTreeMock: vi.fn(),
  getWorkspaceFileMock: vi.fn(),
  getWorkspaceDiffMock: vi.fn(),
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    getWorkspaceStatus: mocks.getWorkspaceStatusMock,
    getWorkspaceTree: mocks.getWorkspaceTreeMock,
    getWorkspaceFile: mocks.getWorkspaceFileMock,
    getWorkspaceDiff: mocks.getWorkspaceDiffMock,
  },
}))

import { sessionsApi } from '../api/sessions'
import {
  WORKSPACE_PANEL_DEFAULT_WIDTH,
  WORKSPACE_PANEL_MAX_WIDTH,
  WORKSPACE_PANEL_MIN_WIDTH,
  getWorkspacePreviewId,
  useWorkspacePanelStore,
} from './workspacePanelStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('workspacePanelStore', () => {
  const initialState = useWorkspacePanelStore.getInitialState()

  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspacePanelStore.setState(initialState, true)
  })

  afterEach(() => {
    useWorkspacePanelStore.setState(initialState, true)
    vi.restoreAllMocks()
  })

  it('uses hoisted session api mocks', () => {
    expect(sessionsApi.getWorkspaceStatus).toBe(mocks.getWorkspaceStatusMock)
    expect(sessionsApi.getWorkspaceTree).toBe(mocks.getWorkspaceTreeMock)
    expect(sessionsApi.getWorkspaceFile).toBe(mocks.getWorkspaceFileMock)
    expect(sessionsApi.getWorkspaceDiff).toBe(mocks.getWorkspaceDiffMock)
  })

  it('keeps panel open state, tab and active view isolated per session', () => {
    const store = useWorkspacePanelStore.getState()

    expect(store.isPanelOpen('session-a')).toBe(false)
    expect(store.getPanelTab('session-a')).toBe('files')
    expect(store.getActiveView('session-a')).toBe('changed')
    expect(store.width).toBe(WORKSPACE_PANEL_DEFAULT_WIDTH)
    expect(WORKSPACE_PANEL_DEFAULT_WIDTH).toBe(380)

    store.openPanel('session-a')
    store.setActiveView('session-a', 'all')

    expect(useWorkspacePanelStore.getState().isPanelOpen('session-a')).toBe(true)
    expect(useWorkspacePanelStore.getState().getActiveView('session-a')).toBe('all')
    expect(useWorkspacePanelStore.getState().isPanelOpen('session-b')).toBe(false)
    expect(useWorkspacePanelStore.getState().getActiveView('session-b')).toBe('changed')

    store.togglePanel('session-b', 'terminal')
    expect(useWorkspacePanelStore.getState().isPanelOpen('session-b')).toBe(true)
    expect(useWorkspacePanelStore.getState().getPanelTab('session-b')).toBe('terminal')
    expect(useWorkspacePanelStore.getState().getPanelTab('session-a')).toBe('files')

    store.closePanel('session-a')
    expect(useWorkspacePanelStore.getState().isPanelOpen('session-a')).toBe(false)
    expect(useWorkspacePanelStore.getState().getActiveView('session-a')).toBe('all')
  })

  it('switches tabs when the other tab button is pressed and closes on the showing tab', () => {
    const store = useWorkspacePanelStore.getState()

    store.togglePanel('session-a', 'files')
    expect(useWorkspacePanelStore.getState().isPanelOpen('session-a')).toBe(true)
    expect(useWorkspacePanelStore.getState().getPanelTab('session-a')).toBe('files')

    store.togglePanel('session-a', 'terminal')
    expect(useWorkspacePanelStore.getState().isPanelOpen('session-a')).toBe(true)
    expect(useWorkspacePanelStore.getState().getPanelTab('session-a')).toBe('terminal')

    store.togglePanel('session-a', 'terminal')
    expect(useWorkspacePanelStore.getState().isPanelOpen('session-a')).toBe(false)

    store.setPanelTab('session-a', 'files')
    store.openPanel('session-a')
    expect(useWorkspacePanelStore.getState().getPanelTab('session-a')).toBe('files')
  })

  it('expands and restores the panel and resets expansion on close', () => {
    const store = useWorkspacePanelStore.getState()

    store.openPanel('session-a', 'files')
    store.toggleExpanded('session-a')
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-a')).toBe(true)
    store.toggleExpanded('session-a')
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-a')).toBe(false)

    store.toggleExpanded('session-a')
    store.closePanel('session-a')
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-a')).toBe(false)
    store.openPanel('session-a')
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-a')).toBe(false)
  })

  it('clamps the panel width to 280-680', () => {
    const store = useWorkspacePanelStore.getState()
    store.setWidth(120)
    expect(useWorkspacePanelStore.getState().width).toBe(WORKSPACE_PANEL_MIN_WIDTH)
    expect(WORKSPACE_PANEL_MIN_WIDTH).toBe(280)
    store.setWidth(1200)
    expect(useWorkspacePanelStore.getState().width).toBe(WORKSPACE_PANEL_MAX_WIDTH)
    expect(WORKSPACE_PANEL_MAX_WIDTH).toBe(680)
    store.setWidth(Number.NaN)
    expect(useWorkspacePanelStore.getState().width).toBe(WORKSPACE_PANEL_DEFAULT_WIDTH)
  })

  it('loads workspace status successfully', async () => {
    mocks.getWorkspaceStatusMock.mockResolvedValue({
      state: 'ok',
      workDir: '/repo',
      repoName: 'repo',
      branch: 'main',
      isGitRepo: true,
      changedFiles: [
        {
          path: 'src/a.ts',
          status: 'modified',
          additions: 3,
          deletions: 1,
        },
      ],
    })

    await useWorkspacePanelStore.getState().loadStatus('session-1')

    expect(mocks.getWorkspaceStatusMock).toHaveBeenCalledWith('session-1')
    expect(useWorkspacePanelStore.getState().statusBySession['session-1']).toMatchObject({
      branch: 'main',
      changedFiles: [{ path: 'src/a.ts' }],
    })
    expect(useWorkspacePanelStore.getState().loading.statusBySession['session-1']).toBe(false)
    expect(useWorkspacePanelStore.getState().errors.statusBySession['session-1']).toBeNull()
  })

  it('defaults an empty changed-files status to the all-files view', async () => {
    mocks.getWorkspaceStatusMock.mockResolvedValue({
      state: 'ok',
      workDir: '/repo',
      repoName: 'repo',
      branch: 'main',
      isGitRepo: true,
      changedFiles: [],
    })

    useWorkspacePanelStore.getState().openPanel('session-empty-changes')
    expect(useWorkspacePanelStore.getState().getActiveView('session-empty-changes')).toBe('changed')

    await useWorkspacePanelStore.getState().loadStatus('session-empty-changes')

    expect(useWorkspacePanelStore.getState().statusBySession['session-empty-changes']?.changedFiles).toEqual([])
    expect(useWorkspacePanelStore.getState().getActiveView('session-empty-changes')).toBe('all')
  })

  it('keeps the changed-files view when status contains changes', async () => {
    mocks.getWorkspaceStatusMock.mockResolvedValue({
      state: 'ok',
      workDir: '/repo',
      repoName: 'repo',
      branch: 'main',
      isGitRepo: true,
      changedFiles: [
        {
          path: 'src/app.ts',
          status: 'modified',
          additions: 2,
          deletions: 1,
        },
      ],
    })

    useWorkspacePanelStore.getState().openPanel('session-has-changes')
    await useWorkspacePanelStore.getState().loadStatus('session-has-changes')

    expect(useWorkspacePanelStore.getState().getActiveView('session-has-changes')).toBe('changed')
  })

  it('returns to changed-files when a refreshed default all-files view now has changes', async () => {
    mocks.getWorkspaceStatusMock
      .mockResolvedValueOnce({
        state: 'ok',
        workDir: '/repo',
        repoName: 'repo',
        branch: 'main',
        isGitRepo: true,
        changedFiles: [],
      })
      .mockResolvedValueOnce({
        state: 'ok',
        workDir: '/repo',
        repoName: 'repo',
        branch: 'main',
        isGitRepo: true,
        changedFiles: [
          {
            path: 'src/app.ts',
            status: 'modified',
            additions: 2,
            deletions: 1,
          },
        ],
      })

    useWorkspacePanelStore.getState().openPanel('session-refresh-changes')
    await useWorkspacePanelStore.getState().loadStatus('session-refresh-changes')
    expect(useWorkspacePanelStore.getState().getActiveView('session-refresh-changes')).toBe('all')

    await useWorkspacePanelStore.getState().loadStatus('session-refresh-changes')

    expect(useWorkspacePanelStore.getState().getActiveView('session-refresh-changes')).toBe('changed')
  })

  it('does not override an explicit all-files selection when refreshed status has changes', async () => {
    mocks.getWorkspaceStatusMock.mockResolvedValue({
      state: 'ok',
      workDir: '/repo',
      repoName: 'repo',
      branch: 'main',
      isGitRepo: true,
      changedFiles: [
        {
          path: 'src/app.ts',
          status: 'modified',
          additions: 2,
          deletions: 1,
        },
      ],
    })

    useWorkspacePanelStore.getState().openPanel('session-explicit-all')
    useWorkspacePanelStore.getState().setActiveView('session-explicit-all', 'all')
    await useWorkspacePanelStore.getState().loadStatus('session-explicit-all')

    expect(useWorkspacePanelStore.getState().getActiveView('session-explicit-all')).toBe('all')
  })

  it('does not override an explicit changed-files selection when status is empty', async () => {
    mocks.getWorkspaceStatusMock.mockResolvedValue({
      state: 'ok',
      workDir: '/repo',
      repoName: 'repo',
      branch: 'main',
      isGitRepo: true,
      changedFiles: [],
    })

    useWorkspacePanelStore.getState().openPanel('session-explicit-changed')
    useWorkspacePanelStore.getState().setActiveView('session-explicit-changed', 'changed')
    await useWorkspacePanelStore.getState().loadStatus('session-explicit-changed')

    expect(useWorkspacePanelStore.getState().getActiveView('session-explicit-changed')).toBe('changed')
  })

  it('captures workspace status request errors', async () => {
    mocks.getWorkspaceStatusMock.mockRejectedValue(new Error('status failed'))

    await useWorkspacePanelStore.getState().loadStatus('session-err')

    expect(useWorkspacePanelStore.getState().statusBySession['session-err']).toBeUndefined()
    expect(useWorkspacePanelStore.getState().loading.statusBySession['session-err']).toBe(false)
    expect(useWorkspacePanelStore.getState().errors.statusBySession['session-err']).toBe('status failed')
  })

  it('lazily loads tree nodes when expanding and reuses cached results', async () => {
    mocks.getWorkspaceTreeMock.mockResolvedValue({
      state: 'ok',
      path: '',
      entries: [
        { name: 'src', path: 'src', isDirectory: true },
        { name: 'README.md', path: 'README.md', isDirectory: false },
      ],
    })

    await useWorkspacePanelStore.getState().toggleTreeNode('session-tree', '')

    expect(mocks.getWorkspaceTreeMock).toHaveBeenCalledTimes(1)
    expect(mocks.getWorkspaceTreeMock).toHaveBeenCalledWith('session-tree', '')
    expect(useWorkspacePanelStore.getState().expandedPathsBySession['session-tree']).toEqual([''])
    expect(useWorkspacePanelStore.getState().treeBySessionPath['session-tree']?.['']).toMatchObject({
      entries: [{ path: 'src' }, { path: 'README.md' }],
    })

    await useWorkspacePanelStore.getState().toggleTreeNode('session-tree', '')
    expect(useWorkspacePanelStore.getState().expandedPathsBySession['session-tree']).toEqual([])

    await useWorkspacePanelStore.getState().toggleTreeNode('session-tree', '')
    expect(mocks.getWorkspaceTreeMock).toHaveBeenCalledTimes(1)
    expect(useWorkspacePanelStore.getState().expandedPathsBySession['session-tree']).toEqual([''])
  })

  it('ignores stale tree responses for the same session path', async () => {
    const first = deferred<{ state: 'ok'; path: string; entries: Array<{ name: string; path: string; isDirectory: boolean }> }>()
    const second = deferred<{ state: 'ok'; path: string; entries: Array<{ name: string; path: string; isDirectory: boolean }> }>()

    mocks.getWorkspaceTreeMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const firstLoad = useWorkspacePanelStore.getState().loadTree('session-tree-race', 'src')
    const secondLoad = useWorkspacePanelStore.getState().loadTree('session-tree-race', 'src')

    second.resolve({
      state: 'ok',
      path: 'src',
      entries: [{ name: 'new.ts', path: 'src/new.ts', isDirectory: false }],
    })
    await secondLoad

    first.resolve({
      state: 'ok',
      path: 'src',
      entries: [{ name: 'old.ts', path: 'src/old.ts', isDirectory: false }],
    })
    await firstLoad

    expect(useWorkspacePanelStore.getState().treeBySessionPath['session-tree-race']?.src?.entries).toEqual([
      { name: 'new.ts', path: 'src/new.ts', isDirectory: false },
    ])
  })

  it('expands previews inline, caches them per path and kind, and fetches lazily', async () => {
    const storage = typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
    const setItemSpy = storage ? vi.spyOn(storage, 'setItem') : null

    mocks.getWorkspaceFileMock.mockResolvedValue({
      state: 'ok',
      path: 'src/a.ts',
      content: 'export const a = 1',
      language: 'typescript',
      size: 18,
    })
    mocks.getWorkspaceDiffMock.mockResolvedValue({
      state: 'ok',
      path: 'src/a.ts',
      diff: '@@ -1 +1 @@',
    })

    const store = useWorkspacePanelStore.getState()
    await store.expandPreview('session-preview', 'src/a.ts', 'file')
    await store.expandPreview('session-preview', 'src/a.ts', 'diff')
    await store.togglePreview('session-preview', 'src/a.ts', 'file')
    await store.togglePreview('session-preview', 'src/a.ts', 'file')

    expect(mocks.getWorkspaceFileMock).toHaveBeenCalledTimes(1)
    expect(mocks.getWorkspaceDiffMock).toHaveBeenCalledTimes(1)
    expect(useWorkspacePanelStore.getState().expandedPreviewIdsBySession['session-preview']).toEqual([
      'diff:src/a.ts',
      'file:src/a.ts',
    ])
    expect(useWorkspacePanelStore.getState().previewsBySession['session-preview']).toMatchObject({
      'file:src/a.ts': { kind: 'file', content: 'export const a = 1', state: 'ok' },
      'diff:src/a.ts': { kind: 'diff', diff: '@@ -1 +1 @@', state: 'ok' },
    })
    expect(getWorkspacePreviewId('src/a.ts', 'diff')).toBe('diff:src/a.ts')
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('keeps the cache when collapsing and allows several files open at once', async () => {
    mocks.getWorkspaceDiffMock.mockImplementation(async (_sessionId: string, path: string) => ({
      state: 'ok',
      path,
      diff: `diff for ${path}`,
    }))

    const store = useWorkspacePanelStore.getState()
    await store.expandPreview('session-many', 'a.ts', 'diff')
    await store.expandPreview('session-many', 'b.ts', 'diff')
    expect(useWorkspacePanelStore.getState().expandedPreviewIdsBySession['session-many']).toEqual([
      'diff:a.ts',
      'diff:b.ts',
    ])

    store.collapsePreview('session-many', 'a.ts', 'diff')
    expect(useWorkspacePanelStore.getState().expandedPreviewIdsBySession['session-many']).toEqual(['diff:b.ts'])
    expect(useWorkspacePanelStore.getState().previewsBySession['session-many']?.['diff:a.ts']?.diff).toBe('diff for a.ts')

    await store.expandPreview('session-many', 'a.ts', 'diff')
    expect(mocks.getWorkspaceDiffMock).toHaveBeenCalledTimes(2)
  })

  it('refreshes expanded previews and drops collapsed cache entries', async () => {
    let version = 1
    mocks.getWorkspaceDiffMock.mockImplementation(async (_sessionId: string, path: string) => ({
      state: 'ok',
      path,
      diff: `${path} v${version}`,
    }))

    const store = useWorkspacePanelStore.getState()
    await store.expandPreview('session-refresh', 'a.ts', 'diff')
    await store.expandPreview('session-refresh', 'b.ts', 'diff')
    store.collapsePreview('session-refresh', 'b.ts', 'diff')

    version = 2
    await store.refreshPreviews('session-refresh')

    const previews = useWorkspacePanelStore.getState().previewsBySession['session-refresh']
    expect(previews?.['diff:a.ts']?.diff).toBe('a.ts v2')
    expect(previews?.['diff:b.ts']).toBeUndefined()
  })

  it('keeps loaded previews visible without a loading state while they refresh', async () => {
    mocks.getWorkspaceDiffMock.mockResolvedValueOnce({ state: 'ok', path: 'a.ts', diff: 'v1' })
    const store = useWorkspacePanelStore.getState()
    await store.expandPreview('session-swr', 'a.ts', 'diff')

    const next = deferred<{ state: 'ok'; path: string; diff: string }>()
    mocks.getWorkspaceDiffMock.mockReturnValueOnce(next.promise)
    const refresh = store.refreshPreviews('session-swr')

    expect(useWorkspacePanelStore.getState().previewsBySession['session-swr']?.['diff:a.ts']).toMatchObject({
      state: 'ok',
      diff: 'v1',
    })
    expect(useWorkspacePanelStore.getState().loading.previewById['session-swr::diff:a.ts']).toBeFalsy()

    next.resolve({ state: 'ok', path: 'a.ts', diff: 'v2' })
    await refresh
    expect(useWorkspacePanelStore.getState().previewsBySession['session-swr']?.['diff:a.ts']?.diff).toBe('v2')
  })

  it('retries a preview that failed when it is expanded again', async () => {
    mocks.getWorkspaceDiffMock
      .mockRejectedValueOnce(new Error('diff failed'))
      .mockResolvedValueOnce({ state: 'ok', path: 'a.ts', diff: 'ok' })

    const store = useWorkspacePanelStore.getState()
    await store.expandPreview('session-retry', 'a.ts', 'diff')
    expect(useWorkspacePanelStore.getState().previewsBySession['session-retry']?.['diff:a.ts']).toMatchObject({
      state: 'error',
      error: 'diff failed',
    })
    expect(useWorkspacePanelStore.getState().errors.previewById['session-retry::diff:a.ts']).toBe('diff failed')

    store.collapsePreview('session-retry', 'a.ts', 'diff')
    await store.expandPreview('session-retry', 'a.ts', 'diff')
    expect(useWorkspacePanelStore.getState().previewsBySession['session-retry']?.['diff:a.ts']?.diff).toBe('ok')
  })

  it('ignores stale status responses for the same session', async () => {
    const first = deferred<{
      state: 'ok'
      workDir: string
      repoName: string | null
      branch: string | null
      isGitRepo: boolean
      changedFiles: []
      error?: string
    }>()
    const second = deferred<{
      state: 'ok'
      workDir: string
      repoName: string | null
      branch: string | null
      isGitRepo: boolean
      changedFiles: []
      error?: string
    }>()

    mocks.getWorkspaceStatusMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const firstLoad = useWorkspacePanelStore.getState().loadStatus('session-race')
    const secondLoad = useWorkspacePanelStore.getState().loadStatus('session-race')

    second.resolve({
      state: 'ok',
      workDir: '/repo',
      repoName: 'repo',
      branch: 'new',
      isGitRepo: true,
      changedFiles: [],
    })
    await secondLoad

    first.resolve({
      state: 'ok',
      workDir: '/repo',
      repoName: 'repo',
      branch: 'old',
      isGitRepo: true,
      changedFiles: [],
    })
    await firstLoad

    expect(useWorkspacePanelStore.getState().statusBySession['session-race']?.branch).toBe('new')
  })

  it('ignores stale preview responses when the cache is refreshed mid-flight', async () => {
    const first = deferred<{ state: 'ok'; path: string; diff: string }>()
    mocks.getWorkspaceDiffMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ state: 'ok', path: 'a.ts', diff: 'fresh' })

    const store = useWorkspacePanelStore.getState()
    const firstExpand = store.expandPreview('session-preview-race', 'a.ts', 'diff')
    await Promise.resolve()
    await store.refreshPreviews('session-preview-race')
    first.resolve({ state: 'ok', path: 'a.ts', diff: 'stale' })
    await firstExpand

    expect(useWorkspacePanelStore.getState().previewsBySession['session-preview-race']?.['diff:a.ts']?.diff).toBe('fresh')
  })

  it('clears session UI and cached data for clearSession and resetSessionUi', () => {
    useWorkspacePanelStore.setState((state) => ({
      ...state,
      panelBySession: {
        'session-clear': { isOpen: true, tab: 'files', expanded: false, activeView: 'all' },
        'session-reset': { isOpen: true, tab: 'terminal', expanded: true, activeView: 'all' },
      },
      statusBySession: {
        'session-clear': {
          state: 'ok',
          workDir: '/repo',
          repoName: 'repo',
          branch: 'main',
          isGitRepo: true,
          changedFiles: [],
        },
        'session-reset': {
          state: 'ok',
          workDir: '/repo',
          repoName: 'repo',
          branch: 'main',
          isGitRepo: true,
          changedFiles: [],
        },
      },
      expandedPathsBySession: {
        'session-clear': ['src'],
        'session-reset': ['src'],
      },
      treeBySessionPath: {
        'session-clear': {
          src: { state: 'ok', path: 'src', entries: [] },
        },
        'session-reset': {
          src: { state: 'ok', path: 'src', entries: [] },
        },
      },
      previewsBySession: {
        'session-clear': {
          'file:src/a.ts': { id: 'file:src/a.ts', path: 'src/a.ts', kind: 'file', title: 'a.ts' },
        },
        'session-reset': {
          'file:src/b.ts': { id: 'file:src/b.ts', path: 'src/b.ts', kind: 'file', title: 'b.ts' },
        },
      },
      expandedPreviewIdsBySession: {
        'session-clear': ['file:src/a.ts'],
        'session-reset': ['file:src/b.ts'],
      },
      loading: {
        statusBySession: {
          'session-clear': true,
          'session-reset': true,
        },
        treeBySessionPath: {
          'session-clear::src': true,
          'session-reset::src': true,
        },
        previewById: {
          'session-clear::file:src/a.ts': true,
          'session-reset::file:src/b.ts': true,
        },
      },
      errors: {
        statusBySession: {
          'session-clear': 'bad',
          'session-reset': 'bad',
        },
        treeBySessionPath: {
          'session-clear::src': 'bad',
          'session-reset::src': 'bad',
        },
        previewById: {
          'session-clear::file:src/a.ts': 'bad',
          'session-reset::file:src/b.ts': 'bad',
        },
      },
    }))

    useWorkspacePanelStore.getState().clearSession('session-clear')
    useWorkspacePanelStore.getState().resetSessionUi('session-reset')

    const state = useWorkspacePanelStore.getState()
    expect(state.panelBySession['session-clear']).toBeUndefined()
    expect(state.panelBySession['session-reset']).toBeUndefined()
    expect(state.statusBySession['session-clear']).toBeUndefined()
    expect(state.statusBySession['session-reset']).toBeUndefined()
    expect(state.expandedPathsBySession['session-clear']).toBeUndefined()
    expect(state.expandedPathsBySession['session-reset']).toBeUndefined()
    expect(state.treeBySessionPath['session-clear']).toBeUndefined()
    expect(state.treeBySessionPath['session-reset']).toBeUndefined()
    expect(state.previewsBySession['session-clear']).toBeUndefined()
    expect(state.previewsBySession['session-reset']).toBeUndefined()
    expect(state.expandedPreviewIdsBySession['session-clear']).toBeUndefined()
    expect(state.expandedPreviewIdsBySession['session-reset']).toBeUndefined()
    expect(state.loading.statusBySession['session-clear']).toBeUndefined()
    expect(state.loading.statusBySession['session-reset']).toBeUndefined()
    expect(state.loading.treeBySessionPath['session-clear::src']).toBeUndefined()
    expect(state.loading.treeBySessionPath['session-reset::src']).toBeUndefined()
    expect(state.loading.previewById['session-clear::file:src/a.ts']).toBeUndefined()
    expect(state.loading.previewById['session-reset::file:src/b.ts']).toBeUndefined()
    expect(state.errors.statusBySession['session-clear']).toBeUndefined()
    expect(state.errors.statusBySession['session-reset']).toBeUndefined()
    expect(state.errors.treeBySessionPath['session-clear::src']).toBeUndefined()
    expect(state.errors.treeBySessionPath['session-reset::src']).toBeUndefined()
    expect(state.errors.previewById['session-clear::file:src/a.ts']).toBeUndefined()
    expect(state.errors.previewById['session-reset::file:src/b.ts']).toBeUndefined()
  })
})
