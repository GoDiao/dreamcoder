import * as fs from 'fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { CronService, type CronTask } from './cronService.js'
import { SessionService } from './sessionService.js'
import { sendTaskNotification } from './notificationService.js'
import { ProviderService } from './providerService.js'
import { isProviderManagedEnvVar } from '../../utils/managedEnvConstants.js'
import {
  buildClaudeCliArgs,
  resolveClaudeCliLauncher,
} from '../../utils/desktopBundledCli.js'
import { getProcessEnvWithTerminalShellEnvironment } from '../../utils/terminalShellEnvironment.js'
import { attributionHeaderEnvForModel } from './attributionHeaderPolicy.js'

export type TaskRun = {
  id: string
  taskId: string
  taskName: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'completed' | 'failed' | 'timeout'
  prompt: string
  output?: string
  error?: string
  exitCode?: number
  durationMs?: number
  sessionId?: string
}

function extractAssistantText(raw: string): string {
  if (!raw) return ''
  const lines = raw.split('\n')
  const parts: string[] = []

  for (const line of lines) {
    if (!line.trim()) continue
    let parsed: any
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    const type = parsed?.type

    if (type === 'assistant') {
      const content = parsed?.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === 'text' && block.text?.trim()) {
          parts.push(block.text.trim())
        }
      }
    }

    if (type === 'result') {
      const result = parsed?.result
      if (typeof result === 'string' && result.trim()) {
        parts.push(result.trim())
      } else if (result?.message?.trim()) {
        parts.push(result.message.trim())
      }
    }
  }

  return parts.join('\n\n')
}

export function fieldMatches(
  field: string,
  value: number,
  options?: { sundayAlias?: boolean },
): boolean {
  if (field === '*') return true

  const parts = field.split(',')
  return parts.some((part) => singleFieldMatches(part.trim(), value, options))
}

function singleFieldMatches(
  part: string,
  value: number,
  options?: { sundayAlias?: boolean },
): boolean {
  if (options?.sundayAlias && value === 0) {
    return singleFieldMatches(part, 0) || singleFieldMatches(part, 7)
  }

  if (part.includes('/')) {
    const [rangePart, stepStr] = part.split('/')
    const step = parseInt(stepStr, 10)
    if (isNaN(step) || step <= 0) return false

    if (rangePart === '*') {
      return value % step === 0
    }
    if (rangePart.includes('-')) {
      const [startStr, endStr] = rangePart.split('-')
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      if (value < start || value > end) return false
      return (value - start) % step === 0
    }
    const start = parseInt(rangePart, 10)
    if (value < start) return false
    return (value - start) % step === 0
  }

  if (part.includes('-')) {
    const [startStr, endStr] = part.split('-')
    const start = parseInt(startStr, 10)
    const end = parseInt(endStr, 10)
    return value >= start && value <= end
  }

  return parseInt(part, 10) === value
}

export function cronMatches(cronExpr: string, date: Date): boolean {
  const fields = cronExpr.trim().split(/\s+/)
  if (fields.length !== 5) return false

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  return (
    fieldMatches(minute, date.getMinutes()) &&
    fieldMatches(hour, date.getHours()) &&
    fieldMatches(dayOfMonth, date.getDate()) &&
    fieldMatches(month, date.getMonth() + 1) &&
    fieldMatches(dayOfWeek, date.getDay(), { sundayAlias: true })
  )
}

type RunsFile = { runs: TaskRun[] }

function getLogFilePath(): string {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configDir, 'scheduled_tasks_log.json')
}

async function readRunsFile(): Promise<RunsFile> {
  try {
    const raw = await fs.readFile(getLogFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as RunsFile
    if (!Array.isArray(parsed.runs)) return { runs: [] }
    return parsed
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { runs: [] }
    }
    throw err
  }
}

async function writeRunsFile(data: RunsFile): Promise<void> {
  const filePath = getLogFilePath()
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })

  const tmpFile = `${filePath}.tmp.${Date.now()}`
  try {
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    await fs.rename(tmpFile, filePath)
  } catch (err) {
    await fs.unlink(tmpFile).catch(() => {})
    throw err
  }
}

async function appendRun(run: TaskRun): Promise<void> {
  const data = await readRunsFile()
  data.runs.push(run)
  trimRuns(data)
  await writeRunsFile(data)
}

async function updateRun(run: TaskRun): Promise<void> {
  const data = await readRunsFile()
  const idx = data.runs.findIndex((r) => r.id === run.id)
  if (idx !== -1) {
    data.runs[idx] = run
  } else {
    data.runs.push(run)
  }
  trimRuns(data)
  await writeRunsFile(data)
}

const MAX_RUNS_PER_TASK = 100

function trimRuns(data: RunsFile): void {
  const countByTask = new Map<string, number>()
  const keep = new Array<boolean>(data.runs.length).fill(false)
  for (let i = data.runs.length - 1; i >= 0; i--) {
    const taskId = data.runs[i].taskId
    const count = countByTask.get(taskId) || 0
    if (count < MAX_RUNS_PER_TASK) {
      keep[i] = true
      countByTask.set(taskId, count + 1)
    }
  }
  data.runs = data.runs.filter((_, i) => keep[i])
}

const TASK_TIMEOUT_MS = 10 * 60 * 1000

type CronCliResolutionOptions = {
  cliPath?: string | null
  execPath?: string
  appRoot?: string
  cwd?: string
  moduleDir?: string
  env?: NodeJS.ProcessEnv
}

function isSourceProjectRoot(root: string): boolean {
  return (
    existsSync(path.join(root, 'preload.ts')) &&
    existsSync(path.join(root, 'src', 'entrypoints', 'cli.tsx'))
  )
}

function findSourceProjectRoot(startDir: string): string | null {
  let current = path.resolve(startDir)

  while (true) {
    if (isSourceProjectRoot(current)) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

export function resolveCronProjectRoot(
  options: CronCliResolutionOptions = {},
): string {
  const env = options.env ?? process.env
  const explicitRoot = env.DREAMCODER_ROOT?.trim()
  if (explicitRoot && isSourceProjectRoot(path.resolve(explicitRoot))) {
    return path.resolve(explicitRoot)
  }

  const cwdRoot = findSourceProjectRoot(options.cwd ?? process.cwd())
  if (cwdRoot) {
    return cwdRoot
  }

  const moduleRoot = findSourceProjectRoot(options.moduleDir ?? import.meta.dir)
  if (moduleRoot) {
    return moduleRoot
  }

  return path.resolve(options.moduleDir ?? import.meta.dir, '../../..')
}

export function buildCronCliArgs(
  baseArgs: string[],
  options: CronCliResolutionOptions = {},
): string[] {
  const launcher = resolveClaudeCliLauncher({
    cliPath: options.cliPath ?? process.env.CLAUDE_CLI_PATH,
    execPath: options.execPath ?? process.execPath,
  })

  if (launcher) {
    return buildClaudeCliArgs(
      launcher,
      baseArgs,
      options.appRoot ?? process.env.CLAUDE_APP_ROOT,
    )
  }

  const projectRoot = resolveCronProjectRoot(options)
  return [
    'bun',
    '--preload',
    path.join(projectRoot, 'preload.ts'),
    path.join(projectRoot, 'src', 'entrypoints', 'cli.tsx'),
    ...baseArgs,
  ]
}

export class CronScheduler {
  private intervalId: Timer | null = null
  private runningTasks = new Map<
    string,
    { proc: ReturnType<typeof Bun.spawn>; startedAt: number; runId: string }
  >()
  private lastFiredMinuteKey = new Map<string, string>()
  private cronService: CronService
  private sessionService: SessionService
  private providerService = new ProviderService()

  constructor(cronService?: CronService) {
    this.cronService = cronService || new CronService()
    this.sessionService = new SessionService()
  }

  private static minuteKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`
  }

  start(): void {
    if (this.intervalId) return
    console.log('[CronScheduler] Starting — checking every 60 s')
    this.cleanupStaleRuns().catch((err) =>
      console.error('[CronScheduler] Error cleaning up stale runs:', err),
    )
    this.intervalId = setInterval(() => this.tick(), 60_000)
    this.tick()
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    for (const [taskId, entry] of this.runningTasks) {
      try {
        entry.proc.kill()
      } catch {
      }
      this.runningTasks.delete(taskId)
    }
    console.log('[CronScheduler] Stopped')
  }

  async tick(): Promise<void> {
    try {
      const tasks = await this.cronService.listTasks()
      const now = new Date()
      const currentKey = CronScheduler.minuteKey(now)

      for (const task of tasks) {
        if (task.enabled === false) continue

        if (this.runningTasks.has(task.id)) continue

        if (this.lastFiredMinuteKey.get(task.id) === currentKey) continue

        if (task.lastFiredAt) {
          const lastFiredKey = CronScheduler.minuteKey(new Date(task.lastFiredAt))
          if (lastFiredKey === currentKey) continue
        }

        if (cronMatches(task.cron, now)) {
          this.lastFiredMinuteKey.set(task.id, currentKey)
          this.executeTask(task).catch((err) => {
            console.error(
              `[CronScheduler] Unhandled error executing task ${task.id}:`,
              err,
            )
          })
        }
      }
    } catch (err) {
      console.error('[CronScheduler] Error during tick:', err)
    }
  }

  async executeTask(task: CronTask, options?: { createSession?: boolean }): Promise<TaskRun> {
    const existing = this.runningTasks.get(task.id)
    if (existing) {
      console.log(
        `[CronScheduler] Task ${task.id} is already running (runId=${existing.runId}), skipping`,
      )
      return {
        id: existing.runId,
        taskId: task.id,
        taskName: task.name || task.prompt.slice(0, 60),
        startedAt: new Date(existing.startedAt).toISOString(),
        status: 'running',
        prompt: task.prompt,
      }
    }

    const runId = crypto.randomBytes(6).toString('hex')
    const startedAt = new Date().toISOString()
    let workDir = task.folderPath || os.homedir()
    if (task.folderPath && (!existsSync(task.folderPath) || !statSync(task.folderPath).isDirectory())) {
      console.warn(`[cron] task ${task.id}: folderPath "${task.folderPath}" is not a valid directory, falling back to homedir`)
      workDir = os.homedir()
    }

    let sessionId: string | undefined
    if (options?.createSession) {
      try {
        const result = await this.sessionService.createSession(workDir)
        sessionId = result.sessionId
        await this.sessionService.deleteSessionFile(sessionId)
      } catch {
      }
    }

    const run: TaskRun = {
      id: runId,
      taskId: task.id,
      taskName: task.name || task.prompt.slice(0, 60),
      startedAt,
      status: 'running',
      prompt: task.prompt,
      sessionId,
    }

    await this.cronService.updateLastFired(task.id, startedAt)

    await appendRun(run)

    const inputPayload = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: task.prompt }],
      },
      parent_tool_use_id: null,
      session_id: sessionId || '',
    }) + '\n'

    const cliArgs = buildCronCliArgs([
      '--print',
      '--verbose',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      ...(sessionId ? ['--session-id', sessionId] : []),
      ...this.getRuntimeArgs(task),
    ])

    const childEnv = await this.buildTaskChildEnv(workDir, task)
    const proc = Bun.spawn(
      cliArgs,
      {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: workDir,
        env: childEnv,
      },
    )

    this.runningTasks.set(task.id, { proc, startedAt: Date.now(), runId })

    try {
      proc.stdin.write(inputPayload)
      proc.stdin.end()
    } catch {
    }

    const timeoutId = setTimeout(() => {
      if (this.runningTasks.has(task.id)) {
        try {
          proc.kill()
        } catch {
        }
      }
    }, TASK_TIMEOUT_MS)

    try {
      const stdoutChunks: string[] = []
      if (proc.stdout) {
        const reader = proc.stdout.getReader()
        const decoder = new TextDecoder()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            stdoutChunks.push(decoder.decode(value, { stream: true }))
          }
        } catch {
        }
      }

      const exitCode = await proc.exited

      clearTimeout(timeoutId)
      this.runningTasks.delete(task.id)

      const completedAt = new Date().toISOString()
      const rawOutput = stdoutChunks.join('')
      const durationMs =
        new Date(completedAt).getTime() - new Date(startedAt).getTime()

      const wasTimeout = durationMs >= TASK_TIMEOUT_MS

      const output = extractAssistantText(rawOutput)

      const completedRun: TaskRun = {
        ...run,
        completedAt,
        status: wasTimeout ? 'timeout' : exitCode === 0 ? 'completed' : 'failed',
        output: output.slice(0, 50_000),
        exitCode,
        durationMs,
      }

      if (exitCode !== 0 && proc.stderr) {
        try {
          const stderrText = await new Response(proc.stderr).text()
          completedRun.error = stderrText.slice(0, 5_000)
        } catch {
        }
      }

      await updateRun(completedRun)

      if (task.notification?.enabled && task.notification.channels.length > 0) {
        sendTaskNotification(completedRun, task.notification).catch((err) => {
          console.error(`[CronScheduler] Notification error for task ${task.id}:`, err)
        })
      }

      if (!task.recurring) {
        await this.cronService.updateTask(task.id, { enabled: false }).catch(() => {
        })
      }

      return completedRun
    } catch (err) {
      clearTimeout(timeoutId)
      this.runningTasks.delete(task.id)

      const completedAt = new Date().toISOString()
      const failedRun: TaskRun = {
        ...run,
        completedAt,
        status: 'failed',
        error: (err as Error).message,
        durationMs:
          new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      }

      await updateRun(failedRun)

      return failedRun
    }
  }

  private getRuntimeArgs(task: CronTask): string[] {
    const model = task.model?.trim()
    return model ? ['--model', model] : []
  }

  private async buildTaskChildEnv(
    workDir: string,
    task: CronTask,
  ): Promise<Record<string, string | undefined>> {
    const cleanEnv = await getProcessEnvWithTerminalShellEnvironment()
    delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN

    if (this.shouldStripInheritedProviderEnv(task.providerId)) {
      for (const key of Object.keys(cleanEnv)) {
        if (isProviderManagedEnvVar(key)) {
          delete cleanEnv[key]
        }
      }
    }

    const explicitProviderEnv =
      typeof task.providerId === 'string'
        ? await this.providerService.getProviderRuntimeEnv(task.providerId)
        : null
    if (explicitProviderEnv && task.model?.trim()) {
      explicitProviderEnv.ANTHROPIC_MODEL = task.model.trim()
    }
    const attributionHeaderEnv = attributionHeaderEnvForModel(
      task.model?.trim() ||
        explicitProviderEnv?.ANTHROPIC_MODEL ||
        cleanEnv.ANTHROPIC_MODEL,
    )

    return {
      ...cleanEnv,
      CLAUDE_CODE_ENABLE_TASKS: '1',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-cli',
      CALLER_DIR: workDir,
      PWD: workDir,
      DREAMCODER_SKIP_DOTENV: '1',
      ...(explicitProviderEnv
        ? {
            CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
            CLAUDE_CODE_ENTRYPOINT: 'sdk-cli',
          }
        : {}),
      ...(explicitProviderEnv ?? {}),
      ...(this.shouldMarkManagedOAuth(task.providerId)
        ? await this.buildOfficialOAuthEnv()
        : {}),
      ...attributionHeaderEnv,
    }
  }

  private getConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  }

  private shouldStripInheritedProviderEnv(providerId?: string | null): boolean {
    if (providerId !== undefined) {
      return true
    }

    const dreamcoderDir = path.join(this.getConfigDir(), 'dreamcoder')
    if (existsSync(path.join(dreamcoderDir, 'providers.json'))) {
      return true
    }

    try {
      const raw = readFileSync(path.join(dreamcoderDir, 'settings.json'), 'utf-8')
      const parsed = JSON.parse(raw) as { env?: Record<string, string> }
      const env = parsed.env ?? {}
      return Object.entries(env).some(
        ([key, value]) =>
          isProviderManagedEnvVar(key) &&
          typeof value === 'string' &&
          value.trim().length > 0,
      )
    } catch {
      return false
    }
  }

  private shouldMarkManagedOAuth(providerId?: string | null): boolean {
    if (providerId === null) {
      return true
    }
    if (typeof providerId === 'string') {
      return false
    }

    try {
      const raw = readFileSync(
        path.join(this.getConfigDir(), 'dreamcoder', 'settings.json'),
        'utf-8',
      )
      const parsed = JSON.parse(raw) as { env?: Record<string, string> }
      const env = parsed.env ?? {}
      const hasProviderEnv = [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
      ].some(
        (key) =>
          typeof env[key] === 'string' && env[key]!.trim().length > 0,
      )
      return !hasProviderEnv
    } catch {
      return true
    }
  }

  private async buildOfficialOAuthEnv(): Promise<Record<string, string>> {
    const env: Record<string, string> = {
      CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
    }
    try {
      const { providerOAuthService } = await import('./providerOAuthService.js')
      const token = await providerOAuthService.ensureFreshAccessToken()
      if (token) {
        env.CLAUDE_CODE_OAUTH_TOKEN = token
      }
    } catch (err) {
      console.error(
        '[cronScheduler] ensureFreshAccessToken failed:',
        err instanceof Error ? err.message : err,
      )
    }
    return env
  }

  private async cleanupStaleRuns(): Promise<void> {
    const data = await readRunsFile()
    let changed = false
    const now = Date.now()

    for (const run of data.runs) {
      if (run.status !== 'running') continue
      const startedAt = new Date(run.startedAt).getTime()
      if (now - startedAt > TASK_TIMEOUT_MS + 60_000) {
        run.status = 'failed'
        run.error = 'Process terminated before task could complete'
        run.completedAt = new Date().toISOString()
        run.durationMs = now - startedAt
        changed = true
        console.log(
          `[CronScheduler] Cleaned up stale run ${run.id} for task ${run.taskId}`,
        )
      }
    }

    if (changed) {
      await writeRunsFile(data)
    }
  }

  async getTaskRuns(taskId: string): Promise<TaskRun[]> {
    const data = await readRunsFile()
    return data.runs
      .filter((r) => r.taskId === taskId)
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      )
  }

  async getRecentRuns(limit = 50): Promise<TaskRun[]> {
    const data = await readRunsFile()
    return data.runs
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      )
      .slice(0, limit)
  }
}

export const cronScheduler = new CronScheduler()
