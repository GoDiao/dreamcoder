import { api } from './client'
import type { CLITask, TaskListSummary } from '../types/cliTask'

type TaskListsResponse = { lists: TaskListSummary[] }
type TasksResponse = { tasks: CLITask[] }
type TaskResponse = { task: CLITask }

export const cliTasksApi = {
  listTaskLists() {
    return api.get<TaskListsResponse>('/api/tasks/lists')
  },

  getTasksForList(taskListId: string) {
    return api.get<TasksResponse>(`/api/tasks/lists/${encodeURIComponent(taskListId)}`)
  },

  getTask(taskListId: string, taskId: string) {
    return api.get<TaskResponse>(`/api/tasks/lists/${encodeURIComponent(taskListId)}/${taskId}`)
  },

  resetTaskList(taskListId: string) {
    return api.post<{ ok: true }>(`/api/tasks/lists/${encodeURIComponent(taskListId)}/reset`)
  },

  listAll() {
    return api.get<TasksResponse>('/api/tasks')
  },
}
