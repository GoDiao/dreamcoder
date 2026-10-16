import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { ApiError } from '../middleware/errorHandler.js'

export type TaskNotificationConfig = {
  enabled: boolean
  channels: 'desktop'[]
}

export type CronTask = {
  id: string
  name?: string
  description?: string
  cron: string
  prompt: string
  createdAt: number
  lastFiredAt?: string
  enabled?: boolean
  recurring?: boolean
  permanent?: boolean
  permissionMode?: string
  model?: string
  providerId?: string | null
  folderPath?: string
  useWorktree?: boolean
  notification?: TaskNotificationConfig
}

type TasksFile = {
  tasks: CronTask[]
}

const TASKS_FILE_WRITE_ATTEMPTS = 2

export class CronService {
  private getTasksFilePath(): string {
    const configDir =
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    return path.join(configDir, 'scheduled_tasks.json')
  }

  async listTasks(): Promise<CronTask[]> {
    const data = await this.readTasksFile()
    return data.tasks
  }

  async createTask(
    task: Omit<CronTask, 'id' | 'createdAt'>,
  ): Promise<CronTask> {
    if (!task.cron || !task.prompt) {
      throw ApiError.badRequest('Fields "cron" and "prompt" are required')
    }

    const data = await this.readTasksFile()
    const newTask: CronTask = {
      ...task,
      id: crypto.randomBytes(4).toString('hex'),
      createdAt: Date.now(),
    }
    data.tasks.push(newTask)
    await this.writeTasksFile(data)
    return newTask
  }

  async updateTask(id: string, updates: Partial<CronTask>): Promise<CronTask> {
    const data = await this.readTasksFile()
    const index = data.tasks.findIndex((t) => t.id === id)
    if (index === -1) {
      throw ApiError.notFound(`Task not found: ${id}`)
    }

    const { id: _id, createdAt: _ca, ...safeUpdates } = updates
    data.tasks[index] = { ...data.tasks[index], ...safeUpdates }
    await this.writeTasksFile(data)
    return data.tasks[index]
  }

  async deleteTask(id: string): Promise<void> {
    const data = await this.readTasksFile()
    const index = data.tasks.findIndex((t) => t.id === id)
    if (index === -1) {
      throw ApiError.notFound(`Task not found: ${id}`)
    }
    data.tasks.splice(index, 1)
    await this.writeTasksFile(data)
  }

  async updateLastFired(taskId: string, timestamp: string): Promise<void> {
    const data = await this.readTasksFile()
    const index = data.tasks.findIndex((t) => t.id === taskId)
    if (index === -1) {
      return
    }
    data.tasks[index].lastFiredAt = timestamp
    await this.writeTasksFile(data)
  }

  private async readTasksFile(): Promise<TasksFile> {
    try {
      const raw = await fs.readFile(this.getTasksFilePath(), 'utf-8')
      const parsed = JSON.parse(raw) as TasksFile
      if (!Array.isArray(parsed.tasks)) {
        return { tasks: [] }
      }
      return parsed
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { tasks: [] }
      }
      throw ApiError.internal(
        `Failed to read scheduled tasks: ${(err as Error).message}`,
      )
    }
  }

  private async writeTasksFile(data: TasksFile): Promise<void> {
    const filePath = this.getTasksFilePath()
    const dir = path.dirname(filePath)
    const contents = JSON.stringify(data, null, 2) + '\n'
    let lastError: Error | undefined

    for (let attempt = 0; attempt < TASKS_FILE_WRITE_ATTEMPTS; attempt++) {
      const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}`

      try {
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(tmpFile, contents, 'utf-8')
        await fs.rename(tmpFile, filePath)
        return
      } catch (err) {
        lastError = err as Error
        await fs.unlink(tmpFile).catch(() => {})

        if (
          (err as NodeJS.ErrnoException).code !== 'ENOENT' ||
          attempt === TASKS_FILE_WRITE_ATTEMPTS - 1
        ) {
          break
        }
      }
    }

    throw ApiError.internal(
      `Failed to write scheduled tasks: ${lastError?.message ?? 'unknown error'}`,
    )
  }
}
