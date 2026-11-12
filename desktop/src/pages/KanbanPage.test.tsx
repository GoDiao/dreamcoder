import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const kanbanApiMock = vi.hoisted(() => ({ view: vi.fn(), listBoards: vi.fn(), createBoard: vi.fn(), command: vi.fn(), history: vi.fn() }))
vi.mock('../api/kanban', () => ({ kanbanApi: kanbanApiMock }))
vi.mock('../i18n', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}))

import { KanbanPage } from './KanbanPage'
import { FIXTURE_BOARD, FIXTURE_PROJECT, fixtureCard, fixtureView } from '../components/kanban/kanbanFixture'
import { useKanbanStore } from '../stores/kanbanStore'
import { useSessionStore } from '../stores/sessionStore'
import { kanbanTabId, useTabStore } from '../stores/tabStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'

const TAB = kanbanTabId(FIXTURE_PROJECT)

describe('KanbanPage', () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [{ sessionId: TAB, title: 'Project board', type: 'kanban', status: 'idle' }], activeTabId: TAB })
    useWorkspacePanelStore.setState(useWorkspacePanelStore.getInitialState(), true)
    useSessionStore.setState({ sessions: [{ id: 'pm', title: 'Planner', createdAt: '', modifiedAt: '', messageCount: 1, projectPath: FIXTURE_PROJECT, projectRoot: FIXTURE_PROJECT, workDir: FIXTURE_PROJECT, workDirExists: true }] })
    kanbanApiMock.view.mockResolvedValue({ changed: false, etag: 'etag-1' })
    kanbanApiMock.history.mockResolvedValue({ events: [] })
  })

  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('offers to create a board when the project has none', async () => {
    useKanbanStore.setState({ boards: [], views: {} })
    kanbanApiMock.createBoard.mockResolvedValue({ view: fixtureView([]) })
    render(<KanbanPage />)

    expect(screen.getByTestId('kanban-create-board')).toHaveTextContent('kanban.empty.title')
    fireEvent.click(screen.getByRole('button', { name: 'kanban.empty.create' }))

    await waitFor(() => expect(kanbanApiMock.createBoard).toHaveBeenCalledWith(FIXTURE_PROJECT))
    expect(await screen.findByTestId('kanban-page')).toBeInTheDocument()
  })

  it('shows the board once the list loads after a failed first try', async () => {
    useKanbanStore.setState({ boards: null, views: {} })
    kanbanApiMock.listBoards.mockRejectedValueOnce(new Error('offline'))
    render(<KanbanPage />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    act(() => useKanbanStore.setState({ boards: [{ key: FIXTURE_BOARD, project: FIXTURE_PROJECT }], views: { [FIXTURE_BOARD]: fixtureView([fixtureCard(1)]) } }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('kanban-page')).toBeInTheDocument()
  })

  it('shows every task again when the filtered owner no longer owns any', async () => {
    const owned = fixtureView([fixtureCard(1, { owner: 'planner' }), fixtureCard(2)])
    useKanbanStore.setState({ boards: [{ key: FIXTURE_BOARD, project: FIXTURE_PROJECT }], views: { [FIXTURE_BOARD]: owned } })
    render(<KanbanPage />)
    const filter = screen.getByRole('combobox', { name: 'kanban.filter.owner' })
    act(() => filter.focus())
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Planner' }))
    expect(screen.queryByRole('button', { name: /Task 2/ })).not.toBeInTheDocument()

    act(() => useKanbanStore.setState({ views: { [FIXTURE_BOARD]: fixtureView([fixtureCard(1), fixtureCard(2)]) } }))

    expect(screen.getByRole('button', { name: /Task 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Task 2/ })).toBeInTheDocument()
    expect(filter).toHaveTextContent('kanban.filter.allOwners')
  })

  it('starts another board with its own search and shows when a refresh failed', async () => {
    const other = '/work/beta'
    const otherTab = kanbanTabId(other)
    useTabStore.setState({ tabs: [{ sessionId: TAB, title: 'A', type: 'kanban', status: 'idle' }, { sessionId: otherTab, title: 'B', type: 'kanban', status: 'idle' }], activeTabId: TAB })
    useKanbanStore.setState({
      boards: [{ key: FIXTURE_BOARD, project: FIXTURE_PROJECT }, { key: 'work-beta', project: other }],
      views: { [FIXTURE_BOARD]: fixtureView([fixtureCard(1)]), 'work-beta': fixtureView([fixtureCard(1)], { key: 'work-beta', project: other }) },
      loadErrors: { 'work-beta': 'offline' },
    })
    render(<KanbanPage />)

    fireEvent.change(screen.getByRole('searchbox', { name: 'kanban.search' }), { target: { value: 'nothing matches' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    act(() => useTabStore.setState({ activeTabId: otherTab }))

    expect(screen.getByRole('searchbox', { name: 'kanban.search' })).toHaveValue('')
    expect(screen.getByRole('alert')).toHaveTextContent('kanban.error.refreshFailed offline')
  })

  it('opens a task in the side panel, without session tabs, and turns the board compact', async () => {
    useKanbanStore.setState({
      boards: [{ key: FIXTURE_BOARD, project: FIXTURE_PROJECT }],
      views: { [FIXTURE_BOARD]: fixtureView([fixtureCard(1, { status: 'backlog' }), fixtureCard(2, { status: 'todo' })]) },
    })
    render(<KanbanPage />)
    expect(screen.getByTestId('kanban-columns')).not.toHaveAttribute('data-compact')

    fireEvent.click(screen.getByRole('button', { name: /Task 2/ }))

    expect(await screen.findByTestId('kanban-task-detail', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByTestId('kanban-columns')).toHaveAttribute('data-compact', 'true')
    expect(screen.getByTestId('kanban-column-backlog')).toHaveAttribute('data-folded', 'true')
    expect(screen.queryByRole('button', { name: 'workspace.newTab' })).not.toBeInTheDocument()
    expect(useWorkspacePanelStore.getState().getActiveTab(TAB)).toMatchObject({ kind: 'task', board: FIXTURE_BOARD, card: 2 })
  })
})
