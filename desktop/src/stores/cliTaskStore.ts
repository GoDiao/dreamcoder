import { create } from 'zustand'
import { cliTasksApi } from '../api/cliTasks'
import type { CLITask, TaskStatus } from '../types/cliTask'

type TodoItem = {
  content: string
  status: string
  activeForm?: string
}

export type SessionTasks = {
  tasks: CLITask[]
  resetting: boolean
  expanded: boolean
  completedAndDismissed: boolean
  dismissedCompletionKey: string | null
}

type CLITaskStore = {
  bySession: Record<string, SessionTasks | undefined>

  fetchSessionTasks: (sessionId: string) => Promise<void>
  refreshTasks: (sessionId: string) => Promise<void>
  setTasksFromTodos: (todos: TodoItem[], sessionId: string) => void
  markCompletedAndDismissed: (sessionId: string) => void
  resetCompletedTasks: (sessionId: string) => Promise<void>
  clearTasks: (sessionId: string) => void
  toggleExpanded: (sessionId: string) => void
}

const EMPTY_SESSION_TASKS: SessionTasks = {
  tasks: [],
  resetting: false,
  expanded: false,
  completedAndDismissed: false,
  dismissedCompletionKey: null,
}

function buildCompletedTaskKey(tasks: CLITask[]): string | null {
  if (tasks.length === 0 || tasks.some((task) => task.status !== 'completed')) return null

  return tasks
    .map((task) => [
      task.taskListId,
      task.id,
      task.subject,
      task.status,
      task.activeForm ?? '',
      task.owner ?? '',
    ].join('::'))
    .join('|')
}

function resolveDismissState(tasks: CLITask[], dismissedCompletionKey: string | null) {
  const completionKey = buildCompletedTaskKey(tasks)
  const keepDismissed = completionKey !== null && completionKey === dismissedCompletionKey

  return {
    completedAndDismissed: keepDismissed,
    dismissedCompletionKey: keepDismissed ? completionKey : null,
  }
}

function mapTodosToTasks(todos: TodoItem[], sessionId: string): CLITask[] {
  return todos.map((todo, index) => ({
    id: String(index + 1),
    subject: todo.content,
    description: '',
    activeForm: todo.activeForm,
    status: (['pending', 'in_progress', 'completed'].includes(todo.status)
      ? todo.status
      : 'pending') as TaskStatus,
    blocks: [],
    blockedBy: [],
    taskListId: sessionId,
  }))
}

const clearedCounts = new Map<string, number>()

function clearCount(sessionId: string) {
  return clearedCounts.get(sessionId) ?? 0
}

export function getSessionTasks(state: Pick<CLITaskStore, 'bySession'>, sessionId: string): SessionTasks {
  return state.bySession[sessionId] ?? EMPTY_SESSION_TASKS
}

export const useCLITaskStore = create<CLITaskStore>((set, get) => {
  const patch = (sessionId: string, update: (current: SessionTasks) => Partial<SessionTasks>) =>
    set((state) => {
      const current = getSessionTasks(state, sessionId)
      return { bySession: { ...state.bySession, [sessionId]: { ...current, ...update(current) } } }
    })

  const applyTasks = (sessionId: string, tasks: CLITask[]) =>
    patch(sessionId, (current) => ({ tasks, ...resolveDismissState(tasks, current.dismissedCompletionKey) }))

  return {
    bySession: {},

    fetchSessionTasks: async (sessionId) => {
      const cleared = clearCount(sessionId)
      const current = () => clearCount(sessionId) === cleared && !getSessionTasks(get(), sessionId).resetting
      try {
        const { tasks } = await cliTasksApi.getTasksForList(sessionId)
        if (current()) applyTasks(sessionId, tasks)
      } catch {
        if (current()) {
          patch(sessionId, () => ({ tasks: [], completedAndDismissed: false, dismissedCompletionKey: null, expanded: false }))
        }
      }
    },

    refreshTasks: async (sessionId) => {
      const cleared = clearCount(sessionId)
      try {
        const { tasks } = await cliTasksApi.getTasksForList(sessionId)
        if (clearCount(sessionId) === cleared && !getSessionTasks(get(), sessionId).resetting) applyTasks(sessionId, tasks)
      } catch (error) {
        console.warn('[tasks] Failed to refresh the task list', sessionId, error)
      }
    },

    setTasksFromTodos: (todos, sessionId) => {
      applyTasks(sessionId, mapTodosToTasks(todos, sessionId))
    },

    markCompletedAndDismissed: (sessionId) => {
      const completionKey = buildCompletedTaskKey(getSessionTasks(get(), sessionId).tasks)
      if (!completionKey) return
      patch(sessionId, () => ({
        completedAndDismissed: true,
        dismissedCompletionKey: completionKey,
        expanded: false,
      }))
    },

    resetCompletedTasks: async (sessionId) => {
      if (!buildCompletedTaskKey(getSessionTasks(get(), sessionId).tasks)) return

      patch(sessionId, () => ({
        tasks: [],
        resetting: true,
        completedAndDismissed: false,
        dismissedCompletionKey: null,
        expanded: false,
      }))

      try {
        await cliTasksApi.resetTaskList(sessionId)
      } finally {
        if (get().bySession[sessionId]) patch(sessionId, () => ({ resetting: false }))
      }
    },

    clearTasks: (sessionId) => {
      clearedCounts.set(sessionId, clearCount(sessionId) + 1)
      set((state) => {
        if (!(sessionId in state.bySession)) return state
        const { [sessionId]: _removed, ...rest } = state.bySession
        return { bySession: rest }
      })
    },

    toggleExpanded: (sessionId) => {
      patch(sessionId, (current) => ({ expanded: !current.expanded }))
    },
  }
})
