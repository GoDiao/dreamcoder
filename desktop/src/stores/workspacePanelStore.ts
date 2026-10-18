import { create } from 'zustand'
import {
  sessionsApi,
  type WorkspaceDiffResult,
  type WorkspaceReadFileResult,
  type WorkspaceStatusResult,
  type WorkspaceTreeResult,
} from '../api/sessions'

export const WORKSPACE_PANEL_DEFAULT_WIDTH = 380
export const WORKSPACE_PANEL_MIN_WIDTH = 280
export const WORKSPACE_PANEL_MAX_WIDTH = 680
export const WORKSPACE_PANEL_MIN_CHAT_WIDTH = 320

export type WorkspacePanelTab = 'files' | 'terminal'
export type WorkspacePanelView = 'changed' | 'all'
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

export type WorkspacePanelSessionState = {
  isOpen: boolean
  tab: WorkspacePanelTab
  expanded: boolean
  activeView: WorkspacePanelView
  hasUserSelectedView?: boolean
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
  panelBySession: Record<string, WorkspacePanelSessionState | undefined>
  width: number
  statusBySession: Record<string, WorkspaceStatusResult | undefined>
  expandedPathsBySession: Record<string, string[] | undefined>
  treeBySessionPath: Record<string, Record<string, WorkspaceTreeResult | undefined> | undefined>
  previewsBySession: Record<string, Record<string, WorkspacePreviewEntry | undefined> | undefined>
  expandedPreviewIdsBySession: Record<string, string[] | undefined>
  loading: WorkspacePanelLoadingState
  errors: WorkspacePanelErrorState

  isPanelOpen: (sessionId: string) => boolean
  getPanelTab: (sessionId: string) => WorkspacePanelTab
  isPanelExpanded: (sessionId: string) => boolean
  getActiveView: (sessionId: string) => WorkspacePanelView
  openPanel: (sessionId: string, tab?: WorkspacePanelTab) => void
  closePanel: (sessionId: string) => void
  togglePanel: (sessionId: string, tab?: WorkspacePanelTab) => void
  setPanelTab: (sessionId: string, tab: WorkspacePanelTab) => void
  toggleExpanded: (sessionId: string) => void
  setWidth: (width: number) => void
  setActiveView: (sessionId: string, view: WorkspacePanelView) => void
  loadStatus: (sessionId: string) => Promise<void>
  loadTree: (sessionId: string, path?: string) => Promise<void>
  toggleTreeNode: (sessionId: string, path: string) => Promise<void>
  expandPreview: (sessionId: string, path: string, kind: WorkspacePreviewKind) => Promise<void>
  collapsePreview: (sessionId: string, path: string, kind: WorkspacePreviewKind) => void
  togglePreview: (sessionId: string, path: string, kind: WorkspacePreviewKind) => Promise<void>
  refreshPreviews: (sessionId: string) => Promise<void>
  clearSession: (sessionId: string) => void
  resetSessionUi: (sessionId: string) => void
}

const DEFAULT_PANEL_STATE: WorkspacePanelSessionState = {
  isOpen: false,
  tab: 'files',
  expanded: false,
  activeView: 'changed',
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
  panelBySession: Record<string, WorkspacePanelSessionState | undefined>,
  sessionId: string,
) {
  return panelBySession[sessionId] ?? DEFAULT_PANEL_STATE
}

function makeTreeKey(sessionId: string, path: string) {
  return `${sessionId}::${path}`
}

export function getWorkspacePreviewId(path: string, kind: WorkspacePreviewKind) {
  return `${kind}:${path}`
}

function makePreviewKey(sessionId: string, tabId: string) {
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
  panelBySession: Record<string, WorkspacePanelSessionState | undefined>,
  sessionId: string,
  patch: Partial<WorkspacePanelSessionState>,
) {
  return {
    ...panelBySession,
    [sessionId]: {
      ...getSessionPanelState(panelBySession, sessionId),
      ...patch,
    },
  }
}

export const useWorkspacePanelStore = create<WorkspacePanelStore>((set, get) => ({
  panelBySession: {},
  width: WORKSPACE_PANEL_DEFAULT_WIDTH,
  statusBySession: {},
  expandedPathsBySession: {},
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

  isPanelOpen: (sessionId) => getSessionPanelState(get().panelBySession, sessionId).isOpen,
  getPanelTab: (sessionId) => getSessionPanelState(get().panelBySession, sessionId).tab,
  isPanelExpanded: (sessionId) => {
    const panel = getSessionPanelState(get().panelBySession, sessionId)
    return panel.isOpen && panel.expanded
  },
  getActiveView: (sessionId) => getSessionPanelState(get().panelBySession, sessionId).activeView,

  openPanel: (sessionId, tab) =>
    set((state) => ({
      panelBySession: patchSessionPanel(state.panelBySession, sessionId, {
        isOpen: true,
        ...(tab ? { tab } : {}),
      }),
    })),

  closePanel: (sessionId) =>
    set((state) => ({
      panelBySession: patchSessionPanel(state.panelBySession, sessionId, {
        isOpen: false,
        expanded: false,
      }),
    })),

  togglePanel: (sessionId, tab = 'files') => {
    const panel = getSessionPanelState(get().panelBySession, sessionId)
    if (panel.isOpen && panel.tab === tab) {
      get().closePanel(sessionId)
      return
    }
    get().openPanel(sessionId, tab)
  },

  setPanelTab: (sessionId, tab) =>
    set((state) => ({
      panelBySession: patchSessionPanel(state.panelBySession, sessionId, { tab }),
    })),

  toggleExpanded: (sessionId) =>
    set((state) => ({
      panelBySession: patchSessionPanel(state.panelBySession, sessionId, {
        expanded: !getSessionPanelState(state.panelBySession, sessionId).expanded,
      }),
    })),

  setWidth: (width) => set({ width: clampWorkspacePanelWidth(width) }),

  setActiveView: (sessionId, view) =>
    set((state) => ({
      panelBySession: {
        ...state.panelBySession,
        [sessionId]: {
          ...getSessionPanelState(state.panelBySession, sessionId),
          activeView: view,
          hasUserSelectedView: true,
        },
      },
    })),

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

      set((state) => {
        const panel = getSessionPanelState(state.panelBySession, sessionId)
        const nextActiveView =
          !panel.hasUserSelectedView && result.state === 'ok'
            ? result.changedFiles.length > 0 ? 'changed' : 'all'
            : panel.activeView

        return {
          panelBySession: {
            ...state.panelBySession,
            [sessionId]: {
              ...panel,
              activeView: nextActiveView,
            },
          },
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
        }
      })
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

  toggleTreeNode: async (sessionId, path) => {
    let shouldLoad = false

    set((state) => {
      const expanded = new Set(state.expandedPathsBySession[sessionId] ?? [])
      if (expanded.has(path)) {
        expanded.delete(path)
      } else {
        expanded.add(path)
        if (!state.treeBySessionPath[sessionId]?.[path]) {
          shouldLoad = true
        }
      }

      return {
        expandedPathsBySession: {
          ...state.expandedPathsBySession,
          [sessionId]: [...expanded],
        },
      }
    })

    if (shouldLoad) {
      await get().loadTree(sessionId, path)
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

    const existing = get().previewsBySession[sessionId]?.[previewId]
    if (existing && existing.state !== 'error') return
    await loadPreview(sessionId, path, kind)
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

  refreshPreviews: async (sessionId) => {
    invalidateSessionScopedRequests(previewRequestIds, sessionId)
    const cached = get().previewsBySession[sessionId] ?? {}
    const expandedIds = new Set(get().expandedPreviewIdsBySession[sessionId] ?? [])
    const kept = Object.fromEntries(
      Object.entries(cached).filter(([id, entry]) => entry && expandedIds.has(id)),
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

  clearSession: (sessionId) => {
    invalidateRequest(statusRequestIds, sessionId)
    invalidateSessionScopedRequests(treeRequestIds, sessionId)
    invalidateSessionScopedRequests(previewRequestIds, sessionId)

    set((state) => ({
      panelBySession: removeRecordKey(state.panelBySession, sessionId),
      statusBySession: removeRecordKey(state.statusBySession, sessionId),
      expandedPathsBySession: removeRecordKey(state.expandedPathsBySession, sessionId),
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
    }))
  },

  resetSessionUi: (sessionId) => {
    get().clearSession(sessionId)
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
