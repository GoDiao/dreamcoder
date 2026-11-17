import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  moveBoard: vi.fn(),
  open: vi.fn(),
  holdEdit: vi.fn(),
  releaseEdit: vi.fn(),
  refreshArtifactShell: vi.fn(),
  setCanvasMessageHandler: vi.fn(),
  submitBrowserInput: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../api/artifacts', () => ({ artifactsApi: { moveBoard: mocks.moveBoard, open: mocks.open, holdEdit: mocks.holdEdit, releaseEdit: mocks.releaseEdit } }))
vi.mock('../lib/browserGuests', () => ({
  setCanvasMessageHandler: mocks.setCanvasMessageHandler,
  submitBrowserInput: mocks.submitBrowserInput,
  refreshArtifactShell: mocks.refreshArtifactShell,
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import type { CanvasMessage } from '../lib/canvasBridge'
import { useWorkspaceChatContextStore } from '../stores/workspaceChatContextStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'
import { useCanvasTab } from './useCanvasTab'

const canvasArtifact = { id: 'id-flow', name: 'flow', mtimeMs: 1, canvas: true as const }
const target = { tabId: 't1', sessionId: 's1' as string | null, root: '/repo/dc_artifacts', name: 'flow', title: 'Flow', artifact: canvasArtifact }
const edits = () => (useWorkspaceChatContextStore.getState().referencesBySession.s1 ?? []).filter((reference) => reference.kind === 'artifact-edit')

function handlerOf(): (message: CanvasMessage) => void {
  const call = mocks.setCanvasMessageHandler.mock.calls.filter(([, handler]) => handler !== null).at(-1)
  if (!call) throw new Error('no handler registered')
  return call[1]
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useCanvasTab', () => {
  const initialPanel = useWorkspacePanelStore.getInitialState()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.moveBoard.mockResolvedValue({ latestMtimeMs: 777, dir: '/repo/dc_artifacts/flow', files: ['artifact.json'] })
    mocks.holdEdit.mockResolvedValue({ ok: true })
    mocks.releaseEdit.mockResolvedValue({ ok: true })
    mocks.refreshArtifactShell.mockResolvedValue(true)
    useWorkspaceChatContextStore.setState(useWorkspaceChatContextStore.getInitialState(), true)
    mocks.open.mockResolvedValue({ rootDir: '/repo/dc_artifacts', filePath: '/repo/dc_artifacts/flow/home.html' })
    mocks.submitBrowserInput.mockResolvedValue(undefined)
    useWorkspacePanelStore.setState({
      ...initialPanel,
      panelByTab: {
        s1: { isOpen: true, expanded: false, activeTabId: 't1', recentFiles: [], selectedFile: null, tabs: [{ id: 't1', kind: 'browser', url: 'dreamcoder-project://id/flow/index.html', title: '', root: '/repo/dc_artifacts', artifact: canvasArtifact }] },
      },
    })
  })

  afterEach(() => {
    useWorkspacePanelStore.setState(initialPanel, true)
    localStorage.clear()
  })

  it('registers a handler for the tab and removes it again, and stops holding the canvas then', () => {
    const view = renderHook(() => useCanvasTab(target))
    expect(mocks.setCanvasMessageHandler).toHaveBeenCalledWith('t1', expect.any(Function))
    vi.useFakeTimers()
    handlerOf()({ type: 'busy', on: true })
    view.unmount()
    expect(mocks.setCanvasMessageHandler).toHaveBeenLastCalledWith('t1', null)
    vi.advanceTimersByTime(30_000)
    expect(mocks.holdEdit).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('registers nothing without a target', () => {
    renderHook(() => useCanvasTab(null))
    expect(mocks.setCanvasMessageHandler).not.toHaveBeenCalled()
  })

  it('writes a moved board and moves the refresh baseline of the tab to the time the sidecar answers with', async () => {
    renderHook(() => useCanvasTab(target))
    handlerOf()({ type: 'move', id: 'home', x: 1, y: 2, width: 300, height: 200 })
    await flush()
    expect(mocks.moveBoard).toHaveBeenCalledWith({ dir: '/repo/dc_artifacts', name: 'flow', boardId: 'home', x: 1, y: 2, width: 300, height: 200 })
    const tab = useWorkspacePanelStore.getState().panelByTab.s1?.tabs[0]
    expect(tab && 'artifact' in tab ? tab.artifact : null).toEqual({ ...canvasArtifact, mtimeMs: 777 })
  })

  it('writes a moved board of a page that belongs to no chat without touching any tab', async () => {
    renderHook(() => useCanvasTab({ ...target, sessionId: null, artifact: undefined }))
    handlerOf()({ type: 'move', id: 'home', x: 1, y: 2, width: 3, height: 4 })
    await flush()
    expect(mocks.moveBoard).toHaveBeenCalledTimes(1)
    const tab = useWorkspacePanelStore.getState().panelByTab.s1?.tabs[0]
    expect(tab && 'artifact' in tab ? tab.artifact?.mtimeMs : null).toBe(1)
  })

  it('holds the canvas while a board is dragged and releases it after the board is written', async () => {
    renderHook(() => useCanvasTab(target))
    handlerOf()({ type: 'busy', on: true })
    expect(mocks.holdEdit).toHaveBeenCalledWith('/repo/dc_artifacts', 'flow', 't1')
    handlerOf()({ type: 'move', id: 'home', x: 1, y: 2, width: 3, height: 4 })
    handlerOf()({ type: 'busy', on: false })
    await vi.waitFor(() => expect(mocks.releaseEdit).toHaveBeenCalledWith('/repo/dc_artifacts', 'flow', 't1'))
    expect(mocks.moveBoard.mock.invocationCallOrder[0]).toBeLessThan(mocks.releaseEdit.mock.invocationCallOrder[0]!)
  })

  it('tells the agent of the chat that the user moved a board, with one chip for the canvas', async () => {
    renderHook(() => useCanvasTab(target))
    handlerOf()({ type: 'move', id: 'home', x: 1, y: 2, width: 3, height: 4 })
    handlerOf()({ type: 'move', id: 'detail', x: 1, y: 2, width: 3, height: 4 })
    await vi.waitFor(() => expect(mocks.moveBoard).toHaveBeenCalledTimes(2))
    await flush()
    expect(edits()).toMatchObject([{ path: '/repo/dc_artifacts/flow', name: 'Edited: Flow', artifactEdit: { files: ['artifact.json'], slides: false } }])
  })

  it('adds no chip for a canvas that belongs to no chat or a move that failed', async () => {
    mocks.moveBoard.mockRejectedValueOnce(new Error('disk full'))
    renderHook(() => useCanvasTab(target))
    handlerOf()({ type: 'move', id: 'home', x: 1, y: 2, width: 3, height: 4 })
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('disk full'))
    expect(mocks.refreshArtifactShell).toHaveBeenCalledWith('t1')
    expect(edits()).toEqual([])
  })

  it('opens a board in a new tab of the chat', async () => {
    renderHook(() => useCanvasTab(target))
    handlerOf()({ type: 'open', id: 'home' })
    await flush()
    expect(mocks.open).toHaveBeenCalledWith('/repo/dc_artifacts', 'flow', 'home')
    const tabs = useWorkspacePanelStore.getState().panelByTab.s1!.tabs
    expect(tabs).toHaveLength(2)
    expect(tabs[1]).toMatchObject({ root: '/repo/dc_artifacts', artifact: { id: 'id-flow', name: 'flow', mtimeMs: 1, board: 'home' } })
    expect(mocks.submitBrowserInput).toHaveBeenCalledWith('s1', tabs[1]!.id, '/repo/dc_artifacts/flow/home.html', '/repo/dc_artifacts')
  })

  it('opens the same board once and a second board in its own tab', async () => {
    renderHook(() => useCanvasTab(target))
    handlerOf()({ type: 'open', id: 'home' })
    await flush()
    handlerOf()({ type: 'open', id: 'home' })
    await flush()
    expect(useWorkspacePanelStore.getState().panelByTab.s1!.tabs).toHaveLength(2)
    handlerOf()({ type: 'open', id: 'detail' })
    await flush()
    expect(useWorkspacePanelStore.getState().panelByTab.s1!.tabs).toHaveLength(3)
  })

  it('opens a board in the same page when the page belongs to no chat', async () => {
    renderHook(() => useCanvasTab({ ...target, sessionId: null }))
    handlerOf()({ type: 'open', id: 'home' })
    await flush()
    expect(mocks.submitBrowserInput).toHaveBeenCalledWith(null, 't1', '/repo/dc_artifacts/flow/home.html', '/repo/dc_artifacts')
    expect(useWorkspacePanelStore.getState().panelByTab.s1!.tabs).toHaveLength(1)
  })

  it('tells the user when the write or the open fails', async () => {
    mocks.moveBoard.mockRejectedValueOnce(new Error('disk full'))
    mocks.open.mockRejectedValueOnce(new Error('Board not found: home'))
    renderHook(() => useCanvasTab(target))
    handlerOf()({ type: 'move', id: 'home', x: 1, y: 2, width: 3, height: 4 })
    handlerOf()({ type: 'open', id: 'home' })
    await flush()
    expect(mocks.toastError).toHaveBeenCalledWith('disk full')
    expect(mocks.toastError).toHaveBeenCalledWith('Board not found: home')
    expect(mocks.submitBrowserInput).not.toHaveBeenCalled()
  })
})
