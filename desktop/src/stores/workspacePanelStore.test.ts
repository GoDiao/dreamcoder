import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type HoistedVi = typeof vi & {
  hoisted?: <T>(factory: () => T) => T
}

if (typeof (vi as HoistedVi).hoisted !== 'function') {
  ;(vi as HoistedVi).hoisted = <T>(factory: () => T) => factory()
}

const mocks = vi.hoisted(() => ({
  closeBrowser: vi.fn(),
  submitBrowserInput: vi.fn(),
  destroyTerminalRuntime: vi.fn(),
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

vi.mock('../lib/browserGuests', () => ({
  closeBrowser: mocks.closeBrowser,
  submitBrowserInput: mocks.submitBrowserInput,
}))

vi.mock('../lib/terminalRuntime', () => ({
  destroyTerminalRuntime: mocks.destroyTerminalRuntime,
}))

import { sessionsApi } from '../api/sessions'
import { ELECTRON_BRIDGE_KEY } from '../lib/shell/electronBridge'
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
    localStorage.clear()
    delete (window as unknown as Record<string, unknown>)[ELECTRON_BRIDGE_KEY]
    vi.restoreAllMocks()
  })

  const okStatus = (changedFiles: Array<{ path: string; status: 'modified'; additions: number; deletions: number }> = []) => ({
    state: 'ok' as const,
    workDir: '/repo',
    repoName: 'repo',
    branch: 'main',
    isGitRepo: true,
    changedFiles,
  })

  const panel = (sessionId: string) => useWorkspacePanelStore.getState().panelBySession[sessionId]
  const kinds = (sessionId: string) => panel(sessionId)?.tabs.map((tab) => tab.kind)

  it('uses hoisted session api mocks', () => {
    expect(sessionsApi.getWorkspaceStatus).toBe(mocks.getWorkspaceStatusMock)
    expect(sessionsApi.getWorkspaceTree).toBe(mocks.getWorkspaceTreeMock)
    expect(sessionsApi.getWorkspaceFile).toBe(mocks.getWorkspaceFileMock)
    expect(sessionsApi.getWorkspaceDiff).toBe(mocks.getWorkspaceDiffMock)
  })

  it('keeps tabs and the open state per session', () => {
    const store = useWorkspacePanelStore.getState()
    expect(store.isPanelOpen('session-a')).toBe(false)
    expect(store.getActiveTab('session-a')).toBeNull()
    expect(store.width).toBe(WORKSPACE_PANEL_DEFAULT_WIDTH)
    expect(WORKSPACE_PANEL_DEFAULT_WIDTH).toBe(380)

    const changes = store.openTab('session-a', { kind: 'changes' })
    store.openTab('session-b', { kind: 'files' })

    expect(useWorkspacePanelStore.getState().isPanelOpen('session-a')).toBe(true)
    expect(useWorkspacePanelStore.getState().getActiveTab('session-a')).toEqual({ id: changes, kind: 'changes' })
    expect(kinds('session-b')).toEqual(['files'])

    store.closePanel('session-a')
    expect(useWorkspacePanelStore.getState().isPanelOpen('session-a')).toBe(false)
    expect(kinds('session-a')).toEqual(['changes'])
  })

  it('reuses the open tab of a list, file or page revision and adds every browser and terminal', () => {
    const store = useWorkspacePanelStore.getState()
    const files = store.openTab('s', { kind: 'files' })
    const file = store.openTab('s', { kind: 'file', path: 'src/a.ts' })
    const page = store.openTab('s', { kind: 'uiPage', pageId: 'p1', revision: 1, title: 'Plan' })

    expect(store.openTab('s', { kind: 'files' })).toBe(files)
    expect(store.openTab('s', { kind: 'file', path: 'src/a.ts' })).toBe(file)
    expect(store.openTab('s', { kind: 'uiPage', pageId: 'p1', revision: 1, title: 'Plan' })).toBe(page)
    expect(store.openTab('s', { kind: 'uiPage', pageId: 'p1', revision: 2, title: 'Plan' })).not.toBe(page)
    store.openTab('s', { kind: 'browser', url: 'https://a.test/' })
    store.openTab('s', { kind: 'browser', url: 'https://a.test/' })
    store.openTab('s', { kind: 'terminal' })
    store.openTab('s', { kind: 'terminal' })

    expect(kinds('s')).toEqual(['files', 'file', 'uiPage', 'uiPage', 'browser', 'browser', 'terminal', 'terminal'])
    expect(panel('s')?.tabs.filter((tab) => tab.kind === 'terminal').map((tab) => tab.kind === 'terminal' && tab.index)).toEqual([1, 2])
    expect(panel('s')?.recentFiles).toEqual(['src/a.ts'])
  })

  it('turns the new tab page into what is opened from it', () => {
    const store = useWorkspacePanelStore.getState()
    const changes = store.openTab('s', { kind: 'changes' })
    const launcher = store.openTab('s', { kind: 'launcher' })
    const file = store.openTab('s', { kind: 'file', path: 'README.md' })
    expect(kinds('s')).toEqual(['changes', 'file'])
    expect(panel('s')?.activeTabId).toBe(file)
    expect(file).not.toBe(launcher)

    store.openTab('s', { kind: 'launcher' })
    expect(store.openTab('s', { kind: 'changes' })).toBe(changes)
    expect(kinds('s')).toEqual(['changes', 'file'])
    expect(panel('s')?.activeTabId).toBe(changes)
  })

  it('closes a tab with what runs in it, shows its neighbour and closes the panel with the last tab', () => {
    const store = useWorkspacePanelStore.getState()
    const browser = store.openTab('s', { kind: 'browser', url: 'https://a.test/' })
    const terminal = store.openTab('s', { kind: 'terminal' })
    const files = store.openTab('s', { kind: 'files' })
    store.activateTab('s', terminal)

    store.closeTab('s', terminal)
    expect(mocks.destroyTerminalRuntime).toHaveBeenCalledWith(terminal)
    expect(panel('s')?.activeTabId).toBe(files)

    store.closeTab('s', files)
    expect(panel('s')?.activeTabId).toBe(browser)
    store.closeTab('s', browser)
    expect(mocks.closeBrowser).toHaveBeenCalledWith(browser)
    expect(useWorkspacePanelStore.getState().isPanelOpen('s')).toBe(false)
    expect(panel('s')?.activeTabId).toBeNull()
  })

  it('opens an empty panel on the changes, or on the files when nothing changed', () => {
    useWorkspacePanelStore.setState({ statusBySession: { clean: okStatus() } })
    const store = useWorkspacePanelStore.getState()

    store.togglePanel('dirty')
    store.togglePanel('clean')
    expect(kinds('dirty')).toEqual(['changes'])
    expect(kinds('clean')).toEqual(['files'])

    store.togglePanel('dirty')
    expect(useWorkspacePanelStore.getState().isPanelOpen('dirty')).toBe(false)
    store.togglePanel('dirty')
    expect(kinds('dirty')).toEqual(['changes'])
  })

  it('records the address, title and shell a tab reports', () => {
    const store = useWorkspacePanelStore.getState()
    const browser = store.openTab('s', { kind: 'browser', url: '' })
    const terminal = store.openTab('s', { kind: 'terminal' })
    store.patchTab('s', browser, { url: 'http://localhost:3000/', title: 'App' })
    store.patchTab('s', terminal, { shell: 'zsh' })

    expect(panel('s')?.tabs).toEqual([
      { id: browser, kind: 'browser', url: 'http://localhost:3000/', title: 'App' },
      { id: terminal, kind: 'terminal', index: 1, shell: 'zsh' },
    ])
    const before = panel('s')
    store.patchTab('s', terminal, { shell: 'zsh' })
    expect(panel('s')).toBe(before)
  })

  it('opens a typed address as a project file, or as a web page in the desktop app', async () => {
    mocks.getWorkspaceFileMock.mockImplementation(async (_sessionId: string, path: string) => (
      path === 'src/a.ts' ? { state: 'ok', path, content: '' } : { state: 'missing', path }
    ))
    mocks.submitBrowserInput.mockResolvedValue(undefined)
    const store = useWorkspacePanelStore.getState()

    await store.openAddress('h5', 'localhost:3000', null)
    expect(useWorkspacePanelStore.getState().getActiveTab('h5')).toMatchObject({ kind: 'file', path: 'localhost:3000' })
    expect(mocks.getWorkspaceFileMock).not.toHaveBeenCalled()

    Object.assign(window, { [ELECTRON_BRIDGE_KEY]: {} })
    await store.openAddress('s', '  src/a.ts ', '/repo')
    expect(useWorkspacePanelStore.getState().getActiveTab('s')).toMatchObject({ kind: 'file', path: 'src/a.ts' })

    await store.openAddress('s', 'localhost:3000', '/repo')
    const browser = useWorkspacePanelStore.getState().getActiveTab('s')
    expect(browser).toMatchObject({ kind: 'browser', url: '' })
    expect(mocks.submitBrowserInput).toHaveBeenCalledWith('s', browser?.id, 'localhost:3000', '/repo')

    await store.openAddress('s', '   ', '/repo')
    expect(kinds('s')).toEqual(['file', 'browser'])
  })

  it('expands and restores the panel and resets expansion on close', () => {
    const store = useWorkspacePanelStore.getState()

    store.openTab('session-a', { kind: 'files' })
    store.toggleExpanded('session-a')
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-a')).toBe(true)
    store.toggleExpanded('session-a')
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-a')).toBe(false)

    store.toggleExpanded('session-a')
    store.closePanel('session-a')
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-a')).toBe(false)
    store.togglePanel('session-a')
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-a')).toBe(false)
  })

  it('saves the tabs of each session without terminals and restores them on the next start', async () => {
    const store = useWorkspacePanelStore.getState()
    const file = store.openTab('s', { kind: 'file', path: 'src/a.ts' })
    const browser = store.openTab('s', { kind: 'browser', url: 'http://localhost:3000/' })
    const terminal = store.openTab('s', { kind: 'terminal' })
    store.openTab('closed', { kind: 'changes' })
    store.closePanel('closed')
    expect(panel('s')?.activeTabId).toBe(terminal)

    vi.resetModules()
    const restarted = await import('./workspacePanelStore')
    const restored = restarted.useWorkspacePanelStore.getState().panelBySession

    expect(restored.s).toEqual({
      isOpen: true,
      expanded: false,
      tabs: [
        { id: file, kind: 'file', path: 'src/a.ts' },
        { id: browser, kind: 'browser', url: 'http://localhost:3000/', title: '' },
      ],
      activeTabId: browser,
      recentFiles: ['src/a.ts'],
    })
    expect(restored.closed?.isOpen).toBe(false)
  })

  it('ignores saved tabs it cannot read', async () => {
    localStorage.setItem('dreamcoder-workspace-panels', JSON.stringify({
      s: { isOpen: true, tabs: [{ id: 't1', kind: 'terminal', index: 1 }, { id: 'x', kind: 'file' }, { kind: 'files' }], activeTabId: 't1' },
      t: 'nonsense',
    }))
    vi.resetModules()
    const restarted = await import('./workspacePanelStore')

    expect(restarted.useWorkspacePanelStore.getState().panelBySession).toEqual({
      s: { isOpen: false, expanded: false, tabs: [], activeTabId: null, recentFiles: [] },
    })

    localStorage.setItem('dreamcoder-workspace-panels', '{')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()
    const broken = await import('./workspacePanelStore')
    expect(broken.useWorkspacePanelStore.getState().panelBySession).toEqual({})
    expect(warn).toHaveBeenCalledWith('[workspace] Failed to restore side panel tabs', expect.any(SyntaxError))
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

  it('refreshes the previews of open file tabs with the expanded diffs', async () => {
    mocks.getWorkspaceFileMock.mockResolvedValueOnce({ state: 'ok', path: 'a.ts', content: 'v1' })
    const store = useWorkspacePanelStore.getState()
    store.openTab('s', { kind: 'file', path: 'a.ts' })
    await store.ensurePreview('s', 'a.ts', 'file')
    await store.ensurePreview('s', 'a.ts', 'file')
    expect(mocks.getWorkspaceFileMock).toHaveBeenCalledTimes(1)

    mocks.getWorkspaceFileMock.mockResolvedValueOnce({ state: 'ok', path: 'a.ts', content: 'v2' })
    await store.refreshPreviews('s')
    expect(useWorkspacePanelStore.getState().previewsBySession.s?.['file:a.ts']?.content).toBe('v2')
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

  it('drops the cached data of a released session but keeps its tabs, except terminals', () => {
    const store = useWorkspacePanelStore.getState()
    const file = store.openTab('s', { kind: 'file', path: 'src/a.ts' })
    const browser = store.openTab('s', { kind: 'browser', url: 'https://a.test/' })
    const terminal = store.openTab('s', { kind: 'terminal' })
    store.openTab('other', { kind: 'changes' })
    useWorkspacePanelStore.setState((state) => ({
      statusBySession: { s: okStatus(), other: okStatus() },
      expandedPathsBySession: { s: ['src'] },
      treeBySessionPath: { s: { src: { state: 'ok', path: 'src', entries: [] } } },
      previewsBySession: { s: { 'file:src/a.ts': { id: 'file:src/a.ts', path: 'src/a.ts', kind: 'file', title: 'a.ts' } } },
      expandedPreviewIdsBySession: { s: ['diff:src/a.ts'] },
      loading: { ...state.loading, treeBySessionPath: { 's::src': true }, previewById: { 's::file:src/a.ts': true } },
      errors: { ...state.errors, statusBySession: { s: 'bad' }, treeBySessionPath: { 's::src': 'bad' } },
    }))

    store.releaseSession('s')

    const state = useWorkspacePanelStore.getState()
    expect(mocks.destroyTerminalRuntime).toHaveBeenCalledWith(terminal)
    expect(mocks.closeBrowser).toHaveBeenCalledWith(browser)
    expect(state.panelBySession.s).toMatchObject({
      isOpen: true,
      tabs: [{ id: file, kind: 'file', path: 'src/a.ts' }, { id: browser, kind: 'browser' }],
      activeTabId: browser,
    })
    expect(state.statusBySession).toEqual({ other: okStatus() })
    expect(state.expandedPathsBySession.s).toBeUndefined()
    expect(state.treeBySessionPath.s).toBeUndefined()
    expect(state.previewsBySession.s).toBeUndefined()
    expect(state.expandedPreviewIdsBySession.s).toBeUndefined()
    expect(state.loading.treeBySessionPath).toEqual({})
    expect(state.loading.previewById).toEqual({})
    expect(state.errors.statusBySession).toEqual({})
    expect(state.errors.treeBySessionPath).toEqual({})
    expect(kinds('other')).toEqual(['changes'])
  })

  it('forgets the tabs of a deleted session', () => {
    const store = useWorkspacePanelStore.getState()
    const browser = store.openTab('s', { kind: 'browser', url: 'https://a.test/' })
    store.openTab('other', { kind: 'changes' })

    store.clearSession('s')

    expect(mocks.closeBrowser).toHaveBeenCalledWith(browser)
    expect(useWorkspacePanelStore.getState().panelBySession.s).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('dreamcoder-workspace-panels') ?? '{}')).not.toHaveProperty('s')
    expect(kinds('other')).toEqual(['changes'])
  })
})
