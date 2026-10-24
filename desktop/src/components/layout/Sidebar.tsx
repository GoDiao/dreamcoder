import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ChevronDown, ChevronRight, FolderOpen, GitBranch, ListChecks, LoaderCircle, MoreHorizontal, Pencil, Pin, PinOff, Plus, RotateCcw, SquarePen, Trash2, X } from 'lucide-react'
import { DreamCoderIcon } from '../shared/DreamCoderIcon'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation, type TranslationKey } from '../../i18n'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import type { SessionListItem } from '../../types/session'
import { useTabStore, SCHEDULED_TAB_ID } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useOpenTargetStore } from '../../stores/openTargetStore'
import { desktopUiPreferencesApi, type SidebarProjectPreferences } from '../../api/desktopUiPreferences'
import { SidebarMoreMenu } from './SidebarMoreMenu'
import { useMenuNavigation } from '../../hooks/useMenuNavigation'
import { useWindowDrag } from '../../hooks/useWindowDrag'
import { ProjectManagementDialog, type SidebarProjectOrganization, type SidebarProjectSortBy } from './ProjectManagementDialog'
import { ShortcutsDialog } from './ShortcutsDialog'
import { ReportProblemDialog } from './ReportProblemDialog'
import { SearchField } from '../shared/SearchField'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)
const SESSION_LIST_AUTO_REFRESH_MS = 30_000
const SESSION_LIST_FOCUS_REFRESH_MIN_MS = 5_000
const PROJECT_ORDER_STORAGE_KEY = 'dreamcoder-sidebar-project-order'
const PROJECT_PINNED_STORAGE_KEY = 'dreamcoder-sidebar-pinned-projects'
const PROJECT_HIDDEN_STORAGE_KEY = 'dreamcoder-sidebar-hidden-projects'
const PROJECT_ORGANIZATION_STORAGE_KEY = 'dreamcoder-sidebar-project-organization'
const PROJECT_SORT_STORAGE_KEY = 'dreamcoder-sidebar-project-sort'
const PROJECT_GROUP_VISIBLE_COUNT = 6
const PROJECT_GROUP_SCROLL_COUNT = 12
const SESSION_MENU_WIDTH = 180


type ProjectGroup = {
  key: string
  title: string
  subtitle: string | null
  workDir: string | undefined
  sessions: SessionListItem[]
}

type SidebarProps = {
  isMobile?: boolean
  onRequestClose?: () => void
}

export function Sidebar({ isMobile = false, onRequestClose }: SidebarProps) {
  const t = useTranslation()
  const sessions = useSessionStore((s) => s.sessions)
  const isLoading = useSessionStore((s) => s.isLoading)
  const error = useSessionStore((s) => s.error)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const deleteSessions = useSessionStore((s) => s.deleteSessions)
  const isBatchMode = useSessionStore((s) => s.isBatchMode)
  const selectedSessionIds = useSessionStore((s) => s.selectedSessionIds)
  const enterBatchMode = useSessionStore((s) => s.enterBatchMode)
  const exitBatchMode = useSessionStore((s) => s.exitBatchMode)
  const toggleSessionSelected = useSessionStore((s) => s.toggleSessionSelected)
  const selectSessions = useSessionStore((s) => s.selectSessions)
  const deselectSessions = useSessionStore((s) => s.deselectSessions)
  const renameSession = useSessionStore((s) => s.renameSession)
  const addToast = useUIStore((s) => s.addToast)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const runningChatSessionIds = useChatStore(useShallow((s) => {
    const ids = new Set<string>()
    for (const [sessionId, session] of Object.entries(s.sessions)) {
      if (session.chatState !== 'idle') ids.add(sessionId)
    }
    return ids
  }))
  const closeTab = useTabStore((s) => s.closeTab)
  const disconnectSession = useChatStore((s) => s.disconnectSession)
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [projectContextMenu, setProjectContextMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const [createProjectMenu, setCreateProjectMenu] = useState<{ x: number; y: number } | null>(null)
  const [projectManagementOpen, setProjectManagementOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [reportProblemOpen, setReportProblemOpen] = useState(false)
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null)
  const [pendingBatchDeleteSessionIds, setPendingBatchDeleteSessionIds] = useState<string[] | null>(null)
  const [isBatchDeleting, setIsBatchDeleting] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [lastSelectedSessionId, setLastSelectedSessionId] = useState<string | null>(null)
  const [expandedProjectKeys, setExpandedProjectKeys] = useState<Set<string>>(new Set())
  const [collapsedProjectKeys, setCollapsedProjectKeys] = useState<Set<string>>(new Set())
  const [projectOrder, setProjectOrder] = useState<string[]>(() => readStoredProjectOrder())
  const [pinnedProjectKeys, setPinnedProjectKeys] = useState<Set<string>>(() => readStoredProjectPins())
  const [hiddenProjectKeys, setHiddenProjectKeys] = useState<Set<string>>(() => readStoredProjectHidden())
  const [projectOrganization, setProjectOrganizationState] = useState<SidebarProjectOrganization>(() => readStoredProjectOrganization())
  const [projectSortBy, setProjectSortByState] = useState<SidebarProjectSortBy>(() => readStoredProjectSortBy())
  const [draggingProjectKey, setDraggingProjectKey] = useState<string | null>(null)
  const [projectDropTarget, setProjectDropTarget] = useState<{ key: string; position: 'before' | 'after' } | null>(null)
  const suppressProjectClickRef = useRef<string | null>(null)
  const sessionMenuRef = useRef<HTMLDivElement>(null)
  const sessionMenuTriggerRef = useRef<HTMLElement | null>(null)
  const projectMenuRef = useRef<HTMLDivElement>(null)
  const createProjectMenuRef = useRef<HTMLDivElement>(null)
  const closeSessionMenu = useCallback(() => setContextMenu(null), [])
  const closeProjectMenu = useCallback(() => setProjectContextMenu(null), [])
  const closeCreateProjectMenu = useCallback(() => setCreateProjectMenu(null), [])
  const sessionMenuNav = useMenuNavigation({
    openKey: contextMenu?.id,
    menuRef: sessionMenuRef,
    onClose: closeSessionMenu,
    triggerRef: sessionMenuTriggerRef,
  })
  const projectMenuNav = useMenuNavigation({
    openKey: projectContextMenu?.key,
    menuRef: projectMenuRef,
    onClose: closeProjectMenu,
  })
  const createProjectMenuNav = useMenuNavigation({
    openKey: Boolean(createProjectMenu),
    menuRef: createProjectMenuRef,
    onClose: closeCreateProjectMenu,
  })
  const sidebarPreferenceRevisionRef = useRef(0)
  const refreshSessionsNow = useSessionListAutoRefresh(fetchSessions)

  useEffect(() => {
    if (!contextMenu) return
    if (!sidebarOpen) setContextMenu(null)
  }, [sidebarOpen])

  useEffect(() => {
    if (!contextMenu && !projectContextMenu && !createProjectMenu) return
    const close = () => {
      setContextMenu(null)
      setProjectContextMenu(null)
      setCreateProjectMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [contextMenu, projectContextMenu, createProjectMenu])

  const filteredSessions = useMemo(() => {
    let result = sessions
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((s) => s.title.toLowerCase().includes(q))
    }
    return result
  }, [sessions, searchQuery])

  const projectGroups = useMemo(() => groupByProject(filteredSessions, projectSortBy), [filteredSessions, projectSortBy])
  const orderedProjectGroups = useMemo(
    () => applyProjectOrder(projectGroups, projectOrder, pinnedProjectKeys, projectOrganization, projectSortBy),
    [projectGroups, projectOrder, pinnedProjectKeys, projectOrganization, projectSortBy],
  )
  const visibleProjectGroups = useMemo(() => {
    if (hiddenProjectKeys.size === 0) return orderedProjectGroups
    return orderedProjectGroups.filter((project) => (
      !hiddenProjectKeys.has(project.key)
    ))
  }, [hiddenProjectKeys, orderedProjectGroups])
  const managementProjectGroups = useMemo(
    () => applyProjectOrder(groupByProject(sessions, projectSortBy), projectOrder, pinnedProjectKeys, projectOrganization, projectSortBy),
    [pinnedProjectKeys, projectOrder, projectOrganization, projectSortBy, sessions],
  )
  const managedProjects = useMemo(
    () => managementProjectGroups.map((project) => ({
      key: project.key,
      title: project.title,
      subtitle: project.subtitle,
      pinned: pinnedProjectKeys.has(project.key),
      hidden: hiddenProjectKeys.has(project.key),
      canOpen: Boolean(project.workDir),
    })),
    [hiddenProjectKeys, managementProjectGroups, pinnedProjectKeys],
  )
  const showInitialLoading = isLoading && sessions.length === 0
  const filteredSessionIds = useMemo(() => filteredSessions.map((session) => session.id), [filteredSessions])
  const selectedCount = selectedSessionIds.size
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  )
  const runningSessionIds = useMemo(() => {
    const ids = new Set(runningChatSessionIds)
    for (const tab of tabs) {
      if (tab.type === 'session' && tab.status === 'running') ids.add(tab.sessionId)
    }
    return ids
  }, [runningChatSessionIds, tabs])
  const pendingBatchDeleteSessions = useMemo(
    () => (pendingBatchDeleteSessionIds ?? [])
      .map((sessionId) => sessionsById.get(sessionId))
      .filter((session): session is SessionListItem => Boolean(session)),
    [pendingBatchDeleteSessionIds, sessionsById],
  )
  // The mobile drawer and the desktop app slide the whole sidebar out of view
  // instead of narrowing it to the icon rail, so their layout stays expanded.
  const expanded = isMobile || isTauri ? true : sidebarOpen
  const closeMobileDrawer = useCallback(() => {
    if (isMobile) onRequestClose?.()
  }, [isMobile, onRequestClose])

  const applySidebarProjectPreferences = useCallback((preferences: SidebarProjectPreferences) => {
    setProjectOrder(preferences.projectOrder)
    setPinnedProjectKeys(new Set(preferences.pinnedProjects))
    setHiddenProjectKeys(new Set(preferences.hiddenProjects))
    setProjectOrganizationState(preferences.projectOrganization)
    setProjectSortByState(preferences.projectSortBy)
  }, [])

  const persistSidebarProjectPreferences = useCallback((preferences: SidebarProjectPreferences) => {
    const normalized = normalizeSidebarProjectPreferences(preferences)
    sidebarPreferenceRevisionRef.current += 1
    writeCachedSidebarProjectPreferences(normalized)
    void desktopUiPreferencesApi.updateSidebarPreferences(normalized).catch(() => undefined)
  }, [])

  const restoreHiddenProjectForWorkDir = useCallback((workDir: string | null | undefined) => {
    if (!workDir) return
    setHiddenProjectKeys((current) => {
      const next = new Set([...current].filter((projectKey) => !projectPathMatches(projectKey, workDir)))
      if (next.size === current.size) return current
      persistSidebarProjectPreferences(buildSidebarProjectPreferences(
        projectOrder,
        pinnedProjectKeys,
        next,
        projectOrganization,
        projectSortBy,
      ))
      return next
    })
  }, [persistSidebarProjectPreferences, pinnedProjectKeys, projectOrder, projectOrganization, projectSortBy])

  useEffect(() => {
    let cancelled = false
    const startRevision = sidebarPreferenceRevisionRef.current

    void desktopUiPreferencesApi.getPreferences()
      .then((response) => {
        if (cancelled || startRevision !== sidebarPreferenceRevisionRef.current) return

        const localPreferences = readCachedSidebarProjectPreferences()
        const serverPreferences = normalizeSidebarProjectPreferences(response.preferences.sidebar)
        const effectivePreferences = response.exists ? serverPreferences : localPreferences

        applySidebarProjectPreferences(effectivePreferences)
        writeCachedSidebarProjectPreferences(effectivePreferences)

        if (!response.exists && hasSidebarProjectPreferences(localPreferences)) {
          void desktopUiPreferencesApi.updateSidebarPreferences(localPreferences).catch(() => undefined)
        }
      })
      .catch(() => {
      })

    return () => {
      cancelled = true
    }
  }, [applySidebarProjectPreferences])

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    if (isBatchMode) return
    setProjectContextMenu(null)
    setCreateProjectMenu(null)
    sessionMenuTriggerRef.current = null
    setContextMenu({ id, x: e.clientX, y: e.clientY })
  }, [isBatchMode])

  const toggleSessionMenu = useCallback((event: React.MouseEvent<HTMLElement>, id: string) => {
    // The document-level click listener would otherwise close the menu in the same click.
    event.stopPropagation()
    setProjectContextMenu(null)
    setCreateProjectMenu(null)
    if (contextMenu?.id === id) {
      setContextMenu(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    sessionMenuTriggerRef.current = event.currentTarget
    setContextMenu({ id, x: rect.right - SESSION_MENU_WIDTH, y: rect.bottom + 4 })
  }, [contextMenu])

  const handleProjectContextMenu = useCallback((event: React.MouseEvent, projectKey: string) => {
    event.preventDefault()
    if (isBatchMode) return
    setContextMenu(null)
    setCreateProjectMenu(null)
    setProjectContextMenu({ key: projectKey, x: event.clientX, y: event.clientY })
  }, [isBatchMode])

  const handleProjectDragStart = useCallback((event: React.DragEvent, projectKey: string) => {
    if (isBatchMode) {
      event.preventDefault()
      return
    }
    suppressProjectClickRef.current = projectKey
    setDraggingProjectKey(projectKey)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', projectKey)
  }, [isBatchMode])

  const handleProjectDragOver = useCallback((event: React.DragEvent<HTMLElement>, projectKey: string) => {
    const sourceProjectKey = draggingProjectKey || event.dataTransfer.getData('text/plain')
    if (!sourceProjectKey || sourceProjectKey === projectKey) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const position = getProjectDropPosition(event)
    setProjectDropTarget((current) => (
      current?.key === projectKey && current.position === position
        ? current
        : { key: projectKey, position }
    ))
  }, [draggingProjectKey])

  const clearProjectDragState = useCallback(() => {
    setDraggingProjectKey(null)
    setProjectDropTarget(null)
    window.setTimeout(() => {
      suppressProjectClickRef.current = null
    }, 0)
  }, [])

  const handleProjectDrop = useCallback((event: React.DragEvent<HTMLElement>, targetProjectKey: string) => {
    event.preventDefault()
    const sourceProjectKey = draggingProjectKey || event.dataTransfer.getData('text/plain')
    const dropPosition = projectDropTarget?.key === targetProjectKey
      ? projectDropTarget.position
      : getProjectDropPosition(event)
    if (!sourceProjectKey || sourceProjectKey === targetProjectKey) {
      clearProjectDragState()
      return
    }

    const nextOrder = moveProjectKey(
      orderedProjectGroups.map((project) => project.key),
      sourceProjectKey,
      targetProjectKey,
      dropPosition,
    )
    setProjectOrder(nextOrder)
    persistSidebarProjectPreferences(buildSidebarProjectPreferences(nextOrder, pinnedProjectKeys, hiddenProjectKeys, projectOrganization, projectSortBy))
    clearProjectDragState()
  }, [clearProjectDragState, draggingProjectKey, hiddenProjectKeys, orderedProjectGroups, persistSidebarProjectPreferences, pinnedProjectKeys, projectDropTarget, projectOrganization, projectSortBy])

  const createSessionForWorkDir = useCallback(async (workDir?: string) => {
    try {
      const sessionId = await useSessionStore.getState().createSession(workDir)
      restoreHiddenProjectForWorkDir(workDir)
      useTabStore.getState().openTab(sessionId, t('sidebar.newSession'))
      useChatStore.getState().connectToSession(sessionId)
      closeMobileDrawer()
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('sidebar.sessionListFailed'),
      })
    }
  }, [addToast, closeMobileDrawer, restoreHiddenProjectForWorkDir, t])

  const toggleCreateProjectMenu = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (createProjectMenu) {
      setCreateProjectMenu(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 250
    setProjectContextMenu(null)
    setContextMenu(null)
    setCreateProjectMenu({
      x: Math.max(10, Math.min(rect.right - width, window.innerWidth - width - 10)),
      y: rect.bottom + 8,
    })
  }, [createProjectMenu])

  const updateProjectOrganization = useCallback((organization: SidebarProjectOrganization) => {
    setProjectOrganizationState(organization)
    const nextOrder = organization === 'project' || organization === 'time' ? [] : projectOrder
    if (nextOrder !== projectOrder) setProjectOrder(nextOrder)
    persistSidebarProjectPreferences(buildSidebarProjectPreferences(
      nextOrder,
      pinnedProjectKeys,
      hiddenProjectKeys,
      organization,
      projectSortBy,
    ))
  }, [hiddenProjectKeys, persistSidebarProjectPreferences, pinnedProjectKeys, projectOrder, projectSortBy])

  const updateProjectSortBy = useCallback((sortBy: SidebarProjectSortBy) => {
    setProjectSortByState(sortBy)
    const nextOrder: string[] = []
    setProjectOrder(nextOrder)
    persistSidebarProjectPreferences(buildSidebarProjectPreferences(
      nextOrder,
      pinnedProjectKeys,
      hiddenProjectKeys,
      projectOrganization,
      sortBy,
    ))
  }, [hiddenProjectKeys, persistSidebarProjectPreferences, pinnedProjectKeys, projectOrganization])

  const createSessionFromExistingFolder = useCallback(async () => {
    setCreateProjectMenu(null)
    if (!isTauri) {
      addToast({
        type: 'error',
        message: t('sidebar.chooseProjectFolderUnavailable'),
      })
      return
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('sidebar.useExistingFolder'),
      })
      if (typeof selected === 'string' && selected.trim()) {
        await createSessionForWorkDir(selected)
      }
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('sidebar.sessionListFailed'),
      })
    }
  }, [addToast, createSessionForWorkDir, t])

  const togglePinnedProject = useCallback((projectKey: string) => {
    setProjectContextMenu(null)
    setPinnedProjectKeys((current) => {
      const next = new Set(current)
      if (next.has(projectKey)) {
        next.delete(projectKey)
      } else {
        next.add(projectKey)
      }
      persistSidebarProjectPreferences(buildSidebarProjectPreferences(projectOrder, next, hiddenProjectKeys, projectOrganization, projectSortBy))
      return next
    })
  }, [hiddenProjectKeys, persistSidebarProjectPreferences, projectOrder, projectOrganization, projectSortBy])

  const restoreAllHiddenProjects = useCallback(() => {
    setHiddenProjectKeys((current) => {
      if (current.size === 0) return current
      const next = new Set<string>()
      persistSidebarProjectPreferences(buildSidebarProjectPreferences(
        projectOrder,
        pinnedProjectKeys,
        next,
        projectOrganization,
        projectSortBy,
      ))
      return next
    })
  }, [persistSidebarProjectPreferences, pinnedProjectKeys, projectOrder, projectOrganization, projectSortBy])

  const toggleHiddenProject = useCallback((project: ProjectGroup) => {
    const wasHidden = hiddenProjectKeys.has(project.key)
    setProjectContextMenu(null)
    setHiddenProjectKeys((current) => {
      const next = new Set(current)
      if (next.has(project.key)) {
        next.delete(project.key)
      } else {
        next.add(project.key)
      }
      persistSidebarProjectPreferences(buildSidebarProjectPreferences(projectOrder, pinnedProjectKeys, next, projectOrganization, projectSortBy))
      return next
    })
    if (!wasHidden) {
      addToast({
        type: 'info',
        message: t('sidebar.projectHidden', { project: project.title }),
      })
    }
  }, [addToast, hiddenProjectKeys, persistSidebarProjectPreferences, pinnedProjectKeys, projectOrder, projectOrganization, projectSortBy, t])

  const openProjectInFinder = useCallback(async (project: ProjectGroup) => {
    setProjectContextMenu(null)
    try {
      if (!project.workDir) {
        throw new Error(t('sidebar.openInFinderUnavailable'))
      }
      const store = useOpenTargetStore.getState()
      await store.ensureTargets()
      const latest = useOpenTargetStore.getState()
      const target = latest.targets.find((item) => item.id === 'finder')
        ?? latest.targets.find((item) => item.kind === 'file_manager')
      if (!target) {
        throw new Error(t('sidebar.openInFinderUnavailable'))
      }
      await latest.openTarget(target.id, project.workDir)
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('sidebar.openInFinderFailed'),
      })
    }
  }, [addToast, t])

  const handleDelete = useCallback((id: string) => {
    setContextMenu(null)
    setPendingDeleteSessionId(id)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteSessionId) return
    await deleteSession(pendingDeleteSessionId)
    disconnectSession(pendingDeleteSessionId)
    closeTab(pendingDeleteSessionId)
    setPendingDeleteSessionId(null)
  }, [closeTab, deleteSession, disconnectSession, pendingDeleteSessionId])

  const handleBatchSessionClick = useCallback((event: React.MouseEvent, id: string) => {
    if (event.shiftKey && lastSelectedSessionId) {
      const start = filteredSessionIds.indexOf(lastSelectedSessionId)
      const end = filteredSessionIds.indexOf(id)
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start]
        selectSessions(filteredSessionIds.slice(from, to + 1))
        setLastSelectedSessionId(id)
        return
      }
    }

    toggleSessionSelected(id)
    setLastSelectedSessionId(id)
  }, [filteredSessionIds, lastSelectedSessionId, selectSessions, toggleSessionSelected])

  const handleExitBatchMode = useCallback(() => {
    exitBatchMode()
    setLastSelectedSessionId(null)
    setPendingBatchDeleteSessionIds(null)
  }, [exitBatchMode])

  const requestBatchDelete = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    setPendingBatchDeleteSessionIds([...new Set(ids)])
  }, [])

  const confirmBatchDelete = useCallback(async () => {
    const ids = pendingBatchDeleteSessionIds ?? []
    if (ids.length === 0) return

    setIsBatchDeleting(true)
    try {
      const result = await deleteSessions(ids)
      for (const sessionId of result.successes) {
        disconnectSession(sessionId)
        closeTab(sessionId)
      }

      if (result.failures.length > 0) {
        addToast({
          type: 'error',
          message: t('sidebar.batchDeleteFailed', { count: result.failures.length }),
        })
      } else {
        addToast({
          type: 'success',
          message: t('sidebar.batchDeleteSucceeded', { count: result.successes.length }),
        })
        handleExitBatchMode()
      }
      setPendingBatchDeleteSessionIds(null)
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('sidebar.batchDeleteFailed', { count: ids.length }),
      })
    } finally {
      setIsBatchDeleting(false)
    }
  }, [addToast, closeTab, deleteSessions, disconnectSession, handleExitBatchMode, pendingBatchDeleteSessionIds, t])

  const toggleGroupSelection = useCallback((ids: string[]) => {
    const allSelected = ids.every((id) => selectedSessionIds.has(id))
    if (allSelected) {
      deselectSessions(ids)
    } else {
      selectSessions(ids)
    }
  }, [deselectSessions, selectSessions, selectedSessionIds])

  const toggleProjectCollapsed = useCallback((projectKey: string) => {
    if (suppressProjectClickRef.current === projectKey) {
      suppressProjectClickRef.current = null
      return
    }
    setCollapsedProjectKeys((current) => {
      const next = new Set(current)
      if (next.has(projectKey)) {
        next.delete(projectKey)
      } else {
        next.add(projectKey)
      }
      return next
    })
  }, [])

  const toggleProjectSessionExpansion = useCallback((projectKey: string) => {
    setExpandedProjectKeys((current) => {
      const next = new Set(current)
      if (next.has(projectKey)) {
        next.delete(projectKey)
      } else {
        next.add(projectKey)
      }
      return next
    })
  }, [])

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setContextMenu(null)
    setRenamingId(id)
    setRenameValue(currentTitle)
  }, [])

  const handleFinishRename = useCallback(async () => {
    if (renamingId && renameValue.trim()) {
      await renameSession(renamingId, renameValue.trim())
    }
    setRenamingId(null)
    setRenameValue('')
  }, [renamingId, renameValue, renameSession])

  const handleSidebarDrag = useWindowDrag()

  useEffect(() => {
    if (!isBatchMode) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      // The sidebar sits behind the settings window while it is open.
      if (useUIStore.getState().settingsOpen) return

      if (event.key === 'Escape') {
        handleExitBatchMode()
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        selectSessions(filteredSessionIds)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [filteredSessionIds, handleExitBatchMode, isBatchMode, selectSessions])

  return (
    <aside
      onMouseDown={handleSidebarDrag}
      className="sidebar-panel relative h-full flex flex-col bg-[var(--color-surface-sidebar)] border-r border-[var(--color-border)] select-none"
      data-state={expanded ? 'open' : 'closed'}
      aria-label="Sidebar"
    >
      {/* On macOS the top band is the title row: traffic lights and the sidebar toggle. */}
      <div
        className={`px-3 pb-2 ${isTauri && !isWindows ? '' : 'pt-3'}`}
        style={isTauri && !isWindows ? { paddingTop: 'var(--titlebar-height)' } : undefined}
      >
        <div className={`flex ${expanded ? 'items-center justify-between gap-3' : 'flex-col items-center gap-2'}`}>
          <div className={`flex min-w-0 items-center ${expanded ? 'gap-2.5' : 'justify-center'}`}>
            <DreamCoderIcon size={32} />
            <div
              className={`sidebar-copy ${expanded ? 'sidebar-copy--visible' : 'sidebar-copy--hidden'} flex flex-col min-w-0`}
            >
              <span
                className="text-[13px] font-semibold tracking-tight text-[var(--color-text-primary)] truncate"
                style={{ fontFamily: 'var(--font-headline)' }}
              >
                DreamCoder
              </span>
            </div>
          </div>
          <div className={`flex items-center ${expanded ? 'gap-1.5' : 'flex-col gap-2'}`}>
            <a
              href="https://github.com/GoDiao/dreamcoder"
              target="_blank"
              rel="noopener noreferrer"
              className={`sidebar-copy ${expanded ? 'sidebar-copy--visible' : 'sidebar-copy--hidden'} inline-flex items-center justify-center rounded-md p-1 text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]`}
              title="GitHub"
              tabIndex={expanded ? undefined : -1}
              aria-hidden={!expanded}
            >
              <GitHubIcon />
            </a>
            {isMobile ? (
              <button
                type="button"
                onClick={closeMobileDrawer}
                className="sidebar-toggle-button flex h-11 w-11 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-sidebar)]"
                aria-label={t('sidebar.collapse')}
                title={t('sidebar.collapse')}
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            ) : isTauri ? null : (
              // The desktop app's toggle is in the title row (TitlebarSidebarToggle).
              <button
                type="button"
                onClick={toggleSidebar}
                data-testid={expanded ? 'sidebar-collapse-button' : 'sidebar-expand-button'}
                className={`sidebar-toggle-button ${expanded ? 'sidebar-toggle-button--open h-8 w-8' : 'sidebar-toggle-button--collapsed h-8 w-8'} flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-sidebar)]`}
                aria-label={expanded ? t('sidebar.collapse') : t('sidebar.expand')}
                title={expanded ? t('sidebar.collapse') : t('sidebar.expand')}
              >
                <SidebarToggleIcon collapsed={!expanded} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`px-3 pb-3 flex flex-col ${expanded ? 'gap-0.5' : 'items-center gap-2'}`}>
        <NavItem
          active={false}
          collapsed={!expanded}
          label={t('sidebar.newSession')}
          touchFriendly={isMobile}
          onClick={() => {
            const currentTabId = useTabStore.getState().activeTabId
            const currentSession = currentTabId
              ? useSessionStore.getState().sessions.find((s) => s.id === currentTabId)
              : null
            void createSessionForWorkDir(currentSession?.workDir || currentSession?.projectRoot || undefined)
          }}
          icon={<Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />}
        >
          {t('sidebar.newSession')}
        </NavItem>
        {!isMobile && (
          <NavItem
            active={activeTabId === SCHEDULED_TAB_ID}
            collapsed={!expanded}
            label={t('sidebar.scheduled')}
            touchFriendly={isMobile}
            onClick={() => {
              useTabStore.getState().openTab(SCHEDULED_TAB_ID, t('sidebar.scheduled'), 'scheduled')
              closeMobileDrawer()
            }}
            icon={<ClockIcon />}
          >
            {t('sidebar.scheduled')}
          </NavItem>
        )}
      </div>

      {expanded ? (
        <>
          <div
            data-testid="sidebar-search-controls-section"
            className="sidebar-section sidebar-section--visible relative z-20 flex-none px-3 pb-2"
            style={{ overflow: 'visible' }}
          >
            <SearchField
              id="sidebar-search"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('sidebar.searchPlaceholder')}
              aria-label={t('sidebar.searchPlaceholder')}
              className={`w-full bg-[var(--color-sidebar-search-bg)] ${isMobile ? 'h-11' : ''}`}
            />
          </div>

          <div
            data-testid="sidebar-session-list-section"
            className="sidebar-section sidebar-section--visible flex flex-1 min-h-0 flex-col"
          >
            {isBatchMode && (
              <div className="mx-3 mb-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-xs font-medium text-[var(--color-text-primary)]">
                    {t('sidebar.batchSelectedCount', { count: selectedCount })}
                  </span>
                  <button
                    type="button"
                    onClick={handleExitBatchMode}
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
                    aria-label={t('sidebar.batchExit')}
                    title={t('sidebar.batchExit')}
                  >
                    <span className="material-symbols-outlined text-[17px]">close</span>
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (filteredSessionIds.every((id) => selectedSessionIds.has(id))) {
                        deselectSessions(filteredSessionIds)
                      } else {
                        selectSessions(filteredSessionIds)
                      }
                    }}
                    disabled={filteredSessionIds.length === 0}
                    className="rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                  >
                    {filteredSessionIds.length > 0 && filteredSessionIds.every((id) => selectedSessionIds.has(id))
                      ? t('sidebar.batchDeselectAll')
                      : t('sidebar.batchSelectAll')}
                  </button>
                  <button
                    type="button"
                    onClick={() => requestBatchDelete([...selectedSessionIds])}
                    disabled={selectedCount === 0}
                    className="rounded-md bg-[var(--color-error)] px-2 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {t('sidebar.batchDeleteSelected', { count: selectedCount })}
                  </button>
                </div>
              </div>
            )}
            <div className="sidebar-scroll-area min-h-0 flex-1 overflow-y-auto px-3 pb-20">
              {error && (
                <div className="mx-1 mt-2 rounded-[var(--radius-md)] border border-[var(--color-error)]/20 bg-[var(--color-error)]/5 px-3 py-2">
                  <div className="text-xs font-medium text-[var(--color-error)]">{t('sidebar.sessionListFailed')}</div>
                  <div className="mt-1 text-[11px] text-[var(--color-text-secondary)] break-words">{error}</div>
                  <button
                    onClick={() => fetchSessions()}
                    className="mt-2 text-[11px] font-medium text-[var(--color-brand)] hover:underline"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              )}
              {showInitialLoading ? (
                <div className="px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
                  {t('common.loading')}
                </div>
              ) : filteredSessions.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
                  {searchQuery ? t('sidebar.noMatching') : t('sidebar.noSessions')}
                </div>
              )}
              {orderedProjectGroups.length > 0 && (
                <ProjectHeaderActions
                  title={t('sidebar.projects')}
                  createLabel={t('sidebar.newProject')}
                  createMenuOpen={createProjectMenu !== null}
                  onOpenCreate={toggleCreateProjectMenu}
                />
              )}
              {visibleProjectGroups.map((project) => {
                const projectCollapsed = collapsedProjectKeys.has(project.key)
                const sessionsExpanded = expandedProjectKeys.has(project.key)
                const visibleItems = projectCollapsed ? [] : getVisibleProjectSessions(project.sessions, sessionsExpanded, activeTabId)
                const hiddenCount = project.sessions.length - visibleItems.length
                const groupIds = project.sessions.map((session) => session.id)
                const groupSelectedCount = groupIds.filter((id) => selectedSessionIds.has(id)).length
                const hasInternalScroll = sessionsExpanded && project.sessions.length > PROJECT_GROUP_SCROLL_COUNT
                const isProjectDragging = draggingProjectKey === project.key
                const isProjectPinned = pinnedProjectKeys.has(project.key)
                const dropBefore = projectDropTarget?.key === project.key && projectDropTarget.position === 'before'
                const dropAfter = projectDropTarget?.key === project.key && projectDropTarget.position === 'after'
                return (
                  <section
                    key={project.key}
                    data-testid={`sidebar-project-group-${domSafeProjectKey(project.key)}`}
                    onDragOver={(event) => handleProjectDragOver(event, project.key)}
                    onDrop={(event) => handleProjectDrop(event, project.key)}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setProjectDropTarget((current) => current?.key === project.key ? null : current)
                      }
                    }}
                    className={`group/project relative mb-3.5 transition-opacity ${isProjectDragging ? 'opacity-50' : ''}`}
                  >
                    {dropBefore && (
                      <div className="pointer-events-none absolute -top-1 left-1 right-1 z-10 h-0.5 rounded-full bg-[var(--color-brand)]" />
                    )}
                    <div
                      className={`sidebar-row group/project-row flex items-center ${isMobile ? 'sidebar-row--touch' : ''}`}
                      data-testid={`sidebar-project-row-${domSafeProjectKey(project.key)}`}
                      data-menu-open={projectContextMenu?.key === project.key ? 'true' : undefined}
                      onContextMenu={(event) => handleProjectContextMenu(event, project.key)}
                    >
                      <button
                        type="button"
                        draggable={!isBatchMode}
                        onDragStart={(event) => handleProjectDragStart(event, project.key)}
                        onDragEnd={clearProjectDragState}
                        onClick={() => toggleProjectCollapsed(project.key)}
                        className={`flex min-w-0 flex-1 cursor-grab items-center gap-1.5 bg-transparent px-1.5 text-left active:cursor-grabbing focus-visible:outline-none ${isMobile ? 'min-h-[44px]' : 'min-h-[30px]'}`}
                        aria-expanded={!projectCollapsed}
                        aria-label={t(projectCollapsed ? 'sidebar.expandProject' : 'sidebar.collapseProject', { project: project.title })}
                        title={project.subtitle || project.title}
                      >
                        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--color-text-tertiary)]">
                          {projectCollapsed
                            ? <ChevronRight className="h-[13px] w-[13px]" strokeWidth={2} aria-hidden="true" />
                            : <ChevronDown className="h-[13px] w-[13px]" strokeWidth={2} aria-hidden="true" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ui-aux font-medium leading-5 text-[var(--color-text-secondary)]">
                          {project.title}
                        </span>
                        {isProjectPinned && (
                          <Pin className="h-3 w-3 flex-shrink-0 text-[var(--color-text-tertiary)]" strokeWidth={1.8} aria-hidden="true" />
                        )}
                      </button>
                      {isBatchMode ? (
                        <button
                          type="button"
                          onClick={() => toggleGroupSelection(groupIds)}
                          className={`mr-1 flex-shrink-0 rounded-md bg-transparent px-1.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none ${
                            groupSelectedCount > 0
                              ? 'text-[var(--color-brand)]'
                              : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                          }`}
                          aria-label={t('sidebar.batchSelectGroup', { group: project.title })}
                        >
                          {groupSelectedCount === groupIds.length
                            ? t('sidebar.batchDeselectAll')
                            : t('sidebar.batchSelectAll')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void createSessionForWorkDir(project.workDir)
                          }}
                          className="sidebar-row-action"
                          aria-label={t('sidebar.newSessionInProject', { project: project.title })}
                          title={t('sidebar.newSessionInProject', { project: project.title })}
                        >
                          <Plus className="h-[14px] w-[14px]" strokeWidth={2} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <div className="motion-collapse mt-0.5 pl-0" data-state={projectCollapsed ? 'closed' : 'open'}>
                      <div>
                        <div
                          className={hasInternalScroll ? 'max-h-[420px] overflow-y-auto pr-1' : undefined}
                          data-testid={`sidebar-project-session-list-${domSafeProjectKey(project.key)}`}
                        >
                          {visibleItems.map((session) => {
                            const isSelected = selectedSessionIds.has(session.id)
                            const isCurrent = session.id === activeTabId
                            const menuOpen = contextMenu?.id === session.id
                            const title = session.title || 'Untitled'
                            return (
                            <div key={session.id} className="relative mb-0.5 last:mb-0">
                              {renamingId === session.id ? (
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onBlur={handleFinishRename}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleFinishRename()
                                    if (e.key === 'Escape') {
                                      setRenamingId(null)
                                      setRenameValue('')
                                    }
                                  }}
                                  aria-label={t('common.rename')}
                                  className={`w-full rounded-lg border border-[var(--color-border-focus)] bg-[var(--color-surface)] px-2.5 text-ui-nav text-[var(--color-text-primary)] outline-none ${isMobile ? 'h-11' : 'h-[30px]'}`}
                                />
                              ) : (
                                <div
                                  data-testid={`sidebar-session-row-${session.id}`}
                                  data-current={isSelected || isCurrent ? 'true' : undefined}
                                  data-menu-open={menuOpen ? 'true' : undefined}
                                  onContextMenu={(e) => handleContextMenu(e, session.id)}
                                  className={`sidebar-row sidebar-session-row flex items-center ${isMobile ? 'sidebar-row--touch' : ''} ${
                                    isSelected
                                      ? 'sidebar-session-row--selected text-[var(--color-text-primary)]'
                                      : isCurrent
                                      ? 'sidebar-session-row--active text-[var(--color-text-primary)]'
                                      : 'sidebar-session-row--idle text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      if (isBatchMode) {
                                        handleBatchSessionClick(event, session.id)
                                        return
                                      }
                                      useTabStore.getState().openTab(session.id, session.title)
                                      useChatStore.getState().connectToSession(session.id)
                                      closeMobileDrawer()
                                    }}
                                    title={title}
                                    className={`flex min-w-0 flex-1 items-center gap-2 bg-transparent px-2.5 text-left text-ui-nav leading-[18px] focus-visible:outline-none ${isMobile ? 'min-h-[44px]' : 'min-h-[30px]'}`}
                                    aria-pressed={isBatchMode ? isSelected : undefined}
                                  >
                                    {isBatchMode ? (
                                      <span
                                        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
                                          isSelected
                                            ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                                            : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                                        }`}
                                        aria-hidden="true"
                                      >
                                        {isSelected && (
                                          <span className="material-symbols-outlined text-[12px]">check</span>
                                        )}
                                      </span>
                                    ) : null}
                                    <span className="min-w-0 flex-1 truncate">{title}</span>
                                    {!session.workDirExists && (
                                      <span
                                        className="flex-shrink-0 text-[10px] text-[var(--color-warning)]"
                                        title={session.workDir ?? ''}
                                      >
                                        {t('sidebar.missingDir')}
                                      </span>
                                    )}
                                    <SessionRowMeta
                                      isRunning={runningSessionIds.has(session.id)}
                                      isWorktree={isWorktreeSession(session)}
                                      t={t}
                                    />
                                  </button>
                                  {!isBatchMode && (
                                    <button
                                      type="button"
                                      onClick={(event) => toggleSessionMenu(event, session.id)}
                                      className="sidebar-row-action sidebar-session-more"
                                      aria-label={t('sidebar.sessionActions', { title })}
                                      title={t('sidebar.sessionActions', { title })}
                                      aria-haspopup="menu"
                                      aria-expanded={menuOpen}
                                    >
                                      <MoreHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                            )
                          })}
                        </div>
                        {(hiddenCount > 0 || sessionsExpanded) && (
                          <div className="mt-2 flex justify-start px-2.5">
                            <button
                              type="button"
                              onClick={() => toggleProjectSessionExpansion(project.key)}
                              className="inline-flex items-center justify-start py-1 text-[13px] font-semibold text-[var(--color-text-tertiary)] opacity-75 transition-[color,opacity] hover:text-[var(--color-text-secondary)] hover:opacity-100 focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
                              aria-expanded={sessionsExpanded}
                            >
                              {sessionsExpanded
                                ? t('sidebar.showFewerSessions')
                                : t('sidebar.showMoreSessions')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {dropAfter && (
                      <div className="pointer-events-none absolute -bottom-1 left-1 right-1 z-10 h-0.5 rounded-full bg-[var(--color-brand)]" />
                    )}
                  </section>
                )
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1" aria-hidden="true" />
      )}

      {!isMobile && (
        <div
          data-testid="sidebar-footer"
          className={`sidebar-settings-dock absolute bottom-0 left-0 right-0 px-3 pb-3 pt-2 ${expanded ? '' : 'flex justify-center'}`}
        >
          <SidebarMoreMenu
            collapsed={!expanded}
            onOpenProjectManagement={() => setProjectManagementOpen(true)}
            onOpenSettings={() => useUIStore.getState().openSettings()}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onReportProblem={() => setReportProblemOpen(true)}
          />
        </div>
      )}

      {contextMenu && (
        <div
          ref={sessionMenuRef}
          role="menu"
          className="motion-menu fixed z-50 overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]"
          data-state="open"
          data-testid="sidebar-session-menu"
          style={{ ...positionFloatingMenu(contextMenu.x, contextMenu.y, SESSION_MENU_WIDTH, 130), width: SESSION_MENU_WIDTH }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={sessionMenuNav.onKeyDown}
        >
          <SessionMenuItem
            icon={<Pencil size={15} aria-hidden="true" />}
            onClick={() => {
              const session = sessions.find((s) => s.id === contextMenu.id)
              handleStartRename(contextMenu.id, session?.title || '')
            }}
          >
            {t('common.rename')}
          </SessionMenuItem>
          <SessionMenuItem
            icon={<ListChecks size={15} aria-hidden="true" />}
            onClick={() => {
              setContextMenu(null)
              enterBatchMode()
            }}
          >
            {t('sidebar.batchManage')}
          </SessionMenuItem>
          <div className="my-1 h-px bg-[var(--color-border-separator)]" role="separator" />
          <SessionMenuItem
            icon={<Trash2 size={15} aria-hidden="true" />}
            danger
            onClick={() => handleDelete(contextMenu.id)}
          >
            {t('common.delete')}
          </SessionMenuItem>
        </div>
      )}

      {projectContextMenu && (() => {
        const project = orderedProjectGroups.find((group) => group.key === projectContextMenu.key)
        if (!project) return null
        const pinned = pinnedProjectKeys.has(project.key)
        const hidden = hiddenProjectKeys.has(project.key)
        return (
          <div
            ref={projectMenuRef}
            role="menu"
            className="motion-menu fixed z-50 min-w-[230px] overflow-hidden rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-2 shadow-[var(--shadow-dropdown)]"
            data-state="open"
            style={positionFloatingMenu(projectContextMenu.x, projectContextMenu.y, 230, 160)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={projectMenuNav.onKeyDown}
          >
            <ProjectMenuItem
              icon={pinned ? <PinOff size={18} aria-hidden="true" /> : <Pin size={18} aria-hidden="true" />}
              onClick={() => togglePinnedProject(project.key)}
            >
              {t(pinned ? 'sidebar.unpinProject' : 'sidebar.pinProject')}
            </ProjectMenuItem>
            <ProjectMenuItem
              icon={<FolderOpen size={18} aria-hidden="true" />}
              onClick={() => void openProjectInFinder(project)}
            >
              {t('sidebar.openInFinder')}
            </ProjectMenuItem>
            <ProjectMenuItem
              icon={hidden ? <RotateCcw size={18} aria-hidden="true" /> : <X size={18} aria-hidden="true" />}
              onClick={() => toggleHiddenProject(project)}
              danger={!hidden}
            >
              {t(hidden ? 'sidebar.restoreProjectToSidebar' : 'sidebar.hideProjectFromSidebar')}
            </ProjectMenuItem>
          </div>
        )
      })()}

      {createProjectMenu && (
        <div
          ref={createProjectMenuRef}
          role="menu"
          className="motion-menu fixed z-50 overflow-hidden rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-2 shadow-[var(--shadow-dropdown)]"
          data-state="open"
          style={{ left: createProjectMenu.x, top: createProjectMenu.y, width: 250 }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={createProjectMenuNav.onKeyDown}
        >
          <HeaderMenuItem
            icon={<SquarePen size={18} aria-hidden="true" />}
            onClick={() => {
              setCreateProjectMenu(null)
              void createSessionForWorkDir()
            }}
          >
            {t('sidebar.newBlankProject')}
          </HeaderMenuItem>
          <HeaderMenuItem icon={<FolderOpen size={18} aria-hidden="true" />} onClick={() => void createSessionFromExistingFolder()}>
            {t('sidebar.useExistingFolder')}
          </HeaderMenuItem>
        </div>
      )}

      <ProjectManagementDialog
        open={projectManagementOpen}
        onClose={() => setProjectManagementOpen(false)}
        organization={projectOrganization}
        sortBy={projectSortBy}
        onSetOrganization={updateProjectOrganization}
        onSetSortBy={updateProjectSortBy}
        projects={managedProjects}
        hiddenProjectCount={hiddenProjectKeys.size}
        onTogglePinned={togglePinnedProject}
        onToggleHidden={(projectKey) => {
          const project = managementProjectGroups.find((group) => group.key === projectKey)
          if (project) toggleHiddenProject(project)
        }}
        onOpenInFinder={(projectKey) => {
          const project = managementProjectGroups.find((group) => group.key === projectKey)
          if (project) void openProjectInFinder(project)
        }}
        onRestoreAllHidden={restoreAllHiddenProjects}
        onRefresh={() => void refreshSessionsNow()}
        isRefreshing={isLoading}
        isBatchMode={isBatchMode}
        onToggleBatchMode={() => {
          setProjectManagementOpen(false)
          if (isBatchMode) handleExitBatchMode()
          else enterBatchMode()
        }}
      />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ReportProblemDialog open={reportProblemOpen} onClose={() => setReportProblemOpen(false)} />

      <ConfirmDialog
        open={pendingDeleteSessionId !== null}
        onClose={() => setPendingDeleteSessionId(null)}
        onConfirm={confirmDelete}
        title={t('common.delete')}
        body={pendingDeleteSessionId ? t('sidebar.confirmDelete') : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
      />
      <ConfirmDialog
        open={pendingBatchDeleteSessionIds !== null}
        onClose={() => {
          if (!isBatchDeleting) setPendingBatchDeleteSessionIds(null)
        }}
        onConfirm={confirmBatchDelete}
        title={t('common.delete')}
        body={(
          <div className="space-y-3">
            <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
              {t('sidebar.batchDeleteConfirm', { count: pendingBatchDeleteSessionIds?.length ?? 0 })}
            </p>
            <div>
              <div className="mb-1.5 text-xs font-medium text-[var(--color-text-primary)]">
                {t('sidebar.batchDeleteConfirmBody')}
              </div>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-2">
                {pendingBatchDeleteSessions.slice(0, 5).map((session) => (
                  <li key={session.id} className="truncate text-xs text-[var(--color-text-secondary)]">
                    {session.title || 'Untitled'}
                  </li>
                ))}
                {(pendingBatchDeleteSessionIds?.length ?? 0) > 5 && (
                  <li className="text-xs text-[var(--color-text-tertiary)]">
                    {t('sidebar.batchDeleteMore', { count: (pendingBatchDeleteSessionIds?.length ?? 0) - 5 })}
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={isBatchDeleting}
      />
    </aside>
  )
}

function useSessionListAutoRefresh(fetchSessions: () => Promise<void>): () => Promise<void> {
  const inFlightRef = useRef<Promise<void> | null>(null)
  const lastStartedAtRef = useRef(0)

  const refreshSessions = useCallback((force = false) => {
    if (inFlightRef.current) return inFlightRef.current

    const now = Date.now()
    if (!force && now - lastStartedAtRef.current < SESSION_LIST_FOCUS_REFRESH_MIN_MS) {
      return Promise.resolve()
    }

    lastStartedAtRef.current = now
    const request = Promise.resolve()
      .then(() => fetchSessions())
      .catch(() => undefined)
      .finally(() => {
        if (inFlightRef.current === request) {
          inFlightRef.current = null
        }
      })
    inFlightRef.current = request
    return request
  }, [fetchSessions])

  useEffect(() => {
    void refreshSessions(true)

    const refreshIfVisible = () => {
      if (!isDocumentVisible()) return
      void refreshSessions()
    }

    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)
    const timer = window.setInterval(() => {
      if (!isDocumentVisible()) return
      void refreshSessions(true)
    }, SESSION_LIST_AUTO_REFRESH_MS)

    return () => {
      window.removeEventListener('focus', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.clearInterval(timer)
    }
  }, [refreshSessions])

  return useCallback(() => refreshSessions(true), [refreshSessions])
}

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function ProjectHeaderActions({
  title,
  createLabel,
  createMenuOpen,
  onOpenCreate,
}: {
  title: string
  createLabel: string
  createMenuOpen: boolean
  onOpenCreate: (event: React.MouseEvent) => void
}) {
  return (
    <div
      data-testid="sidebar-projects-header"
      className="flex items-center justify-between pb-1 pl-2 pr-1 pt-1"
    >
      <div className="text-ui-aux font-semibold tracking-normal text-[var(--color-text-tertiary)]">
        {title}
      </div>
      <button
        type="button"
        onClick={onOpenCreate}
        aria-haspopup="menu"
        aria-expanded={createMenuOpen}
        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
        aria-label={createLabel}
        title={createLabel}
      >
        <Plus className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  )
}

function HeaderMenuItem({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)]"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-text-secondary)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}

function SessionMenuItem({
  icon,
  children,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-ui-nav transition-colors focus-visible:outline-none ${
        danger
          ? 'text-[var(--color-error)] hover:bg-[var(--color-error)]/10 focus-visible:bg-[var(--color-error)]/10'
          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)]'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}

function groupByProject(sessions: SessionListItem[], sortBy: SidebarProjectSortBy): ProjectGroup[] {
  const groupsByKey = new Map<string, SessionListItem[]>()
  for (const session of sessions) {
    const key = getSessionProjectKey(session)
    const items = groupsByKey.get(key) ?? []
    items.push(session)
    groupsByKey.set(key, items)
  }

  const groups = [...groupsByKey.entries()].map(([key, items]) => {
    const sortedSessions = [...items].sort((a, b) => compareSessionsByTimestamp(a, b, sortBy))
    const newest = sortedSessions[0]
    const projectRoot = newest?.projectRoot || newest?.workDir || key
    return {
      key,
      title: projectTitle(projectRoot),
      subtitle: projectSubtitle(projectRoot, key),
      workDir: projectRoot || newest?.workDir || undefined,
      sessions: sortedSessions,
    }
  })

  return groups.sort((a, b) => compareSessionsByTimestamp(a.sessions[0], b.sessions[0], sortBy))
}

function applyProjectOrder(
  groups: ProjectGroup[],
  projectOrder: string[],
  pinnedProjectKeys: Set<string>,
  organization: SidebarProjectOrganization,
  sortBy: SidebarProjectSortBy,
): ProjectGroup[] {
  const orderIndex = new Map(projectOrder.map((key, index) => [key, index]))
  return [...groups].sort((a, b) => {
    const aPinned = pinnedProjectKeys.has(a.key)
    const bPinned = pinnedProjectKeys.has(b.key)
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    if (organization === 'project') return a.title.localeCompare(b.title)
    const aIndex = orderIndex.get(a.key)
    const bIndex = orderIndex.get(b.key)
    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex
    if (aIndex !== undefined) return -1
    if (bIndex !== undefined) return 1
    return compareSessionsByTimestamp(a.sessions[0], b.sessions[0], sortBy)
  })
}

function moveProjectKey(
  projectKeys: string[],
  sourceKey: string,
  targetKey: string,
  position: 'before' | 'after',
): string[] {
  const withoutSource = projectKeys.filter((key) => key !== sourceKey)
  const targetIndex = withoutSource.indexOf(targetKey)
  if (targetIndex < 0) return projectKeys
  const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
  return [
    ...withoutSource.slice(0, insertIndex),
    sourceKey,
    ...withoutSource.slice(insertIndex),
  ]
}

function getProjectDropPosition(event: React.DragEvent<HTMLElement>): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY <= rect.top + rect.height / 2 ? 'before' : 'after'
}

function readStoredProjectOrder(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECT_ORDER_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function writeStoredProjectOrder(projectOrder: string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify(projectOrder))
  } catch {
  }
}

function readStoredProjectPins(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECT_PINNED_STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeStoredProjectPins(projectKeys: Set<string>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PROJECT_PINNED_STORAGE_KEY, JSON.stringify([...projectKeys]))
  } catch {
  }
}

function readStoredProjectHidden(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECT_HIDDEN_STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeStoredProjectHidden(projectKeys: Set<string>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PROJECT_HIDDEN_STORAGE_KEY, JSON.stringify([...projectKeys]))
  } catch {
  }
}

function readStoredProjectOrganization(): SidebarProjectOrganization {
  if (typeof localStorage === 'undefined') return 'recentProject'
  return normalizeProjectOrganization(localStorage.getItem(PROJECT_ORGANIZATION_STORAGE_KEY))
}

function writeStoredProjectOrganization(organization: SidebarProjectOrganization): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PROJECT_ORGANIZATION_STORAGE_KEY, organization)
  } catch {
  }
}

function readStoredProjectSortBy(): SidebarProjectSortBy {
  if (typeof localStorage === 'undefined') return 'updatedAt'
  return normalizeProjectSortBy(localStorage.getItem(PROJECT_SORT_STORAGE_KEY))
}

function writeStoredProjectSortBy(sortBy: SidebarProjectSortBy): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PROJECT_SORT_STORAGE_KEY, sortBy)
  } catch {
  }
}

function buildSidebarProjectPreferences(
  projectOrder: string[],
  pinnedProjectKeys: Set<string>,
  hiddenProjectKeys: Set<string>,
  projectOrganization: SidebarProjectOrganization,
  projectSortBy: SidebarProjectSortBy,
): SidebarProjectPreferences {
  return normalizeSidebarProjectPreferences({
    projectOrder,
    pinnedProjects: [...pinnedProjectKeys],
    hiddenProjects: [...hiddenProjectKeys],
    projectOrganization,
    projectSortBy,
  })
}

function readCachedSidebarProjectPreferences(): SidebarProjectPreferences {
  return {
    projectOrder: readStoredProjectOrder(),
    pinnedProjects: [...readStoredProjectPins()],
    hiddenProjects: [...readStoredProjectHidden()],
    projectOrganization: readStoredProjectOrganization(),
    projectSortBy: readStoredProjectSortBy(),
  }
}

function writeCachedSidebarProjectPreferences(preferences: SidebarProjectPreferences): void {
  const normalized = normalizeSidebarProjectPreferences(preferences)
  writeStoredProjectOrder(normalized.projectOrder)
  writeStoredProjectPins(new Set(normalized.pinnedProjects))
  writeStoredProjectHidden(new Set(normalized.hiddenProjects))
  writeStoredProjectOrganization(normalized.projectOrganization)
  writeStoredProjectSortBy(normalized.projectSortBy)
}

function normalizeSidebarProjectPreferences(preferences: Partial<SidebarProjectPreferences> | undefined): SidebarProjectPreferences {
  return {
    projectOrder: normalizeProjectKeyList(preferences?.projectOrder),
    pinnedProjects: normalizeProjectKeyList(preferences?.pinnedProjects),
    hiddenProjects: normalizeProjectKeyList(preferences?.hiddenProjects),
    projectOrganization: normalizeProjectOrganization(preferences?.projectOrganization),
    projectSortBy: normalizeProjectSortBy(preferences?.projectSortBy),
  }
}

function normalizeProjectKeyList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

function normalizeProjectPathForComparison(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/g, '') || value
  return isWindows ? normalized.toLowerCase() : normalized
}

function isDriveRootComparisonPath(value: string): boolean {
  return /^[a-z]:$/i.test(value)
}

function projectPathMatches(projectKey: string, workDir: string): boolean {
  const normalizedProjectKey = normalizeProjectPathForComparison(projectKey)
  const normalizedWorkDir = normalizeProjectPathForComparison(workDir)

  if (normalizedProjectKey === normalizedWorkDir) return true
  if (isDriveRootComparisonPath(normalizedProjectKey)) return false
  return normalizedWorkDir.startsWith(`${normalizedProjectKey}/`)
}

function hasSidebarProjectPreferences(preferences: SidebarProjectPreferences): boolean {
  return preferences.projectOrder.length > 0
    || preferences.pinnedProjects.length > 0
    || preferences.hiddenProjects.length > 0
    || preferences.projectOrganization !== 'recentProject'
    || preferences.projectSortBy !== 'updatedAt'
}

function normalizeProjectOrganization(value: unknown): SidebarProjectOrganization {
  return value === 'project' || value === 'recentProject' || value === 'time' ? value : 'recentProject'
}

function normalizeProjectSortBy(value: unknown): SidebarProjectSortBy {
  return value === 'createdAt' || value === 'updatedAt' ? value : 'updatedAt'
}

function getVisibleProjectSessions(
  sessions: SessionListItem[],
  expanded: boolean,
  activeSessionId: string | null,
): SessionListItem[] {
  if (expanded || sessions.length <= PROJECT_GROUP_VISIBLE_COUNT) return sessions

  const visible = sessions.slice(0, PROJECT_GROUP_VISIBLE_COUNT)
  if (!activeSessionId || visible.some((session) => session.id === activeSessionId)) return visible

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  return activeSession ? [...visible, activeSession] : visible
}

function getSessionProjectKey(session: SessionListItem): string {
  return session.projectRoot || session.workDir || session.projectPath || 'unknown'
}

function compareSessionsByTimestamp(
  a: SessionListItem | undefined,
  b: SessionListItem | undefined,
  sortBy: SidebarProjectSortBy,
): number {
  return getSessionTimestamp(b, sortBy) - getSessionTimestamp(a, sortBy)
}

function getSessionTimestamp(session: SessionListItem | undefined, sortBy: SidebarProjectSortBy): number {
  const value = sortBy === 'createdAt' ? session?.createdAt : session?.modifiedAt
  const timestamp = new Date(value ?? 0).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function projectTitle(pathLike: string | null | undefined): string {
  if (!pathLike) return 'Unknown project'
  const normalized = pathLike.replace(/[\\/]+$/, '')
  const segments = normalized.split(/[\\/]/).filter(Boolean)
  const last = segments[segments.length - 1]
  if (last) return last
  return normalized || 'Unknown project'
}

function projectSubtitle(projectRoot: string | null | undefined, fallbackKey: string): string | null {
  if (!projectRoot) return fallbackKey === 'unknown' ? null : fallbackKey
  return compactProjectPath(projectRoot)
}

function isWorktreeSession(session: SessionListItem): boolean {
  if (!session.workDir) return false
  if (/[\\/]\.claude[\\/]worktrees[\\/]/.test(session.workDir)) return true
  if (!session.projectRoot || session.workDir === session.projectRoot) return false
  return !isSameOrChildPath(session.workDir, session.projectRoot)
}

function isSameOrChildPath(childPath: string, parentPath: string): boolean {
  const child = normalizePathForCompare(childPath)
  const parent = normalizePathForCompare(parentPath)
  return child === parent || child.startsWith(`${parent}/`)
}

function normalizePathForCompare(pathLike: string): string {
  return pathLike.replace(/\\/g, '/').replace(/\/+$/, '')
}

function compactProjectPath(pathLike: string): string {
  const normalized = normalizePathForCompare(pathLike)
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length <= 3) return normalized
  return `.../${segments.slice(-3, -1).join('/')}`
}

function domSafeProjectKey(projectKey: string): string {
  return projectKey.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'
}

function positionFloatingMenu(clientX: number, clientY: number, width: number, height: number): React.CSSProperties {
  if (typeof window === 'undefined') return { left: clientX, top: clientY }
  return {
    left: Math.max(8, Math.min(clientX, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(clientY, window.innerHeight - height - 8)),
  }
}

function ProjectMenuItem({
  icon,
  children,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)] disabled:cursor-default disabled:opacity-45 ${
        danger
          ? 'text-[var(--color-error)] enabled:hover:bg-[var(--color-error)]/10'
          : 'text-[var(--color-text-primary)] enabled:hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-current">
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </button>
  )
}

function SessionRowMeta({
  isRunning,
  isWorktree,
  t,
}: {
  isRunning: boolean
  isWorktree: boolean
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}) {
  if (!isRunning && !isWorktree) return null

  return (
    <span className="flex h-[18px] flex-shrink-0 items-center gap-1 text-[var(--color-text-tertiary)]">
      {isRunning && (
        <span
          className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--color-success)]"
          aria-label={t('sidebar.sessionRunning')}
          title={t('sidebar.sessionRunning')}
        >
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} aria-hidden="true" />
        </span>
      )}
      {isWorktree && (
        <span
          className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center"
          title={t('sidebar.worktree')}
        >
          <GitBranch className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">{t('sidebar.worktree')}</span>
        </span>
      )}
    </span>
  )
}

function NavItem({
  active,
  collapsed,
  label,
  touchFriendly,
  onClick,
  icon,
  children,
}: {
  active: boolean
  collapsed: boolean
  label: string
  touchFriendly?: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={`
        flex items-center transition-colors duration-200
        ${collapsed ? 'h-10 w-10 justify-center rounded-[var(--radius-md)] px-0 py-0' : `w-full gap-2.5 rounded-[12px] px-3 ${touchFriendly ? 'py-3' : 'py-2.5'} text-sm`}
        ${active
          ? 'bg-[var(--color-sidebar-item-active)] font-medium text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)]'
        }
      `}
    >
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className={`sidebar-copy ${collapsed ? 'sidebar-copy--hidden' : 'sidebar-copy--visible'}`}>
        {children}
      </span>
    </button>
  )
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width={collapsed ? 16 : 14}
      height={collapsed ? 16 : 14}
      viewBox="0 0 14 14"
      fill="none"
      className={`sidebar-toggle-icon ${collapsed ? 'sidebar-toggle-icon--collapsed' : 'sidebar-toggle-icon--open'}`}
      aria-hidden="true"
    >
      <path
        d={collapsed ? 'M5 3 9 7l-4 4' : 'M9 3 5 7l4 4'}
        className="sidebar-toggle-chevron"
      />
    </svg>
  )
}
