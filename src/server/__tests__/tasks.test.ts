import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { TaskService } from '../services/taskService.js'

describe('TaskService', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-tasks-'))
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    delete process.env.CLAUDE_CONFIG_DIR
  })

  async function writeTask(taskListId: string, task: Record<string, unknown> | string): Promise<void> {
    const listDir = path.join(tmpDir, 'tasks', taskListId)
    await fs.mkdir(listDir, { recursive: true })
    const id = typeof task === 'string' ? 'bad' : String(task.id)
    await fs.writeFile(
      path.join(listDir, `${id}.json`),
      typeof task === 'string' ? task : JSON.stringify(task),
    )
  }

  it('should return empty list when no tasks dir', async () => {
    const svc = new TaskService()
    const tasks = await svc.listTasks()
    expect(tasks).toEqual([])
  })

  it('should list tasks from every task list, sorted by numeric id', async () => {
    await writeTask('session-a', { id: '10', subject: 'Ship', status: 'pending' })
    await writeTask('session-a', { id: '2', subject: 'Build', status: 'in_progress', blockedBy: ['1'] })
    await writeTask('session-b', { id: '1', subject: 'Review', status: 'completed' })

    const svc = new TaskService()
    const tasks = await svc.listTasks()

    expect(tasks.map((t) => `${t.taskListId}/${t.id}`).sort()).toEqual(['session-a/10', 'session-a/2', 'session-b/1'])
    expect((await svc.getTasksForList('session-a')).map((t) => t.id)).toEqual(['2', '10'])
    expect(tasks.find((t) => t.id === '2')).toMatchObject({ subject: 'Build', blockedBy: ['1'], blocks: [] })
  })

  it('should summarize task lists and skip empty ones', async () => {
    await writeTask('team-a', { id: '1', subject: 'A', status: 'completed' })
    await writeTask('team-a', { id: '2', subject: 'B', status: 'in_progress' })
    await writeTask('team-a', { id: '3', subject: 'C', status: 'pending' })
    await fs.mkdir(path.join(tmpDir, 'tasks', 'empty-list'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'tasks', 'stray.json'), '{}')

    const svc = new TaskService()
    expect(await svc.listTaskLists()).toEqual([
      { id: 'team-a', taskCount: 3, completedCount: 1, inProgressCount: 1, pendingCount: 1 },
    ])
  })

  it('should get single task by list and id', async () => {
    await writeTask('session-a', { id: '7', subject: 'Deploy', status: 'unknown-status' })

    const svc = new TaskService()
    const task = await svc.getTask('session-a', '7')
    expect(task).toMatchObject({ id: '7', subject: 'Deploy', status: 'pending', taskListId: 'session-a' })
  })

  it('should return null for unknown task', async () => {
    await writeTask('session-a', { id: '1', subject: 'Only', status: 'pending' })

    const svc = new TaskService()
    expect(await svc.getTask('session-a', 'missing')).toBeNull()
    expect(await svc.getTask('no-such-list', '1')).toBeNull()
  })

  it('should skip invalid, incomplete and internal task files', async () => {
    await writeTask('session-a', 'not json {{{')
    await writeTask('session-a', { id: '1', status: 'pending' })
    await writeTask('session-a', { id: '2', subject: 'Internal', metadata: { _internal: true } })

    const svc = new TaskService()
    expect(await svc.listTasks()).toEqual([])
  })
})

describe('Tasks API', () => {
  let server: any
  let baseUrl: string
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-tasks-api-'))
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    await fs.mkdir(path.join(tmpDir, 'projects'), { recursive: true })

    const port = 15500 + Math.floor(Math.random() * 500)
    const { startServer } = await import('../../server/index.js')
    server = startServer(port, '127.0.0.1')
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    server?.stop()
    await fs.rm(tmpDir, { recursive: true, force: true })
    delete process.env.CLAUDE_CONFIG_DIR
  })

  it('should return empty tasks list', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.tasks).toEqual([])
  })

  it('should return tasks when files exist', async () => {
    const listDir = path.join(tmpDir, 'tasks', 'session-a')
    await fs.mkdir(listDir, { recursive: true })
    await fs.writeFile(path.join(listDir, '1.json'), JSON.stringify({
      id: '1', subject: 'test-task', status: 'completed',
    }))

    const res = await fetch(`${baseUrl}/api/tasks`)
    const data = await res.json()
    expect(data.tasks.length).toBe(1)
    expect(data.tasks[0]).toMatchObject({ subject: 'test-task', taskListId: 'session-a' })
  })

  it('should return 404 for unknown task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/lists/session-a/nonexistent`)
    expect(res.status).toBe(404)
  })

  it('should return 404 for unknown tasks sub-resources', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/nonexistent`)
    expect(res.status).toBe(404)
  })

  it('should reject non-GET methods', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, { method: 'POST' })
    expect(res.status).toBe(405)
  })
})
