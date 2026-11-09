import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { BoardView } from '@protocol'

const toastMock = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))
const kanbanApiMock = vi.hoisted(() => ({ command: vi.fn() }))
vi.mock('../../api/kanban', () => ({ kanbanApi: kanbanApiMock }))
vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}))

import { BoardColumns } from './BoardColumns'
import { useMoveCard } from './useReasonPrompt'
import { fixtureAssignment, fixtureCard, fixtureView, FIXTURE_BOARD } from './kanbanFixture'

function Board({ view, compact = false }: { view: BoardView; compact?: boolean }) {
  const { move, dialog } = useMoveCard(FIXTURE_BOARD)
  return (
    <>
      <BoardColumns
        view={view}
        cards={view.cards}
        compact={compact}
        showCancelled={false}
        selectedCard={null}
        draggable
        onOpen={() => undefined}
        onMove={move}
        onArchive={() => undefined}
        onCreate={() => undefined}
      />
      {dialog}
    </>
  )
}

function drag(cardId: number, column: string) {
  const data = new Map<string, string>()
  const dataTransfer = {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() { return [...data.keys()] },
    effectAllowed: 'move',
  }
  fireEvent.dragStart(within(screen.getByTestId(`kanban-card-${cardId}`)).getAllByRole('button')[0]!, { dataTransfer })
  const target = screen.getByTestId(`kanban-column-${column}`)
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
}

describe('BoardColumns', () => {
  beforeEach(() => {
    toastMock.error.mockReset()
    kanbanApiMock.command.mockReset()
  })

  afterEach(() => cleanup())

  it('refuses a drop on a column the task cannot move to and leaves the card where it was', () => {
    render(<Board view={fixtureView([fixtureCard(1, { status: 'backlog' })])} />)

    drag(1, 'done')

    expect(toastMock.error).toHaveBeenCalledWith('kanban.move.notAllowed kanban.status.backlog kanban.status.done')
    expect(kanbanApiMock.command).not.toHaveBeenCalled()
    expect(within(screen.getByTestId('kanban-column-backlog')).getByTestId('kanban-card-1')).toBeInTheDocument()
  })

  it('ignores a task dropped back on its own column', () => {
    render(<Board view={fixtureView([fixtureCard(1, { status: 'todo' })])} />)

    drag(1, 'todo')

    expect(toastMock.error).not.toHaveBeenCalled()
    expect(kanbanApiMock.command).not.toHaveBeenCalled()
  })

  it('sends the matching command when the drop is allowed', () => {
    kanbanApiMock.command.mockResolvedValue({ view: fixtureView([]), warnings: [] })
    render(<Board view={fixtureView([fixtureCard(1, { status: 'backlog' })])} />)

    drag(1, 'todo')

    expect(kanbanApiMock.command).toHaveBeenCalledWith(FIXTURE_BOARD, { type: 'move_card', card: 1, status: 'todo' })
  })

  it('asks for a reason before blocking', () => {
    render(<Board view={fixtureView([fixtureCard(1, { status: 'in_progress' })])} />)

    drag(1, 'blocked')

    expect(screen.getByRole('alertdialog')).toHaveTextContent('kanban.prompt.blockTitle #1')
    expect(kanbanApiMock.command).not.toHaveBeenCalled()
  })

  it('shows whether the owner runs separately from the status, and a deleted owner as vacant', () => {
    const view = fixtureView([
      fixtureCard(1, { status: 'todo', owner: 'w', assignments: [fixtureAssignment('a', 'owner', 'w')] }),
      fixtureCard(2, { status: 'in_progress', owner: 'gone', assignments: [fixtureAssignment('b', 'owner', 'gone')] }),
    ], {
      sessions: {
        pm: { title: 'PM', exists: true, running: false },
        w: { title: 'Writer', exists: true, running: true },
        gone: { title: '', exists: false, running: false },
      },
    })
    render(<Board view={view} />)

    const running = screen.getByTestId('kanban-card-1')
    expect(within(screen.getByTestId('kanban-column-todo')).getByTestId('kanban-card-1')).toBe(running)
    expect(within(running).getByRole('img', { name: 'kanban.marker.running' })).toBeInTheDocument()
    expect(within(running).getByText('Writer')).toBeInTheDocument()
    expect(within(screen.getByTestId('kanban-card-2')).getByText('kanban.owner.missing')).toBeInTheDocument()
    expect(within(screen.getByTestId('kanban-card-2')).queryByRole('img', { name: 'kanban.marker.running' })).not.toBeInTheDocument()
  })

  it('folds Backlog and Done into strips in compact mode and unfolds one on click', () => {
    render(<Board view={fixtureView([fixtureCard(1, { status: 'backlog' }), fixtureCard(2, { status: 'todo' })])} compact />)

    expect(screen.getByTestId('kanban-column-backlog')).toHaveAttribute('data-folded', 'true')
    expect(screen.getByTestId('kanban-column-done')).toHaveAttribute('data-folded', 'true')
    expect(screen.getByTestId('kanban-column-todo')).not.toHaveAttribute('data-folded')
    expect(screen.queryByTestId('kanban-card-1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('kanban-column-backlog'))

    expect(screen.getByTestId('kanban-card-1')).toBeInTheDocument()
  })
})
