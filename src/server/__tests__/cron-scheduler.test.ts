import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  cronMatches,
  fieldMatches,
  CronScheduler,
  type TaskRun,
} from '../services/cronScheduler.js'
import { CronService, type CronTask } from '../services/cronService.js'

let tmpDir: string
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

async function createTmpDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `claude-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function cleanupTmpDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
  }
}

describe('fieldMatches', () => {
  it('should match wildcard', () => {
    expect(fieldMatches('*', 0)).toBe(true)
    expect(fieldMatches('*', 59)).toBe(true)
    expect(fieldMatches('*', 23)).toBe(true)
  })

  it('should match exact number', () => {
    expect(fieldMatches('5', 5)).toBe(true)
    expect(fieldMatches('5', 6)).toBe(false)
    expect(fieldMatches('0', 0)).toBe(true)
    expect(fieldMatches('30', 30)).toBe(true)
  })

  it('should match comma-separated list', () => {
    expect(fieldMatches('1,3,5', 1)).toBe(true)
    expect(fieldMatches('1,3,5', 3)).toBe(true)
    expect(fieldMatches('1,3,5', 5)).toBe(true)
    expect(fieldMatches('1,3,5', 2)).toBe(false)
    expect(fieldMatches('1,3,5', 4)).toBe(false)
  })

  it('should match range', () => {
    expect(fieldMatches('1-5', 1)).toBe(true)
    expect(fieldMatches('1-5', 3)).toBe(true)
    expect(fieldMatches('1-5', 5)).toBe(true)
    expect(fieldMatches('1-5', 0)).toBe(false)
    expect(fieldMatches('1-5', 6)).toBe(false)
  })

  it('should match step from wildcard', () => {
    expect(fieldMatches('*/2', 0)).toBe(true)
    expect(fieldMatches('*/2', 2)).toBe(true)
    expect(fieldMatches('*/2', 4)).toBe(true)
    expect(fieldMatches('*/2', 1)).toBe(false)
    expect(fieldMatches('*/2', 3)).toBe(false)
    expect(fieldMatches('*/15', 0)).toBe(true)
    expect(fieldMatches('*/15', 15)).toBe(true)
    expect(fieldMatches('*/15', 30)).toBe(true)
    expect(fieldMatches('*/15', 7)).toBe(false)
  })

  it('should match step within range', () => {
    expect(fieldMatches('1-10/3', 1)).toBe(true)
    expect(fieldMatches('1-10/3', 4)).toBe(true)
    expect(fieldMatches('1-10/3', 7)).toBe(true)
    expect(fieldMatches('1-10/3', 10)).toBe(true)
    expect(fieldMatches('1-10/3', 2)).toBe(false)
    expect(fieldMatches('1-10/3', 11)).toBe(false)
    expect(fieldMatches('1-10/3', 0)).toBe(false)
  })

  it('should handle combined comma and range', () => {
    expect(fieldMatches('1-3,7,10-12', 2)).toBe(true)
    expect(fieldMatches('1-3,7,10-12', 7)).toBe(true)
    expect(fieldMatches('1-3,7,10-12', 11)).toBe(true)
    expect(fieldMatches('1-3,7,10-12', 5)).toBe(false)
  })
})

describe('cronMatches', () => {
  it('should match every-minute expression', () => {
    const date = new Date(2026, 3, 5, 14, 30, 0)
    expect(cronMatches('* * * * *', date)).toBe(true)
  })

  it('should match daily at 9:00', () => {
    const match = new Date(2026, 3, 5, 9, 0, 0)
    const noMatch = new Date(2026, 3, 5, 9, 1, 0)
    expect(cronMatches('0 9 * * *', match)).toBe(true)
    expect(cronMatches('0 9 * * *', noMatch)).toBe(false)
  })

  it('should match every 2 hours at minute 0', () => {
    expect(cronMatches('0 */2 * * *', new Date(2026, 0, 1, 0, 0))).toBe(true)
    expect(cronMatches('0 */2 * * *', new Date(2026, 0, 1, 2, 0))).toBe(true)
    expect(cronMatches('0 */2 * * *', new Date(2026, 0, 1, 4, 0))).toBe(true)
    expect(cronMatches('0 */2 * * *', new Date(2026, 0, 1, 1, 0))).toBe(false)
    expect(cronMatches('0 */2 * * *', new Date(2026, 0, 1, 3, 0))).toBe(false)
  })

  it('should match weekdays at 14:30', () => {
    const monday = new Date(2026, 3, 6, 14, 30, 0)
    const sunday = new Date(2026, 3, 5, 14, 30, 0)
    expect(cronMatches('30 14 * * 1-5', monday)).toBe(true)
    expect(cronMatches('30 14 * * 1-5', sunday)).toBe(false)
  })

  it('should match specific month and day', () => {
    const jan15 = new Date(2026, 0, 15, 0, 0)
    const feb15 = new Date(2026, 1, 15, 0, 0)
    expect(cronMatches('0 0 15 1 *', jan15)).toBe(true)
    expect(cronMatches('0 0 15 1 *', feb15)).toBe(false)
  })

  it('should reject invalid cron expressions', () => {
    const date = new Date()
    expect(cronMatches('* * *', date)).toBe(false)
    expect(cronMatches('', date)).toBe(false)
    expect(cronMatches('* * * * * *', date)).toBe(false)
  })

  it('should match day-of-week with Sunday as 0', () => {
    const sunday = new Date(2026, 3, 5, 10, 0)
    expect(cronMatches('0 10 * * 0', sunday)).toBe(true)
    expect(cronMatches('0 10 * * 6', sunday)).toBe(false)
  })
})

describe('CronScheduler', () => {
  let cronService: CronService
  let scheduler: CronScheduler

  beforeEach(async () => {
    tmpDir = await createTmpDir()
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    cronService = new CronService()
    scheduler = new CronScheduler(cronService)
  })

  afterEach(async () => {
    scheduler.stop()
    if (originalConfigDir) {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    } else {
      delete process.env.CLAUDE_CONFIG_DIR
    }
    await cleanupTmpDir(tmpDir)
  })

  it('should start and stop without errors', () => {
    scheduler.start()
    scheduler.stop()
    scheduler.start()
    scheduler.stop()
  })

  it('should not start twice', () => {
    scheduler.start()
    scheduler.start()
    scheduler.stop()
  })

  it('should return empty runs when no tasks have executed', async () => {
    const runs = await scheduler.getRecentRuns()
    expect(runs).toEqual([])
  })

  it('should return empty runs for a non-existent task ID', async () => {
    const runs = await scheduler.getTaskRuns('nonexistent')
    expect(runs).toEqual([])
  })

  it('should persist a task run to the log file', async () => {
    const task = await cronService.createTask({
      cron: '* * * * *',
      prompt: 'echo test',
      name: 'Test Task',
      recurring: true,
    })

    try {
      await scheduler.executeTask(task)
    } catch {
    }

    const logPath = path.join(tmpDir, 'scheduled_tasks_log.json')
    const logExists = await fs
      .stat(logPath)
      .then(() => true)
      .catch(() => false)
    expect(logExists).toBe(true)

    const logContent = JSON.parse(await fs.readFile(logPath, 'utf-8')) as {
      runs: TaskRun[]
    }
    expect(logContent.runs.length).toBeGreaterThanOrEqual(1)
    expect(logContent.runs[0].taskId).toBe(task.id)
    expect(logContent.runs[0].taskName).toBe('Test Task')
    expect(logContent.runs[0].prompt).toBe('echo test')
  })

  it('should disable non-recurring task after execution', async () => {
    const task = await cronService.createTask({
      cron: '* * * * *',
      prompt: 'one-shot task',
      recurring: false,
    })

    try {
      await scheduler.executeTask(task)
    } catch {
    }

    const tasks = await cronService.listTasks()
    const updated = tasks.find((t) => t.id === task.id)
    expect(updated?.enabled).toBe(false)
  })

  it('should NOT disable recurring task after execution', async () => {
    const task = await cronService.createTask({
      cron: '* * * * *',
      prompt: 'recurring task',
      recurring: true,
    })

    try {
      await scheduler.executeTask(task)
    } catch {
    }

    const tasks = await cronService.listTasks()
    const updated = tasks.find((t) => t.id === task.id)
    expect(updated?.enabled).not.toBe(false)
  })

  it('should update lastFiredAt after execution', async () => {
    const task = await cronService.createTask({
      cron: '* * * * *',
      prompt: 'fire test',
      recurring: true,
    })

    const beforeExec = new Date().toISOString()

    try {
      await scheduler.executeTask(task)
    } catch {
    }

    const tasks = await cronService.listTasks()
    const updated = tasks.find((t) => t.id === task.id)
    expect(updated?.lastFiredAt).toBeDefined()
    expect(new Date(updated!.lastFiredAt!).getTime()).toBeGreaterThanOrEqual(
      new Date(beforeExec).getTime() - 1000,
    )
  })

  it('should skip disabled tasks during tick', async () => {
    const task = await cronService.createTask({
      cron: '* * * * *',
      prompt: 'should not run',
      enabled: false,
      recurring: true,
    })

    await scheduler.tick()

    const runs = await scheduler.getTaskRuns(task.id)
    expect(runs).toHaveLength(0)
  })

  it('getTaskRuns should return runs sorted newest first', async () => {
    const task = await cronService.createTask({
      cron: '* * * * *',
      prompt: 'multi run',
      recurring: true,
    })

    try {
      await scheduler.executeTask(task)
    } catch {
    }
    try {
      await scheduler.executeTask(task)
    } catch {
    }

    const runs = await scheduler.getTaskRuns(task.id)
    expect(runs.length).toBeGreaterThanOrEqual(2)
    if (runs.length >= 2) {
      expect(
        new Date(runs[0].startedAt).getTime(),
      ).toBeGreaterThanOrEqual(new Date(runs[1].startedAt).getTime())
    }
  })

  it('getRecentRuns should respect limit parameter', async () => {
    const task = await cronService.createTask({
      cron: '* * * * *',
      prompt: 'limit test',
      recurring: true,
    })

    for (let i = 0; i < 3; i++) {
      try {
        await scheduler.executeTask(task)
      } catch {
      }
    }

    const runs = await scheduler.getRecentRuns(2)
    expect(runs.length).toBeLessThanOrEqual(2)
  })
})

describe('Execution log trimming', () => {
  let cronService: CronService
  let scheduler: CronScheduler

  beforeEach(async () => {
    tmpDir = await createTmpDir()
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    cronService = new CronService()
    scheduler = new CronScheduler(cronService)
  })

  afterEach(async () => {
    scheduler.stop()
    if (originalConfigDir) {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    } else {
      delete process.env.CLAUDE_CONFIG_DIR
    }
    await cleanupTmpDir(tmpDir)
  })

  it('should keep log entries within the max limit', async () => {
    const logPath = path.join(tmpDir, 'scheduled_tasks_log.json')
    const runs: TaskRun[] = []
    for (let i = 0; i < 105; i++) {
      runs.push({
        id: `run-${i}`,
        taskId: 'task-1',
        taskName: 'Test',
        startedAt: new Date(Date.now() - (105 - i) * 1000).toISOString(),
        completedAt: new Date(Date.now() - (105 - i) * 1000 + 100).toISOString(),
        status: 'completed',
        prompt: 'test',
        exitCode: 0,
        durationMs: 100,
      })
    }
    await fs.writeFile(logPath, JSON.stringify({ runs }, null, 2), 'utf-8')

    const task = await cronService.createTask({
      cron: '* * * * *',
      prompt: 'trigger trim',
      recurring: true,
    })

    try {
      await scheduler.executeTask(task)
    } catch {
    }

    const logContent = JSON.parse(await fs.readFile(logPath, 'utf-8')) as {
      runs: TaskRun[]
    }
    const task1Runs = logContent.runs.filter((r) => r.taskId === 'task-1')
    expect(task1Runs.length).toBeLessThanOrEqual(100)
  })
})

describe('Scheduled Tasks API — runs endpoints', () => {
  let handleScheduledTasksApi: (
    req: Request,
    url: URL,
    segments: string[],
  ) => Promise<Response>

  beforeEach(async () => {
    tmpDir = await createTmpDir()
    process.env.CLAUDE_CONFIG_DIR = tmpDir

    const mod = await import('../api/scheduled-tasks.js')
    handleScheduledTasksApi = mod.handleScheduledTasksApi
  })

  afterEach(async () => {
    if (originalConfigDir) {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    } else {
      delete process.env.CLAUDE_CONFIG_DIR
    }
    await cleanupTmpDir(tmpDir)
  })

  it('GET /api/scheduled-tasks/runs should return empty runs', async () => {
    const req = new Request('http://localhost/api/scheduled-tasks/runs', {
      method: 'GET',
    })
    const url = new URL(req.url)
    const resp = await handleScheduledTasksApi(req, url, [
      'api',
      'scheduled-tasks',
      'runs',
    ])
    const body = (await resp.json()) as { runs: unknown[] }
    expect(resp.status).toBe(200)
    expect(body.runs).toEqual([])
  })

  it('GET /api/scheduled-tasks/:id/runs should return empty runs for a task', async () => {
    const req = new Request(
      'http://localhost/api/scheduled-tasks/abc123/runs',
      { method: 'GET' },
    )
    const url = new URL(req.url)
    const resp = await handleScheduledTasksApi(req, url, [
      'api',
      'scheduled-tasks',
      'abc123',
      'runs',
    ])
    const body = (await resp.json()) as { runs: unknown[] }
    expect(resp.status).toBe(200)
    expect(body.runs).toEqual([])
  })

  it('GET /api/scheduled-tasks/runs should return runs from log', async () => {
    const logPath = path.join(tmpDir, 'scheduled_tasks_log.json')
    const runs: TaskRun[] = [
      {
        id: 'run-1',
        taskId: 'task-a',
        taskName: 'Task A',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'completed',
        prompt: 'test prompt',
        exitCode: 0,
        durationMs: 500,
      },
      {
        id: 'run-2',
        taskId: 'task-b',
        taskName: 'Task B',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'failed',
        prompt: 'another prompt',
        error: 'some error',
        exitCode: 1,
        durationMs: 200,
      },
    ]
    await fs.writeFile(logPath, JSON.stringify({ runs }, null, 2), 'utf-8')

    const req = new Request('http://localhost/api/scheduled-tasks/runs', {
      method: 'GET',
    })
    const url = new URL(req.url)
    const resp = await handleScheduledTasksApi(req, url, [
      'api',
      'scheduled-tasks',
      'runs',
    ])
    const body = (await resp.json()) as { runs: TaskRun[] }
    expect(resp.status).toBe(200)
    expect(body.runs).toHaveLength(2)
  })

  it('GET /api/scheduled-tasks/:id/runs should filter by task ID', async () => {
    const logPath = path.join(tmpDir, 'scheduled_tasks_log.json')
    const runs: TaskRun[] = [
      {
        id: 'run-1',
        taskId: 'task-a',
        taskName: 'Task A',
        startedAt: new Date().toISOString(),
        status: 'completed',
        prompt: 'prompt a',
        exitCode: 0,
      },
      {
        id: 'run-2',
        taskId: 'task-b',
        taskName: 'Task B',
        startedAt: new Date().toISOString(),
        status: 'completed',
        prompt: 'prompt b',
        exitCode: 0,
      },
    ]
    await fs.writeFile(logPath, JSON.stringify({ runs }, null, 2), 'utf-8')

    const req = new Request(
      'http://localhost/api/scheduled-tasks/task-a/runs',
      { method: 'GET' },
    )
    const url = new URL(req.url)
    const resp = await handleScheduledTasksApi(req, url, [
      'api',
      'scheduled-tasks',
      'task-a',
      'runs',
    ])
    const body = (await resp.json()) as { runs: TaskRun[] }
    expect(resp.status).toBe(200)
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0].taskId).toBe('task-a')
  })
})

describe('cronMatches day-of-week Sunday alias', () => {
  const sunday = new Date(2026, 0, 4, 10, 0)
  const monday = new Date(2026, 0, 5, 10, 0)

  it('fires on Sunday for both 0 and 7', () => {
    expect(sunday.getDay()).toBe(0)
    expect(cronMatches('0 10 * * 0', sunday)).toBe(true)
    expect(cronMatches('0 10 * * 7', sunday)).toBe(true)
  })

  it('does not fire on other days for the 7 alias', () => {
    expect(cronMatches('0 10 * * 7', monday)).toBe(false)
  })

  it('treats a range ending at 7 as covering Sunday', () => {
    expect(cronMatches('0 10 * * 5-7', sunday)).toBe(true)
    expect(cronMatches('0 10 * * 1-5', sunday)).toBe(false)
  })
})

describe('cronMatches stepped day-of-week range ending in 7', () => {
  const sunday = new Date(2026, 0, 4, 10, 0)
  const friday = new Date(2026, 0, 2, 10, 0)
  const monday = new Date(2026, 0, 5, 10, 0)

  it('matches the stepped range on Sunday via the 7 alias', () => {
    expect(cronMatches('0 10 * * 5-7/2', friday)).toBe(true)
    expect(cronMatches('0 10 * * 5-7/2', sunday)).toBe(true)
    expect(cronMatches('0 10 * * 5-7/2', monday)).toBe(false)
  })
})
