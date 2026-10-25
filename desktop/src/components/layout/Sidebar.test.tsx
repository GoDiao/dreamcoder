import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Profiler } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

const desktopUiPreferencesApiMock = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  updateSidebarPreferences: vi.fn(),
}))

vi.mock('../../api/desktopUiPreferences', () => ({
  desktopUiPreferencesApi: desktopUiPreferencesApiMock,
}))

const openTargetStoreMock = vi.hoisted(() => ({
  ensureTargets: vi.fn(),
  openTarget: vi.fn(),
  targets: [{ id: 'finder', kind: 'file_manager', label: 'Finder', platform: 'darwin' }],
}))

vi.mock('../../stores/openTargetStore', () => ({
  useOpenTargetStore: {
    getState: () => openTargetStoreMock,
  },
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      'sidebar.newSession': 'New Session',
      'sidebar.scheduled': 'Scheduled',
      'sidebar.settings': 'Settings',
      'sidebar.searchPlaceholder': 'Search sessions',
      'sidebar.noSessions': 'No sessions',
      'sidebar.noMatching': 'No matching sessions',
      'sidebar.sessionListFailed': 'Session list failed',
      'sidebar.refreshSessions': 'Refresh sessions',
      'sidebar.projects': 'Projects',
      'sidebar.projectMenu': 'Project menu',
      'sidebar.newProject': 'New project',
      'sidebar.archiveAllChats': 'Archive all chats',
      'sidebar.organizeSidebar': 'Organize sidebar',
      'sidebar.sortCondition': 'Sort condition',
      'sidebar.organizeByProject': 'By project',
      'sidebar.organizeByRecentProject': 'Recent projects',
      'sidebar.organizeByTime': 'By time',
      'sidebar.sortByCreatedAt': 'Created time',
      'sidebar.sortByUpdatedAt': 'Updated time',
      'sidebar.newBlankProject': 'New blank project',
      'sidebar.useExistingFolder': 'Use existing folder',
      'sidebar.chooseProjectFolderUnavailable': 'Folder selection is only available in the desktop app.',
      'sidebar.projectActions': 'Project actions for {project}',
      'sidebar.pinProject': 'Pin Project',
      'sidebar.unpinProject': 'Unpin Project',
      'sidebar.openInFinder': 'Open in Finder',
      'sidebar.openInFinderFailed': 'Could not open the project in Finder.',
      'sidebar.openInFinderUnavailable': 'No file manager is available.',
      'sidebar.hideProjectFromSidebar': 'Hide from Sidebar',
      'sidebar.restoreProjectToSidebar': 'Restore to Sidebar',
      'sidebar.restoreHiddenProjects': 'Restore hidden projects ({count})',
      'sidebar.projectHidden': '{project} was hidden from the sidebar. Existing sessions were not deleted.',
      'sidebar.newSessionInProject': 'New session in {project}',
      'sidebar.showMoreSessions': 'Expand display',
      'sidebar.showFewerSessions': 'Collapse display',
      'sidebar.expandProject': 'Expand {project}',
      'sidebar.collapseProject': 'Collapse {project}',
      'sidebar.worktree': 'worktree',
      'sidebar.sessionRunning': 'Session running',
      'common.retry': 'Retry',
      'common.loading': 'Loading...',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.rename': 'Rename',
      'sidebar.timeGroup.today': 'Today',
      'sidebar.timeGroup.yesterday': 'Yesterday',
      'sidebar.timeGroup.last7days': 'Last 7 Days',
      'sidebar.timeGroup.last30days': 'Last 30 Days',
      'sidebar.timeGroup.older': 'Older',
      'sidebar.missingDir': 'Missing',
      'sidebar.confirmDelete': 'Delete this session? This cannot be undone.',
      'sidebar.batchManage': 'Batch manage',
      'sidebar.batchSelectedCount': '{count} selected',
      'sidebar.batchSelectAll': 'Select all',
      'sidebar.batchDeselectAll': 'Deselect all',
      'sidebar.batchSelectGroup': 'Select {group}',
      'sidebar.batchDeleteSelected': 'Delete selected ({count})',
      'sidebar.batchDeleteConfirm': 'Delete {count} sessions? This cannot be undone.',
      'sidebar.batchDeleteConfirmBody': 'The following sessions will be deleted:',
      'sidebar.batchDeleteMore': '...and {count} more',
      'sidebar.batchExit': 'Cancel batch mode',
      'sidebar.batchDeleteSucceeded': 'Deleted {count} sessions.',
      'sidebar.batchDeleteFailed': '{count} sessions could not be deleted.',
      'sidebar.collapse': 'Collapse sidebar',
      'sidebar.expand': 'Expand sidebar',
      'session.lastUpdated': 'last updated {time}',
      'session.timeJustNow': 'just now',
      'session.timeMinutes': '{n}m ago',
      'session.timeHours': '{n}h ago',
      'session.timeDays': '{n}d ago',
      'sidebar.more': 'More',
      'sidebar.language': 'Language',
      'sidebar.projectManagement': 'Projects & sessions',
      'sidebar.shortcuts': 'Keyboard shortcuts',
      'sidebar.backToMore': 'Back',
      'sidebar.sessionActions': 'Actions for {title}',
      'sidebar.organizationMode': 'Organize by',
      'sidebar.manageDone': 'Done',
      'sidebar.pinnedBadge': 'Pinned',
      'sidebar.hiddenBadge': 'Hidden',
      'shortcuts.groupGeneral': 'General',
      'shortcuts.commandPalette': 'Switch session',
      'shortcuts.stopGeneration': 'Stop generating',
    }

    let text = translations[key] ?? key
    for (const [name, value] of Object.entries(params ?? {})) {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value))
    }
    return text
  },
}))

import { Sidebar } from './Sidebar'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { SessionListItem } from '../../types/session'

const PROJECT_ORDER_STORAGE_KEY = 'dreamcoder-sidebar-project-order'
const PROJECT_PINNED_STORAGE_KEY = 'dreamcoder-sidebar-pinned-projects'
const PROJECT_HIDDEN_STORAGE_KEY = 'dreamcoder-sidebar-hidden-projects'
const PROJECT_ORGANIZATION_STORAGE_KEY = 'dreamcoder-sidebar-project-organization'
const PROJECT_SORT_STORAGE_KEY = 'dreamcoder-sidebar-project-sort'

function makeSession(
  id: string,
  title: string,
  projectRoot: string,
  modifiedAt: string,
): SessionListItem {
  return {
    id,
    title,
    createdAt: modifiedAt,
    modifiedAt,
    messageCount: 1,
    projectPath: projectRoot,
    projectRoot,
    workDir: projectRoot,
    workDirExists: true,
  }
}

function makeDataTransfer() {
  const data = new Map<string, string>()
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn((type: string, value: string) => data.set(type, value)),
    getData: vi.fn((type: string) => data.get(type) ?? ''),
  }
}

function projectGroupNames(): string[] {
  return screen
    .getAllByTestId(/^sidebar-project-group-/)
    .map((group) => group.textContent ?? '')
    .map((text) => {
      if (text.includes('alpha')) return 'alpha'
      if (text.includes('beta')) return 'beta'
      if (text.includes('gamma')) return 'gamma'
      return text
    })
}

function openProjectManagement() {
  fireEvent.click(screen.getByRole('button', { name: 'More' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Projects & sessions' }))
}

describe('Sidebar', () => {
  const connectToSession = vi.fn()
  const disconnectSession = vi.fn()
  const fetchSessions = vi.fn()
  const createSession = vi.fn()
  const deleteSession = vi.fn()
  const deleteSessions = vi.fn()
  const addToast = vi.fn()

  beforeEach(() => {
    connectToSession.mockReset()
    disconnectSession.mockReset()
    fetchSessions.mockReset()
    createSession.mockReset()
    deleteSession.mockReset()
    deleteSessions.mockReset()
    addToast.mockReset()
    desktopUiPreferencesApiMock.getPreferences.mockReset()
    desktopUiPreferencesApiMock.updateSidebarPreferences.mockReset()
    desktopUiPreferencesApiMock.getPreferences.mockRejectedValue(new Error('server unavailable'))
    desktopUiPreferencesApiMock.updateSidebarPreferences.mockResolvedValue({
      ok: true,
      preferences: {
        schemaVersion: 1,
        sidebar: {
          projectOrder: [],
          pinnedProjects: [],
          hiddenProjects: [],
          projectOrganization: 'recentProject',
          projectSortBy: 'updatedAt',
        },
      },
    })
    openTargetStoreMock.ensureTargets.mockReset()
    openTargetStoreMock.openTarget.mockReset()
    openTargetStoreMock.targets = [{ id: 'finder', kind: 'file_manager', label: 'Finder', platform: 'darwin' }]
    window.localStorage.removeItem(PROJECT_ORDER_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_PINNED_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_HIDDEN_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_ORGANIZATION_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_SORT_STORAGE_KEY)

    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
      isBatchMode: false,
      selectedSessionIds: new Set(),
      fetchSessions,
      createSession,
      deleteSession,
      deleteSessions,
    })
    useChatStore.setState({
      sessions: {},
      connectToSession,
      disconnectSession,
    } as Partial<ReturnType<typeof useChatStore.getState>>)
    useUIStore.setState({
      sidebarOpen: true,
      addToast,
    } as Partial<ReturnType<typeof useUIStore.getState>>)
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    useTabStore.setState({ tabs: [], activeTabId: null })
    window.localStorage.removeItem(PROJECT_ORDER_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_PINNED_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_HIDDEN_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_ORGANIZATION_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_SORT_STORAGE_KEY)
  })

  it('opens a new tab when creating a session from the sidebar', async () => {
    createSession.mockResolvedValue('session-new-1')

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalled()
      expect(connectToSession).toHaveBeenCalledWith('session-new-1')
    })

    expect(useTabStore.getState().tabs).toEqual([
      { sessionId: 'session-new-1', title: 'New Session', type: 'session', status: 'idle' },
    ])
    expect(useTabStore.getState().activeTabId).toBe('session-new-1')
    expect(screen.getByRole('complementary')).not.toHaveClass('window-drag-region')
  })

  it('groups sessions by project and expands overflow rows', () => {
    const base = new Date('2026-05-15T10:00:00.000Z').getTime()
    useSessionStore.setState({
      sessions: [
        ...Array.from({ length: 11 }, (_, index) => (
          makeSession(
            `alpha-${index + 1}`,
            index === 0 ? 'Alpha newest' : index === 10 ? 'Alpha hidden' : `Alpha ${index + 1}`,
            '/workspace/alpha',
            new Date(base - index * 1000).toISOString(),
          )
        )),
        makeSession('beta-1', 'Beta only', '/workspace/beta', new Date(base - 4000).toISOString()),
      ],
    })

    render(<Sidebar />)

    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.queryByText('/workspace/alpha')).not.toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Alpha newest/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Alpha hidden/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Alpha newest/ }).closest('[class*="pl-0"]')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand display' }))

    expect(screen.getByRole('button', { name: /^Alpha hidden/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse display' })).toBeInTheDocument()
  })

  it('reorders project groups by dragging project headers while preserving expanded state', async () => {
    const base = new Date('2026-05-15T10:00:00.000Z').getTime()
    useSessionStore.setState({
      sessions: [
        ...Array.from({ length: 11 }, (_, index) => (
          makeSession(
            `alpha-${index + 1}`,
            index === 10 ? 'Alpha hidden' : `Alpha ${index + 1}`,
            '/workspace/alpha',
            new Date(base - index * 1000).toISOString(),
          )
        )),
        makeSession('beta-1', 'Beta Session', '/workspace/beta', new Date(base - 20_000).toISOString()),
        makeSession('gamma-1', 'Gamma Session', '/workspace/gamma', new Date(base - 30_000).toISOString()),
      ],
    })

    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Expand display' }))
    expect(screen.getByRole('button', { name: /^Alpha hidden/ })).toBeInTheDocument()
    expect(projectGroupNames().slice(0, 3)).toEqual(['alpha', 'beta', 'gamma'])

    const dataTransfer = makeDataTransfer()
    const alphaGroup = screen.getByTestId('sidebar-project-group-workspace-alpha')
    vi.spyOn(alphaGroup, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 100,
      left: 0,
      right: 280,
      width: 280,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.dragStart(screen.getByRole('button', { name: 'Collapse gamma' }), { dataTransfer })
    fireEvent.dragOver(alphaGroup, { clientY: -10, dataTransfer })
    fireEvent.drop(alphaGroup, { clientY: -10, dataTransfer })

    await waitFor(() => {
      expect(projectGroupNames().slice(0, 3)).toEqual(['alpha', 'gamma', 'beta'])
    })
    expect(screen.getByRole('button', { name: /^Alpha hidden/ })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(PROJECT_ORDER_STORAGE_KEY) ?? '[]').slice(0, 3)).toEqual([
      '/workspace/alpha',
      '/workspace/gamma',
      '/workspace/beta',
    ])
  })

  it('restores the saved project drag order on render', () => {
    window.localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify([
      '/workspace/beta',
      '/workspace/alpha',
    ]))
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', now),
        makeSession('beta-1', 'Beta Session', '/workspace/beta', now),
        makeSession('gamma-1', 'Gamma Session', '/workspace/gamma', now),
      ],
    })

    render(<Sidebar />)

    expect(projectGroupNames().slice(0, 3)).toEqual(['beta', 'alpha', 'gamma'])
  })

  it('collapses a project group without removing the project header', () => {
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', now),
        makeSession('beta-1', 'Beta Session', '/workspace/beta', now),
      ],
    })

    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse alpha' }))

    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Alpha Session/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Beta Session/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand alpha' })).toBeInTheDocument()
  })

  it('uses a bounded per-project session scroller for large expanded groups', () => {
    const base = new Date('2026-05-15T10:00:00.000Z').getTime()
    useSessionStore.setState({
      sessions: Array.from({ length: 14 }, (_, index) => (
        makeSession(`alpha-${index + 1}`, `Alpha ${index + 1}`, '/workspace/alpha', new Date(base - index * 1000).toISOString())
      )),
    })

    render(<Sidebar />)

    const expandButton = screen.getByRole('button', { name: 'Expand display' })
    expect(expandButton).toHaveAttribute('aria-expanded', 'false')
    expect(expandButton.parentElement).toHaveClass('justify-start')
    expect(expandButton).toHaveClass('text-[var(--color-text-tertiary)]', 'opacity-75')

    fireEvent.click(expandButton)

    expect(screen.getByTestId('sidebar-project-session-list-workspace-alpha')).toHaveClass('max-h-[420px]', 'overflow-y-auto')
    expect(screen.getByRole('button', { name: 'Collapse display' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('creates a new session from the project group context', async () => {
    createSession.mockResolvedValue('session-alpha-new')
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', new Date().toISOString()),
      ],
    })

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New session in alpha' }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('/workspace/alpha')
      expect(connectToSession).toHaveBeenCalledWith('session-alpha-new')
    })
  })

  it('shows project header menus and starts a blank project session', async () => {
    createSession.mockResolvedValue('session-blank-project')
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', new Date().toISOString()),
      ],
    })

    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-projects-header')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    expect(screen.getByRole('menuitem', { name: 'New blank project' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'New blank project' }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith(undefined)
      expect(connectToSession).toHaveBeenCalledWith('session-blank-project')
    })
  })

  it('persists project header sort preferences through desktop UI settings', async () => {
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', '2026-03-01T00:00:00.000Z'),
        {
          ...makeSession('beta-1', 'Beta Session', '/workspace/beta', '2026-02-01T00:00:00.000Z'),
          createdAt: '2026-04-01T00:00:00.000Z',
        },
      ],
    })

    render(<Sidebar />)

    expect(projectGroupNames().slice(0, 2)).toEqual(['alpha', 'beta'])

    openProjectManagement()
    fireEvent.click(screen.getByRole('radio', { name: 'Created time' }))

    await waitFor(() => {
      expect(desktopUiPreferencesApiMock.updateSidebarPreferences).toHaveBeenCalledWith({
        projectOrder: [],
        pinnedProjects: [],
        hiddenProjects: [],
        projectOrganization: 'recentProject',
        projectSortBy: 'createdAt',
      })
      expect(projectGroupNames().slice(0, 2)).toEqual(['beta', 'alpha'])
    })
    expect(window.localStorage.getItem(PROJECT_SORT_STORAGE_KEY)).toBe('createdAt')
  })

  it('keeps only the add-project plus in the projects header', () => {
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', now),
        makeSession('beta-1', 'Beta Session', '/workspace/beta', now),
      ],
    })

    render(<Sidebar />)

    const header = screen.getByTestId('sidebar-projects-header')
    expect(within(header).getAllByRole('button')).toHaveLength(1)
    expect(within(header).getByRole('button', { name: 'New project' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Project menu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Archive all chats' })).not.toBeInTheDocument()
  })

  it('shows the project new-session plus without hover and no per-project menu button', () => {
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', new Date().toISOString()),
      ],
    })

    render(<Sidebar />)

    const row = screen.getByTestId('sidebar-project-row-workspace-alpha')
    const plus = within(row).getByRole('button', { name: 'New session in alpha' })
    expect(row).toHaveClass('sidebar-row')
    expect(plus).toHaveClass('sidebar-row-action')
    expect(plus.parentElement).toBe(row)
    expect(screen.queryByRole('button', { name: 'Project actions for alpha' })).not.toBeInTheDocument()
  })

  it('shows the project action menu with pin and Finder actions', async () => {
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', now),
      ],
    })

    render(<Sidebar />)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Collapse alpha' }))

    expect(screen.getByRole('menuitem', { name: 'Pin Project' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Open in Finder' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Hide from Sidebar' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Create Permanent Worktree' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Rename Project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Archive Conversations' })).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Finder' }))
    })

    expect(openTargetStoreMock.ensureTargets).toHaveBeenCalledTimes(1)
    expect(openTargetStoreMock.openTarget).toHaveBeenCalledWith('finder', '/workspace/alpha')
  })

  it('pins a project above the rest of the project list', async () => {
    const base = new Date('2026-05-15T10:00:00.000Z').getTime()
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', new Date(base).toISOString()),
        makeSession('beta-1', 'Beta Session', '/workspace/beta', new Date(base - 20_000).toISOString()),
      ],
    })

    render(<Sidebar />)

    expect(projectGroupNames().slice(0, 2)).toEqual(['alpha', 'beta'])

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Collapse beta' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin Project' }))

    await waitFor(() => {
      expect(projectGroupNames().slice(0, 2)).toEqual(['beta', 'alpha'])
    })
    expect(JSON.parse(window.localStorage.getItem(PROJECT_PINNED_STORAGE_KEY) ?? '[]')).toEqual(['/workspace/beta'])
  })

  it('removes a project from the sidebar without deleting its sessions', async () => {
    const base = new Date('2026-05-15T10:00:00.000Z').getTime()
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', new Date(base).toISOString()),
        makeSession('beta-1', 'Beta Session', '/workspace/beta', new Date(base - 20_000).toISOString()),
      ],
    })

    render(<Sidebar />)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Collapse beta' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide from Sidebar' }))

    await waitFor(() => {
      expect(screen.queryByText('beta')).not.toBeInTheDocument()
    })
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(deleteSessions).not.toHaveBeenCalled()
    expect(deleteSession).not.toHaveBeenCalled()
    expect(JSON.parse(window.localStorage.getItem(PROJECT_HIDDEN_STORAGE_KEY) ?? '[]')).toEqual(['/workspace/beta'])
    expect(addToast).toHaveBeenCalledWith({
      type: 'info',
      message: 'beta was hidden from the sidebar. Existing sessions were not deleted.',
    })
  })

  it('keeps hidden projects out of the sidebar without the removed project filter', () => {
    window.localStorage.setItem(PROJECT_HIDDEN_STORAGE_KEY, JSON.stringify(['/workspace/beta']))
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', now),
        makeSession('beta-1', 'Beta Session', '/workspace/beta', now),
      ],
    })

    render(<Sidebar />)

    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.queryByText('beta')).not.toBeInTheDocument()
    expect(screen.queryByTestId('project-filter')).not.toBeInTheDocument()
  })

  it('restores hidden projects from the project management dialog', async () => {
    window.localStorage.setItem(PROJECT_HIDDEN_STORAGE_KEY, JSON.stringify(['/workspace/beta']))
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', now),
        makeSession('beta-1', 'Beta Session', '/workspace/beta', now),
      ],
    })

    render(<Sidebar />)

    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.queryByText('beta')).not.toBeInTheDocument()

    openProjectManagement()
    fireEvent.click(screen.getByRole('button', { name: 'Restore hidden projects (1)' }))

    await waitFor(() => {
      expect(within(screen.getByRole('complementary')).getByText('beta')).toBeInTheDocument()
    })
    expect(JSON.parse(window.localStorage.getItem(PROJECT_HIDDEN_STORAGE_KEY) ?? '[]')).toEqual([])
    expect(desktopUiPreferencesApiMock.updateSidebarPreferences).toHaveBeenCalledWith({
      projectOrder: [],
      pinnedProjects: [],
      hiddenProjects: [],
      projectOrganization: 'recentProject',
      projectSortBy: 'updatedAt',
    })
  })

  it('restores a hidden project when a new session is created in that project', async () => {
    window.localStorage.setItem(PROJECT_HIDDEN_STORAGE_KEY, JSON.stringify(['/workspace/beta']))
    createSession.mockResolvedValue('beta-new')
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', now),
        makeSession('beta-1', 'Beta Session', '/workspace/beta', now),
      ],
    })
    useTabStore.setState({
      tabs: [{ sessionId: 'beta-1', title: 'Beta Session', type: 'session', status: 'idle' }],
      activeTabId: 'beta-1',
    })

    render(<Sidebar />)

    expect(screen.queryByText('beta')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('/workspace/beta')
      expect(screen.getByText('beta')).toBeInTheDocument()
    })
    expect(JSON.parse(window.localStorage.getItem(PROJECT_HIDDEN_STORAGE_KEY) ?? '[]')).toEqual([])
    expect(desktopUiPreferencesApiMock.updateSidebarPreferences).toHaveBeenCalledWith({
      projectOrder: [],
      pinnedProjects: [],
      hiddenProjects: [],
      projectOrganization: 'recentProject',
      projectSortBy: 'updatedAt',
    })
  })

  it('uses server sidebar preferences across browser and desktop storage contexts', async () => {
    desktopUiPreferencesApiMock.getPreferences.mockResolvedValueOnce({
      exists: true,
      preferences: {
        schemaVersion: 1,
        sidebar: {
          projectOrder: ['/workspace/beta', '/workspace/alpha'],
          pinnedProjects: ['/workspace/beta'],
          hiddenProjects: ['/workspace/alpha'],
          projectOrganization: 'recentProject',
          projectSortBy: 'updatedAt',
        },
      },
    })
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', now),
        makeSession('beta-1', 'Beta Session', '/workspace/beta', now),
      ],
    })

    render(<Sidebar />)

    await waitFor(() => {
      expect(screen.queryByText('alpha')).not.toBeInTheDocument()
      expect(screen.getByText('beta')).toBeInTheDocument()
    })
    expect(JSON.parse(window.localStorage.getItem(PROJECT_ORDER_STORAGE_KEY) ?? '[]')).toEqual([
      '/workspace/beta',
      '/workspace/alpha',
    ])
    expect(JSON.parse(window.localStorage.getItem(PROJECT_PINNED_STORAGE_KEY) ?? '[]')).toEqual(['/workspace/beta'])
    expect(JSON.parse(window.localStorage.getItem(PROJECT_HIDDEN_STORAGE_KEY) ?? '[]')).toEqual(['/workspace/alpha'])
  })

  it('migrates cached local sidebar preferences when the server file is missing after update', async () => {
    desktopUiPreferencesApiMock.getPreferences.mockResolvedValueOnce({
      exists: false,
      preferences: {
        schemaVersion: 1,
        sidebar: {
          projectOrder: [],
          pinnedProjects: [],
          hiddenProjects: [],
          projectOrganization: 'recentProject',
          projectSortBy: 'updatedAt',
        },
      },
    })
    window.localStorage.setItem(PROJECT_HIDDEN_STORAGE_KEY, JSON.stringify(['/workspace/beta']))
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', new Date().toISOString()),
        makeSession('beta-1', 'Beta Session', '/workspace/beta', new Date().toISOString()),
      ],
    })

    render(<Sidebar />)

    await waitFor(() => {
      expect(desktopUiPreferencesApiMock.updateSidebarPreferences).toHaveBeenCalledWith({
        projectOrder: [],
        pinnedProjects: [],
        hiddenProjects: ['/workspace/beta'],
        projectOrganization: 'recentProject',
        projectSortBy: 'updatedAt',
      })
    })
    expect(screen.queryByText('beta')).not.toBeInTheDocument()
  })

  it('ignores corrupt hidden project storage for backward compatibility', () => {
    window.localStorage.setItem(PROJECT_HIDDEN_STORAGE_KEY, '{bad json')
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', new Date().toISOString()),
      ],
    })

    render(<Sidebar />)

    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Alpha Session/ })).toBeInTheDocument()
  })

  it('keeps persisted worktree sessions under the source project group', () => {
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        makeSession('source-1', 'Source Session', '/workspace/repo', now),
        {
          ...makeSession('worktree-1', 'Worktree Session', '/workspace/repo/.claude/worktrees/desktop-main-12345678', now),
          projectRoot: '/workspace/repo',
        },
        {
          ...makeSession('subdir-1', 'Subdir Session', '/workspace/repo/packages/app', now),
          projectRoot: '/workspace/repo',
        },
      ],
    })

    render(<Sidebar />)

    expect(screen.getByText('repo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Source Session/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Worktree Session/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Subdir Session/ })).toBeInTheDocument()
    expect(screen.getAllByText('worktree')).toHaveLength(1)
  })

  it('keeps a Windows drive root session separate from sessions in child projects', () => {
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        makeSession('drive-root', 'Drive Root Session', 'D:\\', now),
        makeSession('drive-project', 'Drive Project Session', 'D:\\SomeProject', now),
      ],
    })

    render(<Sidebar />)

    expect(screen.getByText('D:')).toBeInTheDocument()
    expect(screen.getByText('SomeProject')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Drive Root Session/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Drive Project Session/ })).toBeInTheDocument()
  })

  it('does not restore a hidden Windows drive root when creating a child project session', async () => {
    window.localStorage.setItem(PROJECT_HIDDEN_STORAGE_KEY, JSON.stringify(['D:\\']))
    createSession.mockResolvedValue('child-new')
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        makeSession('child-1', 'Child Session', 'D:\\workspace\\code\\dreamcoder', now),
      ],
    })
    useTabStore.setState({
      tabs: [{ sessionId: 'child-1', title: 'Child Session', type: 'session', status: 'idle' }],
      activeTabId: 'child-1',
    })

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('D:\\workspace\\code\\dreamcoder')
    })
    expect(JSON.parse(window.localStorage.getItem(PROJECT_HIDDEN_STORAGE_KEY) ?? '[]')).toEqual(['D:\\'])
    expect(desktopUiPreferencesApiMock.updateSidebarPreferences).not.toHaveBeenCalled()
  })

  it('shows running status and worktree marker on session rows without update time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))

    useSessionStore.setState({
      sessions: [
        {
          ...makeSession('running-worktree', 'Running Worktree', '/workspace/repo/.claude/worktrees/desktop-main-12345678', '2026-05-19T07:00:00.000Z'),
          projectRoot: '/workspace/repo',
        },
        makeSession('idle-source', 'Idle Source', '/workspace/repo', '2026-05-19T11:40:00.000Z'),
      ],
    })
    useTabStore.setState({
      tabs: [
        { sessionId: 'running-worktree', title: 'Running Worktree', type: 'session', status: 'running' },
        { sessionId: 'idle-source', title: 'Idle Source', type: 'session', status: 'idle' },
      ],
      activeTabId: 'running-worktree',
    })

    render(<Sidebar />)

    const runningRow = screen.getByRole('button', { name: /^Running Worktree/ })
    expect(within(runningRow).getByLabelText('Session running')).toBeInTheDocument()
    expect(within(runningRow).getByText('worktree')).toHaveClass('sr-only')
    expect(runningRow).toHaveAttribute('title', 'Running Worktree')
    expect(screen.queryByText(/ago$/)).not.toBeInTheDocument()

    const idleRow = screen.getByRole('button', { name: /^Idle Source/ })
    expect(within(idleRow).queryByLabelText('Session running')).not.toBeInTheDocument()
    expect(idleRow).toHaveAttribute('title', 'Idle Source')
  })

  it('does not re-render for streamed text or idle session changes', async () => {
    vi.useFakeTimers()
    useSessionStore.setState({
      sessions: [makeSession('running', 'Running session', '/workspace/repo', '2026-05-19T12:00:00.000Z')],
    })
    useChatStore.setState({
      sessions: { running: { ...useChatStore.getState().getSession('running'), chatState: 'streaming' } },
    })
    const onRender = vi.fn()
    await act(async () => {
      render(<Profiler id="sidebar" onRender={onRender}><Sidebar /></Profiler>)
    })
    onRender.mockClear()

    act(() => {
      useChatStore.getState().handleServerMessage('running', { type: 'content_delta', text: 'Hello' })
      vi.advanceTimersByTime(50)
    })

    expect(useChatStore.getState().getSession('running').streamingText).toBe('Hello')
    expect(onRender).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Session running')).toBeInTheDocument()

    act(() => {
      useChatStore.setState((state) => ({
        sessions: { idle: state.getSession('idle'), ...state.sessions },
      }))
    })

    expect(onRender).not.toHaveBeenCalled()
  })

  it('updates running indicators only when running session membership changes', async () => {
    useSessionStore.setState({
      sessions: [
        makeSession('first', 'First session', '/workspace/repo', '2026-05-19T12:00:00.000Z'),
        makeSession('second', 'Second session', '/workspace/repo', '2026-05-19T11:00:00.000Z'),
      ],
    })
    const first = useChatStore.getState().getSession('first')
    const second = useChatStore.getState().getSession('second')
    const onRender = vi.fn()
    await act(async () => {
      render(<Profiler id="sidebar" onRender={onRender}><Sidebar /></Profiler>)
    })
    onRender.mockClear()
    expect(screen.queryByLabelText('Session running')).not.toBeInTheDocument()

    act(() => {
      useChatStore.setState({ sessions: { first: { ...first, chatState: 'thinking' }, second } })
    })
    expect(onRender).toHaveBeenCalledOnce()
    expect(within(screen.getByRole('button', { name: /^First session/ })).getByLabelText('Session running')).toBeInTheDocument()
    onRender.mockClear()

    act(() => {
      useChatStore.setState({ sessions: { first: { ...first, chatState: 'tool_executing' }, second } })
    })
    expect(onRender).not.toHaveBeenCalled()

    act(() => {
      useChatStore.setState({ sessions: { first, second: { ...second, chatState: 'streaming' } } })
    })
    expect(onRender).toHaveBeenCalledOnce()
    expect(within(screen.getByRole('button', { name: /^First session/ })).queryByLabelText('Session running')).not.toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /^Second session/ })).getByLabelText('Session running')).toBeInTheDocument()
    onRender.mockClear()

    act(() => {
      useChatStore.setState({ sessions: {} })
    })
    expect(onRender).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Session running')).not.toBeInTheDocument()
  })

  it('shows a toast when session creation fails', async () => {
    createSession.mockRejectedValue(new Error('boom'))

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith({
        type: 'error',
        message: 'boom',
      })
    })

    expect(useTabStore.getState().tabs).toEqual([])
  })

  it('requires confirmation before deleting a session from the sidebar', async () => {
    deleteSession.mockResolvedValue(undefined)
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'Open Session',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
      ],
    })
    useTabStore.setState({
      tabs: [{ sessionId: 'session-1', title: 'Open Session', type: 'session', status: 'idle' }],
      activeTabId: 'session-1',
    })

    render(<Sidebar />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /^Open Session/ }))

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))

    expect(deleteSession).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Delete this session? This cannot be undone.')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    })

    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledWith('session-1')
      expect(disconnectSession).toHaveBeenCalledWith('session-1')
    })

    expect(useTabStore.getState().tabs).toEqual([])
    expect(useTabStore.getState().activeTabId).toBeNull()
  })

  it('selects and deletes multiple sessions from batch mode', async () => {
    deleteSessions.mockResolvedValue({
      ok: true,
      successes: ['session-1', 'session-2'],
      failures: [],
    })
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'First Session',
          createdAt: now,
          modifiedAt: now,
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
        {
          id: 'session-2',
          title: 'Second Session',
          createdAt: now,
          modifiedAt: now,
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
      ],
    })
    useTabStore.setState({
      tabs: [
        { sessionId: 'session-1', title: 'First Session', type: 'session', status: 'idle' },
        { sessionId: 'session-2', title: 'Second Session', type: 'session', status: 'idle' },
      ],
      activeTabId: 'session-1',
    })

    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Actions for First Session' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Batch manage' }))
    fireEvent.click(screen.getByRole('button', { name: /^First Session/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Second Session/ }))

    expect(screen.getByText('2 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (2)' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Delete 2 sessions? This cannot be undone.')).toBeInTheDocument()
    expect(within(dialog).getByText('First Session')).toBeInTheDocument()
    expect(within(dialog).getByText('Second Session')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    })

    await waitFor(() => {
      expect(deleteSessions).toHaveBeenCalledWith(['session-1', 'session-2'])
      expect(disconnectSession).toHaveBeenCalledWith('session-1')
      expect(disconnectSession).toHaveBeenCalledWith('session-2')
    })
    expect(useTabStore.getState().tabs).toEqual([])
    expect(addToast).toHaveBeenCalledWith({
      type: 'success',
      message: 'Deleted 2 sessions.',
    })
  })

  it('renders batch-selected sessions as separated selected rows', () => {
    const now = new Date().toISOString()
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'First Session',
          createdAt: now,
          modifiedAt: now,
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
        {
          id: 'session-2',
          title: 'Second Session',
          createdAt: now,
          modifiedAt: now,
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
        {
          id: 'session-3',
          title: 'Third Session',
          createdAt: now,
          modifiedAt: now,
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
      ],
    })
    useTabStore.setState({
      tabs: [{ sessionId: 'session-2', title: 'Second Session', type: 'session', status: 'idle' }],
      activeTabId: 'session-2',
    })

    render(<Sidebar />)

    openProjectManagement()
    fireEvent.click(screen.getByRole('button', { name: 'Batch manage' }))
    fireEvent.click(screen.getByRole('button', { name: /^First Session/ }))

    expect(screen.getByTestId('sidebar-session-row-session-1').parentElement).toHaveClass('mb-0.5')
    expect(screen.getByTestId('sidebar-session-row-session-1')).toHaveClass('sidebar-session-row--selected')
    expect(screen.getByTestId('sidebar-session-row-session-2')).toHaveClass('sidebar-session-row--active')
    expect(screen.getByTestId('sidebar-session-row-session-3')).toHaveClass('sidebar-session-row--idle')
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument()
  })

  it('collapses into an icon rail and expands back', async () => {
    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    })

    expect(useUIStore.getState().sidebarOpen).toBe(false)
    expect(screen.queryByPlaceholderText('Search sessions')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary')).toHaveAttribute('data-state', 'closed')
    expect(screen.getByTestId('sidebar-expand-button')).toHaveClass('sidebar-toggle-button--collapsed')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    })

    expect(useUIStore.getState().sidebarOpen).toBe(true)
    expect(screen.getByPlaceholderText('Search sessions')).toBeInTheDocument()
    expect(screen.getByRole('complementary')).toHaveAttribute('data-state', 'open')
  })

  it('renders search controls without the removed embedded project filter', () => {
    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-search-controls-section')).toHaveStyle({ overflow: 'visible' })
    expect(screen.getByTestId('sidebar-search-controls-section')).toHaveClass('relative', 'z-20')
    expect(screen.getByPlaceholderText('Search sessions')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^All projects/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('project-filter')).not.toBeInTheDocument()
  })

  it('keeps the session list section in a constrained flex column for scrolling', () => {
    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-session-list-section')).toHaveClass('flex', 'flex-1', 'min-h-0', 'flex-col')
  })

  it('keeps the footer dock opaque above the scrolling session list', () => {
    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-footer')).toHaveClass('sidebar-settings-dock')
    expect(screen.getByTestId('sidebar-footer')).toHaveClass('absolute', 'bottom-0')
    expect(within(screen.getByTestId('sidebar-footer')).getByRole('button', { name: 'More' })).toBeInTheDocument()
  })

  it('keeps mobile navigation focused on chat sessions', async () => {
    const onRequestClose = vi.fn()
    createSession.mockResolvedValue('session-mobile-new')
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'Open Session',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar isMobile onRequestClose={onRequestClose} />)

    expect(screen.queryByRole('button', { name: 'Scheduled' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions for Open Session' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Open Session/ }))
    expect(onRequestClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalled()
    })
    expect(onRequestClose).toHaveBeenCalledTimes(2)
  })

  it('opens settings from the More menu', () => {
    useUIStore.setState({ settingsOpen: false } as Partial<ReturnType<typeof useUIStore.getState>>)
    render(<Sidebar />)

    const trigger = screen.getByRole('button', { name: 'More' })
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'Projects & sessions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(screen.queryByTestId('sidebar-more-menu')).not.toBeInTheDocument()
    // The trigger holds focus before settings opens, so the modal returns focus there.
    expect(document.activeElement).toBe(trigger)
  })

  it('moves focus into the More menu and between its main and language views', () => {
    useSettingsStore.setState({ locale: 'zh' })
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Projects & sessions' }))

    fireEvent.click(screen.getByRole('menuitem', { name: 'Language · 中文' }))
    expect(screen.getByRole('menu', { name: 'Language' })).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '中文' }))

    fireEvent.click(screen.getByRole('menuitem', { name: 'Back' }))
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Projects & sessions' }))
  })

  it('switches the interface language from the More menu', () => {
    useSettingsStore.setState({ locale: 'zh' })
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Language · 中文' }))

    expect(screen.getByRole('menuitemradio', { name: '中文' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Back' }))
    expect(screen.getByRole('menuitem', { name: 'Language · 中文' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Language · 中文' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }))

    expect(useSettingsStore.getState().locale).toBe('en')
    expect(screen.queryByTestId('sidebar-more-menu')).not.toBeInTheDocument()
  })

  it('closes the More menu on an outside click', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByTestId('sidebar-more-menu')).toBeInTheDocument()

    fireEvent.click(document.body)
    expect(screen.queryByTestId('sidebar-more-menu')).not.toBeInTheDocument()
  })

  it('lists the registered keyboard shortcuts', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keyboard shortcuts' }))

    const dialog = screen.getByTestId('shortcuts-dialog')
    expect(within(dialog).getByText('Switch session')).toBeInTheDocument()
    expect(within(dialog).getByText('Stop generating')).toBeInTheDocument()
    expect(within(dialog).getByText('K')).toBeInTheDocument()
  })

  it('manages pinned and hidden projects from the project management dialog', async () => {
    const base = new Date('2026-05-15T10:00:00.000Z').getTime()
    useSessionStore.setState({
      sessions: [
        makeSession('alpha-1', 'Alpha Session', '/workspace/alpha', new Date(base).toISOString()),
        makeSession('beta-1', 'Beta Session', '/workspace/beta', new Date(base - 20_000).toISOString()),
      ],
    })

    render(<Sidebar />)
    openProjectManagement()

    expect(screen.getByRole('radio', { name: 'Recent projects' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'By time' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'By project' })).toBeInTheDocument()

    const betaRow = screen.getByTestId('project-management-row-beta')
    fireEvent.click(within(betaRow).getByRole('button', { name: 'Pin Project' }))
    await waitFor(() => {
      expect(projectGroupNames().slice(0, 2)).toEqual(['beta', 'alpha'])
    })

    fireEvent.click(within(screen.getByTestId('project-management-row-alpha')).getByRole('button', { name: 'Hide from Sidebar' }))
    await waitFor(() => {
      expect(within(screen.getByRole('complementary')).queryByText('alpha')).not.toBeInTheDocument()
    })
    expect(within(screen.getByTestId('project-management-row-alpha')).getByRole('button', { name: 'Restore to Sidebar' })).toBeInTheDocument()
  })

  it('opens the session row menu from the row button and keeps it open on the same click', () => {
    useSessionStore.setState({
      sessions: [makeSession('session-1', 'Open Session', '/workspace/project', new Date().toISOString())],
    })

    render(<Sidebar />)

    const moreButton = screen.getByRole('button', { name: 'Actions for Open Session' })
    expect(moreButton).toHaveClass('sidebar-session-more')
    expect(moreButton.parentElement).toBe(screen.getByTestId('sidebar-session-row-session-1'))

    fireEvent.click(moreButton)
    expect(moreButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('sidebar-session-row-session-1')).toHaveAttribute('data-menu-open', 'true')
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Batch manage' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()

    fireEvent.click(moreButton)
    expect(screen.queryByTestId('sidebar-session-menu')).not.toBeInTheDocument()

    fireEvent.click(moreButton)
    fireEvent.click(document.body)
    expect(screen.queryByTestId('sidebar-session-menu')).not.toBeInTheDocument()

    fireEvent.click(moreButton)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(screen.getByRole('textbox', { name: 'Rename' })).toHaveValue('Open Session')
  })

  it('supports keyboard navigation in the session row menu and returns focus to its button', () => {
    useSessionStore.setState({
      sessions: [makeSession('session-1', 'Open Session', '/workspace/project', new Date().toISOString())],
    })
    render(<Sidebar />)

    const moreButton = screen.getByRole('button', { name: 'Actions for Open Session' })
    moreButton.focus()
    fireEvent.click(moreButton)
    const menu = screen.getByTestId('sidebar-session-menu')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }))

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Batch manage' }))
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }))
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }))

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByTestId('sidebar-session-menu')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(moreButton)
  })

  it('enters batch mode from the session row menu', () => {
    useSessionStore.setState({
      sessions: [makeSession('session-1', 'Open Session', '/workspace/project', new Date().toISOString())],
    })

    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Open Session' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Batch manage' }))

    expect(useSessionStore.getState().isBatchMode).toBe(true)
    expect(screen.getByText('0 selected')).toBeInTheDocument()
  })

  it('shows a loading state instead of an empty session list while initial fetch is pending', () => {
    useSessionStore.setState({ isLoading: true, sessions: [] })

    render(<Sidebar />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('No sessions')).not.toBeInTheDocument()
  })

  it('refreshes sessions manually and through low-frequency visible polling', async () => {
    vi.useFakeTimers()

    render(<Sidebar />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchSessions).toHaveBeenCalledTimes(1)

    openProjectManagement()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh sessions' }))
      await Promise.resolve()
    })
    expect(fetchSessions).toHaveBeenCalledTimes(2)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })
    expect(fetchSessions).toHaveBeenCalledTimes(2)

    await act(async () => {
      vi.advanceTimersByTime(30_000)
      await Promise.resolve()
    })
    expect(fetchSessions).toHaveBeenCalledTimes(3)
  })

  it('does not poll for session changes while the document is hidden', async () => {
    vi.useFakeTimers()
    const originalVisibility = document.visibilityState
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })

    render(<Sidebar />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchSessions).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(30_000)
      await Promise.resolve()
    })
    expect(fetchSessions).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(fetchSessions).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibility,
    })
  })
})
