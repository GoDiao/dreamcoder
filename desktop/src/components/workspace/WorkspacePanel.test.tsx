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
    view = render(<WorkspacePanel panelId={sessionId} sessionTitle="Session" />)
    await Promise.resolve()
  })
  return view
}

async function clickElement(element: Element) {
  await act(async () => {
    fireEvent(element, Object.assign(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }), { pointerType: 'mouse' }))
    fireEvent.mouseDown(element, { button: 0 })
    fireEvent.mouseDown(element, { button: 0 })
    fireEvent(element, Object.assign(new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }), { pointerType: 'mouse' }))
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
    fireEvent.mouseDown(code, { button: 0 })
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
    fireEvent.mouseDown(target ?? container, { button: 0 })
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

vi.mock('../../pages/TerminalSettings', () => ({ TerminalSettings: () => null }))

vi.mock('@pierre/trees/react', async () => {
  const React = await import('react')
  type TreeOptions = { onSelectionChange?: (paths: readonly string[]) => void }
  type TreeItem = { path: string; name: string; kind: 'directory' | 'file' }
  type TreeContext = { close: () => void; anchorRect: { left: number; top: number; width: number; height: number } }
  function createModel(options: TreeOptions) {
    let paths: string[] = []
    const expanded = new Set<string>()
    const selected = new Set<string>()
    const listeners = new Set<() => void>()
    const notify = () => listeners.forEach((listener) => listener())
    return {
      options,
      paths: () => paths,
      isExpanded: (path: string) => expanded.has(path),
      resetPaths: (next: readonly string[]) => { paths = [...next]; notify() },
      batch: (operations: readonly { type: string; path: string }[]) => {
        for (const operation of operations) {
          if (operation.type === 'remove' && !paths.includes(operation.path)) throw new Error(`Path does not exist: "${operation.path}"`)
          paths = operation.type === 'add' ? [...paths, operation.path] : paths.filter((path) => path !== operation.path && !path.startsWith(operation.path))
        }
        notify()
      },
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      getItem: (path: string) => paths.includes(path)
        ? { isDirectory: () => path.endsWith('/'), isExpanded: () => expanded.has(path), expand: () => { expanded.add(path); notify() }, select: () => { selected.add(path) }, deselect: () => { selected.delete(path) }, isSelected: () => selected.has(path) }
        : null,
      focused: null as string | null,
      focusPath(path: string) { this.focused = path; notify() },
      scrollToPath: () => {},
      getSelectedPaths: () => [...selected],
      setSearch: () => {},
      toggle: (path: string) => { if (expanded.has(path)) expanded.delete(path); else expanded.add(path); notify() },
      choose: (path: string) => { selected.clear(); selected.add(path); options.onSelectionChange?.([path]) },
    }
  }
  type Model = ReturnType<typeof createModel>
  return {
    useFileTree: (options: TreeOptions) => {
      const [model] = React.useState(() => createModel(options))
      return { model }
    },
    FileTree: ({ model, renderContextMenu, 'aria-label': label }: { model: Model; renderContextMenu?: (item: TreeItem, context: TreeContext) => React.ReactNode; 'aria-label'?: string }) => {
      const [, rerender] = React.useReducer((count: number) => count + 1, 0)
      const [menu, setMenu] = React.useState<{ item: TreeItem; context: TreeContext } | null>(null)
      React.useEffect(() => model.subscribe(rerender), [model])
      const visible = model.paths().filter((path) => {
        const segments = path.replace(/\/$/, '').split('/')
        return segments.slice(0, -1).every((_, index) => {
          const directory = `${segments.slice(0, index + 1).join('/')}/`
          return !model.paths().includes(directory) || model.isExpanded(directory)
        })
      })
      return React.createElement('div', { role: 'tree', 'aria-label': label },
        ...visible.map((path) => {
          const isDirectory = path.endsWith('/')
          const clean = path.replace(/\/$/, '')
          const name = clean.split('/').pop() ?? clean
          return React.createElement('button', {
            key: path,
            type: 'button',
            role: 'treeitem',
            'aria-label': clean,
            'aria-expanded': isDirectory ? model.isExpanded(path) : undefined,
            onClick: () => (isDirectory ? model.toggle(path) : model.choose(clean)),
            onContextMenu: (event: React.MouseEvent) => {
              event.preventDefault()
              setMenu({ item: { path, name, kind: isDirectory ? 'directory' : 'file' }, context: { close: () => setMenu(null), anchorRect: { left: 0, top: 0, width: 0, height: 0 } } })
            },
          }, name)
        }),
        menu && renderContextMenu ? renderContextMenu(menu.item, menu.context) : null,
      )
    },
  }
})

vi.mock('./BrowserView', () => ({
  BrowserView: ({ tab, projectRoot }: { tab: { id: string }; projectRoot: string | null }) => (
    <div data-testid="browser-view" data-tab={tab.id} data-root={projectRoot ?? ''} />
  ),
}))

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
import { useWorkspacePanelStore, type WorkspacePreviewEntry, type WorkspaceTab } from '../../stores/workspacePanelStore'
import { toast } from 'sonner'
import { ELECTRON_BRIDGE_KEY } from '../../lib/shell/electronBridge'
import { WorkspacePanel } from './WorkspacePanel'

type WorkspaceStoreState = ReturnType<typeof useWorkspacePanelStore.getState>

function panelState(...tabs: WorkspaceTab[]) {
  return { isOpen: true, expanded: false, tabs, activeTabId: tabs[0]?.id ?? null, recentFiles: [], selectedFile: null }
}

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
    panelByTab: {
      ...state.panelByTab,
      [sessionId]: fileEntries.length > 0
        ? panelState(...fileEntries.map((entry) => ({ id: `file:${entry.path}`, kind: 'file' as const, path: entry.path })))
        : panelState({ id: 'changes', kind: 'changes' }),
    },
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
    localStorage.clear()
    delete (window as unknown as Record<string, unknown>)[ELECTRON_BRIDGE_KEY]
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
      useWorkspacePanelStore.getState().openTab('session-changed', { kind: 'changes' })
    })

    const view = await renderPanel('session-changed')

    expect(view.getByRole('tab', { name: 'Changes' }).getAttribute('aria-selected')).toBe('true')

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
    expect(view.getByTestId('workspace-file-body')).toBeTruthy()
    expect(view.getByRole('button', { name: 'src/app.ts', expanded: true })).toBeTruthy()
    expect(previewQueries(view).getByRole('button', { name: 'Comment line 1' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Open file' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'More file actions' })).toBeTruthy()

    await clickElement(row)
    expect(view.queryByTestId('workspace-file-body')).toBeNull()
    await clickElement(row)
    expect(getMocks().getWorkspaceDiffMock).toHaveBeenCalledTimes(1)
  })

  it('reloads a stale status when the panel opens', async () => {
    getMocks().getWorkspaceStatusMock.mockResolvedValue({
      state: 'ok',
      workDir: '/repo',
      repoName: 'repo',
      branch: 'main',
      isGitRepo: true,
      changedFiles: [{ path: 'src/Fresh.ts', status: 'modified', additions: 4, deletions: 1 }],
    })

    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: { ...state.panelByTab, 'session-stale': panelState({ id: 'changes', kind: 'changes' }) },
      statusBySession: {
        ...state.statusBySession,
        'session-stale': { state: 'ok', workDir: '/repo', repoName: 'repo', branch: 'main', isGitRepo: true, changedFiles: [] },
      },
    }))

    const view = await renderPanel('session-stale')

    await waitFor(() => {
      expect(view.getByRole('button', { name: 'src/Fresh.ts' })).toBeTruthy()
    })
    expect(getMocks().getWorkspaceStatusMock).toHaveBeenCalledWith('session-stale')
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
      useWorkspacePanelStore.getState().openTab('session-running-open', { kind: 'changes' })
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
      useWorkspacePanelStore.getState().openTab('session-non-git', { kind: 'changes' })
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

  it('lazy loads the tree, expands directories and previews a file inside the files tab', async () => {
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

    getMocks().getWorkspaceTreeMock
      .mockReturnValueOnce(rootTreeRequest.promise)
      .mockReturnValueOnce(childTreeRequest.promise)
    getMocks().getWorkspaceFileMock.mockReturnValue(fileRequest.promise)

    await act(() => {
      useWorkspacePanelStore.getState().openTab('session-tree', { kind: 'files' })
    })

    const view = await renderPanel('session-tree')

    expect(view.getByRole('tab', { name: 'Files' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => {
      expect(getMocks().getWorkspaceTreeMock).toHaveBeenCalledWith('session-tree', '')
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

    const folderButton = (await view.findByText('src')).closest('button')
    if (!folderButton) {
      throw new Error('Expected src label to be rendered inside a folder button')
    }
    expect(folderButton.getAttribute('aria-expanded')).toBe('false')
    expect(view.getByText('README.md').closest('button')?.hasAttribute('aria-expanded')).toBe(false)

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

    await clickElement((await view.findByText('index.ts')).closest('button')!)

    expect(view.getByRole('tab', { name: 'Files' }).getAttribute('aria-selected')).toBe('true')
    expect(view.queryByRole('tab', { name: 'index.ts' })).toBeNull()
    expect(useWorkspacePanelStore.getState().panelByTab['session-tree']?.selectedFile).toBe('src/index.ts')
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
    expect(within(view.getByRole('navigation', { name: 'File path' })).getAllByRole('button').map((segment) => segment.textContent)).toEqual(['repo', 'src', 'index.ts'])
    expect(view.getByRole('treeitem', { name: 'src/index.ts' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Wrap lines' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('drops folders from the tree once their parent no longer lists them', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: { ...state.panelByTab, 'session-stale-tree': panelState({ id: 'files', kind: 'files' }) },
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-stale-tree': {
          '': { state: 'ok', path: '', entries: [{ name: 'old', path: 'old', isDirectory: true }] },
          old: { state: 'ok', path: 'old', entries: [{ name: 'a.ts', path: 'old/a.ts', isDirectory: false }] },
        },
      },
    }))

    const view = await renderPanel('session-stale-tree')
    await clickElement(view.getByRole('treeitem', { name: 'old' }))
    expect(view.getByRole('treeitem', { name: 'old/a.ts' })).toBeTruthy()

    await setWorkspaceState((state) => ({
      ...state,
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-stale-tree': {
          ...state.treeBySessionPath['session-stale-tree'],
          '': { state: 'ok', path: '', entries: [{ name: 'README.md', path: 'README.md', isDirectory: false }] },
        },
      },
    }))

    expect(view.queryByRole('treeitem', { name: 'old' })).toBeNull()
    expect(view.queryByRole('treeitem', { name: 'old/a.ts' })).toBeNull()
    expect(view.getByRole('treeitem', { name: 'README.md' })).toBeTruthy()
  })

  it('ignores a folder listing its parent no longer lists, even before the tree mounts', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: { ...state.panelByTab, 'session-stale-mount': panelState({ id: 'files', kind: 'files' }) },
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-stale-mount': {
          '': { state: 'ok', path: '', entries: [{ name: 'README.md', path: 'README.md', isDirectory: false }] },
          old: { state: 'ok', path: 'old', entries: [{ name: 'a.ts', path: 'old/a.ts', isDirectory: false }] },
        },
      },
    }))

    const view = await renderPanel('session-stale-mount')

    expect(view.getByRole('treeitem', { name: 'README.md' })).toBeTruthy()
    expect(view.queryByRole('treeitem', { name: 'old/a.ts' })).toBeNull()
  })

  it('does not report a folder load that a newer request replaced', async () => {
    type TreeResult = { state: 'ok'; path: string; entries: Array<{ name: string; path: string; isDirectory: boolean }> }
    const first = deferred<TreeResult>()
    const second = deferred<TreeResult>()
    getMocks().getWorkspaceTreeMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: { ...state.panelByTab, 'session-tree-race': panelState({ id: 'files', kind: 'files' }) },
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-tree-race': { '': { state: 'ok', path: '', entries: [{ name: 'src', path: 'src', isDirectory: true }] } },
      },
    }))

    const view = await renderPanel('session-tree-race')
    await clickElement(view.getByRole('treeitem', { name: 'src' }))
    let newer!: Promise<void>
    act(() => {
      newer = useWorkspacePanelStore.getState().loadTree('session-tree-race', 'src')
    })
    await act(async () => {
      first.resolve({ state: 'ok', path: 'src', entries: [] })
      await first.promise
    })
    expect(toast.error).not.toHaveBeenCalled()

    await act(async () => {
      second.resolve({ state: 'ok', path: 'src', entries: [{ name: 'a.ts', path: 'src/a.ts', isDirectory: false }] })
      await newer
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(view.getByRole('treeitem', { name: 'src/a.ts' })).toBeTruthy()
  })

  it('reports a folder that fails to load and retries it only when expanded again', async () => {
    getMocks().getWorkspaceTreeMock.mockResolvedValue({ state: 'error', path: 'secret', entries: [], error: 'Permission denied' })
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: { ...state.panelByTab, 'session-tree-error': panelState({ id: 'files', kind: 'files' }) },
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-tree-error': { '': { state: 'ok', path: '', entries: [{ name: 'secret', path: 'secret', isDirectory: true }] } },
      },
    }))

    const view = await renderPanel('session-tree-error')
    await clickElement(view.getByRole('treeitem', { name: 'secret' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not open secret: Permission denied'))
    expect(getMocks().getWorkspaceTreeMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      fireEvent.contextMenu(view.getByRole('treeitem', { name: 'secret' }))
    })
    expect(getMocks().getWorkspaceTreeMock).toHaveBeenCalledTimes(1)

    await clickElement(view.getByRole('treeitem', { name: 'secret' }))
    await clickElement(view.getByRole('treeitem', { name: 'secret' }))
    await waitFor(() => expect(getMocks().getWorkspaceTreeMock).toHaveBeenCalledTimes(2))
  })

  it('offers the shared file and folder menus in the tree', async () => {
    Object.assign(window, { [ELECTRON_BRIDGE_KEY]: {} })
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: { ...state.panelByTab, 'session-tree-menus': panelState({ id: 'files', kind: 'files' }) },
      statusBySession: {
        ...state.statusBySession,
        'session-tree-menus': { state: 'ok', workDir: '/repo', repoName: 'repo', branch: 'main', isGitRepo: true, changedFiles: [] },
      },
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-tree-menus': { '': { state: 'ok', path: '', entries: [
          { name: 'src', path: 'src', isDirectory: true },
          { name: 'App.tsx', path: 'App.tsx', isDirectory: false },
        ] } },
      },
    }))

    const view = await renderPanel('session-tree-menus')
    await act(async () => {
      fireEvent.contextMenu(view.getByRole('treeitem', { name: 'src' }))
    })
    expect(view.getByRole('menu', { name: 'src' }).closest('[data-file-tree-context-menu-root="true"]')).toBeTruthy()
    await clickElement(view.getByRole('menuitem', { name: 'Open in Terminal' }))
    expect(useWorkspacePanelStore.getState().getActiveTab('session-tree-menus')).toMatchObject({ kind: 'terminal', cwd: '/repo/src' })

    await act(() => {
      useWorkspacePanelStore.getState().openTab('session-tree-menus', { kind: 'files' })
    })
    await act(async () => {
      fireEvent.contextMenu(view.getByRole('treeitem', { name: 'App.tsx' }))
    })
    await clickElement(view.getByRole('menuitem', { name: 'Open in new tab' }))
    expect(useWorkspacePanelStore.getState().getActiveTab('session-tree-menus')).toMatchObject({ kind: 'file', path: 'App.tsx' })
    await act(() => {
      useWorkspacePanelStore.getState().clearSession('session-tree-menus')
    })
  })

  it('hides the file tree in a narrow panel once a file is selected, until it is shown again', async () => {
    const originalObserver = globalThis.ResizeObserver
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(target: Element) {
          const size = [{ inlineSize: 400, blockSize: 600 }]
          this.callback([{ target, contentRect: { width: 400, height: 600 }, borderBoxSize: size, contentBoxSize: size } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
        }
        unobserve() {}
        disconnect() {}
      },
    })
    try {
      await setWorkspaceState((state) => ({
        ...state,
        panelByTab: { ...state.panelByTab, 'session-narrow': panelState({ id: 'files', kind: 'files' }) },
        statusBySession: {
          ...state.statusBySession,
          'session-narrow': { state: 'ok', workDir: '/repo', repoName: 'repo', branch: 'main', isGitRepo: true, changedFiles: [] },
        },
        treeBySessionPath: {
          ...state.treeBySessionPath,
          'session-narrow': { '': { state: 'ok', path: '', entries: [{ name: 'App.tsx', path: 'src/App.tsx', isDirectory: false }] } },
        },
      }))

      getMocks().getWorkspaceFileMock.mockResolvedValue({ state: 'ok', path: 'src/App.tsx', content: 'export {}', language: 'tsx', size: 9 })
      const view = await renderPanel('session-narrow')

      await clickElement(view.getByRole('treeitem', { name: 'src/App.tsx' }))
      expect(useWorkspacePanelStore.getState().panelByTab['session-narrow']?.selectedFile).toBe('src/App.tsx')
      expect(view.queryByRole('tree')).toBeNull()
      await clickElement(view.getByRole('button', { name: 'Show file tree' }))
      expect(view.getByRole('treeitem', { name: 'src/App.tsx' })).toBeTruthy()
      expect(view.getByRole('button', { name: 'Hide file tree' }).getAttribute('aria-pressed')).toBe('true')
    } finally {
      Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: originalObserver })
    }
  })

  it('opens a tree file in its own tab from the context menu', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: { ...state.panelByTab, 'session-tree-tab': panelState({ id: 'files', kind: 'files' }) },
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-tree-tab': { '': { state: 'ok', path: '', entries: [{ name: 'App.tsx', path: 'App.tsx', isDirectory: false }] } },
      },
    }))
    getMocks().getWorkspaceFileMock.mockResolvedValue({ state: 'ok', path: 'App.tsx', content: 'export {}', language: 'typescript', size: 9 })

    const view = await renderPanel('session-tree-tab')
    await act(() => {
      fireEvent.contextMenu(view.getByRole('treeitem', { name: 'App.tsx' }))
    })
    await clickElement(view.getByRole('menuitem', { name: 'Open in new tab' }))

    expect(view.getByRole('tab', { name: 'App.tsx' }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps several changed files expanded at once and collapses only the clicked one', async () => {
    await setWorkspaceState((state) => ({
      ...state,
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

    expect(panel.className).toContain('bg-background')
    expect(panel.className).not.toContain('bg-white')
    expect(classNameContains(codeSurface, 'bg-code')).toBe(true)
    expect(classNameContains(codeSurface, 'bg-white')).toBe(false)
  })

  it('can expand long diff previews beyond the default rendered line cap', async () => {
    const longDiff = Array.from({ length: 2300 }, (_, index) => `+line ${index + 1}`).join('\n')

    await setWorkspaceState((state) => ({
      ...state,
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
      panelByTab: {
        ...state.panelByTab,
        'session-image-preview': panelState({ id: 'files', kind: 'files' }),
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

  it('shows markdown source first and the formatted document from the preview toggle', async () => {
    await setWorkspaceState((state) => ({
      ...state,
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

    expect(previewText(view)).toContain('# Project Notes')
    expect(view.queryByRole('heading', { name: 'Project Notes' })).toBeNull()

    await clickElement(view.getByRole('button', { name: 'Show preview' }))

    expect(view.getByRole('button', { name: 'Show preview' }).getAttribute('aria-pressed')).toBe('true')
    expect(view.getByRole('heading', { name: 'Project Notes', level: 1 })).toBeTruthy()
    expect(view.getByText('Done')).toBeTruthy()
    expect(view.container.textContent).toContain('export const ok = true')
    expect(view.queryByTestId('workspace-code')).toBeNull()
  })

  it('comments on a diff line and adds the file from the changed row menu', async () => {
    await setWorkspaceState((state) => ({
      ...state,
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

    await clickElement(previewQueries(view).getByRole('button', { name: 'Comment line 5' }))
    expect(view.getByText('Line 5')).toBeTruthy()
    await act(() => {
      fireEvent.change(view.getByPlaceholderText('Add a comment'), {
        target: { value: 'Use the default port' },
      })
    })
    await clickElement(view.getByRole('button', { name: 'Add comment to chat' }))

    await act(async () => {
      fireEvent.keyDown(view.getByRole('button', { name: 'More file actions' }), { key: 'Enter' })
    })
    expect(view.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
    expect(view.getByRole('menuitem', { name: 'Open file' })).toBeTruthy()
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

    await clickElement(view.getByRole('button', { name: 'Open file' }))
    expect(useWorkspacePanelStore.getState().getActiveTab('session-preview-menu')).toMatchObject({ kind: 'files' })
    expect(useWorkspacePanelStore.getState().panelByTab['session-preview-menu']?.selectedFile).toBe('vite.config.js')
  })

  it('offers chat, comment and copy actions from the right-click menu of a code preview', async () => {
    const originalClipboard = navigator.clipboard
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      await setWorkspaceState((state) => ({
        ...state,
        ...seedExpandedPreviews(state, 'session-code-menu', [{
          id: 'file:src/App.ts',
          path: 'src/App.ts',
          kind: 'file',
          title: 'App.ts',
          language: 'text',
          content: 'const a = 1\nconst b = 2',
          state: 'ok',
          size: 24,
        }]),
      }))

      const view = await renderPanel('session-code-menu')
      const openMenuOnLine = (line: number) => act(async () => {
        fireEvent.contextMenu(view.container.querySelector(`[data-workspace-line-number="${line}"]`)!, { clientX: 40, clientY: 40 })
      })

      await openMenuOnLine(2)
      expect(view.getByRole('menuitem', { name: 'Add to chat' })).toBeTruthy()
      expect(view.getByRole('menuitem', { name: 'Copy' }).getAttribute('aria-disabled')).toBe('true')
      expect(view.getByRole('menuitem', { name: 'Select all' })).toBeTruthy()
      expect(view.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
      await clickElement(view.getByRole('menuitem', { name: 'Add comment' }))
      await waitFor(() => expect(document.activeElement).toBe(view.getByRole('textbox', { name: 'Line 2' })))
      await flushReactWork()
      expect(document.activeElement).toBe(view.getByRole('textbox', { name: 'Line 2' }))

      const lineOne = view.container.querySelector('[data-workspace-line-number="1"]')!
      fireEvent.mouseOver(lineOne)
      expect(view.container.querySelector('[data-workspace-code]')?.parentElement?.querySelector('span[aria-hidden="true"][data-line]')).toBeTruthy()
      const lineOneButton = view.getByRole('button', { name: 'Comment line 1' })
      expect(fireEvent.mouseDown(lineOneButton)).toBe(false)
      expect(document.activeElement).toBe(view.getByRole('textbox', { name: 'Line 2' }))
      fireEvent.click(lineOneButton)
      await waitFor(() => expect(document.activeElement).toBe(view.getByRole('textbox', { name: 'Line 1' })))
      await act(async () => {
        fireEvent.keyDown(view.getByRole('textbox', { name: 'Line 1' }), { key: 'Escape' })
      })

      await openMenuOnLine(1)
      await clickElement(view.getByRole('menuitem', { name: 'Copy file contents' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('const a = 1\nconst b = 2'))

      await selectWorkspaceCodeText(view, 1, 'const a', 1, 'const a')
      await openMenuOnLine(1)
      expect(view.getByRole('menuitem', { name: 'Copy' }).getAttribute('aria-disabled')).toBeNull()
      await clickElement(view.getByRole('menuitem', { name: 'Copy' }))
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('const a'))

      await selectWorkspaceCodeText(view, 1, 'const a', 1, 'const a')
      await openMenuOnLine(1)
      await clickElement(view.getByRole('menuitem', { name: 'Add to chat' }))
      expect(useWorkspaceChatContextStore.getState().referencesBySession['session-code-menu']).toMatchObject([
        { kind: 'code-selection', path: 'src/App.ts', lineStart: 1, lineEnd: 1, quote: 'const a' },
      ])
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
    }
  })

  it('adds the markdown file or the selected passage from the right-click menu of a markdown preview', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      ...seedExpandedPreviews(state, 'session-markdown-menu', [{
        id: 'file:README.md',
        path: 'README.md',
        kind: 'file',
        title: 'README.md',
        language: 'markdown',
        content: '# Project Notes\n\nShip the release.',
        state: 'ok',
        size: 34,
      }]),
    }))

    const view = await renderPanel('session-markdown-menu')
    await clickElement(view.getByRole('button', { name: 'Show preview' }))
    const paragraph = view.getByText('Ship the release.')
    const openMenu = () => act(async () => {
      fireEvent.contextMenu(paragraph, { clientX: 40, clientY: 40 })
    })

    await openMenu()
    expect(view.queryByRole('menuitem', { name: 'Add comment' })).toBeNull()
    await clickElement(view.getByRole('menuitem', { name: 'Add to chat' }))

    const range = document.createRange()
    range.selectNodeContents(paragraph.firstChild!)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    await openMenu()
    await clickElement(view.getByRole('menuitem', { name: 'Add to chat' }))

    expect(useWorkspaceChatContextStore.getState().referencesBySession['session-markdown-menu']).toMatchObject([
      { kind: 'file', path: 'README.md', absolutePath: '/repo/README.md' },
      { kind: 'code-selection', path: 'README.md', quote: 'Ship the release.', lineStart: 3, lineEnd: 3 },
    ])
  })

  it('offers only chat and copy actions for a deleted file', async () => {
    Object.assign(window, { [ELECTRON_BRIDGE_KEY]: {} })
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: { ...state.panelByTab, 'session-deleted': panelState({ id: 'changes', kind: 'changes' }) },
      statusBySession: {
        ...state.statusBySession,
        'session-deleted': {
          state: 'ok', workDir: '/repo', repoName: 'repo', branch: 'main', isGitRepo: true,
          changedFiles: [{ path: 'gone.ts', status: 'deleted', additions: 0, deletions: 3 }],
        },
      },
    }))

    const view = await renderPanel('session-deleted')
    expect(view.queryByRole('button', { name: 'Open file' })).toBeNull()
    await act(async () => {
      fireEvent.keyDown(view.getByRole('button', { name: 'More file actions' }), { key: 'Enter' })
    })
    expect(view.getByRole('menuitem', { name: 'Add to chat' })).toBeTruthy()
    expect(view.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
    expect(view.queryByRole('menuitem', { name: 'Open file' })).toBeNull()
  })

  it('loads missing parent folders before revealing a path segment', async () => {
    getMocks().getWorkspaceTreeMock.mockImplementation(async (_sessionId: string, path: string) => (
      path === 'src'
        ? { state: 'ok', path, entries: [{ name: 'lib', path: 'src/lib', isDirectory: true }] }
        : { state: 'ok', path, entries: [{ name: 'a.ts', path: 'src/lib/a.ts', isDirectory: false }] }
    ))
    getMocks().getWorkspaceFileMock.mockResolvedValue({ state: 'ok', path: 'src/lib/a.ts', content: 'export {}', language: 'ts', size: 9 })
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: { ...state.panelByTab, 'session-reveal-load': { ...panelState({ id: 'files', kind: 'files' }), selectedFile: 'src/lib/a.ts' } },
      statusBySession: {
        ...state.statusBySession,
        'session-reveal-load': { state: 'ok', workDir: '/repo', repoName: 'repo', branch: 'main', isGitRepo: true, changedFiles: [] },
      },
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-reveal-load': { '': { state: 'ok', path: '', entries: [{ name: 'src', path: 'src', isDirectory: true }] } },
      },
    }))

    const view = await renderPanel('session-reveal-load')
    await clickElement(within(view.getByRole('navigation', { name: 'File path' })).getByRole('button', { name: 'a.ts' }))

    await waitFor(() => expect(view.getByRole('treeitem', { name: 'src/lib' }).getAttribute('aria-expanded')).toBe('true'))
    expect(getMocks().getWorkspaceTreeMock).toHaveBeenCalledWith('session-reveal-load', 'src')
    expect(getMocks().getWorkspaceTreeMock).toHaveBeenCalledWith('session-reveal-load', 'src/lib')
    expect(view.getByRole('treeitem', { name: 'src' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('reveals a path segment in the file tree and opens a terminal in it from its menu', async () => {
    Object.assign(window, { [ELECTRON_BRIDGE_KEY]: {} })
    getMocks().getWorkspaceFileMock.mockResolvedValue({ state: 'ok', path: 'src/index.ts', content: 'export {}', language: 'ts', size: 9 })
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: { ...state.panelByTab, 'session-crumbs': { ...panelState({ id: 'files', kind: 'files' }), selectedFile: 'src/index.ts' } },
      statusBySession: {
        ...state.statusBySession,
        'session-crumbs': { state: 'ok', workDir: '/repo', repoName: 'repo', branch: 'main', isGitRepo: true, changedFiles: [] },
      },
      treeBySessionPath: {
        ...state.treeBySessionPath,
        'session-crumbs': {
          '': { state: 'ok', path: '', entries: [{ name: 'src', path: 'src', isDirectory: true }] },
          src: { state: 'ok', path: 'src', entries: [{ name: 'index.ts', path: 'src/index.ts', isDirectory: false }] },
        },
      },
    }))

    const view = await renderPanel('session-crumbs')
    const crumbs = within(view.getByRole('navigation', { name: 'File path' }))
    expect(view.getByRole('treeitem', { name: 'src' }).getAttribute('aria-expanded')).toBe('false')

    await clickElement(crumbs.getByRole('button', { name: 'src' }))
    expect(view.getByRole('treeitem', { name: 'src' }).getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      fireEvent.contextMenu(crumbs.getByRole('button', { name: 'src' }), { clientX: 40, clientY: 20 })
    })
    await clickElement(view.getByRole('menuitem', { name: 'Open in Terminal' }))
    expect(useWorkspacePanelStore.getState().getActiveTab('session-crumbs')).toMatchObject({ kind: 'terminal', cwd: '/repo/src' })
    await act(() => {
      useWorkspacePanelStore.getState().clearSession('session-crumbs')
    })
  })

  it('keeps a diff line-comment draft open while previews refresh', async () => {
    await setWorkspaceState((state) => ({
      ...state,
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
      fireEvent.change(view.getByPlaceholderText('Add a comment'), {
        target: { value: 'Keep me' },
      })
    })

    let refresh!: Promise<void>
    await act(async () => {
      refresh = useWorkspacePanelStore.getState().refreshPreviews('session-draft')
    })
    // The old diff stays on screen while the refetch is pending.
    expect(view.queryByText('Loading preview...')).toBeNull()
    expect((view.getByPlaceholderText('Add a comment') as HTMLTextAreaElement).value).toBe('Keep me')

    await act(async () => {
      refreshed.resolve({ state: 'ok', path: 'vite.config.js', diff: '@@ -4,2 +4,3 @@\n plugins: [],\n-port: 1\n+port: 2\n+host: true' })
      await refresh
    })
    expect(previewQueries(view).getByRole('button', { name: 'Comment line 6' })).toBeTruthy()
    expect((view.getByPlaceholderText('Add a comment') as HTMLTextAreaElement).value).toBe('Keep me')
  })

  it('adds a workspace file to the chat context from the file tree menu', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: {
        ...state.panelByTab,
        'session-add-file': panelState({ id: 'files', kind: 'files' }),
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
      panelByTab: {
        ...state.panelByTab,
        'session-add-directory': panelState({ id: 'files', kind: 'files' }),
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
      panelByTab: {
        ...state.panelByTab,
        'session-cite-file': panelState({ id: 'files', kind: 'files' }),
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

    getMocks().getWorkspaceStatusMock.mockResolvedValue({ state: 'ok', workDir: '/repo', repoName: 'repo', branch: 'main', isGitRepo: true, changedFiles: [] })

    try {
      await setWorkspaceState((state) => ({
        ...state,
        panelByTab: {
          ...state.panelByTab,
          'session-copy-file': panelState({ id: 'files', kind: 'files' }),
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
      await clickElement(view.getByRole('menuitem', { name: 'Relative path' }))

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

      await clickElement(view.getByRole('menuitem', { name: 'Copy path' }))
      await clickElement(view.getByRole('menuitem', { name: 'Absolute path' }))

      await waitFor(() => {
        expect(writeText).toHaveBeenLastCalledWith('/repo/src/App.tsx')
      })
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
    const textarea = view.getByPlaceholderText('Add a comment')
    await act(() => {
      fireEvent.change(textarea, { target: { value: 'Rename this title' } })
    })
    await clickElement(view.getByRole('button', { name: 'Add comment to chat' }))

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
    expect(view.queryAllByRole('button', { name: 'Add to chat' })).toHaveLength(0)
    expect(window.getSelection()?.toString()).toBe('const title = "Todo"')
  })

  it('closes the selected-code action but keeps the selection when pressing outside the popover', async () => {
    await setWorkspaceState((state) => ({
      ...state,
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
    expect(view.getAllByRole('button', { name: 'Add to chat' })).toHaveLength(1)

    await act(async () => {
      fireEvent.pointerDown(document.body)
      await Promise.resolve()
    })
    await flushReactWork()

    expect(view.queryAllByRole('button', { name: 'Add to chat' })).toHaveLength(0)
    expect(window.getSelection()?.toString()).toBe('const title = "Todo"')
  })

  it('adds selected markdown text from a preview to the chat context', async () => {
    await setWorkspaceState((state) => ({
      ...state,
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

  it('names the tabs in the app language', async () => {
    await setSettingsState({ ...settingsInitialState, locale: 'zh' })
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: {
        ...state.panelByTab,
        'session-zh': panelState({ id: 'changes', kind: 'changes' }, { id: 'launcher', kind: 'launcher' }),
      },
    }))

    const view = await renderPanel('session-zh')

    expect(view.getByRole('tab', { name: '变更' })).toBeTruthy()
    expect(view.getByRole('tab', { name: '新标签页' })).toBeTruthy()
    expect(view.getByRole('button', { name: '关闭 变更' })).toBeTruthy()
  })

  it('switches, adds and closes tabs, and expands, restores and closes the panel', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: {
        ...state.panelByTab,
        'session-tabs': panelState({ id: 'changes', kind: 'changes' }, { id: 'files', kind: 'files' }),
      },
    }))

    const view = await renderPanel('session-tabs')
    expect(view.getByRole('tablist', { name: 'Side panel' })).toBeTruthy()
    expect(view.getByRole('tab', { name: 'Changes' }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByRole('button', { name: 'Refresh workspace' })).toBeTruthy()

    await clickElement(view.getByRole('tab', { name: 'Files' }))
    expect(useWorkspacePanelStore.getState().getActiveTab('session-tabs')?.kind).toBe('files')

    await clickElement(view.getByRole('button', { name: 'New tab' }))
    expect(view.getByRole('tab', { name: 'New tab' }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByTestId('workspace-launcher')).toBeTruthy()

    await clickElement(view.getByRole('button', { name: 'Close New tab' }))
    expect(view.queryByRole('tab', { name: 'New tab' })).toBeNull()
    expect(view.getByRole('tab', { name: 'Files' }).getAttribute('aria-selected')).toBe('true')

    expect(view.queryByRole('button', { name: 'Session' })).toBeNull()
    await clickElement(view.getByRole('button', { name: 'Expand panel' }))
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-tabs')).toBe(true)
    await clickElement(view.getByRole('button', { name: 'Restore panel' }))
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-tabs')).toBe(false)

    await clickElement(view.getByRole('button', { name: 'Expand panel' }))
    await clickElement(view.getByRole('button', { name: 'Session' }))
    expect(useWorkspacePanelStore.getState().isPanelExpanded('session-tabs')).toBe(false)

    await clickElement(view.getByRole('button', { name: 'Close panel' }))
    expect(useWorkspacePanelStore.getState().isPanelOpen('session-tabs')).toBe(false)
    expect(view.queryByTestId('workspace-panel')).toBeNull()
    expect(useWorkspacePanelStore.getState().panelByTab['session-tabs']?.tabs).toHaveLength(2)
  })

  it('keeps every terminal tab mounted and names it after its shell', async () => {
    await act(() => {
      useWorkspacePanelStore.getState().openTab('session-terminals', { kind: 'terminal' })
      useWorkspacePanelStore.getState().openTab('session-terminals', { kind: 'terminal' })
      useWorkspacePanelStore.getState().openTab('session-terminals', { kind: 'changes' })
    })

    const view = await renderPanel('session-terminals')
    await flushReactWork()

    expect(view.getByRole('tab', { name: 'Terminal 1' })).toBeTruthy()
    expect(view.getByRole('tab', { name: 'Terminal 2' })).toBeTruthy()
    const panels = view.getAllByTestId('session-terminal-panel')
    expect(panels).toHaveLength(2)
    expect(panels.every((panel) => panel.hidden)).toBe(true)

    const [first] = useWorkspacePanelStore.getState().panelByTab['session-terminals']!.tabs
    await act(() => {
      useWorkspacePanelStore.getState().patchTab('session-terminals', first!.id, { shell: 'zsh' })
    })
    await clickElement(view.getByRole('tab', { name: 'zsh 1' }))
    expect(view.getAllByTestId('session-terminal-panel').map((panel) => panel.hidden)).toEqual([false, true])

    await clickElement(view.getByRole('button', { name: 'Close Terminal 2' }))
    expect(view.getAllByTestId('session-terminal-panel')).toHaveLength(1)
    await act(() => {
      useWorkspacePanelStore.getState().clearSession('session-terminals')
    })
  })

  it('opens tools and recent pages and files from the new tab page', async () => {
    useChatStore.setState({
      sessions: {
        'session-launcher': { mirror: { uiPages: [{ pageId: 'a1b2c3d4e5f6a1b2c3d4e5f6', title: 'Plan', revision: 2 }] } } as never,
      },
    })
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: {
        ...state.panelByTab,
        'session-launcher': { ...panelState({ id: 'launcher', kind: 'launcher' }), recentFiles: ['src/app.ts'], selectedFile: null },
      },
    }))

    const view = await renderPanel('session-launcher')
    const launcher = within(view.getByTestId('workspace-launcher'))
    expect(launcher.getByRole('textbox', { name: 'Address' }).getAttribute('placeholder')).toBe('Enter a file path')
    expect(launcher.queryByRole('button', { name: 'Terminal' })).toBeNull()
    expect(launcher.queryByRole('button', { name: 'Artifacts' })).toBeNull()

    await clickElement(launcher.getByRole('button', { name: /Plan/ }))
    expect(view.getByRole('tab', { name: 'Plan · rev 2' }).getAttribute('aria-selected')).toBe('true')
    expect(view.queryByRole('tab', { name: 'New tab' })).toBeNull()
    expect(view.getByTitle('Interactive page: Plan').getAttribute('src')).toContain('/ui-pages/session-launcher/a1b2c3d4e5f6a1b2c3d4e5f6/2')

    await clickElement(view.getByRole('button', { name: 'New tab' }))
    await clickElement(within(view.getByTestId('workspace-launcher')).getByRole('button', { name: /app\.ts/ }))
    expect(useWorkspacePanelStore.getState().getActiveTab('session-launcher')).toMatchObject({ kind: 'files' })
    expect(useWorkspacePanelStore.getState().panelByTab['session-launcher']?.selectedFile).toBe('src/app.ts')
  })

  it('offers terminals and web pages from the new tab page in the desktop app only', async () => {
    Object.assign(window, { [ELECTRON_BRIDGE_KEY]: {} })
    await act(() => {
      useWorkspacePanelStore.getState().openTab('session-desktop', { kind: 'launcher' })
    })

    const view = await renderPanel('session-desktop')
    const launcher = within(view.getByTestId('workspace-launcher'))
    expect(launcher.getByRole('textbox', { name: 'Address' }).getAttribute('placeholder')).toBe('Enter a URL or a file path')
    expect(launcher.getByRole('button', { name: 'Artifacts' })).toBeTruthy()
    await clickElement(launcher.getByRole('button', { name: 'Terminal' }))

    expect(view.getByRole('tab', { name: 'Terminal 1' }).getAttribute('aria-selected')).toBe('true')
    await act(() => {
      useWorkspacePanelStore.getState().clearSession('session-desktop')
    })
  })

  it('shows a web page tab in the browser view with the session project', async () => {
    Object.assign(window, { [ELECTRON_BRIDGE_KEY]: {} })
    let tabId = ''
    await act(() => {
      tabId = useWorkspacePanelStore.getState().openTab('session-web', { kind: 'browser', url: 'http://localhost:3000/' })
    })
    await act(() => {
      useWorkspacePanelStore.getState().patchTab('session-web', tabId, { title: 'Dev server' })
    })

    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(<WorkspacePanel panelId="session-web" sessionTitle="Session" projectRoot="/repo" />)
    })

    expect(view.getByRole('tab', { name: 'Dev server' }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByTestId('browser-view').dataset).toMatchObject({ tab: tabId, root: '/repo' })
  })

  it('shows a labelled skeleton while the changed view loads', async () => {
    getMocks().getWorkspaceStatusMock.mockImplementation(() => new Promise(() => {}))
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: {
        ...state.panelByTab,
        'session-loading': panelState({ id: 'changes', kind: 'changes' }),
      },
    }))

    const view = await renderPanel('session-loading')

    const status = (await view.findByText('Loading...')).closest('[role="status"]')
    expect(status?.querySelector('[data-slot="skeleton"]')).toBeTruthy()
  })

  it('shows explicit empty and error states in the changed view', async () => {
    await setWorkspaceState((state) => ({
      ...state,
      panelByTab: {
        ...state.panelByTab,
        'session-empty': panelState({ id: 'changes', kind: 'changes' }),
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
      panelByTab: {
        ...state.panelByTab,
        'session-error': panelState({ id: 'changes', kind: 'changes' }),
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
      view.rerender(<WorkspacePanel panelId="session-error" sessionTitle="Session" />)
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(view.getByText('status failed')).toBeTruthy()
    })
  })
})
