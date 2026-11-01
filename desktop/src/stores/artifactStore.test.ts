import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkspaceArtifacts: vi.fn(),
  browserReload: vi.fn(),
  refreshCanvas: vi.fn(),
  closeBrowser: vi.fn(),
  submitBrowserInput: vi.fn(),
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: { getWorkspaceArtifacts: mocks.getWorkspaceArtifacts },
}))

vi.mock('../lib/browserGuests', () => ({
  browserReload: mocks.browserReload,
  refreshCanvas: mocks.refreshCanvas,
  closeBrowser: mocks.closeBrowser,
  submitBrowserInput: mocks.submitBrowserInput,
}))

vi.mock('../lib/terminalRuntime', () => ({ destroyTerminalRuntime: vi.fn() }))

import type { ArtifactListItem } from '../types/artifact'
import { reloadChangedArtifactTabs, useArtifactStore } from './artifactStore'
import { useWorkspacePanelStore } from './workspacePanelStore'

const item = (overrides: Partial<ArtifactListItem>): ArtifactListItem => ({
  name: 'report',
  artifactsDir: '/repo/dc_artifacts',
  dir: '/repo/dc_artifacts/report',
  workDir: '/repo',
  projectRoot: '/repo',
  branch: null,
  id: 'id-report',
  lastOpenedAt: null,
  entryMissing: false,
  thumbnailMtimeMs: null,
  origin: null,
  sessions: [],
  manifest: { version: 1, id: 'm', kind: 'page', title: 'Report', entry: 'index.html' },
  error: null,
  latestMtimeMs: 100,
  ...overrides,
})

describe('artifactStore', () => {
  const initialPanel = useWorkspacePanelStore.getInitialState()
  const initialArtifacts = useArtifactStore.getInitialState()

  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspacePanelStore.setState(initialPanel, true)
    useArtifactStore.setState(initialArtifacts, true)
  })

  afterEach(() => {
    vi.useRealTimers()
    useWorkspacePanelStore.setState(initialPanel, true)
    localStorage.clear()
  })

  const openArtifactTab = (sessionId: string, root: string, name: string, mtimeMs: number, id = `id-${name}`, canvas?: true) =>
    useWorkspacePanelStore.getState().openTab(sessionId, { kind: 'browser', url: 'dreamcoder-project://id/report/index.html', root, artifact: { id, name, mtimeMs, ...(canvas && { canvas }) } })

  it('reloads only the artifact tabs whose files changed and remembers the new time', async () => {
    const changed = openArtifactTab('s1', '/repo/dc_artifacts', 'report', 100)
    const unchanged = openArtifactTab('s1', '/repo/dc_artifacts', 'other', 100)
    useWorkspacePanelStore.getState().openTab('s1', { kind: 'browser', url: 'https://example.com/' })
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      current: [item({ latestMtimeMs: 250 }), item({ name: 'other', id: 'id-other', latestMtimeMs: 100 })],
      others: [],
    })

    await reloadChangedArtifactTabs()

    expect(mocks.browserReload).toHaveBeenCalledTimes(1)
    expect(mocks.browserReload).toHaveBeenCalledWith(changed)
    const tabs = useWorkspacePanelStore.getState().panelBySession['s1']!.tabs
    expect(tabs.find((tab) => tab.id === changed)).toMatchObject({ artifact: { id: 'id-report', name: 'report', mtimeMs: 250 } })
    expect(tabs.find((tab) => tab.id === unchanged)).toMatchObject({ artifact: { id: 'id-other', name: 'other', mtimeMs: 100 } })
  })

  it('finds an artifact that moved to another folder by its id', async () => {
    const tab = openArtifactTab('s1', '/repo/dc_artifacts', 'moved', 10, 'stable-id')
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      current: [],
      others: [item({ name: 'moved-2', id: 'stable-id', workDir: null, projectRoot: null, artifactsDir: '/config/artifacts-global/dc_artifacts', latestMtimeMs: 20 })],
    })

    await reloadChangedArtifactTabs()

    expect(mocks.browserReload).toHaveBeenCalledWith(tab)
  })

  it('does not ask the server when no session has an artifact tab', async () => {
    useWorkspacePanelStore.getState().openTab('s1', { kind: 'browser', url: 'https://example.com/' })
    await reloadChangedArtifactTabs()
    expect(mocks.getWorkspaceArtifacts).not.toHaveBeenCalled()
  })

  it('refreshes a canvas tab in place instead of reloading the page', async () => {
    const canvas = openArtifactTab('s1', '/repo/dc_artifacts', 'flow', 100, undefined, true)
    mocks.refreshCanvas.mockResolvedValue(true)
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      current: [item({ id: 'id-flow', name: 'flow', latestMtimeMs: 200, manifest: { version: 1, id: 'id-flow', kind: 'canvas', title: 'Flow', entry: 'index.html' } })],
      others: [],
    })

    await reloadChangedArtifactTabs()

    expect(mocks.refreshCanvas).toHaveBeenCalledWith(canvas)
    expect(mocks.browserReload).not.toHaveBeenCalled()
    const tab = useWorkspacePanelStore.getState().panelBySession.s1?.tabs.find((candidate) => candidate.id === canvas)
    expect(tab && 'artifact' in tab ? tab.artifact?.mtimeMs : null).toBe(200)
  })

  it('reloads the tab of a single board when its file changed and keeps the canvas refresh for the canvas', async () => {
    const board = useWorkspacePanelStore.getState().openTab('s1', { kind: 'browser', url: 'dreamcoder-project://id/flow/home.html', root: '/repo/dc_artifacts', artifact: { id: 'id-flow', name: 'flow', mtimeMs: 100, board: 'home' } })
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      current: [item({ id: 'id-flow', name: 'flow', latestMtimeMs: 200, manifest: { version: 1, id: 'id-flow', kind: 'canvas', title: 'Flow', entry: 'index.html' } })],
      others: [],
    })

    await reloadChangedArtifactTabs()

    expect(mocks.browserReload).toHaveBeenCalledWith(board)
    expect(mocks.refreshCanvas).not.toHaveBeenCalled()
    const tab = useWorkspacePanelStore.getState().panelBySession.s1?.tabs.find((candidate) => candidate.id === board)
    expect(tab && 'artifact' in tab ? tab.artifact : null).toEqual({ id: 'id-flow', name: 'flow', mtimeMs: 200, board: 'home' })
  })

  it('reloads a canvas tab whose page cannot be refreshed yet', async () => {
    const canvas = openArtifactTab('s1', '/repo/dc_artifacts', 'flow', 100, undefined, true)
    mocks.refreshCanvas.mockResolvedValue(false)
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      current: [item({ id: 'id-flow', name: 'flow', latestMtimeMs: 200, manifest: { version: 1, id: 'id-flow', kind: 'canvas', title: 'Flow', entry: 'index.html' } })],
      others: [],
    })

    await reloadChangedArtifactTabs()

    expect(mocks.browserReload).toHaveBeenCalledWith(canvas)
  })

  it('does not refresh a canvas tab whose files did not change, such as after the user moved a board', async () => {
    openArtifactTab('s1', '/repo/dc_artifacts', 'flow', 777, undefined, true)
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      current: [item({ id: 'id-flow', name: 'flow', latestMtimeMs: 777, manifest: { version: 1, id: 'id-flow', kind: 'canvas', title: 'Flow', entry: 'index.html' } })],
      others: [],
    })

    await reloadChangedArtifactTabs()

    expect(mocks.refreshCanvas).not.toHaveBeenCalled()
    expect(mocks.browserReload).not.toHaveBeenCalled()
  })

  it('keeps going when one session cannot be read', async () => {
    openArtifactTab('s1', '/repo/dc_artifacts', 'report', 100)
    const second = openArtifactTab('s2', '/repo/dc_artifacts', 'report', 100)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getWorkspaceArtifacts
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValueOnce({ current: [item({ latestMtimeMs: 300 })], others: [] })

    await reloadChangedArtifactTabs()

    expect(warn).toHaveBeenCalled()
    expect(mocks.browserReload).toHaveBeenCalledWith(second)
  })

  it('debounces bursts of activity into one refresh and bumps the write version', async () => {
    vi.useFakeTimers()
    openArtifactTab('s1', '/repo/dc_artifacts', 'report', 100)
    mocks.getWorkspaceArtifacts.mockResolvedValue({ current: [item({ latestMtimeMs: 100 })], others: [] })

    useArtifactStore.getState().noteArtifactActivity()
    useArtifactStore.getState().noteArtifactActivity()
    useArtifactStore.getState().noteArtifactActivity()
    expect(useArtifactStore.getState().writeVersion).toBe(3)
    expect(mocks.getWorkspaceArtifacts).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(400)
    expect(mocks.getWorkspaceArtifacts).toHaveBeenCalledTimes(1)
  })
})
