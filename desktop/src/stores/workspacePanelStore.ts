import { create } from 'zustand'
import {
  sessionsApi,
  type WorkspaceDiffResult,
  type WorkspaceReadFileResult,
  type WorkspaceStatusResult,
  type WorkspaceTreeResult,
} from '../api/sessions'
import { artifactsApi } from '../api/artifacts'
import { designApi } from '../api/design'
import { closeBrowser, submitBrowserInput } from '../lib/browserGuests'
import type { ArtifactListItem } from '../types/artifact'
import { isDesktopRuntime } from '../lib/desktopRuntime'
import { destroyTerminalRuntime } from '../lib/terminalRuntime'

export const WORKSPACE_PANEL_DEFAULT_WIDTH = 380
export const WORKSPACE_PANEL_MIN_WIDTH = 280
export const WORKSPACE_PANEL_MAX_WIDTH = 680
export const WORKSPACE_PANEL_MIN_CHAT_WIDTH = 320

export type WorkspacePreviewKind = 'file' | 'diff'
export type WorkspacePreviewState =
  | 'loading'
  | WorkspaceReadFileResult['state']
  | WorkspaceDiffResult['state']

export type WorkspacePreviewEntry = {
  id: string
  path: string
  kind: WorkspacePreviewKind
  title: string
  language?: string
  content?: string
  dataUrl?: string
  mimeType?: string
  previewType?: 'text' | 'image'
  diff?: string
  state?: WorkspacePreviewState
  error?: string
  size?: number
}

export type BrowserTabArtifact = { id: string; name: string; mtimeMs: number; canvas?: true; board?: string }

export type BrowserTabTemplate = { id: string }

export type WorkspaceTab =
  | { id: string; kind: 'launcher' }
  | { id: string; kind: 'changes' }
  | { id: string; kind: 'files' }
  | { id: string; kind: 'artifacts' }
  | { id: string; kind: 'file'; path: string; sessionId?: string }
  | { id: string; kind: 'browser'; url: string; title: string; root?: string; artifact?: BrowserTabArtifact; template?: BrowserTabTemplate }
  | { id: string; kind: 'terminal'; index: number; shell?: string; cwd?: string }
  | { id: string; kind: 'uiPage'; pageId: string; revision: number; title: string }
  | { id: string; kind: 'task'; board: string; card: number }
  | { id: string; kind: 'inbox'; board: string }

export type WorkspaceTabKind = WorkspaceTab['kind']

export type WorkspaceTabTarget =
  | { kind: 'launcher' | 'changes' | 'files' | 'artifacts' }
  | { kind: 'terminal'; cwd?: string }
  | { kind: 'file'; path: string; sessionId?: string }
  | { kind: 'browser'; url: string; root?: string; artifact?: BrowserTabArtifact; template?: BrowserTabTemplate }
  | { kind: 'uiPage'; pageId: string; revision: number; title: string }
  | { kind: 'task'; board: string; card: number }
  | { kind: 'inbox'; board: string }

export type WorkspacePanelSessionState = {
  isOpen: boolean
  expanded: boolean
  tabs: WorkspaceTab[]
  activeTabId: string | null
  recentFiles: string[]
  selectedFile: string | null
}

type WorkspacePanelLoadingState = {
  statusBySession: Record<string, boolean | undefined>
  treeBySessionPath: Record<string, boolean | undefined>
  previewById: Record<string, boolean | undefined>
}

type WorkspacePanelErrorState = {
  statusBySession: Record<string, string | null | undefined>
  treeBySessionPath: Record<string, string | null | undefined>
  previewById: Record<string, string | null | undefined>
}

type WorkspacePanelStore = {
  panelByTab: Record<string, WorkspacePanelSessionState | undefined>
  width: number
  statusBySession: Record<string, WorkspaceStatusResult | undefined>
  treeBySessionPath: Record<string, Record<string, WorkspaceTreeResult | undefined> | undefined>
  previewsBySession: Record<string, Record<string, WorkspacePreviewEntry | undefined> | undefined>
  expandedPreviewIdsBySession: Record<string, string[] | undefined>
  loading: WorkspacePanelLoadingState
  errors: WorkspacePanelErrorState

  isPanelOpen: (sessionId: string) => boolean
  isPanelExpanded: (sessionId: string) => boolean
  getActiveTab: (sessionId: string) => WorkspaceTab | null
  openTab: (sessionId: string, target: WorkspaceTabTarget) => string
  selectFile: (sessionId: string, path: string) => void
  openAddress: (sessionId: string, input: string, projectRoot: string | null) => Promise<void>
  openUrl: (sessionId: string, url: string, projectRoot: string | null) => Promise<void>
  openArtifact: (sessionId: string, item: Pick<ArtifactListItem, 'name' | 'latestMtimeMs' | 'id'> & Partial<Pick<ArtifactListItem, 'manifest'>>, root: string) => Promise<void>
  openTemplatePreview: (sessionId: string, templateId: string) => Promise<void>
  activateTab: (sessionId: string, tabId: string) => void
  closeTab: (sessionId: string, tabId: string) => void
  patchTab: (sessionId: string, tabId: string, patch: WorkspaceTabPatch) => void
  closePanel: (sessionId: string) => void
  togglePanel: (sessionId: string) => void
  toggleExpanded: (sessionId: string) => void
  setWidth: (width: number) => void
  loadStatus: (sessionId: string) => Promise<void>
  loadTree: (sessionId: string, path?: string) => Promise<void>
  expandPreview: (sessionId: string, path: string, kind: WorkspacePreviewKind) => Promise<void>
  collapsePreview: (sessionId: string, path: string, kind: WorkspacePreviewKind) => void
  togglePreview: (sessionId: string, path: string, kind: WorkspacePreviewKind) => Promise<void>
  ensurePreview: (sessionId: string, path: string, kind: WorkspacePreviewKind) => Promise<void>
  refreshPreviews: (sessionId: string) => Promise<void>
  releaseSession: (sessionId: string) => void
  clearSession: (sessionId: string) => void
}

type WorkspaceTabPatch = { url?: string; title?: string; shell?: string; artifact?: BrowserTabArtifact }

const PANEL_STORAGE_KEY = 'dreamcoder-workspace-panels'
const MAX_RECENT_FILES = 8

const DEFAULT_PANEL_STATE: WorkspacePanelSessionState = {
  isOpen: false,
  expanded: false,
  tabs: [],
  activeTabId: null,
  recentFiles: [],
  selectedFile: null,
}

const statusRequestIds = new Map<string, number>()
const treeRequestIds = new Map<string, number>()
const previewRequestIds = new Map<string, number>()

function nextRequestId(store: Map<string, number>, key: string) {
  const requestId = (store.get(key) ?? 0) + 1
  store.set(key, requestId)
  return requestId
}

function invalidateRequest(store: Map<string, number>, key: string) {
  store.set(key, (store.get(key) ?? 0) + 1)
}

function isLatestRequest(store: Map<string, number>, key: string, requestId: number) {
  return store.get(key) === requestId
}

export function clampWorkspacePanelWidth(width: number) {
  if (!Number.isFinite(width)) return WORKSPACE_PANEL_DEFAULT_WIDTH
  const rounded = Math.round(width)
  return Math.min(WORKSPACE_PANEL_MAX_WIDTH, Math.max(WORKSPACE_PANEL_MIN_WIDTH, rounded))
}

function getSessionPanelState(
  panelByTab: Record<string, WorkspacePanelSessionState | undefined>,
  sessionId: string,
) {
  return panelByTab[sessionId] ?? DEFAULT_PANEL_STATE
}

function pushRecentFile(recentFiles: string[], path: string) {
  return [path, ...recentFiles.filter((candidate) => candidate !== path)].slice(0, MAX_RECENT_FILES)
}

export function makeTreeKey(sessionId: string, path: string) {
  return `${sessionId}::${path}`
}

export function getWorkspacePreviewId(path: string, kind: WorkspacePreviewKind) {
  return `${kind}:${path}`
}

export function makePreviewKey(sessionId: string, tabId: string) {
  return `${sessionId}::${tabId}`
}

function getPathTitle(path: string) {
  if (!path) return 'Workspace'
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? path
}

function stripSessionKeys<T>(record: Record<string, T>, sessionId: string) {
  const prefix = `${sessionId}::`
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !key.startsWith(prefix)),
  ) as Record<string, T>
}

function removeRecordKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record
  const { [key]: _removed, ...rest } = record
  return rest
}

function invalidateSessionScopedRequests(store: Map<string, number>, sessionId: string) {
  const prefix = `${sessionId}::`
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      invalidateRequest(store, key)
    }
  }
}

function patchSessionPanel(
  panelByTab: Record<string, WorkspacePanelSessionState | undefined>,
  sessionId: string,
  patch: Partial<WorkspacePanelSessionState>,
) {
  return {
    ...panelByTab,
    [sessionId]: {
      ...getSessionPanelState(panelByTab, sessionId),
      ...patch,
    },
  }
}

function newTabId() {
  return crypto.randomUUID()
}

function isSameTarget(tab: WorkspaceTab, target: WorkspaceTabTarget) {
  switch (target.kind) {
    case 'changes':
    case 'files':
    case 'artifacts':
      return tab.kind === target.kind
    case 'file':
      return tab.kind === 'file' && tab.path === target.path && tab.sessionId === target.sessionId
    case 'uiPage':
      return tab.kind === 'uiPage' && tab.pageId === target.pageId && tab.revision === target.revision
    case 'task':
      return tab.kind === 'task' && tab.board === target.board && tab.card === target.card
    case 'inbox':
      return tab.kind === 'inbox' && tab.board === target.board
    case 'browser':
      if (target.artifact !== undefined) return tab.kind === 'browser' && tab.artifact?.id === target.artifact.id && tab.artifact.board === target.artifact.board
      return target.template !== undefined && tab.kind === 'browser' && tab.template?.id === target.template.id
    default:
      return false
  }
}

function createTab(target: WorkspaceTabTarget, tabs: WorkspaceTab[]): WorkspaceTab {
  const id = newTabId()
  switch (target.kind) {
    case 'file':
      return { id, kind: 'file', path: target.path, ...(target.sessionId ? { sessionId: target.sessionId } : {}) }
    case 'browser':
      return {
        id,
        kind: 'browser',
        url: target.url,
        title: '',
        ...(target.root !== undefined && { root: target.root }),
        ...(target.artifact !== undefined && { artifact: target.artifact }),
        ...(target.template !== undefined && { template: target.template }),
      }
    case 'uiPage':
      return { id, kind: 'uiPage', pageId: target.pageId, revision: target.revision, title: target.title }
    case 'task':
      return { id, kind: 'task', board: target.board, card: target.card }
    case 'inbox':
      return { id, kind: 'inbox', board: target.board }
    case 'terminal': {
      const index = Math.max(0, ...tabs.map((tab) => tab.kind === 'terminal' ? tab.index : 0)) + 1
      return { id, kind: 'terminal', index, ...(target.cwd && { cwd: target.cwd }) }
    }
    default:
      return { id, kind: target.kind }
  }
}

function disposeTab(tab: WorkspaceTab) {
  if (tab.kind === 'terminal') destroyTerminalRuntime(tab.id)
  if (tab.kind === 'browser') closeBrowser(tab.id)
}

async function isWorkspaceFile(sessionId: string, path: string) {
  const result = await sessionsApi.getWorkspaceFile(sessionId, path)
  return result.state === 'ok' || result.state === 'binary' || result.state === 'too_large'
}

export function getShellDisplayName(shell: string | undefined) {
  if (!shell) return undefined
  const name = shell.split(/[\\/]/).pop()?.replace(/\.exe$/i, '')
  return name || undefined
}

type StoredPanel = Pick<WorkspacePanelSessionState, 'isOpen' | 'tabs' | 'activeTabId' | 'recentFiles' | 'selectedFile'>

function isStoredBrowserTabArtifact(value: unknown): value is BrowserTabArtifact {
  if (!value || typeof value !== 'object') return false
  const artifact = value as Record<string, unknown>
  return typeof artifact.id === 'string' && typeof artifact.name === 'string' && typeof artifact.mtimeMs === 'number'
    && (artifact.board === undefined || typeof artifact.board === 'string')
    && (artifact.canvas === undefined || artifact.canvas === true)
}

function isStoredBrowserTabTemplate(value: unknown): value is BrowserTabTemplate {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).id === 'string'
}

function isStoredTab(value: unknown): value is WorkspaceTab {
  if (!value || typeof value !== 'object') return false
  const tab = value as Record<string, unknown>
  if (typeof tab.id !== 'string') return false
  switch (tab.kind) {
    case 'launcher':
    case 'changes':
    case 'files':
    case 'artifacts':
      return true
    case 'file':
      return typeof tab.path === 'string' && (tab.sessionId === undefined || typeof tab.sessionId === 'string')
    case 'browser':
      return typeof tab.url === 'string' && typeof tab.title === 'string'
        && (tab.root === undefined || typeof tab.root === 'string')
        && (tab.artifact === undefined || isStoredBrowserTabArtifact(tab.artifact))
        && (tab.template === undefined || isStoredBrowserTabTemplate(tab.template))
    case 'uiPage':
      return typeof tab.pageId === 'string' && typeof tab.revision === 'number' && typeof tab.title === 'string'
    case 'task':
      return typeof tab.board === 'string' && typeof tab.card === 'number'
    case 'inbox':
      return typeof tab.board === 'string'
    default:
      return false
  }
}

function restorePanel(value: unknown): WorkspacePanelSessionState | null {
  if (!value || typeof value !== 'object') return null
  const stored = value as Partial<Record<keyof StoredPanel, unknown>>
  const tabs = Array.isArray(stored.tabs) ? stored.tabs.filter(isStoredTab) : []
  const activeTabId = tabs.some((tab) => tab.id === stored.activeTabId) ? stored.activeTabId as string : tabs.at(-1)?.id ?? null
  const recentFiles = Array.isArray(stored.recentFiles) ? stored.recentFiles.filter((path): path is string => typeof path === 'string') : []
  const selectedFile = typeof stored.selectedFile === 'string' ? stored.selectedFile : null
  return { ...DEFAULT_PANEL_STATE, isOpen: stored.isOpen === true && tabs.length > 0, tabs, activeTabId, recentFiles, selectedFile }
}

function readStoredPanels(): Record<string, WorkspacePanelSessionState | undefined> {
  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([sessionId, value]) => {
        const panel = restorePanel(value)
        return panel ? [[sessionId, panel]] : []
      }),
    )
  } catch (error) {
    console.warn('[workspace] Failed to restore side panel tabs', error)
    return {}
  }
}

function writeStoredPanels(panelByTab: Record<string, WorkspacePanelSessionState | undefined>) {
  const stored = Object.fromEntries(
    Object.entries(panelByTab).flatMap(([sessionId, panel]) => {
      if (!panel) return []
      const tabs = panel.tabs.filter((tab) => tab.kind !== 'terminal')
      if (tabs.length === 0 && panel.recentFiles.length === 0) return []
      const value: StoredPanel = { isOpen: panel.isOpen, tabs, activeTabId: panel.activeTabId, recentFiles: panel.recentFiles, selectedFile: panel.selectedFile }
      return [[sessionId, value]]
    }),
  )
  try {
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(stored))
  } catch (error) {
    console.warn('[workspace] Failed to save side panel tabs', error)
  }
}

export const useWorkspacePanelStore = create<WorkspacePanelStore>((set, get) => ({
  panelByTab: readStoredPanels(),
  width: WORKSPACE_PANEL_DEFAULT_WIDTH,
  statusBySession: {},
  treeBySessionPath: {},
  previewsBySession: {},
  expandedPreviewIdsBySession: {},
  loading: {
    statusBySession: {},
    treeBySessionPath: {},
    previewById: {},
  },
  errors: {
    statusBySession: {},
    treeBySessionPath: {},
    previewById: {},
  },

  isPanelOpen: (sessionId) => getSessionPanelState(get().panelByTab, sessionId).isOpen,
  isPanelExpanded: (sessionId) => {
    const panel = getSessionPanelState(get().panelByTab, sessionId)
    return panel.isOpen && panel.expanded
  },
  getActiveTab: (sessionId) => {
    const panel = getSessionPanelState(get().panelByTab, sessionId)
    return panel.tabs.find((tab) => tab.id === panel.activeTabId) ?? null
  },

  openTab: (sessionId, target) => {
    const panel = getSessionPanelState(get().panelByTab, sessionId)
    const existing = panel.tabs.find((tab) => isSameTarget(tab, target))
    const active = panel.tabs.find((tab) => tab.id === panel.activeTabId)
    const replaced = active?.kind === 'launcher' && target.kind !== 'launcher' ? active : null
    const tab = existing ?? createTab(target, panel.tabs)
    const tabs = existing
      ? panel.tabs.filter((candidate) => candidate !== replaced)
      : replaced
        ? panel.tabs.map((candidate) => candidate === replaced ? tab : candidate)
        : [...panel.tabs, tab]
    const recentFiles = target.kind === 'file' ? pushRecentFile(panel.recentFiles, target.path) : panel.recentFiles
    set((state) => ({
      panelByTab: patchSessionPanel(state.panelByTab, sessionId, { isOpen: true, tabs, activeTabId: tab.id, recentFiles }),
    }))
    return tab.id
  },

  selectFile: (sessionId, path) => {
    const panel = getSessionPanelState(get().panelByTab, sessionId)
    const recentFiles = pushRecentFile(panel.recentFiles, path)
    set((state) => ({
      panelByTab: patchSessionPanel(state.panelByTab, sessionId, { selectedFile: path, recentFiles }),
    }))
    get().openTab(sessionId, { kind: 'files' })
  },

  openAddress: async (sessionId, input, projectRoot) => {
    const value = input.trim()
    if (!value) return
    if (!isDesktopRuntime() || await isWorkspaceFile(sessionId, value)) {
      get().selectFile(sessionId, value)
      return
    }
    await get().openUrl(sessionId, value, projectRoot)
  },

  openUrl: async (sessionId, url, projectRoot) => {
    const tabId = get().openTab(sessionId, { kind: 'browser', url: '' })
    await submitBrowserInput(sessionId, tabId, url, projectRoot)
  },

  openArtifact: async (sessionId, item, root) => {
    if (!item.id) throw new Error('This artifact has no id')
    const target: WorkspaceTabTarget = { kind: 'browser', url: '', root, artifact: { id: item.id, name: item.name, mtimeMs: item.latestMtimeMs, ...(item.manifest?.kind === 'canvas' && { canvas: true as const }) } }
    const panel = getSessionPanelState(get().panelByTab, sessionId)
    if (panel.tabs.some((tab) => isSameTarget(tab, target))) {
      get().openTab(sessionId, target)
      return
    }
    const opened = await artifactsApi.open(root, item.name)
    const tabId = get().openTab(sessionId, target)
    await submitBrowserInput(sessionId, tabId, opened.filePath, opened.rootDir)
  },

  openTemplatePreview: async (sessionId, templateId) => {
    const target: WorkspaceTabTarget = { kind: 'browser', url: '', template: { id: templateId } }
    const panel = getSessionPanelState(get().panelByTab, sessionId)
    if (panel.tabs.some((tab) => isSameTarget(tab, target))) {
      get().openTab(sessionId, target)
      return
    }
    const opened = await designApi.preview(templateId)
    const tabId = get().openTab(sessionId, { ...target, root: opened.rootDir })
    await submitBrowserInput(sessionId, tabId, opened.filePath, opened.rootDir)
  },

  activateTab: (sessionId, tabId) =>
    set((state) => {
      const panel = getSessionPanelState(state.panelByTab, sessionId)
      if (!panel.tabs.some((tab) => tab.id === tabId)) return state
      return { panelByTab: patchSessionPanel(state.panelByTab, sessionId, { activeTabId: tabId }) }
    }),

  closeTab: (sessionId, tabId) => {
    const panel = getSessionPanelState(get().panelByTab, sessionId)
    const index = panel.tabs.findIndex((tab) => tab.id === tabId)
    if (index < 0) return
    disposeTab(panel.tabs[index]!)
    const tabs = panel.tabs.filter((tab) => tab.id !== tabId)
    const activeTabId = panel.activeTabId === tabId
      ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null
      : panel.activeTabId
    set((state) => ({
      panelByTab: patchSessionPanel(state.panelByTab, sessionId, {
        tabs,
        activeTabId,
        ...(tabs.length === 0 ? { isOpen: false, expanded: false } : {}),
      }),
    }))
  },

  patchTab: (sessionId, tabId, patch) =>
    set((state) => {
      const panel = state.panelByTab[sessionId]
      const tab = panel?.tabs.find((candidate) => candidate.id === tabId)
      if (!panel || !tab) return state
      const next = { ...tab, ...patch } as WorkspaceTab
      if (Object.keys(patch).every((key) => tab[key as keyof WorkspaceTab] === next[key as keyof WorkspaceTab])) return state
      return {
        panelByTab: patchSessionPanel(state.panelByTab, sessionId, {
          tabs: panel.tabs.map((candidate) => candidate.id === tabId ? next : candidate),
        }),
      }
    }),

  closePanel: (sessionId) =>
    set((state) => ({
      panelByTab: patchSessionPanel(state.panelByTab, sessionId, {
        isOpen: false,
        expanded: false,
      }),
    })),

  togglePanel: (sessionId) => {
    const panel = getSessionPanelState(get().panelByTab, sessionId)
    if (panel.isOpen) {
      get().closePanel(sessionId)
      return
    }
    if (panel.tabs.length === 0) {
      get().openTab(sessionId, { kind: 'launcher' })
      return
    }
    set((state) => ({ panelByTab: patchSessionPanel(state.panelByTab, sessionId, { isOpen: true }) }))
  },

  toggleExpanded: (sessionId) =>
    set((state) => ({
      panelByTab: patchSessionPanel(state.panelByTab, sessionId, {
        expanded: !getSessionPanelState(state.panelByTab, sessionId).expanded,
      }),
    })),

  setWidth: (width) => set({ width: clampWorkspacePanelWidth(width) }),

  loadStatus: async (sessionId) => {
    const requestId = nextRequestId(statusRequestIds, sessionId)

    set((state) => ({
      loading: {
        ...state.loading,
        statusBySession: {
          ...state.loading.statusBySession,
          [sessionId]: true,
        },
      },
      errors: {
        ...state.errors,
        statusBySession: {
          ...state.errors.statusBySession,
          [sessionId]: null,
        },
      },
    }))

    try {
      const result = await sessionsApi.getWorkspaceStatus(sessionId)
      if (!isLatestRequest(statusRequestIds, sessionId, requestId)) return

      set((state) => ({
        statusBySession: {
          ...state.statusBySession,
          [sessionId]: result,
        },
        loading: {
          ...state.loading,
          statusBySession: {
            ...state.loading.statusBySession,
            [sessionId]: false,
          },
        },
        errors: {
          ...state.errors,
          statusBySession: {
            ...state.errors.statusBySession,
            [sessionId]: result.error ?? null,
          },
        },
      }))
    } catch (error) {
      if (!isLatestRequest(statusRequestIds, sessionId, requestId)) return

      set((state) => ({
        loading: {
          ...state.loading,
          statusBySession: {
            ...state.loading.statusBySession,
            [sessionId]: false,
          },
        },
        errors: {
          ...state.errors,
          statusBySession: {
            ...state.errors.statusBySession,
            [sessionId]: error instanceof Error ? error.message : 'Failed to load workspace status',
          },
        },
      }))
    }
  },

  loadTree: async (sessionId, path = '') => {
    const treeKey = makeTreeKey(sessionId, path)
    const requestId = nextRequestId(treeRequestIds, treeKey)

    set((state) => ({
      loading: {
        ...state.loading,
        treeBySessionPath: {
          ...state.loading.treeBySessionPath,
          [treeKey]: true,
        },
      },
      errors: {
        ...state.errors,
        treeBySessionPath: {
          ...state.errors.treeBySessionPath,
          [treeKey]: null,
        },
      },
    }))

    try {
      const result = await sessionsApi.getWorkspaceTree(sessionId, path)
      if (!isLatestRequest(treeRequestIds, treeKey, requestId)) return

      set((state) => ({
        treeBySessionPath: {
          ...state.treeBySessionPath,
          [sessionId]: {
            ...state.treeBySessionPath[sessionId],
            [path]: result,
          },
        },
        loading: {
          ...state.loading,
          treeBySessionPath: {
            ...state.loading.treeBySessionPath,
            [treeKey]: false,
          },
        },
        errors: {
          ...state.errors,
          treeBySessionPath: {
            ...state.errors.treeBySessionPath,
            [treeKey]: result.error ?? null,
          },
        },
      }))
    } catch (error) {
      if (!isLatestRequest(treeRequestIds, treeKey, requestId)) return

      set((state) => ({
        loading: {
          ...state.loading,
          treeBySessionPath: {
            ...state.loading.treeBySessionPath,
            [treeKey]: false,
          },
        },
        errors: {
          ...state.errors,
          treeBySessionPath: {
            ...state.errors.treeBySessionPath,
            [treeKey]: error instanceof Error ? error.message : 'Failed to load workspace tree',
          },
        },
      }))
    }
  },

  expandPreview: async (sessionId, path, kind) => {
    const previewId = getWorkspacePreviewId(path, kind)
    set((state) => {
      const expanded = state.expandedPreviewIdsBySession[sessionId] ?? []
      if (expanded.includes(previewId)) return state
      return {
        expandedPreviewIdsBySession: {
          ...state.expandedPreviewIdsBySession,
          [sessionId]: [...expanded, previewId],
        },
      }
    })

    await get().ensurePreview(sessionId, path, kind)
  },

  collapsePreview: (sessionId, path, kind) => {
    const previewId = getWorkspacePreviewId(path, kind)
    set((state) => {
      const expanded = state.expandedPreviewIdsBySession[sessionId] ?? []
      if (!expanded.includes(previewId)) return state
      return {
        expandedPreviewIdsBySession: {
          ...state.expandedPreviewIdsBySession,
          [sessionId]: expanded.filter((id) => id !== previewId),
        },
      }
    })
  },

  togglePreview: async (sessionId, path, kind) => {
    const previewId = getWorkspacePreviewId(path, kind)
    if (get().expandedPreviewIdsBySession[sessionId]?.includes(previewId)) {
      get().collapsePreview(sessionId, path, kind)
      return
    }
    await get().expandPreview(sessionId, path, kind)
  },

  ensurePreview: async (sessionId, path, kind) => {
    const existing = get().previewsBySession[sessionId]?.[getWorkspacePreviewId(path, kind)]
    if (existing && existing.state !== 'error') return
    await loadPreview(sessionId, path, kind)
  },

  refreshPreviews: async (sessionId) => {
    invalidateSessionScopedRequests(previewRequestIds, sessionId)
    const cached = get().previewsBySession[sessionId] ?? {}
    const panel = getSessionPanelState(get().panelByTab, sessionId)
    const shownIds = new Set([
      ...get().expandedPreviewIdsBySession[sessionId] ?? [],
      ...panel.tabs.flatMap((tab) => tab.kind === 'file' ? [getWorkspacePreviewId(tab.path, 'file')] : []),
      ...(panel.selectedFile ? [getWorkspacePreviewId(panel.selectedFile, 'file')] : []),
    ])
    const kept = Object.fromEntries(
      Object.entries(cached).filter(([id, entry]) => entry && shownIds.has(id)),
    ) as Record<string, WorkspacePreviewEntry>
    // Keep expanded previews on screen while they refetch so open comment drafts survive.
    set((state) => ({
      previewsBySession: Object.keys(kept).length > 0
        ? { ...state.previewsBySession, [sessionId]: kept }
        : removeRecordKey(state.previewsBySession, sessionId),
      loading: {
        ...state.loading,
        previewById: stripSessionKeys(state.loading.previewById, sessionId),
      },
      errors: {
        ...state.errors,
        previewById: stripSessionKeys(state.errors.previewById, sessionId),
      },
    }))
    await Promise.all(
      Object.values(kept).map((entry) => loadPreview(sessionId, entry.path, entry.kind, { background: true })),
    )
  },

  releaseSession: (sessionId) => {
    const panel = get().panelByTab[sessionId]
    panel?.tabs.forEach(disposeTab)
    invalidateRequest(statusRequestIds, sessionId)
    invalidateSessionScopedRequests(treeRequestIds, sessionId)
    invalidateSessionScopedRequests(previewRequestIds, sessionId)

    set((state) => {
      const tabs = panel?.tabs.filter((tab) => tab.kind !== 'terminal') ?? []
      return {
        panelByTab: panel
          ? patchSessionPanel(state.panelByTab, sessionId, {
            tabs,
            activeTabId: tabs.some((tab) => tab.id === panel.activeTabId) ? panel.activeTabId : tabs.at(-1)?.id ?? null,
            isOpen: panel.isOpen && tabs.length > 0,
            expanded: false,
          })
          : state.panelByTab,
        statusBySession: removeRecordKey(state.statusBySession, sessionId),
        treeBySessionPath: removeRecordKey(state.treeBySessionPath, sessionId),
        previewsBySession: removeRecordKey(state.previewsBySession, sessionId),
        expandedPreviewIdsBySession: removeRecordKey(state.expandedPreviewIdsBySession, sessionId),
        loading: {
          statusBySession: removeRecordKey(state.loading.statusBySession, sessionId),
          treeBySessionPath: stripSessionKeys(state.loading.treeBySessionPath, sessionId),
          previewById: stripSessionKeys(state.loading.previewById, sessionId),
        },
        errors: {
          statusBySession: removeRecordKey(state.errors.statusBySession, sessionId),
          treeBySessionPath: stripSessionKeys(state.errors.treeBySessionPath, sessionId),
          previewById: stripSessionKeys(state.errors.previewById, sessionId),
        },
      }
    })
  },

  clearSession: (sessionId) => {
    get().releaseSession(sessionId)
    set((state) => ({ panelByTab: removeRecordKey(state.panelByTab, sessionId) }))
  },
}))

function setPreviewEntry(
  sessionId: string,
  previewId: string,
  entry: WorkspacePreviewEntry,
  loading: boolean,
  error: string | null,
) {
  const requestKey = makePreviewKey(sessionId, previewId)
  useWorkspacePanelStore.setState((state) => ({
    previewsBySession: {
      ...state.previewsBySession,
      [sessionId]: {
        ...state.previewsBySession[sessionId],
        [previewId]: entry,
      },
    },
    loading: {
      ...state.loading,
      previewById: { ...state.loading.previewById, [requestKey]: loading },
    },
    errors: {
      ...state.errors,
      previewById: { ...state.errors.previewById, [requestKey]: error },
    },
  }))
}

async function loadPreview(
  sessionId: string,
  path: string,
  kind: WorkspacePreviewKind,
  { background = false }: { background?: boolean } = {},
) {
  const previewId = getWorkspacePreviewId(path, kind)
  const requestKey = makePreviewKey(sessionId, previewId)
  const requestId = nextRequestId(previewRequestIds, requestKey)
  const baseEntry: WorkspacePreviewEntry = {
    id: previewId,
    path,
    kind,
    title: getPathTitle(path),
    state: 'loading',
  }
  const existing = useWorkspacePanelStore.getState().previewsBySession[sessionId]?.[previewId]
  if (!background || !existing || existing.state === 'loading') {
    setPreviewEntry(sessionId, previewId, baseEntry, true, null)
  }

  try {
    if (kind === 'diff') {
      const result = await sessionsApi.getWorkspaceDiff(sessionId, path)
      if (!isLatestRequest(previewRequestIds, requestKey, requestId)) return
      setPreviewEntry(sessionId, previewId, {
        ...baseEntry,
        diff: result.diff ?? '',
        state: result.state,
        error: result.error,
      }, false, result.error ?? null)
      return
    }

    const result = await sessionsApi.getWorkspaceFile(sessionId, path)
    if (!isLatestRequest(previewRequestIds, requestKey, requestId)) return
    setPreviewEntry(sessionId, previewId, {
      ...baseEntry,
      content: result.content,
      dataUrl: result.dataUrl,
      mimeType: result.mimeType,
      previewType: result.previewType ?? 'text',
      language: result.language,
      size: result.size,
      state: result.state,
      error: result.error,
    }, false, result.error ?? null)
  } catch (error) {
    if (!isLatestRequest(previewRequestIds, requestKey, requestId)) return
    const message = error instanceof Error ? error.message : 'Failed to load workspace preview'
    setPreviewEntry(sessionId, previewId, { ...baseEntry, state: 'error', error: message }, false, message)
  }
}

useWorkspacePanelStore.subscribe((state, previous) => {
  if (state.panelByTab !== previous.panelByTab) writeStoredPanels(state.panelByTab)
})
