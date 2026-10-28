// @vitest-environment jsdom

// @ts-expect-error jsdom is installed in this workspace without local type declarations
import { JSDOM } from 'jsdom'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof document === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  })
  const { window } = dom

  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    MutationObserver: window.MutationObserver,
    Node: window.Node,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })
}

type WorkspaceApiMocks = {
  getWorkspaceStatusMock: ReturnType<typeof vi.fn>
  getWorkspaceTreeMock: ReturnType<typeof vi.fn>
  getWorkspaceFileMock: ReturnType<typeof vi.fn>
  getWorkspaceDiffMock: ReturnType<typeof vi.fn>
}

var mocks: WorkspaceApiMocks | undefined

function getMocks() {
  if (!mocks) {
    throw new Error('Workspace API mocks were not initialized')
  }
  return mocks
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function setWorkspaceState(
  updater:
    | ReturnType<typeof useWorkspacePanelStore.getInitialState>
    | Parameters<typeof useWorkspacePanelStore.setState>[0],
) {
  await act(() => {
    useWorkspacePanelStore.setState(updater as Parameters<typeof useWorkspacePanelStore.setState>[0], true)
  })
}

async function setSettingsState(
  updater:
    | ReturnType<typeof useSettingsStore.getInitialState>
    | Parameters<typeof useSettingsStore.setState>[0],
) {
  await act(() => {
    useSettingsStore.setState(updater as Parameters<typeof useSettingsStore.setState>[0], true)
  })
}

async function flushReactWork() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderPanel(sessionId: string) {
  let view!: ReturnType<typeof render>
  await act(async () => {
    view = render(<WorkspacePanel sessionId={sessionId} />)
    await Promise.resolve()
  })
  return view
}

async function clickElement(element: Element) {
  await act(async () => {
    fireEvent(element, Object.assign(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }), { pointerType: 'mouse' }))
    fireEvent.mouseDown(element, { button: 0 })
    fireEvent.mouseUp(element, { button: 0 })
    fireEvent.click(element)
    await Promise.resolve()
  })
  await flushReactWork()
}

function findTextNodeContaining(container: Element, text: string) {
  const walker = document.createTreeWalker(container, 4)
  let current = walker.nextNode()
  while (current) {
    if (current.textContent?.includes(text)) return current
    current = walker.nextNode()
  }
  throw new Error(`Unable to find text node containing ${text}`)
}

function previewQueries(view: Awaited<ReturnType<typeof renderPanel>>) {
  const root = view.getByTestId('workspace-code')
  const shadow = root.querySelector('diffs-container')?.shadowRoot
  return within((shadow ?? root) as HTMLElement)
}

function previewText(view: Awaited<ReturnType<typeof renderPanel>>) {
  const root = view.getByTestId('workspace-code')
  const shadow = root.querySelector('diffs-container')?.shadowRoot
  return shadow ? Array.from(shadow.querySelectorAll('[data-line]')).map((row) => row.textContent).join('\n') : root.textContent
}

async function selectWorkspaceCodeText(
  view: Awaited<ReturnType<typeof renderPanel>>,
  startLine: number,
  startText: string,
  endLine: number,
  endText: string,
) {
  const code = view.getByTestId('workspace-code')
  const startRow = code.querySelector(`[data-workspace-line-number="${startLine}"]`)
  const endRow = code.querySelector(`[data-workspace-line-number="${endLine}"]`)
  if (!startRow || !endRow) throw new Error('Selection rows were not rendered')

  Object.assign(code.parentElement?.parentElement ?? code, {
    getBoundingClientRect: () => ({
      left: 100,
      top: 24,
      right: 520,
      bottom: 420,
      width: 420,
      height: 396,
      x: 100,
      y: 24,
      toJSON: () => ({}),
    }),
  })

  const startNode = findTextNodeContaining(startRow, startText)
  const endNode = findTextNodeContaining(endRow, endText)
  const startOffset = startNode.textContent?.indexOf(startText) ?? -1
  const endOffset = (endNode.textContent?.indexOf(endText) ?? -1) + endText.length
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  Object.assign(range, {
    getBoundingClientRect: () => ({
      left: 120,
      top: 100,
      right: 240,
      bottom: 118,
      width: 120,
      height: 18,
      x: 120,
      y: 100,
      toJSON: () => ({}),
    }),
  })

  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)

  await act(async () => {
    fireEvent.mouseUp(code, { clientX: 180, clientY: 122 })
    await Promise.resolve()
  })
  await flushReactWork()
}

async function selectRenderedText(container: Element, text: string, target?: Element) {
  const textNode = findTextNodeContaining(container, text)
  const startOffset = textNode.textContent?.indexOf(text) ?? -1
  const range = document.createRange()
  range.setStart(textNode, startOffset)
  range.setEnd(textNode, startOffset + text.length)
  Object.assign(range, {
    getBoundingClientRect: () => ({
      left: 130,
      top: 60,
      right: 260,
      bottom: 78,
      width: 130,
      height: 18,
      x: 130,
      y: 60,
      toJSON: () => ({}),
    }),
  })
  Object.assign(target ?? container, {
    getBoundingClientRect: () => ({
      left: 100,
      top: 24,
      right: 520,
      bottom: 420,
      width: 420,
      height: 396,
      x: 100,
      y: 24,
      toJSON: () => ({}),
    }),
  })

  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)

  await act(async () => {
    fireEvent.mouseUp(target ?? container, { clientX: 190, clientY: 80 })
    await Promise.resolve()
  })
  await flushReactWork()
}

function classNameContains(element: Element | null, needle: string) {
  let current = element
  while (current) {
    if (typeof current.className === 'string' && current.className.includes(needle)) {
      return true
    }
    current = current.parentElement
  }
  return false
}

vi.mock('../../api/sessions', () => ({
  sessionsApi: (() => {
    if (!mocks) {
      mocks = {
        getWorkspaceStatusMock: vi.fn(),
        getWorkspaceTreeMock: vi.fn(),
        getWorkspaceFileMock: vi.fn(),
        getWorkspaceDiffMock: vi.fn(),
      }
    }

    return {
      getWorkspaceStatus: mocks.getWorkspaceStatusMock,
      getWorkspaceTree: mocks.getWorkspaceTreeMock,
      getWorkspaceFile: mocks.getWorkspaceFileMock,
      getWorkspaceDiff: mocks.getWorkspaceDiffMock,
    }
  })(),
}))

import { useSettingsStore } from '../../stores/settingsStore'
import { useChatStore } from '../../stores/chatStore'
import { useWorkspaceChatContextStore } from '../../stores/workspaceChatContextStore'
import { useWorkspacePanelStore, type WorkspacePreviewEntry } from '../../stores/workspacePanelStore'
import { toast } from 'sonner'
import { useTerminalPanelStore } from '../../stores/terminalPanelStore'
import { WorkspacePanel } from './WorkspacePanel'

type WorkspaceStoreState = ReturnType<typeof useWorkspacePanelStore.getState>

/** Seed cached previews as already expanded rows, with the rows they belong to. */
function seedExpandedPreviews(
  state: WorkspaceStoreState,
  sessionId: string,
  entries: Array<Partial<WorkspacePreviewEntry> & Pick<WorkspacePreviewEntry, 'id' | 'path' | 'kind'>>,
) {
  const diffEntries = entries.filter((entry) => entry.kind === 'diff')
  const fileEntries = entries.filter((entry) => entry.kind === 'file')
  const status = state.statusBySession[sessionId] ?? {
    state: 'ok' as const,
    workDir: '/repo',
    repoName: 'repo',
    branch: 'main',
    isGitRepo: true,
    changedFiles: [],
  }
  return {
    statusBySession: {
      ...state.statusBySession,
      [sessionId]: {
        ...status,
        changedFiles: diffEntries.map((entry) => ({
          path: entry.path,
          status: 'modified' as const,
          additions: 1,
          deletions: 0,
        })),
      },
    },
    treeBySessionPath: {
      ...state.treeBySessionPath,
      [sessionId]: {
        '': {
          state: 'ok' as const,
          path: '',
          entries: fileEntries.map((entry) => ({
            name: entry.path.split('/').pop() ?? entry.path,
            path: entry.path,
            isDirectory: false,
          })),
        },
      },
    },
    previewsBySession: {
      ...state.previewsBySession,
      [sessionId]: Object.fromEntries(entries.map((entry) => [entry.id, { title: entry.path, ...entry }])),
    },
    expandedPreviewIdsBySession: {
      ...state.expandedPreviewIdsBySession,
      [sessionId]: entries.map((entry) => entry.id),
    },
  }
}

describe('WorkspacePanel', () => {
  const workspaceInitialState = useWorkspacePanelStore.getInitialState()
  const workspaceChatInitialState = useWorkspaceChatContextStore.getInitialState()
  const settingsInitialState = useSettingsStore.getInitialState()
  const chatInitialState = useChatStore.getInitialState()

  beforeEach(async () => {
    vi.clearAllMocks()
    await setWorkspaceState(workspaceInitialState)
    useChatStore.setState(chatInitialState, true)
    useWorkspaceChatContextStore.setState(workspaceChatInitialState, true)
    await setSettingsState({ ...settingsInitialState, locale: 'en' })

    getMocks().getWorkspaceStatusMock.mockImplementation(async (sessionId: string) =>
      useWorkspacePanelStore.getState().statusBySession[sessionId] ?? {
        state: 'ok',
        workDir: '/repo',
        repoName: 'repo',
        branch: 'main',
        isGitRepo: true,
        changedFiles: [],
      },
    )
    getMocks().getWorkspaceTreeMock.mockImplementation(async (sessionId: string, path = '') =>
      useWorkspacePanelStore.getState().treeBySessionPath[sessionId]?.[path] ?? {
        state: 'ok',
        path,
        entries: [],
      },
    )
  })

  afterEach(async () => {
    cleanup()
    await setWorkspaceState(workspaceInitialState)
    useChatStore.setState(chatInitialState, true)
    useWorkspaceChatContextStore.setState(workspaceChatInitialState, true)
    await setSettingsState(settingsInitialState)
    vi.restoreAllMocks()
  })

  it('stays hidden when the panel is closed', async () => {
    const view = await renderPanel('session-hidden')

    expect(view.queryByTestId('workspace-panel')).toBeNull()
  })

  it('loads changed status on open and opens a diff preview from the changed view', async () => {
    const statusRequest = deferred<{
      state: 'ok'
      workDir: string
      repoName: string
      branch: string
      isGitRepo: true
      changedFiles: Array<{
        path: string
        status: 'modified'
        additions: number
        deletions: number
      }>
    }>()
    const diffRequest = deferred<{
      state: 'ok'
      path: string
      diff: string
    }>()

    getMocks().getWorkspaceStatusMock.mockReturnValue(statusRequest.promise)
    getMocks().getWorkspaceDiffMock.mockReturnValue(diffRequest.promise)

    await act(() => {
      useWorkspacePanelStore.getState().openPanel('session-changed')
    })

    const view = await renderPanel('session-changed')

    expect(view.getByRole('tab', { name: 'Files' }).getAttribute('aria-selected')).toBe('true')

    await waitFor(() => {
      expect(getMocks().getWorkspaceStatusMock).toHaveBeenCalledWith('session-changed')
    })

    await act(async () => {
      statusRequest.resolve({
        state: 'ok',
        workDir: '/repo',
        repoName: 'repo',
        branch: 'main',
        isGitRepo: true,
        changedFiles: [
          {
            path: 'src/app.ts',
            status: 'modified',
            additions: 4,
            deletions: 1,
          },
        ],
      })
      await statusRequest.promise
    })

    expect(view.getByPlaceholderText('Filter files...')).toBeTruthy()

    const row = await view.findByRole('button', { name: 'src/app.ts' })
    expect(row.textContent).toContain('app.ts')
    expect(row.textContent).toContain('+4')
    expect(row.textContent).toContain('−1')
    expect(row.textContent).toContain('M')
    expect(row.getAttribute('aria-expanded')).toBe('false')
    await clickElement(row)

    await waitFor(() => {
      expect(getMocks().getWorkspaceDiffMock).toHaveBeenCalledWith('session-changed', 'src/app.ts')
    })
    expect(row.getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      diffRequest.resolve({
        state: 'ok',
        path: 'src/app.ts',
        diff: '@@ -1 +1 @@\n-console.log("old")\n+console.log("new")',
      })
      await diffRequest.promise
    })

    await waitFor(() => {
      expect(previewText(view)).toContain('console.log("new")')
    })
    const body = view.getByTestId('workspace-file-body')
    expect(body.textContent).toContain('src/app.ts')
    expect(previewQueries(view).getByRole('button', { name: 'Comment line 1' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Add to chat' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Line comment' })).toBeTruthy()

    await clickElement(row)
    expect(view.queryByTestId('workspace-file-body')).toBeNull()
    await clickElement(row)
    expect(getMocks().getWorkspaceDiffMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes status on open and switches back to changed files when new changes exist', async () => {
    getMocks().getWorkspaceStatusMock.mockResolvedValue({
      state: 'ok',
      workDir: '/repo',
      repoName: 'repo',
      branch: 'main',
      isGitRepo: true,
      changedFiles: [
        {
          path: 'src/Fresh.ts',
          status: 'modified',
          additions: 4,
          deletions: 1,
        },
      ],
    })
    getMocks().getWorkspaceTreeMock.mockResolvedValue({
      state: 'ok',
      path: '',
      entries: [{ name: 'src', path: 'src', isDirectory: true }],
    })

    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-stale-all': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
        },
      },
      statusBySession: {
        ...state.statusBySession,
        'session-stale-all': {
          state: 'ok',
          workDir: '/repo',
          repoName: 'repo',
          branch: 'main',
          isGitRepo: true,
          changedFiles: [],
        },
      },
    }))

    const view = await renderPanel('session-stale-all')

    await waitFor(() => {
      expect(getMocks().getWorkspaceStatusMock).toHaveBeenCalledWith('session-stale-all')
    })
    await waitFor(() => {
      expect(view.getByRole('button', { name: 'Changed files' })).toBeTruthy()
    })
    expect(view.getByRole('button', { name: 'src/Fresh.ts' })).toBeTruthy()
  })

  it('loads workspace status when opened while the chat is running', async () => {
    getMocks().getWorkspaceStatusMock.mockResolvedValue({
      state: 'ok',
      workDir: '/repo',
      repoName: 'repo',
      branch: 'main',
      isGitRepo: true,
      changedFiles: [
        {
          path: 'src/running.ts',
          status: 'modified',
          additions: 1,
          deletions: 0,
        },
      ],
    })

    useChatStore.setState({
      sessions: {
        'session-running-open': {
          chatState: 'thinking',
        } as never,
      },
    })

    await act(() => {
      useWorkspacePanelStore.getState().openPanel('session-running-open')
    })

    const view = await renderPanel('session-running-open')

    await waitFor(() => {
      expect(getMocks().getWorkspaceStatusMock).toHaveBeenCalledWith('session-running-open')
    })
    await waitFor(() => {
      expect(view.getByRole('button', { name: 'src/running.ts' })).toBeTruthy()
    })
    expect(view.queryByText('Loading...')).toBeNull()
  })

  it('renders transcript-derived changed files for non-git sessions', async () => {
    getMocks().getWorkspaceStatusMock.mockResolvedValue({
      state: 'ok',
      workDir: '/tmp/non-git-session',
      repoName: 'non-git-session',
      branch: null,
      isGitRepo: false,
      changedFiles: [
        {
          path: 'src/app.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
        },
      ],
    })
    getMocks().getWorkspaceDiffMock.mockResolvedValue({
      state: 'ok',
      path: 'src/app.ts',
      diff: 'diff --session a/src/app.ts b/src/app.ts\n-export const answer = 1\n+export const answer = 2',
    })

    await act(() => {
      useWorkspacePanelStore.getState().openPanel('session-non-git')
    })

    const view = await renderPanel('session-non-git')

    await waitFor(() => {
      expect(view.getByRole('button', { name: 'src/app.ts' })).toBeTruthy()
    })
    expect(view.queryByText('No matching files')).toBeNull()

    await clickElement(view.getByRole('button', { name: 'src/app.ts' }))

    await waitFor(() => {
      expect(getMocks().getWorkspaceDiffMock).toHaveBeenCalledWith('session-non-git', 'src/app.ts')
    })
    await waitFor(() => {
      expect(previewText(view)).toContain('export const answer = 2')
    })
  })

  it('opens to all files when the current turn has no changed files', async () => {
    const statusRequest = deferred<{
      state: 'ok'
      workDir: string
      repoName: string
      branch: string
      isGitRepo: true
      changedFiles: []
    }>()
    const rootTreeRequest = deferred<{
      state: 'ok'
      path: ''
      entries: Array<{ name: string; path: string; isDirectory: boolean }>
    }>()

    getMocks().getWorkspaceStatusMock.mockReturnValue(statusRequest.promise)
    getMocks().getWorkspaceTreeMock.mockReturnValue(rootTreeRequest.promise)

    await act(() => {
      useWorkspacePanelStore.getState().openPanel('session-empty-tree')
    })

    const view = await renderPanel('session-empty-tree')
    expect(view.getByRole('button', { name: 'Changed files' })).toBeTruthy()

    await act(async () => {
      statusRequest.resolve({
        state: 'ok',
        workDir: '/repo',
        repoName: 'repo',
        branch: 'main',
        isGitRepo: true,
        changedFiles: [],
      })
      await statusRequest.promise
    })

    await waitFor(() => {
      expect(useWorkspacePanelStore.getState().getActiveView('session-empty-tree')).toBe('all')
      expect(getMocks().getWorkspaceTreeMock).toHaveBeenCalledWith('session-empty-tree', '')
    })

    await act(async () => {
      rootTreeRequest.resolve({
        state: 'ok',
        path: '',
        entries: [
          { name: 'src', path: 'src', isDirectory: true },
          { name: 'README.md', path: 'README.md', isDirectory: false },
        ],
      })
      await rootTreeRequest.promise
    })

    expect(view.getByRole('button', { name: 'All files' })).toBeTruthy()
    expect(await view.findByText('src')).toBeTruthy()
    expect(await view.findByText('README.md')).toBeTruthy()
    expect(view.queryByText('No changes')).toBeNull()
  })

  it('lazy loads the root tree, expands directories, and opens file previews from the all-files view', async () => {
    const statusRequest = deferred<{
      state: 'ok'
      workDir: string
      repoName: string
      branch: string
      isGitRepo: true
      changedFiles: []
    }>()
    const rootTreeRequest = deferred<{
      state: 'ok'
      path: ''
      entries: Array<{ name: string; path: string; isDirectory: boolean }>
    }>()
    const childTreeRequest = deferred<{
      state: 'ok'
      path: 'src'
      entries: Array<{ name: string; path: string; isDirectory: boolean }>
    }>()
    const fileRequest = deferred<{
      state: 'ok'
      path: string
      content: string
      language: string
      size: number
    }>()

    getMocks().getWorkspaceStatusMock.mockReturnValue(statusRequest.promise)
    getMocks().getWorkspaceTreeMock
      .mockReturnValueOnce(rootTreeRequest.promise)
      .mockReturnValueOnce(childTreeRequest.promise)
    getMocks().getWorkspaceFileMock.mockReturnValue(fileRequest.promise)

    await act(() => {
      useWorkspacePanelStore.getState().openPanel('session-tree')
    })

    const view = await renderPanel('session-tree')

    expect(view.getByRole('button', { name: 'Changed files' })).toBeTruthy()

    await clickElement(view.getByRole('button', { name: 'Changed files' }))
    await clickElement(view.getByRole('menuitemradio', { name: 'All files' }))

    await waitFor(() => {
      expect(getMocks().getWorkspaceTreeMock).toHaveBeenCalledWith('session-tree', '')
    })

    await act(async () => {
      statusRequest.resolve({
        state: 'ok',
        workDir: '/repo',
        repoName: 'repo',
        branch: 'main',
        isGitRepo: true,
        changedFiles: [],
      })
      rootTreeRequest.resolve({
        state: 'ok',
        path: '',
        entries: [
          { name: 'src', path: 'src', isDirectory: true },
          { name: 'README.md', path: 'README.md', isDirectory: false },
        ],
      })
      await Promise.all([statusRequest.promise, rootTreeRequest.promise])
    })

    const folderLabel = await view.findByText('src')
    const folderButton = folderLabel.closest('button')
    if (!folderButton) {
      throw new Error('Expected src label to be rendered inside a folder button')
    }
    expect(folderButton.getAttribute('aria-expanded')).toBe('false')
    expect(folderButton.classList.contains('justify-start')).toBe(true)
    expect(folderButton.classList.contains('justify-center')).toBe(false)

    await clickElement(folderButton)

    await waitFor(() => {
      expect(getMocks().getWorkspaceTreeMock).toHaveBeenCalledWith('session-tree', 'src')
    })
    await act(async () => {
      childTreeRequest.resolve({
        state: 'ok',
        path: 'src',
        entries: [{ name: 'index.ts', path: 'src/index.ts', isDirectory: false }],
      })
      await childTreeRequest.promise
    })
    await waitFor(() => {
      expect(folderButton.getAttribute('aria-expanded')).toBe('true')
    })

    const fileRow = (await view.findByText('index.ts')).closest('button')!
    expect(fileRow.getAttribute('aria-expanded')).toBe('false')
    await clickElement(fileRow)

    await waitFor(() => {
      expect(getMocks().getWorkspaceFileMock).toHaveBeenCalledWith('session-tree', 'src/index.ts')
    })
    await act(async () => {
      fileRequest.resolve({
        state: 'ok',
        path: 'src/index.ts',
        content: 'export const ready = true',
        language: 'typescript',
        size: 25,
      })
      await fileRequest.promise
    })

    await waitFor(() => {
      expect(previewText(view)).toContain('export const ready = true')
    })
    expect(fileRow.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByTestId('workspace-file-body').textContent).toContain('src/index.ts')
  })

  it('keeps several changed files expanded at once and collapses only the clicked one', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-multi': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'changed',
          hasUserSelectedView: true,
        },
      },
      ...seedExpandedPreviews(state, 'session-multi', [
        { id: 'diff:src/a.ts', path: 'src/a.ts', kind: 'diff', diff: '@@ -1 +1 @@\n-a\n+alpha', state: 'ok' },
        { id: 'diff:src/b.ts', path: 'src/b.ts', kind: 'diff', diff: '@@ -3 +3 @@\n-b\n+beta', state: 'ok' },
      ]),
    }))

    const view = await renderPanel('session-multi')

    expect(view.getAllByTestId('workspace-file-body')).toHaveLength(2)
    expect(view.queryByRole('tablist', { name: 'Preview tabs' })).toBeNull()

    await clickElement(view.getByRole('button', { name: 'src/a.ts' }))

    expect(view.getAllByTestId('workspace-file-body')).toHaveLength(1)
    expect(previewText(view)).toContain('beta')
    expect(view.getByRole('button', { name: 'src/b.ts' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('uses theme tokens for the panel and code surface in dark mode', async () => {
    await setSettingsState({ ...settingsInitialState, locale: 'en', theme: 'dark' })
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-dark-theme': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
          hasUserSelectedView: true,
        },
      },
      ...seedExpandedPreviews(state, 'session-dark-theme', [{
          id: 'file:src/theme.ts',
          path: 'src/theme.ts',
          kind: 'file',
          title: 'theme.ts',
          language: 'typescript',
          content: 'export const theme = "dark"',
          state: 'ok',
          size: 27,
        }]),
    }))

    const view = await renderPanel('session-dark-theme')
    const panel = view.getByTestId('workspace-panel')
    const codeSurface = view.getByTestId('workspace-code')

    expect(panel.className).toContain('bg-[var(--color-surface)]')
    expect(panel.className).not.toContain('bg-white')
    expect(classNameContains(codeSurface, 'bg-[var(--color-code-bg)]')).toBe(true)
    expect(classNameContains(codeSurface, 'bg-white')).toBe(false)
  })

  it('can expand long diff previews beyond the default rendered line cap', async () => {
    const longDiff = Array.from({ length: 2300 }, (_, index) => `+line ${index + 1}`).join('\n')

    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-large-preview': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'changed',
          hasUserSelectedView: true,
        },
      },
      ...seedExpandedPreviews(state, 'session-large-preview', [{
          id: 'diff:large.ts',
          path: 'large.ts',
          kind: 'diff',
          title: 'large.ts',
          diff: longDiff,
          state: 'ok',
        }]),
    }))

    const view = await renderPanel('session-large-preview')
    const highlightedCode = previewText(view) ?? ''

    expect(highlightedCode).toContain('line 1')
    expect(highlightedCode).not.toContain('line 2001')
    await clickElement(view.getByRole('button', { name: 'Show all loaded lines' }))

    await waitFor(() => {
      expect(view.getByRole('button', { name: 'Collapse preview' })).toBeTruthy()
    })
    expect(view.getByRole('button', { name: 'Collapse preview' })).toBeTruthy()
  })

  it('keeps diff rows intrinsically wide so H5 users can scroll sideways', async () => {
    const longDiffLine = '+const label = "this is a very long generated line that should not be compressed into the phone viewport";'

    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-wide-diff': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'changed',
          hasUserSelectedView: true,
        },
      },
      ...seedExpandedPreviews(state, 'session-wide-diff', [{
          id: 'diff:wide.ts',
          path: 'wide.ts',
          kind: 'diff',
          title: 'wide.ts',
          diff: longDiffLine,
          state: 'ok',
        }]),
    }))

    const view = await renderPanel('session-wide-diff')
    const diffSurface = view.getByTestId('workspace-code')
    const shadow = diffSurface.querySelector('diffs-container')!.shadowRoot!
    const code = shadow.querySelector('pre')

    expect(code?.getAttribute('data-overflow')).toBe('scroll')
    expect(previewText(view)).toContain(longDiffLine.slice(1))
  })

  it('can expand long file previews beyond the default rendered line cap', async () => {
    const longFile = Array.from({ length: 2300 }, (_, index) => `const line${index + 1} = ${index + 1}`).join('\n')

    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-large-file-preview': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
        },
      },
      ...seedExpandedPreviews(state, 'session-large-file-preview', [{
          id: 'file:large-file.ts',
          path: 'large-file.ts',
          kind: 'file',
          title: 'large-file.ts',
          content: longFile,
          language: 'typescript',
          previewType: 'text',
          state: 'ok',
        }]),
    }))

    const view = await renderPanel('session-large-file-preview')
    const highlightedCode = previewText(view) ?? ''

    expect(highlightedCode).toContain('const line1 = 1')
    expect(highlightedCode).toContain('const line2000 = 2000')
    expect(highlightedCode).not.toContain('const line2001 = 2001')
    await clickElement(view.getByRole('button', { name: 'Show all loaded lines' }))

    await waitFor(() => {
      expect(previewText(view)).toContain('const line2300 = 2300')
    })
    expect(view.getByRole('button', { name: 'Collapse preview' })).toBeTruthy()
  }, 20_000)

  it('renders image previews from workspace files', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-image-preview': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
        },
      },
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-image-preview': {
          '': {
            state: 'ok',
            path: '',
            entries: [{ name: 'logo.png', path: 'logo.png', isDirectory: false }],
          },
        },
      },
    }))

    getMocks().getWorkspaceFileMock.mockResolvedValue({
      state: 'ok',
      path: 'logo.png',
      previewType: 'image',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      mimeType: 'image/png',
      language: 'image',
      size: 8,
    })

    const view = await renderPanel('session-image-preview')

    await clickElement(await view.findByText('logo.png'))

    const image = await view.findByRole('img', { name: 'logo.png' })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('renders markdown file previews as formatted documents', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-markdown-preview': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
        },
      },
      ...seedExpandedPreviews(state, 'session-markdown-preview', [{
          id: 'file:README.md',
          path: 'README.md',
          kind: 'file',
          title: 'README.md',
          language: 'markdown',
          content: '# Project Notes\n\n- **Done** item\n\n```ts\nexport const ok = true\n```',
          state: 'ok',
          size: 70,
        }]),
    }))

    const view = await renderPanel('session-markdown-preview')

    expect(view.getByRole('heading', { name: 'Project Notes', level: 1 })).toBeTruthy()
    expect(view.getByText('Done')).toBeTruthy()
    expect(view.container.textContent).toContain('export const ok = true')
    expect(view.queryByTestId('workspace-code')).toBeNull()
  })

  it('offers add-to-chat, line comment and the file actions menu under an expanded diff', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-preview-menu': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'changed',
          hasUserSelectedView: true,
        },
      },
      ...seedExpandedPreviews(state, 'session-preview-menu', [
        {
          id: 'diff:vite.config.js',
          path: 'vite.config.js',
          kind: 'diff',
          diff: '@@ -4,2 +4,2 @@\n plugins: [],\n-port: 1\n+port: 2',
          state: 'ok',
        },
      ]),
    }))

    const view = await renderPanel('session-preview-menu')

    expect(previewQueries(view).getByRole('button', { name: 'Comment line 4' })).toBeTruthy()
    expect(previewQueries(view).getByRole('button', { name: 'Comment line 5' })).toBeTruthy()
    expect(previewQueries(view).queryByRole('button', { name: 'Comment line 6' })).toBeNull()

    await clickElement(view.getByRole('button', { name: 'Line comment' }))
    expect(view.getByText('Line 5')).toBeTruthy()
    await act(() => {
      fireEvent.change(view.getByPlaceholderText('Describe what should change here...'), {
        target: { value: 'Use the default port' },
      })
    })
    await clickElement(view.getByRole('button', { name: 'Add comment' }))

    await clickElement(view.getByRole('button', { name: 'More file actions' }))
    expect(view.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
    expect(view.getByRole('menuitem', { name: 'Copy absolute path' })).toBeTruthy()
    await clickElement(view.getByRole('menuitem', { name: 'Add to chat' }))

    expect(useWorkspaceChatContextStore.getState().referencesBySession['session-preview-menu']).toMatchObject([
      {
        kind: 'code-comment',
        path: 'vite.config.js',
        lineStart: 5,
        lineEnd: 5,
        note: 'Use the default port',
        quote: 'port: 2',
      },
      {
        kind: 'file',
        path: 'vite.config.js',
        absolutePath: '/repo/vite.config.js',
      },
    ])
  })

  it('keeps a diff line-comment draft open while previews refresh', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-draft': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'changed',
          hasUserSelectedView: true,
        },
      },
      ...seedExpandedPreviews(state, 'session-draft', [
        {
          id: 'diff:vite.config.js',
          path: 'vite.config.js',
          kind: 'diff',
          diff: '@@ -4,2 +4,2 @@\n plugins: [],\n-port: 1\n+port: 2',
          state: 'ok',
        },
      ]),
    }))
    const refreshed = deferred<{ state: 'ok'; path: string; diff: string }>()
    getMocks().getWorkspaceDiffMock.mockReturnValue(refreshed.promise)

    const view = await renderPanel('session-draft')
    await clickElement(previewQueries(view).getByRole('button', { name: 'Comment line 5' }))
    await act(() => {
      fireEvent.change(view.getByPlaceholderText('Describe what should change here...'), {
        target: { value: 'Keep me' },
      })
    })

    let refresh!: Promise<void>
    await act(async () => {
      refresh = useWorkspacePanelStore.getState().refreshPreviews('session-draft')
    })
    // The old diff stays on screen while the refetch is pending.
    expect(view.queryByText('Loading preview...')).toBeNull()
    expect((view.getByPlaceholderText('Describe what should change here...') as HTMLTextAreaElement).value).toBe('Keep me')

    await act(async () => {
      refreshed.resolve({ state: 'ok', path: 'vite.config.js', diff: '@@ -4,2 +4,3 @@\n plugins: [],\n-port: 1\n+port: 2\n+host: true' })
      await refresh
    })
    expect(previewQueries(view).getByRole('button', { name: 'Comment line 6' })).toBeTruthy()
    expect((view.getByPlaceholderText('Describe what should change here...') as HTMLTextAreaElement).value).toBe('Keep me')
  })

  it('adds a workspace file to the chat context from the file tree menu', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-add-file': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
        },
      },
      statusBySession: {
        ...state.statusBySession,
        'session-add-file': {
          state: 'ok',
          workDir: '/repo',
          repoName: 'repo',
          branch: 'main',
          isGitRepo: true,
          changedFiles: [],
        },
      },
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-add-file': {
          '': {
            state: 'ok',
            path: '',
            entries: [{ name: 'App.tsx', path: 'src/App.tsx', isDirectory: false }],
          },
        },
      },
    }))

    const view = await renderPanel('session-add-file')

    await act(() => {
      fireEvent.contextMenu(view.getByRole('treeitem', { name: /App\.tsx/i }), {
        clientX: 260,
        clientY: 80,
      })
    })

    await clickElement(view.getByRole('menuitem', { name: 'Add to chat' }))

    expect(useWorkspaceChatContextStore.getState().referencesBySession['session-add-file']).toMatchObject([
      {
        kind: 'file',
        path: 'src/App.tsx',
        absolutePath: '/repo/src/App.tsx',
        name: 'App.tsx',
      },
    ])
  })

  it('adds a workspace directory to the chat context from the file tree menu', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-add-directory': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
        },
      },
      statusBySession: {
        ...state.statusBySession,
        'session-add-directory': {
          state: 'ok',
          workDir: '/repo',
          repoName: 'repo',
          branch: 'main',
          isGitRepo: true,
          changedFiles: [],
        },
      },
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-add-directory': {
          '': {
            state: 'ok',
            path: '',
            entries: [{ name: 'src', path: 'src', isDirectory: true }],
          },
        },
      },
    }))

    const view = await renderPanel('session-add-directory')

    await act(() => {
      fireEvent.contextMenu(view.getByRole('treeitem', { name: /src/i }), {
        clientX: 260,
        clientY: 80,
      })
    })

    await clickElement(view.getByRole('menuitem', { name: 'Add to chat' }))

    expect(useWorkspaceChatContextStore.getState().referencesBySession['session-add-directory']).toMatchObject([
      {
        kind: 'file',
        path: 'src',
        absolutePath: '/repo/src',
        name: 'src/',
        isDirectory: true,
      },
    ])
  })

  it('does not show duplicate inline citation actions in the file tree menu', async () => {
    useChatStore.setState({
      sessions: {
        'session-cite-file': {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
        },
      },
    })
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-cite-file': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
        },
      },
      statusBySession: {
        ...state.statusBySession,
        'session-cite-file': {
          state: 'ok',
          workDir: '/repo',
          repoName: 'repo',
          branch: 'main',
          isGitRepo: true,
          changedFiles: [],
        },
      },
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-cite-file': {
          '': {
            state: 'ok',
            path: '',
            entries: [{ name: 'App.tsx', path: 'src/App.tsx', isDirectory: false }],
          },
        },
      },
    }))

    const view = await renderPanel('session-cite-file')

    await act(() => {
      fireEvent.contextMenu(view.getByRole('treeitem', { name: /App\.tsx/i }), {
        clientX: 260,
        clientY: 80,
      })
    })

    expect(view.queryByRole('menuitem', { name: 'Cite in message' })).toBeNull()
  })

  it('copies relative and absolute file paths from the file tree menu with the legacy clipboard fallback', async () => {
    const originalClipboard = navigator.clipboard
    const originalExecCommand = document.execCommand
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    })
    const execCommand = vi.mocked(document.execCommand)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('clipboard blocked')),
      },
    })
    const writeText = vi.mocked(navigator.clipboard.writeText)

    try {
      await setWorkspaceState((state) => ({
        ...state,
        panelBySession: {
          ...state.panelBySession,
          'session-copy-file': {
            isOpen: true,
            tab: 'files',
            expanded: false,
            activeView: 'all',
          },
        },
        statusBySession: {
          ...state.statusBySession,
          'session-copy-file': {
            state: 'ok',
            workDir: '/repo',
            repoName: 'repo',
            branch: 'main',
            isGitRepo: true,
            changedFiles: [],
          },
        },
        treeBySessionPath: {
          ...state.treeBySessionPath,
          'session-copy-file': {
            '': {
              state: 'ok',
              path: '',
              entries: [{ name: 'App.tsx', path: 'src/App.tsx', isDirectory: false }],
            },
          },
        },
      }))

      const view = await renderPanel('session-copy-file')

      await act(() => {
        fireEvent.contextMenu(view.getByRole('treeitem', { name: /App\.tsx/i }), {
          clientX: 260,
          clientY: 80,
        })
      })

      await clickElement(view.getByRole('menuitem', { name: 'Copy path' }))

      await waitFor(() => {
        expect(execCommand).toHaveBeenCalledWith('copy')
      })
      expect(writeText).toHaveBeenCalledWith('src/App.tsx')
      expect(toast.success).toHaveBeenLastCalledWith('Path copied.')

      await act(() => {
        fireEvent.contextMenu(view.getByRole('treeitem', { name: /App\.tsx/i }), {
          clientX: 260,
          clientY: 80,
        })
      })

      await clickElement(view.getByRole('menuitem', { name: 'Copy absolute path' }))

      expect(writeText).toHaveBeenLastCalledWith('/repo/src/App.tsx')
    } finally {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: originalExecCommand,
      })
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      })
    }
  })

  it('adds a line comment from a code preview to the chat context', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-line-comment': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
        },
      },
      ...seedExpandedPreviews(state, 'session-line-comment', [{
          id: 'file:src/App.tsx',
          path: 'src/App.tsx',
          kind: 'file',
          title: 'App.tsx',
          language: 'tsx',
          content: 'const title = "Todo"\nexport default title',
          state: 'ok',
          size: 42,
        }]),
    }))

    const view = await renderPanel('session-line-comment')

    await clickElement(previewQueries(view).getByRole('button', { name: 'Comment line 1' }))
    const textarea = view.getByPlaceholderText('Describe what should change here...')
    await act(() => {
      fireEvent.change(textarea, { target: { value: 'Rename this title' } })
    })
    await clickElement(view.getByRole('button', { name: 'Add comment' }))

    expect(useWorkspaceChatContextStore.getState().referencesBySession['session-line-comment']).toMatchObject([
      {
        kind: 'code-comment',
        path: 'src/App.tsx',
        absolutePath: '/repo/src/App.tsx',
        name: 'App.tsx',
        lineStart: 1,
        lineEnd: 1,
        note: 'Rename this title',
        quote: 'const title = "Todo"',
      },
    ])
  })

  it('adds selected code from a preview to the chat context without requiring a note', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-code-selection': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
        },
      },
      ...seedExpandedPreviews(state, 'session-code-selection', [{
          id: 'file:src/App.ts',
          path: 'src/App.ts',
          kind: 'file',
          title: 'App.ts',
          language: 'text',
          content: 'const title = "Todo"\nexport default title',
          state: 'ok',
          size: 42,
        }]),
    }))

    const view = await renderPanel('session-code-selection')

    await selectWorkspaceCodeText(view, 1, 'const title = "Todo"', 2, 'export default title')
    const quotePopover = view.getByRole('dialog', { name: 'Add to chat' })
    await clickElement(within(quotePopover).getByRole('button', { name: 'Add to chat' }))

    expect(useWorkspaceChatContextStore.getState().referencesBySession['session-code-selection']).toMatchObject([
      {
        kind: 'code-selection',
        path: 'src/App.ts',
        absolutePath: '/repo/src/App.ts',
        name: 'App.ts',
        lineStart: 1,
        lineEnd: 2,
        quote: 'const title = "Todo"\nexport default title',
      },
    ])
    expect(useWorkspaceChatContextStore.getState().referencesBySession['session-code-selection']?.[0]?.note).toBeUndefined()
  })

  it('portals the selected-code action and dismisses it with Escape', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-selection-position': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
        },
      },
      ...seedExpandedPreviews(state, 'session-selection-position', [{
          id: 'file:src/App.ts',
          path: 'src/App.ts',
          kind: 'file',
          title: 'App.ts',
          language: 'text',
          content: 'const title = "Todo"\nexport default title',
          state: 'ok',
          size: 42,
        }]),
    }))

    const view = await renderPanel('session-selection-position')

    await selectWorkspaceCodeText(view, 1, 'const title = "Todo"', 1, 'const title = "Todo"')
    const quotePopover = view.getByRole('dialog', { name: 'Add to chat' })
    expect(view.container.contains(quotePopover)).toBe(false)
    expect(within(quotePopover).getByRole('button', { name: 'Add to chat' })).not.toBeNull()

    fireEvent.keyDown(view.getByTestId('workspace-code').parentElement?.parentElement ?? view.getByTestId('workspace-code'), {
      key: 'Escape',
    })
    await flushReactWork()
    expect(view.queryAllByRole('button', { name: 'Add to chat' })).toHaveLength(1)
    expect(window.getSelection()?.toString()).toBe('const title = "Todo"')
  })

  it('closes the selected-code action but keeps the selection when pressing outside the popover', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-selection-dismiss': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
        },
      },
      ...seedExpandedPreviews(state, 'session-selection-dismiss', [{
          id: 'file:src/App.ts',
          path: 'src/App.ts',
          kind: 'file',
          title: 'App.ts',
          language: 'text',
          content: 'const title = "Todo"\nexport default title',
          state: 'ok',
          size: 42,
        }]),
    }))

    const view = await renderPanel('session-selection-dismiss')

    await selectWorkspaceCodeText(view, 1, 'const title = "Todo"', 1, 'const title = "Todo"')
    expect(view.getAllByRole('button', { name: 'Add to chat' })).toHaveLength(2)

    await act(async () => {
      fireEvent.pointerDown(document.body)
      await Promise.resolve()
    })
    await flushReactWork()

    expect(view.queryAllByRole('button', { name: 'Add to chat' })).toHaveLength(1)
    expect(window.getSelection()?.toString()).toBe('const title = "Todo"')
  })

  it('adds selected markdown text from a preview to the chat context', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-markdown-selection': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'all',
        },
      },
      ...seedExpandedPreviews(state, 'session-markdown-selection', [{
          id: 'file:docs/guide.md',
          path: 'docs/guide.md',
          kind: 'file',
          title: 'guide.md',
          language: 'markdown',
          content: '# Guide\nAlpha note and Beta note',
          state: 'ok',
          size: 33,
        }]),
    }))

    const view = await renderPanel('session-markdown-selection')
    const paragraph = view.getByText('Alpha note and Beta note')
    const markdownSurface = paragraph.closest('.overflow-auto') ?? paragraph

    await selectRenderedText(paragraph, 'Alpha note and Beta note', markdownSurface)
    const quotePopover = view.getByRole('dialog', { name: 'Add to chat' })
    await clickElement(within(quotePopover).getByRole('button', { name: 'Add to chat' }))

    expect(useWorkspaceChatContextStore.getState().referencesBySession['session-markdown-selection']).toMatchObject([
      {
        kind: 'code-selection',
        path: 'docs/guide.md',
        absolutePath: '/repo/docs/guide.md',
        name: 'guide.md',
        lineStart: 2,
        lineEnd: 2,
        quote: 'Alpha note and Beta note',
      },
    ])
  })

  it('uses the localized view menu label', async () => {
    await setSettingsState({ ...settingsInitialState, locale: 'zh' })
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-zh': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'changed',
          hasUserSelectedView: true,
        },
      },
      statusBySession: {
        ...state.statusBySession,
        'session-zh': {
          state: 'ok',
          workDir: '/repo',
          repoName: 'repo',
          branch: 'main',
          isGitRepo: true,
          changedFiles: [],
        },
      },
    }))

    const view = await renderPanel('session-zh')

    expect(view.getByRole('button', { name: '已更改文件' })).toBeTruthy()
  })

  it('renders the panel tabs with expand, restore and close controls', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-compact-header': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'changed',
          hasUserSelectedView: true,
        },
      },
      statusBySession: {
        ...state.statusBySession,
        'session-compact-header': {
          state: 'ok',
          workDir: '/repo',
          repoName: 'repo',
          branch: 'main',
          isGitRepo: true,
          changedFiles: [],
        },
      },
    }))

    const view = await renderPanel('session-compact-header')
    expect(view.getByRole('button', { name: 'Changed files' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Refresh workspace' })).toBeTruthy()

    const tabs = view.getByRole('tablist', { name: 'Side panel' })
    expect(tabs).toBeTruthy()
    expect(view.getByRole('tab', { name: 'Files' }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByRole('tab', { name: 'Terminal' }).getAttribute('aria-selected')).toBe('false')

    await clickElement(view.getByRole('button', { name: 'Expand panel' }))
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-compact-header')).toBe(true)
    await clickElement(view.getByRole('button', { name: 'Restore panel' }))
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-compact-header')).toBe(false)

    await clickElement(view.getByRole('button', { name: 'Close panel' }))
    expect(useWorkspacePanelStore.getState().isPanelOpen('session-compact-header')).toBe(false)
    expect(view.queryByTestId('workspace-panel')).toBeNull()
  })

  it('hosts several terminals per session behind inner tabs', async () => {
    useTerminalPanelStore.setState(useTerminalPanelStore.getInitialState(), true)
    await act(() => {
      useWorkspacePanelStore.getState().openPanel('session-terminals', 'terminal')
    })

    const view = await renderPanel('session-terminals')
    await flushReactWork()

    expect(view.getByRole('tab', { name: 'Terminal' }).getAttribute('aria-selected')).toBe('true')
    const terminalTabs = () => view.getAllByRole('tab').filter((tab) => /^Terminal \d$/.test(tab.textContent ?? ''))
    expect(terminalTabs()).toHaveLength(1)
    expect(view.queryByRole('button', { name: 'Close Terminal 1' })).toBeNull()

    await clickElement(view.getByRole('button', { name: 'New Terminal' }))
    expect(terminalTabs().map((tab) => tab.textContent)).toEqual(['Terminal 1', 'Terminal 2'])
    expect(terminalTabs()[1]!.getAttribute('aria-selected')).toBe('true')

    await clickElement(terminalTabs()[0]!)
    expect(useTerminalPanelStore.getState().getActiveTerminalId('session-terminals')).toBe('__session_terminal__session-terminals')
    expect(terminalTabs().map((tab) => tab.tabIndex)).toEqual([0, -1])

    terminalTabs()[0]!.focus()
    await act(() => {
      fireEvent.keyDown(terminalTabs()[0]!, { key: 'ArrowRight' })
    })
    await waitFor(() => expect(terminalTabs()[1]!.getAttribute('aria-selected')).toBe('true'))
    expect(document.activeElement).toBe(terminalTabs()[1])
    await act(() => {
      fireEvent.keyDown(terminalTabs()[1]!, { key: 'Home' })
    })
    await waitFor(() => expect(terminalTabs()[0]!.getAttribute('aria-selected')).toBe('true'))
    expect(document.activeElement).toBe(terminalTabs()[0])

    await clickElement(view.getByRole('button', { name: 'Close Terminal 2' }))
    expect(terminalTabs()).toHaveLength(1)
    expect(view.getAllByTestId('session-terminal-panel')).toHaveLength(1)

    await clickElement(view.getByRole('tab', { name: 'Files' }))
    expect(useWorkspacePanelStore.getState().getPanelTab('session-terminals')).toBe('files')
    useTerminalPanelStore.getState().clearSession('session-terminals')
  })

  it('shows a labelled skeleton while the changed view loads', async () => {
    getMocks().getWorkspaceStatusMock.mockImplementation(() => new Promise(() => {}))
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-loading': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'changed',
          hasUserSelectedView: true,
        },
      },
    }))

    const view = await renderPanel('session-loading')

    const status = (await view.findByText('Loading...')).closest('[role="status"]')
    expect(status?.querySelector('[data-slot="skeleton"]')).toBeTruthy()
  })

  it('shows explicit empty and error states in the changed view', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-empty': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'changed',
          hasUserSelectedView: true,
        },
      },
      statusBySession: {
        ...state.statusBySession,
        'session-empty': {
          state: 'ok',
          workDir: '/repo',
          repoName: 'repo',
          branch: 'main',
          isGitRepo: true,
          changedFiles: [],
        },
      },
    }))

    const view = await renderPanel('session-empty')

    expect(view.getByText('No changes')).toBeTruthy()
    expect(view.getByText('No changes').closest('[data-slot="empty"]')?.getAttribute('role')).toBe('status')

    getMocks().getWorkspaceStatusMock.mockImplementation(async (sessionId: string) => {
      if (sessionId === 'session-error') {
        throw new Error('status failed')
      }
      return useWorkspacePanelStore.getState().statusBySession[sessionId] ?? {
        state: 'ok',
        workDir: '/repo',
        repoName: 'repo',
        branch: 'main',
        isGitRepo: true,
        changedFiles: [],
      }
    })

    await setWorkspaceState((state) => ({
      ...state,
      panelBySession: {
        ...state.panelBySession,
        'session-error': {
          isOpen: true,
          tab: 'files',
          expanded: false,
          activeView: 'changed',
          hasUserSelectedView: true,
        },
      },
      errors: {
        ...state.errors,
        statusBySession: {
          ...state.errors.statusBySession,
          'session-error': 'status failed',
        },
      },
    }))

    await act(async () => {
      view.rerender(<WorkspacePanel sessionId="session-error" />)
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(view.getByText('status failed')).toBeTruthy()
    })
  })
})
