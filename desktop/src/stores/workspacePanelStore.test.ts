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
  openArtifactMock: vi.fn(),
  previewTemplateMock: vi.fn(),
  listSideChatsMock: vi.fn(),
  branchMock: vi.fn(),
  deleteMock: vi.fn(),
  disconnectSession: vi.fn(),
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    getWorkspaceStatus: mocks.getWorkspaceStatusMock,
    getWorkspaceTree: mocks.getWorkspaceTreeMock,
    getWorkspaceFile: mocks.getWorkspaceFileMock,
    getWorkspaceDiff: mocks.getWorkspaceDiffMock,
    listSideChats: mocks.listSideChatsMock,
    branch: mocks.branchMock,
    delete: mocks.deleteMock,
  },
}))

vi.mock('./chatStore', () => ({
  useChatStore: { getState: () => ({ disconnectSession: mocks.disconnectSession }) },
}))

vi.mock('../api/artifacts', () => ({
  artifactsApi: { open: mocks.openArtifactMock },
}))

vi.mock('../api/design', () => ({
  designApi: { preview: mocks.previewTemplateMock },
}))

vi.mock('../lib/browserGuests', () => ({
  closeBrowser: mocks.closeBrowser,
  submitBrowserInput: mocks.submitBrowserInput,
}))

vi.mock('../lib/terminalRuntime', () => ({
  destroyTerminalRuntime: mocks.destroyTerminalRuntime,
}))

import { sessionsApi } from '../api/sessions'
import { useSessionStore } from './sessionStore'
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

  const panel = (sessionId: string) => useWorkspacePanelStore.getState().panelByTab[sessionId]
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

  it('opens an empty panel on the new tab page whether or not anything changed', () => {
    useWorkspacePanelStore.setState({ statusBySession: { clean: okStatus() } })
    const store = useWorkspacePanelStore.getState()

    store.togglePanel('dirty')
    store.togglePanel('clean')
    expect(kinds('dirty')).toEqual(['launcher'])
    expect(kinds('clean')).toEqual(['launcher'])

    store.togglePanel('dirty')
    expect(useWorkspacePanelStore.getState().isPanelOpen('dirty')).toBe(false)
    store.togglePanel('dirty')
    expect(kinds('dirty')).toEqual(['launcher'])
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
      path === 'src/a.ts' ? { state: 'text', path, content: '' } : { state: 'missing', path }
    ))
    mocks.submitBrowserInput.mockResolvedValue(undefined)
    const store = useWorkspacePanelStore.getState()

    await store.openAddress('h5', 'localhost:3000', null)
    expect(useWorkspacePanelStore.getState().getActiveTab('h5')).toMatchObject({ kind: 'files' })
    expect(useWorkspacePanelStore.getState().panelByTab.h5?.selectedFile).toBe('localhost:3000')
    expect(mocks.getWorkspaceFileMock).not.toHaveBeenCalled()

    Object.assign(window, { [ELECTRON_BRIDGE_KEY]: {} })
    await store.openAddress('s', '  src/a.ts ', '/repo')
    expect(useWorkspacePanelStore.getState().getActiveTab('s')).toMatchObject({ kind: 'files' })
    expect(useWorkspacePanelStore.getState().panelByTab.s?.selectedFile).toBe('src/a.ts')

    await store.openAddress('s', 'localhost:3000', '/repo')
    const browser = useWorkspacePanelStore.getState().getActiveTab('s')
    expect(browser).toMatchObject({ kind: 'browser', url: '' })
    expect(mocks.submitBrowserInput).toHaveBeenCalledWith('s', browser?.id, 'localhost:3000', '/repo')

    await store.openAddress('s', '   ', '/repo')
    expect(kinds('s')).toEqual(['files', 'browser'])
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
    store.selectFile('s', 'src/b.ts')
    const files = panel('s')?.activeTabId
    const terminal = store.openTab('s', { kind: 'terminal' })
    store.openTab('closed', { kind: 'changes' })
    store.closePanel('closed')
    expect(panel('s')?.activeTabId).toBe(terminal)

    vi.resetModules()
    const restarted = await import('./workspacePanelStore')
    const restored = restarted.useWorkspacePanelStore.getState().panelByTab

    expect(restored.s).toEqual({
      isOpen: true,
      expanded: false,
      tabs: [
        { id: file, kind: 'file', path: 'src/a.ts' },
        { id: browser, kind: 'browser', url: 'http://localhost:3000/', title: '' },
        { id: files, kind: 'files' },
      ],
      activeTabId: files,
      recentFiles: ['src/b.ts', 'src/a.ts'], selectedFile: 'src/b.ts',
    })
    expect(restored.closed?.isOpen).toBe(false)
  })

  it('ignores saved tabs it cannot read', async () => {
    localStorage.setItem('dreamcoder-workspace-panels', JSON.stringify({
      s: { isOpen: true, tabs: [{ id: 't1', kind: 'terminal', index: 1 }, { id: 'x', kind: 'file' }, { kind: 'files' }], activeTabId: 't1', selectedFile: 7 },
      t: 'nonsense',
    }))
    vi.resetModules()
    const restarted = await import('./workspacePanelStore')

    expect(restarted.useWorkspacePanelStore.getState().panelByTab).toEqual({
      s: { isOpen: false, expanded: false, tabs: [], activeTabId: null, recentFiles: [], selectedFile: null },
    })

    localStorage.setItem('dreamcoder-workspace-panels', '{')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()
    const broken = await import('./workspacePanelStore')
    expect(broken.useWorkspacePanelStore.getState().panelByTab).toEqual({})
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

  it('keeps and refetches the file selected in the Files tab when previews refresh', async () => {
    let version = 1
    mocks.getWorkspaceFileMock.mockImplementation(async (_sessionId: string, path: string) => ({ state: 'ok', path, content: `${path} v${version}` }))
    const store = useWorkspacePanelStore.getState()
    store.selectFile('session-selected', 'src/a.ts')
    await store.ensurePreview('session-selected', 'src/a.ts', 'file')

    version = 2
    await store.refreshPreviews('session-selected')

    expect(useWorkspacePanelStore.getState().previewsBySession['session-selected']?.['file:src/a.ts']?.content).toBe('src/a.ts v2')
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
    expect(state.panelByTab.s).toMatchObject({
      isOpen: true,
      tabs: [{ id: file, kind: 'file', path: 'src/a.ts' }, { id: browser, kind: 'browser' }],
      activeTabId: browser,
    })
    expect(state.statusBySession).toEqual({ other: okStatus() })
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
    expect(useWorkspacePanelStore.getState().panelByTab.s).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('dreamcoder-workspace-panels') ?? '{}')).not.toHaveProperty('s')
    expect(kinds('other')).toEqual(['changes'])
  })
})

describe('artifact tabs', () => {
  const initialState = useWorkspacePanelStore.getInitialState()

  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspacePanelStore.setState(initialState, true)
  })

  afterEach(() => {
    useWorkspacePanelStore.setState(initialState, true)
    localStorage.clear()
  })

  const item = { name: 'report', latestMtimeMs: 42, id: 'id-report' }
  const root = '/repo/dc_artifacts'

  it('opens an artifact with its protocol root and remembers where it came from', async () => {
    mocks.openArtifactMock.mockResolvedValue({ rootDir: '/repo/dc_artifacts', filePath: '/repo/dc_artifacts/report/index.html' })

    await useWorkspacePanelStore.getState().openArtifact('s1', item, root)

    const tab = useWorkspacePanelStore.getState().panelByTab['s1']!.tabs[0]!
    expect(tab).toMatchObject({ kind: 'browser', root: '/repo/dc_artifacts', artifact: { id: 'id-report', name: 'report', mtimeMs: 42 } })
    expect(mocks.openArtifactMock).toHaveBeenCalledWith('/repo/dc_artifacts', 'report')
    expect(mocks.submitBrowserInput).toHaveBeenCalledWith('s1', tab.id, '/repo/dc_artifacts/report/index.html', '/repo/dc_artifacts')
  })

  it('records the fixed marker for an artifact in the global store', async () => {
    mocks.openArtifactMock.mockResolvedValue({ rootDir: '/config/global', filePath: '/config/global/a/index.html' })

    await useWorkspacePanelStore.getState().openArtifact('s1', { ...item, name: 'a', id: 'id-a' }, 'global')

    expect(useWorkspacePanelStore.getState().panelByTab['s1']!.tabs[0]).toMatchObject({ root: 'global' })
    expect(mocks.openArtifactMock).toHaveBeenCalledWith('global', 'a')
  })

  it('activates the tab of an artifact that is already open instead of opening another', async () => {
    mocks.openArtifactMock.mockResolvedValue({ rootDir: '/repo/dc_artifacts', filePath: '/repo/dc_artifacts/report/index.html' })
    await useWorkspacePanelStore.getState().openArtifact('s1', item, root)
    useWorkspacePanelStore.getState().openTab('s1', { kind: 'files' })
    mocks.openArtifactMock.mockClear()
    mocks.submitBrowserInput.mockClear()

    await useWorkspacePanelStore.getState().openArtifact('s1', item, root)

    const panel = useWorkspacePanelStore.getState().panelByTab['s1']!
    expect(panel.tabs.map((tab) => tab.kind)).toEqual(['browser', 'files'])
    expect(panel.activeTabId).toBe(panel.tabs[0]!.id)
    expect(mocks.openArtifactMock).not.toHaveBeenCalled()
    expect(mocks.submitBrowserInput).not.toHaveBeenCalled()
  })

  it('opens a template preview in its own root and remembers the template id', async () => {
    mocks.previewTemplateMock.mockResolvedValue({ rootDir: '/app/design-templates/saas', filePath: '/app/design-templates/saas/index.html' })

    await useWorkspacePanelStore.getState().openTemplatePreview('s1', 'saas')

    const tab = useWorkspacePanelStore.getState().panelByTab['s1']!.tabs[0]!
    expect(tab).toMatchObject({ kind: 'browser', root: '/app/design-templates/saas', template: { id: 'saas' } })
    expect(mocks.previewTemplateMock).toHaveBeenCalledWith('saas')
    expect(mocks.submitBrowserInput).toHaveBeenCalledWith('s1', tab.id, '/app/design-templates/saas/index.html', '/app/design-templates/saas')
  })

  it('activates the preview tab of a template that is already open', async () => {
    mocks.previewTemplateMock.mockResolvedValue({ rootDir: '/app/design-templates/saas', filePath: '/app/design-templates/saas/index.html' })
    await useWorkspacePanelStore.getState().openTemplatePreview('s1', 'saas')
    useWorkspacePanelStore.getState().openTab('s1', { kind: 'files' })
    mocks.previewTemplateMock.mockClear()
    mocks.submitBrowserInput.mockClear()

    await useWorkspacePanelStore.getState().openTemplatePreview('s1', 'saas')

    const panel = useWorkspacePanelStore.getState().panelByTab['s1']!
    expect(panel.tabs.map((tab) => tab.kind)).toEqual(['browser', 'files'])
    expect(panel.activeTabId).toBe(panel.tabs[0]!.id)
    expect(mocks.previewTemplateMock).not.toHaveBeenCalled()
    expect(mocks.submitBrowserInput).not.toHaveBeenCalled()
  })

  it('opens no tab when the template folder cannot be found', async () => {
    mocks.previewTemplateMock.mockRejectedValue(new Error('Template not found: nope'))

    await expect(useWorkspacePanelStore.getState().openTemplatePreview('s1', 'nope')).rejects.toThrow('not found')
    expect(useWorkspacePanelStore.getState().panelByTab['s1']).toBeUndefined()
  })

  it('restores a template preview tab after a restart and drops one with a malformed template', async () => {
    mocks.previewTemplateMock.mockResolvedValue({ rootDir: '/app/design-templates/saas', filePath: '/app/design-templates/saas/index.html' })
    await useWorkspacePanelStore.getState().openTemplatePreview('s1', 'saas')
    const saved = JSON.parse(localStorage.getItem('dreamcoder-workspace-panels')!)
    saved.s2 = { isOpen: true, tabs: [{ id: 'bad', kind: 'browser', url: '', title: '', template: 7 }], activeTabId: 'bad' }
    localStorage.setItem('dreamcoder-workspace-panels', JSON.stringify(saved))

    vi.resetModules()
    const restarted = await import('./workspacePanelStore')
    const restored = restarted.useWorkspacePanelStore.getState().panelByTab

    expect(restored.s1?.tabs[0]).toMatchObject({ kind: 'browser', template: { id: 'saas' } })
    expect(restored.s2?.tabs).toEqual([])
  })

  it('marks the tab of a canvas artifact and not the tab of a page', async () => {
    mocks.openArtifactMock.mockResolvedValue({ rootDir: '/repo/dc_artifacts', filePath: '/repo/dc_artifacts/flow/index.html' })

    await useWorkspacePanelStore.getState().openArtifact('s1', { ...item, name: 'flow', id: 'id-flow', manifest: { version: 1, id: 'id-flow', kind: 'canvas', title: 'Flow', entry: 'index.html' } }, root)
    await useWorkspacePanelStore.getState().openArtifact('s1', { ...item, name: 'report', id: 'id-report', manifest: { version: 1, id: 'id-report', kind: 'page', title: 'Report', entry: 'index.html' } }, root)

    const tabs = useWorkspacePanelStore.getState().panelByTab['s1']!.tabs
    expect(tabs[0]).toMatchObject({ artifact: { id: 'id-flow', canvas: true } })
    expect(tabs[1] && 'artifact' in tabs[1] ? tabs[1].artifact : null).not.toHaveProperty('canvas')
  })

  it('keeps the tab of a board apart from the tab of its canvas and from the tab of another board', () => {
    const store = useWorkspacePanelStore.getState()
    const artifact = { id: 'id-flow', name: 'flow', mtimeMs: 1 }
    const canvas = store.openTab('s1', { kind: 'browser', url: '', artifact: { ...artifact, canvas: true } })
    const home = store.openTab('s1', { kind: 'browser', url: '', artifact: { ...artifact, board: 'home' } })
    const detail = store.openTab('s1', { kind: 'browser', url: '', artifact: { ...artifact, board: 'detail' } })
    const homeAgain = store.openTab('s1', { kind: 'browser', url: '', artifact: { ...artifact, board: 'home' } })
    expect(new Set([canvas, home, detail]).size).toBe(3)
    expect(homeAgain).toBe(home)
  })

  it('restores the board and canvas marks after a restart and drops a tab with a malformed mark', async () => {
    const store = useWorkspacePanelStore.getState()
    store.openTab('s1', { kind: 'browser', url: 'dreamcoder-project://id/flow/index.html', root: '/repo/dc_artifacts', artifact: { id: 'id-flow', name: 'flow', mtimeMs: 1, canvas: true } })
    store.openTab('s1', { kind: 'browser', url: 'dreamcoder-project://id/flow/home.html', root: '/repo/dc_artifacts', artifact: { id: 'id-flow', name: 'flow', mtimeMs: 1, board: 'home' } })
    const saved = JSON.parse(localStorage.getItem('dreamcoder-workspace-panels')!)
    saved.s2 = { isOpen: true, tabs: [{ id: 'bad', kind: 'browser', url: '', title: '', artifact: { id: 'x', name: 'x', mtimeMs: 1, board: 7 } }], activeTabId: 'bad' }
    localStorage.setItem('dreamcoder-workspace-panels', JSON.stringify(saved))

    vi.resetModules()
    const restarted = await import('./workspacePanelStore')
    const restored = restarted.useWorkspacePanelStore.getState().panelByTab

    expect(restored.s1?.tabs.map((tab) => ('artifact' in tab ? tab.artifact : null))).toEqual([
      { id: 'id-flow', name: 'flow', mtimeMs: 1, canvas: true },
      { id: 'id-flow', name: 'flow', mtimeMs: 1, board: 'home' },
    ])
    expect(restored.s2?.tabs).toEqual([])
  })

  it('refuses to open an artifact that has no id', async () => {
    await expect(useWorkspacePanelStore.getState().openArtifact('s1', { ...item, id: null }, root)).rejects.toThrow('no id')
  })

  it('opens the artifacts list as a single tab', () => {
    const store = useWorkspacePanelStore.getState()
    const first = store.openTab('s1', { kind: 'artifacts' })
    const second = store.openTab('s1', { kind: 'artifacts' })
    expect(second).toBe(first)
  })

  it('keeps the root and artifact fields across a restart and drops malformed ones', () => {
    localStorage.setItem('dreamcoder-workspace-panels', JSON.stringify({
      s1: {
        isOpen: true,
        activeTabId: 'a',
        recentFiles: [], selectedFile: null,
        tabs: [
          { id: 'a', kind: 'browser', url: 'dreamcoder-project://x/a/index.html', title: '', root: '/repo/dc_artifacts', artifact: { id: 'id-a', name: 'a', mtimeMs: 1 } },
          { id: 'b', kind: 'browser', url: 'u', title: '', root: 5 },
          { id: 'c', kind: 'browser', url: 'u', title: '', artifact: { id: 'id-c', name: 'c' } },
          { id: 'd', kind: 'artifacts' },
        ],
      },
    }))
    vi.resetModules()
    return import('./workspacePanelStore').then(({ useWorkspacePanelStore: restored }) => {
      const tabs = restored.getState().panelByTab['s1']!.tabs
      expect(tabs.map((tab) => tab.id)).toEqual(['a', 'd'])
      expect(tabs[0]).toMatchObject({ root: '/repo/dc_artifacts', artifact: { id: 'id-a', name: 'a', mtimeMs: 1 } })
    })
  })

  describe('side chats', () => {
    function openSideChat(parentId: string, sideId: string) {
      return useWorkspacePanelStore.getState().openTab(parentId, { kind: 'sideChat', sessionId: sideId })
    }

    it('opens a page, a browser tab and a file of a side chat in its parent panel and records the side chat on the tab', () => {
      const sideTab = openSideChat('parent', 'side')

      const store = useWorkspacePanelStore.getState()
      const pageTabId = store.openTab('side', { kind: 'uiPage', pageId: 'page-1', revision: 2, title: 'Plan' })
      const browserTabId = store.openTab('side', { kind: 'browser', url: 'https://example.com' })
      const fileTabId = store.openTab('side', { kind: 'file', path: 'README.md' })

      const { panelByTab } = useWorkspacePanelStore.getState()
      expect(panelByTab.side).toBeUndefined()
      expect(panelByTab.parent?.tabs.find((tab) => tab.id === pageTabId)).toMatchObject({ kind: 'uiPage', pageId: 'page-1', sessionId: 'side' })
      expect(panelByTab.parent?.tabs.find((tab) => tab.id === browserTabId)).toMatchObject({ kind: 'browser', sessionId: 'side' })
      expect(panelByTab.parent?.tabs.find((tab) => tab.id === fileTabId)).toMatchObject({ kind: 'file', path: 'README.md', sessionId: 'side' })
      expect(panelByTab.parent?.activeTabId).toBe(sideTab)
    })

    it('keeps the side chat tab active when the side chat opens a tab, and switches when the parent does', () => {
      const sideTab = openSideChat('parent', 'side')

      const sideBrowser = useWorkspacePanelStore.getState().openTab('side', { kind: 'browser', url: 'https://example.com' })
      expect(useWorkspacePanelStore.getState().panelByTab.parent).toMatchObject({ isOpen: true, activeTabId: sideTab })
      expect(useWorkspacePanelStore.getState().panelByTab.parent?.tabs.map((tab) => tab.id)).toEqual([sideTab, sideBrowser])

      const parentBrowser = useWorkspacePanelStore.getState().openTab('parent', { kind: 'browser', url: 'https://example.org' })
      expect(useWorkspacePanelStore.getState().panelByTab.parent?.activeTabId).toBe(parentBrowser)

      useWorkspacePanelStore.getState().openTab('side', { kind: 'files' })
      expect(useWorkspacePanelStore.getState().panelByTab.parent?.activeTabId).toBe(parentBrowser)
    })

    it('records what a side chat browser tab reports on the parent panel', () => {
      openSideChat('parent', 'side')
      const tabId = useWorkspacePanelStore.getState().openTab('side', { kind: 'browser', url: '' })

      useWorkspacePanelStore.getState().patchTab('side', tabId, { url: 'https://example.com', title: 'Example' })

      expect(useWorkspacePanelStore.getState().panelByTab.parent?.tabs.find((tab) => tab.id === tabId)).toMatchObject({ url: 'https://example.com', title: 'Example' })
    })

    it('adds the side chats the server has and drops those it no longer has, keeping the local order and active tab', async () => {
      const kept = openSideChat('parent', 'side-kept')
      openSideChat('parent', 'side-gone')
      useWorkspacePanelStore.getState().openTab('parent', { kind: 'files' })
      useWorkspacePanelStore.getState().activateTab('parent', kept)
      mocks.listSideChatsMock.mockResolvedValue({ sessions: [{ id: 'side-new' }, { id: 'side-kept' }] })

      await useWorkspacePanelStore.getState().syncSideChats('parent')

      const panel = useWorkspacePanelStore.getState().panelByTab.parent!
      expect(panel.tabs.map((tab) => tab.kind === 'sideChat' ? tab.sessionId : tab.kind)).toEqual(['side-kept', 'files', 'side-new'])
      expect(useWorkspacePanelStore.getState().sideChatToFocus).toBeNull()
      expect(panel.activeTabId).toBe(kept)
      expect(mocks.disconnectSession).toHaveBeenCalledWith('side-gone')
    })

    it('applies the tab and panel actions of a side chat to its parent panel', () => {
      const sideTab = openSideChat('parent', 'side')
      const browserTab = useWorkspacePanelStore.getState().openTab('parent', { kind: 'browser', url: 'https://example.com' })
      const store = useWorkspacePanelStore.getState()

      store.activateTab('side', sideTab)
      expect(useWorkspacePanelStore.getState().panelByTab.parent?.activeTabId).toBe(sideTab)

      store.closeTab('side', browserTab)
      expect(useWorkspacePanelStore.getState().panelByTab.parent?.tabs.map((tab) => tab.id)).toEqual([sideTab])

      store.selectFile('side', 'README.md')
      expect(useWorkspacePanelStore.getState().panelByTab.parent).toMatchObject({ selectedFile: 'README.md', recentFiles: ['README.md'] })

      store.togglePanel('side')
      expect(useWorkspacePanelStore.getState().panelByTab.parent?.isOpen).toBe(false)
      store.togglePanel('side')
      expect(useWorkspacePanelStore.getState().panelByTab.parent?.isOpen).toBe(true)
      store.closePanel('side')
      expect(useWorkspacePanelStore.getState().panelByTab.parent?.isOpen).toBe(false)

      expect(useWorkspacePanelStore.getState().panelByTab.side).toBeUndefined()
    })

    it('loads the workspace status of a side chat into its parent panel', async () => {
      openSideChat('parent', 'side')
      mocks.getWorkspaceStatusMock.mockResolvedValue({ state: 'ok', workDir: '/repo', repoName: 'repo', branch: 'main', isGitRepo: true, changedFiles: [] })

      await useWorkspacePanelStore.getState().loadStatus('side')

      expect(mocks.getWorkspaceStatusMock).toHaveBeenCalledWith('parent')
      expect(useWorkspacePanelStore.getState().statusBySession.parent).toMatchObject({ state: 'ok', branch: 'main' })
      expect(useWorkspacePanelStore.getState().statusBySession.side).toBeUndefined()
    })

    it('closes the parent panel when the server has none of its side chats left', async () => {
      openSideChat('parent', 'side-gone')
      mocks.listSideChatsMock.mockResolvedValue({ sessions: [] })

      await useWorkspacePanelStore.getState().syncSideChats('parent')

      expect(useWorkspacePanelStore.getState().panelByTab.parent).toMatchObject({ tabs: [], activeTabId: null, isOpen: false, expanded: false })
    })

    it('activates the last tab when the active side chat is gone from the server', async () => {
      openSideChat('parent', 'side-kept')
      const gone = openSideChat('parent', 'side-gone')
      useWorkspacePanelStore.getState().activateTab('parent', gone)
      mocks.listSideChatsMock.mockResolvedValue({ sessions: [{ id: 'side-kept' }, { id: 'side-new' }] })

      await useWorkspacePanelStore.getState().syncSideChats('parent')

      const panel = useWorkspacePanelStore.getState().panelByTab.parent!
      expect(panel.tabs.map((tab) => tab.kind === 'sideChat' ? tab.sessionId : tab.kind)).toEqual(['side-kept', 'side-new'])
      expect(panel.activeTabId).toBe(panel.tabs.at(-1)?.id)
    })

    it('keeps a side chat started while the list was on its way', async () => {
      openSideChat('parent', 'side-kept')
      let answer!: (value: { sessions: Array<{ id: string }> }) => void
      mocks.listSideChatsMock.mockReturnValue(new Promise((resolve) => { answer = resolve }))

      const syncing = useWorkspacePanelStore.getState().syncSideChats('parent')
      const started = openSideChat('parent', 'side-started')
      answer({ sessions: [{ id: 'side-kept' }] })
      await syncing

      const panel = useWorkspacePanelStore.getState().panelByTab.parent!
      expect(panel.tabs.map((tab) => tab.kind === 'sideChat' ? tab.sessionId : tab.kind)).toEqual(['side-kept', 'side-started'])
      expect(panel.activeTabId).toBe(started)
      expect(mocks.disconnectSession).not.toHaveBeenCalledWith('side-started')
    })

    it('does not bring back a side chat deleted while the list was on its way', async () => {
      const tabId = openSideChat('parent', 'side-deleted')
      let answer!: (value: { sessions: Array<{ id: string }> }) => void
      mocks.listSideChatsMock.mockReturnValue(new Promise((resolve) => { answer = resolve }))
      mocks.deleteMock.mockResolvedValue({ ok: true, sideChatFailures: [] })

      const syncing = useWorkspacePanelStore.getState().syncSideChats('parent')
      await useSessionStore.getState().deleteSession('side-deleted')
      useWorkspacePanelStore.getState().closeTab('parent', tabId)
      answer({ sessions: [{ id: 'side-deleted' }] })
      await syncing

      expect(useWorkspacePanelStore.getState().panelByTab.parent?.tabs ?? []).toEqual([])
    })

    it('restores side chat tabs, and the side chat of browser and page tabs, on the next start', async () => {
      const sideTab = openSideChat('parent', 'side')
      const store = useWorkspacePanelStore.getState()
      const browserTab = store.openTab('side', { kind: 'browser', url: 'https://example.com' })
      const pageTab = store.openTab('side', { kind: 'uiPage', pageId: 'page-1', revision: 1, title: 'Plan' })

      vi.resetModules()
      const restarted = await import('./workspacePanelStore')

      expect(restarted.useWorkspacePanelStore.getState().panelByTab.parent?.tabs).toEqual([
        { id: sideTab, kind: 'sideChat', sessionId: 'side' },
        { id: browserTab, kind: 'browser', url: 'https://example.com', title: '', sessionId: 'side' },
        { id: pageTab, kind: 'uiPage', pageId: 'page-1', revision: 1, title: 'Plan', sessionId: 'side' },
      ])
    })

    it('starts a side chat from the parent and shows it as a tab', async () => {
      mocks.branchMock.mockResolvedValue({ sessionId: 'side-created', title: 'btw', workDir: '/repo', sourceSessionId: 'parent' })

      await expect(useWorkspacePanelStore.getState().createSideChat('parent')).resolves.toBe('side-created')

      expect(useWorkspacePanelStore.getState().sideChatToFocus).toBe('side-created')

      expect(mocks.branchMock).toHaveBeenCalledWith('parent', { kind: 'side' })
      const panel = useWorkspacePanelStore.getState().panelByTab.parent!
      expect(panel.isOpen).toBe(true)
      expect(panel.tabs).toMatchObject([{ kind: 'sideChat', sessionId: 'side-created' }])
    })

    it('asks for no focus when the side chat could not be started', async () => {
      mocks.branchMock.mockRejectedValue(new Error('busy'))

      await expect(useWorkspacePanelStore.getState().createSideChat('parent')).rejects.toThrow('busy')

      expect(useWorkspacePanelStore.getState().sideChatToFocus).toBeNull()
    })

    it('clears the focus request only for the side chat it names', () => {
      useWorkspacePanelStore.setState({ sideChatToFocus: 'side-a' })

      useWorkspacePanelStore.getState().clearSideChatFocus('side-b')
      expect(useWorkspacePanelStore.getState().sideChatToFocus).toBe('side-a')
      useWorkspacePanelStore.getState().clearSideChatFocus('side-a')
      expect(useWorkspacePanelStore.getState().sideChatToFocus).toBeNull()
    })

    it('disconnects the side chats of a parent that is released', () => {
      openSideChat('parent', 'side')

      useWorkspacePanelStore.getState().releaseSession('parent')

      expect(mocks.disconnectSession).toHaveBeenCalledWith('side')
      expect(useWorkspacePanelStore.getState().panelByTab.parent?.tabs).toMatchObject([{ kind: 'sideChat', sessionId: 'side' }])
    })
  })
})
