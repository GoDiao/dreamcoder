import { create } from 'zustand'
import { cliTasksApi } from '../api/cliTasks'
import type { CLITask, TaskStatus } from '../types/cliTask'

type TodoItem = {
  content: string
  status: string
  activeForm?: string
}

type CLITaskStore = {
  sessionId: string | null
  tasks: CLITask[]
  resetting: boolean
  expanded: boolean
  completedAndDismissed: boolean
  dismissedCompletionKey: string | null

  fetchSessionTasks: (sessionId: string) => Promise<void>
  refreshTasks: (sessionId?: string) => Promise<void>
  setTasksFromTodos: (todos: TodoItem[], sessionId?: string) => void
  markCompletedAndDismissed: (sessionId?: string) => void
  resetCompletedTasks: (sessionId?: string) => Promise<void>
  clearTasks: (sessionId?: string) => void
  toggleExpanded: () => void
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

function mapTodosToTasks(todos: TodoItem[], sessionId: string | null): CLITask[] {
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
    taskListId: sessionId || '',
  }))
}

export const useCLITaskStore = create<CLITaskStore>((set, get) => ({
  sessionId: null,
  tasks: [],
  resetting: false,
  expanded: false,
  completedAndDismissed: false,
  dismissedCompletionKey: null,

  fetchSessionTasks: async (sessionId) => {
    if (get().sessionId !== sessionId) {
      set({
        sessionId,
        tasks: [],
        resetting: false,
        completedAndDismissed: false,
        dismissedCompletionKey: null,
        expanded: false,
      })
    }

    try {
      const { tasks } = await cliTasksApi.getTasksForList(sessionId)
      if (get().sessionId === sessionId && !get().resetting) {
        set((state) => ({
          tasks,
          ...resolveDismissState(tasks, state.dismissedCompletionKey),
        }))
      }
    } catch {
      if (get().sessionId === sessionId && !get().resetting) {
        set({ tasks: [], completedAndDismissed: false, dismissedCompletionKey: null, expanded: false })
      }
    }
  },

  refreshTasks: async (targetSessionId) => {
    const sessionId = targetSessionId ?? get().sessionId
    if (!sessionId) return
    try {
      const { tasks } = await cliTasksApi.getTasksForList(sessionId)
      if (get().sessionId === sessionId && !get().resetting) {
        set((state) => ({
          tasks,
          ...resolveDismissState(tasks, state.dismissedCompletionKey),
        }))
      }
    } catch {
    }
  },

  setTasksFromTodos: (todos, targetSessionId) => {
    const sessionId = targetSessionId ?? get().sessionId
    if (!sessionId || get().sessionId !== sessionId) return
    const tasks = mapTodosToTasks(todos, sessionId)
    set((state) => ({
      tasks,
      ...resolveDismissState(tasks, state.dismissedCompletionKey),
    }))
  },

  markCompletedAndDismissed: (targetSessionId) => {
    const sessionId = targetSessionId ?? get().sessionId
    if (!sessionId || get().sessionId !== sessionId) return
    const completionKey = buildCompletedTaskKey(get().tasks)
    if (!completionKey) return

    set({
      completedAndDismissed: true,
      dismissedCompletionKey: completionKey,
      expanded: false,
    })
  },

  resetCompletedTasks: async (targetSessionId) => {
    const sessionId = targetSessionId ?? get().sessionId
    if (!sessionId || get().sessionId !== sessionId) return
    const { tasks } = get()
    const completionKey = buildCompletedTaskKey(tasks)
    if (!completionKey) return

    set({
      tasks: [],
      resetting: true,
      completedAndDismissed: false,
      dismissedCompletionKey: null,
      expanded: false,
    })

    try {
      await cliTasksApi.resetTaskList(sessionId)
    } finally {
      if (get().sessionId === sessionId) {
        set({ resetting: false })
      }
    }
  },

  clearTasks: (targetSessionId) => {
    if (targetSessionId && get().sessionId !== targetSessionId) return
    set({
      sessionId: null,
      tasks: [],
      resetting: false,
      completedAndDismissed: false,
      dismissedCompletionKey: null,
      expanded: false,
    })
  },

  toggleExpanded: () => {
    set((s) => ({ expanded: !s.expanded }))
  },
}))
