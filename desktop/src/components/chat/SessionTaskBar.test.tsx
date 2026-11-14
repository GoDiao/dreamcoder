import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { SessionTaskBar } from './SessionTaskBar'
import { getSessionTasks, useCLITaskStore } from '../../stores/cliTaskStore'

vi.mock('../../api/cliTasks', () => ({
  cliTasksApi: {
    getTasksForList: vi.fn(),
    resetTaskList: vi.fn(async () => ({ ok: true })),
  },
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string, params?: Record<string, number>) => {
    const translations: Record<string, string> = {
      'tasks.title': 'Tasks',
      'tasks.dismissCompleted': 'Hide completed tasks',
      'tasks.progress': `${params?.done} of ${params?.total} done`,
    }

    return translations[key] ?? key
  },
}))

const SESSION_ID = 'session-1'

describe('SessionTaskBar', () => {
  beforeEach(() => {
    useCLITaskStore.setState({ bySession: {} })
  })

  afterEach(() => {
    cleanup()
    useCLITaskStore.setState({ bySession: {} })
  })

  it('keeps expansion in the store and updates progress as tasks complete', () => {
    useCLITaskStore.getState().setTasksFromTodos([
      { content: 'first', status: 'completed' },
      { content: 'second', status: 'in_progress', activeForm: 'working' },
    ], SESSION_ID)
    render(<SessionTaskBar sessionId={SESSION_ID} />)
    const trigger = screen.getByRole('button', { name: 'Tasks' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('working')).toBeNull()
    expect(screen.getByText('1 of 2 done')).toBeInTheDocument()
    expect(screen.getByText('Tasks').closest('[data-slot="trace-line"]')).toHaveAttribute('data-status', 'running')
    fireEvent.click(trigger)
    expect(getSessionTasks(useCLITaskStore.getState(), SESSION_ID).expanded).toBe(true)
    expect(screen.getByText('working')).toBeVisible()
    act(() => useCLITaskStore.getState().setTasksFromTodos([
      { content: 'first', status: 'completed' },
      { content: 'second', status: 'completed' },
    ], SESSION_ID))
    expect(screen.queryByText('working')).toBeNull()
    expect(screen.getByText('2 of 2 done')).toBeInTheDocument()
    expect(screen.getByText('Tasks').closest('[data-slot="trace-line"]')).not.toHaveAttribute('data-status')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('only shows the dismiss button once every task is completed', () => {
    act(() => {
      useCLITaskStore.getState().setTasksFromTodos([
        { content: 'first', status: 'completed' },
        { content: 'second', status: 'in_progress', activeForm: 'working' },
      ], SESSION_ID)
    })

    act(() => {
      render(<SessionTaskBar sessionId={SESSION_ID} />)
    })

    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hide completed tasks' })).toBeNull()
  })

  it('hides the bar after dismissing a completed task set', async () => {
    act(() => {
      useCLITaskStore.getState().setTasksFromTodos([
        { content: 'first', status: 'completed' },
        { content: 'second', status: 'completed' },
      ], SESSION_ID)
    })

    act(() => {
      render(<SessionTaskBar sessionId={SESSION_ID} />)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hide completed tasks' }))
      await Promise.resolve()
    })

    expect(screen.queryByText('Tasks')).toBeNull()
    expect(getSessionTasks(useCLITaskStore.getState(), SESSION_ID).tasks).toEqual([])
  })

  it('shows the bar again for a new task cycle after a previous completed set was dismissed', async () => {
    act(() => {
      useCLITaskStore.getState().setTasksFromTodos([
        { content: 'first', status: 'completed' },
      ], SESSION_ID)
    })

    act(() => {
      render(<SessionTaskBar sessionId={SESSION_ID} />)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hide completed tasks' }))
      await Promise.resolve()
    })
    expect(screen.queryByText('Tasks')).toBeNull()

    act(() => {
      useCLITaskStore.getState().setTasksFromTodos([
        { content: 'next task', status: 'in_progress', activeForm: 'running next task' },
      ], SESSION_ID)
    })

    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hide completed tasks' })).toBeNull()

    act(() => {
      useCLITaskStore.getState().setTasksFromTodos([
        { content: 'next task', status: 'completed' },
      ], SESSION_ID)
    })

    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide completed tasks' })).toBeInTheDocument()
  })
})
