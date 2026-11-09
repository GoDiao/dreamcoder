import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

const desktopUiPreferencesApiMock = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  updateSidebarPreferences: vi.fn(),
}))

vi.mock('../../api/desktopUiPreferences', () => ({
  desktopUiPreferencesApi: desktopUiPreferencesApiMock,
}))

const kanbanApiMock = vi.hoisted(() => ({ listBoards: vi.fn(), view: vi.fn() }))

vi.mock('../../api/kanban', () => ({ kanbanApi: kanbanApiMock }))

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}))

import { Sidebar } from './Sidebar'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useKanbanStore } from '../../stores/kanbanStore'
import { fixtureCard, fixtureView } from '../kanban/kanbanFixture'
import type { SessionListItem } from '../../types/session'

const COLLAPSED_KEY = 'dreamcoder-sidebar-collapsed-sessions'

function makeSession(
  id: string,
  title: string,
  modifiedAt: string,
  extra: Partial<SessionListItem> = {},
  projectRoot = '/work/alpha',
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
    ...extra,
  }
}

function alphaSessions(): SessionListItem[] {
  return [
    makeSession('p', 'Parent', '2026-11-04T10:00:00Z'),
    makeSession('c1', 'Child one', '2026-11-04T09:00:00Z', { parent: { sessionId: 'p', kind: 'spawned' } }),
    makeSession('c2', 'Child two', '2026-11-04T09:30:00Z', { parent: { sessionId: 'p', kind: 'forked' } }),
    makeSession('g', 'Grandchild', '2026-11-04T08:00:00Z', { parent: { sessionId: 'c1', kind: 'spawned' } }),
    makeSession('o', 'Orphan', '2026-11-04T07:00:00Z', { parent: { sessionId: 'gone', kind: 'forked' } }),
  ]
}

function rowIds(): string[] {
  return screen.getAllByTestId(/^sidebar-session-row-/).map((row) => row.dataset.testid!.replace('sidebar-session-row-', ''))
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`sidebar-session-row-${id}`)
}

function setSessions(sessions: SessionListItem[]) {
  useSessionStore.setState({ sessions })
}

describe('Sidebar session tree', () => {
  const connectToSession = vi.fn()

  beforeEach(() => {
    connectToSession.mockReset()
    window.localStorage.removeItem(COLLAPSED_KEY)
    desktopUiPreferencesApiMock.getPreferences.mockRejectedValue(new Error('server unavailable'))
    desktopUiPreferencesApiMock.updateSidebarPreferences.mockResolvedValue({ ok: true })
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({
      sessions: [],
      isLoading: false,
      error: null,
      isBatchMode: false,
      selectedSessionIds: new Set(),
      fetchSessions: vi.fn().mockResolvedValue(undefined),
    })
    useChatStore.setState({ sessions: {}, connectToSession } as Partial<ReturnType<typeof useChatStore.getState>>)
    useUIStore.setState({ sidebarOpen: true } as Partial<ReturnType<typeof useUIStore.getState>>)
    useKanbanStore.setState({ boards: null, views: {}, snoozed: {} })
    kanbanApiMock.listBoards.mockResolvedValue({ boards: [] })
  })

  afterEach(() => {
    cleanup()
    window.localStorage.removeItem(COLLAPSED_KEY)
  })

  it('nests children under their parent recursively, newest child first, and keeps an orphan top-level', () => {
    setSessions(alphaSessions())
    render(<Sidebar />)

    expect(rowIds()).toEqual(['p', 'c2', 'c1', 'g', 'o'])
    expect(within(row('p').parentElement!).queryAllByTestId('tree-connector-elbow')).toHaveLength(0)
    expect(within(row('c1').parentElement!).getAllByTestId('tree-connector-elbow')).toHaveLength(1)
    expect(within(row('g').parentElement!).getAllByTestId('tree-connector-elbow')).toHaveLength(1)
    expect(within(row('o').parentElement!).queryAllByTestId('tree-connector-elbow')).toHaveLength(0)
    expect(row('p').parentElement!.style.paddingLeft).toBe('')
    expect(row('c1').parentElement!.style.paddingLeft).toBe('14px')
    expect(row('g').parentElement!.style.paddingLeft).toBe('28px')
  })

  it('shows a child whose parent is in another project as a top-level row of its own group', () => {
    setSessions([
      makeSession('p', 'Parent', '2026-11-04T10:00:00Z'),
      makeSession('x', 'Elsewhere', '2026-11-04T09:00:00Z', { parent: { sessionId: 'p', kind: 'spawned' } }, '/work/beta'),
    ])
    render(<Sidebar />)

    const betaGroup = screen.getByTestId('sidebar-project-group-work-beta')
    expect(within(betaGroup).getByTestId('sidebar-session-row-x')).toBeInTheDocument()
    expect(within(row('x').parentElement!).queryAllByTestId('tree-connector-elbow')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /sidebar\.(collapse|expand)Children/ })).not.toBeInTheDocument()
  })

  it('marks forked and spawned children differently', () => {
    setSessions(alphaSessions())
    render(<Sidebar />)

    expect(within(row('c1')).getByText('sidebar.sessionSpawned')).toBeInTheDocument()
    expect(within(row('c2')).getByText('sidebar.sessionForked')).toBeInTheDocument()
    expect(within(row('p')).queryByText('sidebar.sessionSpawned')).not.toBeInTheDocument()
    expect(within(row('p')).queryByText('sidebar.sessionForked')).not.toBeInTheDocument()
  })

  it('nests a session assigned from the project board under the session that proposed it', () => {
    setSessions([
      makeSession('p', 'Parent', '2026-11-04T10:00:00Z'),
      makeSession('a', 'Assigned', '2026-11-04T09:00:00Z', { parent: { sessionId: 'p', kind: 'assigned' } }),
    ])
    render(<Sidebar />)

    expect(rowIds()).toEqual(['p', 'a'])
    expect(within(row('a').parentElement!).getAllByTestId('tree-connector-elbow')).toHaveLength(1)
    expect(within(row('a')).getByText('sidebar.sessionAssigned')).toBeInTheDocument()
    expect(within(row('a')).queryByText('sidebar.sessionSpawned')).not.toBeInTheDocument()
  })

  it('puts the child toggle after the session title with the child count', () => {
    setSessions(alphaSessions())
    render(<Sidebar />)

    const toggle = within(row('p')).getByTestId('sidebar-session-children-toggle')
    const titleButton = within(row('p')).getByRole('button', { name: 'Parent' })
    expect(toggle).toHaveTextContent('2')
    expect(titleButton.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('gives the child toggle a 44px touch target on mobile only', () => {
    setSessions(alphaSessions())
    const { unmount } = render(<Sidebar />)
    const desktopToggle = within(row('p')).getByTestId('sidebar-session-children-toggle')
    expect(desktopToggle.className).not.toContain('min-h-[44px]')
    unmount()

    render(<Sidebar isMobile onRequestClose={() => undefined} />)
    const mobileToggle = within(row('p')).getByTestId('sidebar-session-children-toggle')
    expect(mobileToggle.className).toContain('min-h-[44px]')
    expect(mobileToggle.className).toContain('min-w-[44px]')
  })

  it('collapses and expands a parent and remembers the collapsed state', () => {
    setSessions(alphaSessions())
    const { unmount } = render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'sidebar.collapseChildren Parent' }))
    expect(rowIds()).toEqual(['p', 'o'])
    expect(JSON.parse(window.localStorage.getItem(COLLAPSED_KEY)!)).toEqual(['p'])

    unmount()
    render(<Sidebar />)
    expect(rowIds()).toEqual(['p', 'o'])

    fireEvent.click(screen.getByRole('button', { name: 'sidebar.expandChildren Parent' }))
    expect(rowIds()).toEqual(['p', 'c2', 'c1', 'g', 'o'])
    expect(JSON.parse(window.localStorage.getItem(COLLAPSED_KEY)!)).toEqual([])
  })

  it('hides only the collapsed subtree', () => {
    setSessions(alphaSessions())
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'sidebar.collapseChildren Child one' }))
    expect(rowIds()).toEqual(['p', 'c2', 'c1', 'o'])
  })

  it('shows matching children flat when their parent does not match, and ignores collapsed state while searching', () => {
    setSessions(alphaSessions())
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(['p']))
    render(<Sidebar />)
    expect(rowIds()).toEqual(['p', 'o'])

    fireEvent.change(screen.getByPlaceholderText('sidebar.searchPlaceholder'), { target: { value: 'child' } })
    expect(rowIds()).toEqual(['c2', 'c1', 'g'])
    expect(within(row('c2').parentElement!).queryAllByTestId('tree-connector-elbow')).toHaveLength(0)
    expect(within(row('g').parentElement!).getAllByTestId('tree-connector-elbow')).toHaveLength(1)

    fireEvent.change(screen.getByPlaceholderText('sidebar.searchPlaceholder'), { target: { value: 'parent' } })
    expect(rowIds()).toEqual(['p'])
  })

  it('shows children of a collapsed parent while the search matches both', () => {
    setSessions([
      makeSession('p', 'Alpha plan', '2026-11-04T10:00:00Z'),
      makeSession('c', 'Alpha step', '2026-11-04T09:00:00Z', { parent: { sessionId: 'p', kind: 'spawned' } }),
    ])
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(['p']))
    render(<Sidebar />)
    expect(rowIds()).toEqual(['p'])

    fireEvent.change(screen.getByPlaceholderText('sidebar.searchPlaceholder'), { target: { value: 'alpha' } })
    expect(rowIds()).toEqual(['p', 'c'])
  })

  it('opens a session from its row through the tab store', () => {
    setSessions(alphaSessions())
    render(<Sidebar />)

    fireEvent.click(within(row('g')).getByRole('button', { name: 'Grandchild' }))
    expect(useTabStore.getState().activeTabId).toBe('g')
    expect(connectToSession).toHaveBeenCalledWith('g')
  })

  it('puts the project board first under a project that has one, with what needs you, and opens it', async () => {
    kanbanApiMock.listBoards.mockResolvedValue({ boards: [{ key: 'work-alpha', project: '/work/alpha' }] })
    kanbanApiMock.view.mockResolvedValue({
      changed: true,
      view: fixtureView([fixtureCard(1, { status: 'review' }), fixtureCard(2, { status: 'review' })], { key: 'work-alpha', inbox: [{ kind: 'review', card: 1 }, { kind: 'review', card: 2 }] }),
    })
    setSessions(alphaSessions())
    render(<Sidebar />)

    const board = await screen.findByTestId('sidebar-project-board')
    await waitFor(() => expect(within(board).getByLabelText('kanban.inbox.count 2')).toHaveTextContent('2'))
    const list = screen.getByTestId('sidebar-project-session-list-work-alpha')
    expect(list.firstElementChild).toBe(board)

    fireEvent.click(within(board).getByRole('button'))

    expect(useTabStore.getState().tabs).toContainEqual({ sessionId: '__kanban__:/work/alpha', title: 'kanban.title', type: 'kanban', status: 'idle' })
    expect(useTabStore.getState().activeTabId).toBe('__kanban__:/work/alpha')
  })

  it('shows no board row for a project without a board', async () => {
    setSessions(alphaSessions())
    render(<Sidebar />)

    await waitFor(() => expect(kanbanApiMock.listBoards).toHaveBeenCalled())
    expect(screen.queryByTestId('sidebar-project-board')).not.toBeInTheDocument()
  })
})
