import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cliTasksApi } from '../api/cliTasks'
import type { CLITask, TaskStatus } from '../types/cliTask'
import { getSessionTasks, useCLITaskStore } from './cliTaskStore'

vi.mock('../api/cliTasks', () => ({
  cliTasksApi: {
    getTasksForList: vi.fn(),
    resetTaskList: vi.fn(),
  },
}))

function makeTask(taskListId: string, status: TaskStatus = 'in_progress'): CLITask {
  return {
    id: '1',
    subject: 'Keep current session isolated',
    description: '',
    status,
    blocks: [],
    blockedBy: [],
    taskListId,
  }
}

function tasksOf(sessionId: string) {
  return getSessionTasks(useCLITaskStore.getState(), sessionId)
}

describe('cliTaskStore', () => {
  beforeEach(() => {
    useCLITaskStore.setState({ bySession: {} })
    vi.clearAllMocks()
  })

  afterEach(() => {
    useCLITaskStore.setState({ bySession: {} })
  })

  it('keeps each session’s tasks when another session fetches its own', async () => {
    vi.mocked(cliTasksApi.getTasksForList).mockResolvedValue({ tasks: [makeTask('session-2', 'completed')] })
    useCLITaskStore.getState().setTasksFromTodos([{ content: 'main task', status: 'in_progress' }], 'session-1')
    useCLITaskStore.getState().toggleExpanded('session-1')

    await useCLITaskStore.getState().fetchSessionTasks('session-2')

    expect(tasksOf('session-1')).toMatchObject({ expanded: true, tasks: [{ subject: 'main task', taskListId: 'session-1' }] })
    expect(tasksOf('session-2').tasks).toMatchObject([{ taskListId: 'session-2', status: 'completed' }])
  })

  it('resets a completed task list locally before clearing it remotely', async () => {
    let resolveReset: ((value: { ok: true }) => void) | null = null

    vi.mocked(cliTasksApi.resetTaskList).mockImplementation(
      () => new Promise<{ ok: true }>((resolve) => {
        resolveReset = resolve
      }),
    )

    useCLITaskStore.setState({
      bySession: {
        'session-1': {
          tasks: [
            makeTask('session-1', 'completed'),
            { ...makeTask('session-1', 'completed'), id: '2', subject: 'Second completed task' },
          ],
          resetting: false,
          expanded: true,
          completedAndDismissed: true,
          dismissedCompletionKey: 'session-1::done',
        },
      },
    })

    const resetPromise = useCLITaskStore.getState().resetCompletedTasks('session-1')

    expect(vi.mocked(cliTasksApi.resetTaskList)).toHaveBeenCalledWith('session-1')
    expect(tasksOf('session-1')).toMatchObject({
      tasks: [],
      resetting: true,
      completedAndDismissed: false,
      dismissedCompletionKey: null,
      expanded: false,
    })

    expect(resolveReset).not.toBeNull()
    resolveReset!({ ok: true })
    await resetPromise

    expect(tasksOf('session-1').resetting).toBe(false)
  })

  it('refreshes the named session’s tasks', async () => {
    vi.mocked(cliTasksApi.getTasksForList).mockResolvedValue({
      tasks: [makeTask('session-1', 'in_progress')],
    })

    await useCLITaskStore.getState().refreshTasks('session-1')

    expect(cliTasksApi.getTasksForList).toHaveBeenCalledWith('session-1')
    expect(tasksOf('session-1').tasks).toMatchObject([
      { taskListId: 'session-1', status: 'in_progress' },
    ])
  })

  it('marks a completed task list dismissed for its session only', () => {
    useCLITaskStore.getState().setTasksFromTodos([{ content: 'Keep current session isolated', status: 'completed' }], 'session-1')
    useCLITaskStore.getState().setTasksFromTodos([{ content: 'other', status: 'completed' }], 'session-2')

    useCLITaskStore.getState().markCompletedAndDismissed('session-1')

    expect(tasksOf('session-1')).toMatchObject({
      completedAndDismissed: true,
      dismissedCompletionKey: 'session-1::1::Keep current session isolated::completed::::',
      expanded: false,
    })
    expect(tasksOf('session-2').completedAndDismissed).toBe(false)
  })

  it('does not reset completed tasks for a different session', async () => {
    useCLITaskStore.getState().setTasksFromTodos([{ content: 'done', status: 'completed' }], 'session-1')

    await useCLITaskStore.getState().resetCompletedTasks('session-2')

    expect(vi.mocked(cliTasksApi.resetTaskList)).not.toHaveBeenCalled()
    expect(tasksOf('session-1').tasks).toMatchObject([{ taskListId: 'session-1', status: 'completed' }])
  })

  it('drops a task list that arrives after its session was disconnected', async () => {
    let answerFetch!: (value: { tasks: CLITask[] }) => void
    let answerRefresh!: (value: { tasks: CLITask[] }) => void
    vi.mocked(cliTasksApi.getTasksForList)
      .mockReturnValueOnce(new Promise((resolve) => { answerFetch = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { answerRefresh = resolve }))

    const fetching = useCLITaskStore.getState().fetchSessionTasks('session-1')
    const refreshing = useCLITaskStore.getState().refreshTasks('session-1')
    useCLITaskStore.getState().clearTasks('session-1')
    answerFetch({ tasks: [makeTask('session-1')] })
    answerRefresh({ tasks: [makeTask('session-1')] })
    await Promise.all([fetching, refreshing])

    expect(useCLITaskStore.getState().bySession).toEqual({})
  })

  it('forgets only the cleared session’s tasks', () => {
    useCLITaskStore.getState().setTasksFromTodos([{ content: 'done', status: 'completed' }], 'session-1')
    useCLITaskStore.getState().setTasksFromTodos([{ content: 'side work', status: 'pending' }], 'session-2')

    useCLITaskStore.getState().clearTasks('session-1')

    expect(Object.keys(useCLITaskStore.getState().bySession)).toEqual(['session-2'])
    expect(tasksOf('session-2').tasks).toMatchObject([{ subject: 'side work' }])
  })
})
