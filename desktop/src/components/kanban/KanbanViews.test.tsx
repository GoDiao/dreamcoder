import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { CardStatus } from '@protocol'

const kanbanApiMock = vi.hoisted(() => ({ command: vi.fn(), history: vi.fn(), view: vi.fn() }))
vi.mock('../../api/kanban', () => ({ kanbanApi: kanbanApiMock }))
vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}))

import { ApiError } from '../../api/client'
import { useChatStore } from '../../stores/chatStore'
import { useKanbanStore } from '../../stores/kanbanStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import type { SessionListItem } from '../../types/session'
import { AssigneePicker } from './AssigneePicker'
import { CreateTaskDialog } from './CreateTaskDialog'
import { InboxView } from './InboxView'
import { TaskDetail } from './TaskDetail'
import { TaskTree } from './TaskTree'
import { useMoveCard } from './useReasonPrompt'
import { FIXTURE_BOARD, FIXTURE_PROJECT, fixtureAssignment, fixtureCard, fixtureView } from './kanbanFixture'

function session(id: string, title: string): SessionListItem {
  return { id, title, createdAt: '', modifiedAt: '', messageCount: 1, projectPath: FIXTURE_PROJECT, projectRoot: FIXTURE_PROJECT, workDir: FIXTURE_PROJECT, workDirExists: true }
}

function hierarchy() {
  return fixtureView([
    fixtureCard(1, { owner: 'lead', assignments: [fixtureAssignment('a1', 'owner', 'lead')], children: [2] }),
    fixtureCard(2, {
      parent: 1,
      status: 'in_progress',
      owner: 'worker',
      reviewer: 'lead',
      assignments: [fixtureAssignment('a2', 'owner', 'worker'), fixtureAssignment('a4', 'reviewer', 'lead')],
      createdBy: { kind: 'session', sessionId: 'lead' },
      dependsOn: [3],
      waitingOn: [3],
    }),
    fixtureCard(3, { status: 'review', deliveries: [{ id: 'd', summary: 'Shipped the token store', links: [], actor: { kind: 'session', sessionId: 'worker' }, at: '' }] }),
  ], {
    sessions: {
      lead: { title: 'Auth lead', exists: true, running: false },
      worker: { title: 'Token worker', exists: true, running: true },
    },
  })
}

beforeEach(() => {
  useKanbanStore.setState({ boards: [{ key: FIXTURE_BOARD, project: FIXTURE_PROJECT }], views: { [FIXTURE_BOARD]: hierarchy() }, loadErrors: {}, snoozed: {} })
  useWorkspacePanelStore.setState(useWorkspacePanelStore.getInitialState(), true)
  useSessionStore.setState({ sessions: [session('lead', 'Auth lead'), session('worker', 'Token worker'), session('idle', 'Idle helper')] })
  useTabStore.setState({ tabs: [], activeTabId: null })
  kanbanApiMock.history.mockResolvedValue({ events: [] })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function MoveButton({ card, to }: { card: number; to: CardStatus }) {
  const { move, dialog } = useMoveCard(FIXTURE_BOARD)
  const view = useKanbanStore((state) => state.views[FIXTURE_BOARD])!
  return (
    <>
      <button type="button" onClick={() => move(view.cards.find((each) => each.id === card)!, to)}>Move it</button>
      {dialog}
    </>
  )
}

describe('cancelling a task', () => {
  it('lists the open tasks that wait on it and its unfinished subtasks before the person confirms', async () => {
    kanbanApiMock.command.mockResolvedValue({ view: hierarchy(), warnings: [] })
    render(<MoveButton card={3} to="cancelled" />)
    fireEvent.click(screen.getByRole('button', { name: 'Move it' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getAllByRole('note').map((note) => note.textContent)).toEqual(['kanban.prompt.cancelDependents #2'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'kanban.action.cancelTask' }))
    await waitFor(() => expect(kanbanApiMock.command).toHaveBeenCalledWith(FIXTURE_BOARD, { type: 'cancel', card: 3 }))

    cleanup()
    render(<MoveButton card={1} to="cancelled" />)
    fireEvent.click(screen.getByRole('button', { name: 'Move it' }))
    expect(within(await screen.findByRole('alertdialog')).getAllByRole('note').map((note) => note.textContent)).toEqual(['kanban.prompt.cancelChildren #2'])
  })
})

describe('moving a task', () => {
  it('keeps the move action the same while the board changes, so the cards do not all re-render', () => {
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: hierarchy() } })
    const { result } = renderHook(() => useMoveCard(FIXTURE_BOARD))
    const first = result.current.move

    act(() => useKanbanStore.setState({ views: { [FIXTURE_BOARD]: fixtureView([...hierarchy().cards, fixtureCard(50)]) } }))

    expect(result.current.move).toBe(first)
  })
})

describe('reopening a task', () => {
  it('asks for an optional reason and sends it with the reopen', async () => {
    const view = hierarchy()
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: { ...view, cards: view.cards.map((card) => card.id === 3 ? { ...card, status: 'done' as const } : card) } } })
    kanbanApiMock.command.mockResolvedValue({ view: hierarchy(), warnings: [] })
    render(<MoveButton card={3} to="todo" />)

    fireEvent.click(screen.getByRole('button', { name: 'Move it' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'kanban.action.reopen' })).toBeEnabled()
    fireEvent.change(within(dialog).getByLabelText('kanban.prompt.optionalReason'), { target: { value: 'The login still fails' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'kanban.action.reopen' }))

    await waitFor(() => expect(kanbanApiMock.command).toHaveBeenCalledWith(FIXTURE_BOARD, { type: 'reopen', card: 3, reason: 'The login still fails' }))
  })
})

describe('CreateTaskDialog', () => {
  it('sends the acceptance criteria written row by row', async () => {
    kanbanApiMock.command.mockResolvedValue({ view: hierarchy(), warnings: [] })
    render(<CreateTaskDialog board={FIXTURE_BOARD} view={hierarchy()} defaults={{ status: 'todo', parent: null }} onClose={vi.fn()} onCreated={vi.fn()} />)

    fireEvent.change(screen.getByRole('textbox', { name: /kanban.create.taskTitle/ }), { target: { value: 'Rotate keys' } })
    const first = screen.getByRole('textbox', { name: 'kanban.acceptance.item 1' })
    fireEvent.change(first, { target: { value: 'Old keys stop working' } })
    fireEvent.keyDown(first, { key: 'Enter' })
    fireEvent.change(screen.getByRole('textbox', { name: 'kanban.acceptance.item 2' }), { target: { value: '  Runs nightly ' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'kanban.acceptance.item 2' }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'kanban.create.submit' }))

    await waitFor(() => expect(kanbanApiMock.command).toHaveBeenCalledWith(FIXTURE_BOARD, expect.objectContaining({ type: 'create_card', title: 'Rotate keys', acceptance: ['Old keys stop working', 'Runs nightly'] })))
  })
})

describe('CreateTaskDialog after a session added a task meanwhile', () => {
  it('opens the task it created, not the newest one on the board', async () => {
    const onCreated = vi.fn()
    const after = fixtureView([...hierarchy().cards, fixtureCard(50, { title: 'Rotate keys' }), fixtureCard(51, { title: 'From a session' })])
    kanbanApiMock.command.mockResolvedValue({ view: after, warnings: [], card: 50 })
    render(<CreateTaskDialog board={FIXTURE_BOARD} view={hierarchy()} defaults={{ status: 'todo', parent: null }} onClose={vi.fn()} onCreated={onCreated} />)

    fireEvent.change(screen.getByRole('textbox', { name: /kanban.create.taskTitle/ }), { target: { value: 'Rotate keys' } })
    fireEvent.click(screen.getByRole('button', { name: 'kanban.create.submit' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 50 })))
  })
})

describe('tree connectors', () => {
  it('gives child rows an elbow and top-level rows none in the hierarchy view', () => {
    const view = hierarchy()
    render(<TaskTree view={view} cards={view.cards} selectedCard={2} onOpen={() => undefined} />)

    expect(within(screen.getByTestId('kanban-tree-row-1')).queryAllByTestId('tree-connector-elbow')).toHaveLength(0)
    expect(within(screen.getByTestId('kanban-tree-row-2')).getAllByTestId('tree-connector-elbow')).toHaveLength(1)
    expect(screen.getByTestId('kanban-tree-row-3')).toHaveAttribute('data-related', 'true')
  })

})

describe('InboxView', () => {
  it('lists each kind of item and opens its task in the panel', () => {
    useKanbanStore.setState({
      views: {
        [FIXTURE_BOARD]: fixtureView([
          fixtureCard(2, { status: 'review' }),
          fixtureCard(3, { status: 'blocked', updates: [{ id: 'u', kind: 'blocked', text: 'Needs keys', actor: { kind: 'human' }, at: '' }] }),
          fixtureCard(5, { owner: 'gone' }),
        ], {
          inbox: [
            { kind: 'review', card: 2 },
            { kind: 'blocked', card: 3 },
            { kind: 'owner_missing', card: 5 },
          ],
        }),
      },
    })
    render(<InboxView panelId="board-tab" board={FIXTURE_BOARD} />)

    for (const key of ['review:2', 'blocked:3', 'owner_missing:5']) {
      expect(screen.getByTestId(`kanban-inbox-${key}`)).toBeInTheDocument()
    }
    expect(screen.getByText('Needs keys')).toBeInTheDocument()

    fireEvent.click(within(screen.getByTestId('kanban-inbox-review:2')).getByRole('button', { name: /#2/ }))

    expect(useWorkspacePanelStore.getState().getActiveTab('board-tab')).toMatchObject({ kind: 'task', board: FIXTURE_BOARD, card: 2 })
  })

  it('takes the person to the owner session to settle a blocked task', () => {
    const connectToSession = vi.fn()
    useChatStore.setState({ connectToSession } as Partial<ReturnType<typeof useChatStore.getState>>)
    const view = hierarchy()
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: { ...view, cards: view.cards.map((card) => card.id === 2 ? { ...card, status: 'blocked' as const } : card), inbox: [{ kind: 'blocked', card: 2 }] } } })
    render(<InboxView panelId="board-tab" board={FIXTURE_BOARD} />)

    fireEvent.click(within(screen.getByTestId('kanban-inbox-blocked:2')).getByRole('button', { name: 'kanban.inbox.openOwner' }))

    expect(useTabStore.getState().activeTabId).toBe('worker')
    expect(connectToSession).toHaveBeenCalledWith('worker')
  })

  it('moves a snoozed item to Later', () => {
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: fixtureView([fixtureCard(2, { status: 'review' })], { inbox: [{ kind: 'review', card: 2 }] }) } })
    render(<InboxView panelId="board-tab" board={FIXTURE_BOARD} />)

    fireEvent.click(within(screen.getByTestId('kanban-inbox-review:2')).getByRole('button', { name: 'kanban.inbox.snooze' }))

    expect(screen.getByText('kanban.inbox.emptyNeeds')).toBeInTheDocument()
    expect(useKanbanStore.getState().snoozed[FIXTURE_BOARD]).toEqual(['review:2'])
  })
})

describe('AssigneePicker', () => {
  it('marks the reviewer as unavailable for the owner and shows why the board refused an assignment', async () => {
    kanbanApiMock.command.mockRejectedValue(new ApiError(409, { error: 'INVALID_TRANSITION', message: 'closed' }))
    const view = hierarchy()
    render(<AssigneePicker board={FIXTURE_BOARD} view={view} card={view.cards[1]!} slot="owner" trigger={<button type="button">Pick</button>} />)

    fireEvent.click(screen.getByRole('button', { name: 'Pick' }))

    expect(screen.getByRole('option', { name: /Auth lead/ })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('kanban.assign.isReviewer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: /Idle helper/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('kanban.error.INVALID_TRANSITION')
    expect(kanbanApiMock.command).toHaveBeenCalledWith(FIXTURE_BOARD, { type: 'assign', card: 2, role: 'owner', target: { sessionId: 'idle' } })
  })

  it('closes without asking again when the current holder is picked', () => {
    const view = hierarchy()
    render(<AssigneePicker board={FIXTURE_BOARD} view={view} card={view.cards[1]!} slot="reviewer" trigger={<button type="button">Pick</button>} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }))
    fireEvent.click(screen.getByRole('option', { name: /Auth lead/ }))

    expect(screen.queryByLabelText('kanban.assign.instructions')).not.toBeInTheDocument()
    expect(kanbanApiMock.command).not.toHaveBeenCalled()
  })

  it('asks for review instructions before assigning a reviewer and sends none when they are left empty', async () => {
    kanbanApiMock.command.mockResolvedValue({ view: hierarchy(), warnings: [] })
    const view = hierarchy()
    const pick = () => {
      render(<AssigneePicker board={FIXTURE_BOARD} view={view} card={view.cards[1]!} slot="reviewer" trigger={<button type="button">Pick</button>} />)
      fireEvent.click(screen.getByRole('button', { name: 'Pick' }))
      fireEvent.click(screen.getByRole('option', { name: /Idle helper/ }))
    }

    pick()
    expect(kanbanApiMock.command).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('kanban.assign.instructions'), { target: { value: '  Run the e2e suite  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'kanban.assign.confirm' }))
    await waitFor(() => expect(kanbanApiMock.command).toHaveBeenCalledWith(FIXTURE_BOARD, { type: 'assign', card: 2, role: 'reviewer', target: { sessionId: 'idle' }, note: 'Run the e2e suite' }))

    cleanup()
    pick()
    expect(screen.getByLabelText('kanban.assign.instructions')).toHaveAttribute('placeholder', 'kanban.assign.instructionsPlaceholder')
    fireEvent.click(screen.getByRole('button', { name: 'kanban.assign.confirm' }))
    await waitFor(() => expect(kanbanApiMock.command).toHaveBeenLastCalledWith(FIXTURE_BOARD, { type: 'assign', card: 2, role: 'reviewer', target: { sessionId: 'idle' } }))
  })
})

describe('TaskDetail', () => {
  it('shows the run state beside the owner, the reviewer and the creator, and opens the owner session', async () => {
    const connectToSession = vi.fn()
    useChatStore.setState({ connectToSession } as Partial<ReturnType<typeof useChatStore.getState>>)
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={2} poll={false} />)

    const owner = screen.getByTestId('kanban-owner')
    expect(owner).toHaveTextContent('Token worker')
    expect(owner).toHaveTextContent('kanban.owner.running')
    expect(screen.getByText('kanban.role.reviewer').nextElementSibling).toHaveTextContent('Auth lead')
    expect(screen.getByText('kanban.detail.creator').nextElementSibling).toHaveTextContent('Auth lead')
    expect(screen.getByLabelText('kanban.detail.alsoCreator Auth lead')).toBeInTheDocument()

    fireEvent.click(within(owner).getByRole('button', { name: 'kanban.detail.openSession' }))

    expect(useTabStore.getState().activeTabId).toBe('worker')
    expect(connectToSession).toHaveBeenCalledWith('worker')
    await waitFor(() => expect(kanbanApiMock.history).toHaveBeenCalledWith(FIXTURE_BOARD, 2))
  })

  it('shows the reviewer instructions under the reviewer, or the default ones when none were given', () => {
    const view = hierarchy()
    const withNote = { ...fixtureAssignment('a4', 'reviewer', 'lead'), note: 'Help me try the login flow' }
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: { ...view, cards: view.cards.map((card) => card.id === 2 ? { ...card, assignments: [card.assignments[0]!, withNote] } : card) } } })
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={2} poll={false} />)
    expect(screen.getByTestId('kanban-reviewer-instructions')).toHaveTextContent('Help me try the login flow')
    expect(screen.getByTestId('kanban-reviewer')).toHaveTextContent('kanban.owner.idle')

    cleanup()
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: hierarchy() } })
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={2} poll={false} />)
    expect(screen.getByTestId('kanban-reviewer-instructions')).toHaveTextContent('kanban.detail.defaultReviewInstructions')
    expect(screen.queryByTestId('kanban-owner-instructions')).not.toBeInTheDocument()
  })

  it('edits the acceptance criteria one per row and saves them as a list', async () => {
    const view = hierarchy()
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: { ...view, cards: view.cards.map((card) => card.id === 2 ? { ...card, acceptance: ['Tokens refresh'] } : card) } } })
    kanbanApiMock.command.mockResolvedValue({ view: hierarchy(), warnings: [] })
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={2} poll={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'kanban.detail.editAcceptance' }))
    const first = screen.getByRole('textbox', { name: 'kanban.acceptance.item 1' })
    await waitFor(() => expect(first).toHaveFocus())
    fireEvent.keyDown(first, { key: 'Enter' })
    const second = screen.getByRole('textbox', { name: 'kanban.acceptance.item 2' })
    await waitFor(() => expect(second).toHaveFocus())
    fireEvent.paste(second, { clipboardData: { getData: () => 'Logout clears them\n\nWorks offline' } })
    expect(screen.getAllByRole('textbox', { name: /kanban.acceptance.item/ }).map((input) => (input as HTMLInputElement).value)).toEqual(['Tokens refresh', 'Logout clears them', 'Works offline'])

    fireEvent.click(screen.getByRole('button', { name: 'kanban.acceptance.remove 2' }))
    const last = screen.getByRole('textbox', { name: 'kanban.acceptance.item 2' })
    fireEvent.keyDown(last, { key: 'Enter' })
    const empty = screen.getByRole('textbox', { name: 'kanban.acceptance.item 3' })
    fireEvent.keyDown(empty, { key: 'Backspace' })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'kanban.acceptance.item 2' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(kanbanApiMock.command).toHaveBeenCalledWith(FIXTURE_BOARD, { type: 'edit_card', card: 2, acceptance: ['Tokens refresh', 'Works offline'] }))
  })

  it('adds an empty criterion from the add button, and reuses one that is still empty', async () => {
    const view = hierarchy()
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: { ...view, cards: view.cards.map((card) => card.id === 2 ? { ...card, acceptance: ['Tokens refresh'] } : card) } } })
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={2} poll={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'kanban.detail.editAcceptance' }))
    fireEvent.click(screen.getByRole('button', { name: 'kanban.acceptance.add' }))
    const added = screen.getByRole('textbox', { name: 'kanban.acceptance.item 2' })
    await waitFor(() => expect(added).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'kanban.acceptance.add' }))

    expect(screen.getAllByRole('textbox', { name: /kanban.acceptance.item/ })).toHaveLength(2)
    await waitFor(() => expect(added).toHaveFocus())
  })

  it('asks for a review report before accepting and sends it with the acceptance', async () => {
    kanbanApiMock.command.mockResolvedValue({ view: hierarchy(), warnings: [] })
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={3} poll={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'kanban.action.accept' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'kanban.action.accept' })).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('kanban.prompt.acceptLabel'), { target: { value: 'Ran the token tests' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'kanban.action.accept' }))

    await waitFor(() => expect(kanbanApiMock.command).toHaveBeenCalledWith(FIXTURE_BOARD, { type: 'accept', card: 3, summary: 'Ran the token tests' }))
  })

  it('shows the reviewer and its run state while a task is in review', () => {
    const view = hierarchy()
    const inReview = { ...view, cards: view.cards.map((card) => card.id === 2 ? { ...card, status: 'review' as const } : card), sessions: { ...view.sessions, lead: { ...view.sessions.lead!, running: true } } }
    render(<TaskTree view={inReview} cards={inReview.cards} selectedCard={null} onOpen={() => undefined} />)

    expect(screen.getByTestId('kanban-tree-row-2')).toHaveTextContent('kanban.card.reviewing Auth lead')
    expect(within(screen.getByTestId('kanban-tree-row-2')).getByRole('img', { name: 'kanban.marker.running' })).toBeInTheDocument()
    expect(screen.getByTestId('kanban-tree-row-1')).toHaveTextContent('Auth lead')
    expect(screen.getByTestId('kanban-tree-row-1')).not.toHaveTextContent('kanban.card.reviewing')
  })

  it('shows a deleted owner as vacant without a session link', () => {
    const view = hierarchy()
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: { ...view, sessions: { ...view.sessions, worker: { title: '', exists: false, running: false } } } } })
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={2} poll={false} />)

    expect(within(screen.getByTestId('kanban-owner')).queryByRole('button', { name: 'kanban.detail.openSession' })).not.toBeInTheDocument()
    expect(screen.getByText('kanban.detail.ownerMissing')).toBeInTheDocument()
    expect(screen.getAllByText('kanban.owner.missing').length).toBeGreaterThan(0)
  })

  it('folds the events of one command into one activity entry and keeps the delivery text out of it', async () => {
    const at = '2026-11-07T01:00:00.000Z'
    const worker = { kind: 'session' as const, sessionId: 'worker' }
    kanbanApiMock.history.mockResolvedValue({ events: [
      { seq: 10, at, actor: worker, type: 'delivery_submitted', card: 2, delivery: 'd', summary: 'Shipped the token store', links: [] },
      { seq: 11, at, actor: worker, type: 'status_changed', card: 2, from: 'in_progress', to: 'review' },
      { seq: 12, at: '2026-11-07T02:00:00.000Z', actor: { kind: 'human' }, type: 'status_changed', card: 2, from: 'review', to: 'done' },
    ] })
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={2} poll={false} />)

    const timeline = await screen.findByTestId('kanban-timeline')
    const entries = within(timeline).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    expect(entries[1]).toHaveTextContent('kanban.event.delivered Token worker')
    expect(within(entries[1]!).getByTestId('kanban-timeline-status')).toHaveTextContent('kanban.detail.statuskanban.status.in_progresskanban.status.review')
    expect(timeline).not.toHaveTextContent('Shipped the token store')
    expect(entries[0]).toHaveTextContent('kanban.event.status')
  })

  it('offers to notify the creator only when it is a session other than the owner', () => {
    const view = hierarchy()
    const own = { ...view.cards[1]!, owner: 'lead', reviewer: null }
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: { ...view, cards: [view.cards[0]!, own, view.cards[2]!] } } })
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={2} poll={false} />)

    expect(screen.queryByLabelText(/kanban.detail.alsoCreator/)).not.toBeInTheDocument()
  })

  it('says the person accepts a task without a reviewer, and that the person created it', () => {
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={3} poll={false} />)

    expect(screen.getByText('kanban.role.reviewer').nextElementSibling).toHaveTextContent('kanban.detail.noReviewer')
    expect(screen.getByText('kanban.detail.creator').nextElementSibling).toHaveTextContent('kanban.actor.you')
    expect(screen.queryByLabelText(/kanban.detail.alsoCreator/)).not.toBeInTheDocument()
  })

  it('renders the delivered summary as Markdown', () => {
    const view = hierarchy()
    const reviewed = { ...view.cards[2]!, deliveries: [{ id: 'd', summary: '## Findings\n\n- **Token store** is done', links: [], actor: { kind: 'session' as const, sessionId: 'worker' }, at: '' }] }
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: { ...view, cards: [view.cards[0]!, view.cards[1]!, reviewed] } } })
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={3} poll={false} />)

    const delivery = screen.getByTestId('kanban-clamped')
    expect(within(delivery).getByRole('heading', { name: 'Findings' })).toBeInTheDocument()
    expect(within(delivery).getByText('Token store').tagName).toBe('STRONG')
  })

  it('opens a delivered report file in the panel through the session that wrote it', () => {
    const view = hierarchy()
    const reviewed = { ...view.cards[2]!, deliveries: [{ id: 'd', summary: 'See the report', links: ['/repo/review.md', 'feat/tokens'], actor: { kind: 'session' as const, sessionId: 'worker' }, at: '' }] }
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: { ...view, cards: [view.cards[0]!, view.cards[1]!, reviewed] } } })
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={3} poll={false} />)

    expect(screen.queryByRole('button', { name: 'feat/tokens' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '/repo/review.md' }))

    expect(useWorkspacePanelStore.getState().getActiveTab('board-tab')).toMatchObject({ kind: 'file', path: '/repo/review.md', sessionId: 'worker' })
  })

  it('opens a related task as another tab in the same panel', () => {
    render(<TaskDetail panelId="board-tab" board={FIXTURE_BOARD} card={2} poll={false} />)

    fireEvent.click(screen.getByRole('button', { name: /#3\s*Task 3/ }))

    expect(useWorkspacePanelStore.getState().getActiveTab('board-tab')).toMatchObject({ kind: 'task', card: 3 })
  })
})
