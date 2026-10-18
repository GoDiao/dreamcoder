/**
 * Import from Claude Code: a one-way copy of the user's sessions and
 * DreamCoder's own files from Claude Code's directory into DreamCoder's.
 *
 * - Existing files are never overwritten, so running it again copies only
 *   what is missing.
 * - Files are cloned where the file system supports it (APFS, reflinks) and
 *   copied otherwise; `projects/` can be several GB.
 * - Nothing under Claude Code's directory is modified.
 */

import { constants as fsConstants } from 'fs'
import * as fs from 'fs/promises'
import * as path from 'path'
import {
  saveCurrentProjectConfig,
  saveGlobalConfig,
  type GlobalConfig,
  type ProjectConfig,
} from '../../utils/config.js'
import {
  getClaudeCodeGlobalConfigFile,
  getClaudeConfigHomeDir,
  getInheritedClaudeCodeDir,
} from '../../utils/envUtils.js'
import { getErrnoCode } from '../../utils/errors.js'
import { ApiError } from '../middleware/errorHandler.js'
import { ManagedSettingsService } from './managedSettingsService.js'
import { rerunPersistentStorageMigrations } from './persistentStorageMigrations.js'
import { getManagedEnvKeys, readActiveProviderManagedEnv } from './providerRuntimeEnv.js'
import { SettingsService } from './settingsService.js'

/** Directories copied from Claude Code's directory, recursively. */
export const IMPORTED_DIRECTORIES = [
  'projects',
  'file-history',
  'todos',
  'plans',
  'dreamcoder',
  'teams',
  'tasks',
] as const

/** Files copied from Claude Code's directory. */
export const IMPORTED_FILES = ['history.jsonl', 'scheduled_tasks.json'] as const

/**
 * `settings.json` keys DreamCoder's settings pages manage. Nothing else is
 * imported: hooks, `statusLine` and other keys run commands or belong to
 * Claude Code.
 */
export const IMPORTED_SETTINGS_KEYS = [
  'model',
  'effort',
  'defaultMode',
  'alwaysThinkingEnabled',
  'theme',
  'language',
  'skipWebFetchPreflight',
  'desktopNotificationsEnabled',
  'desktopTerminal',
  'webSearch',
  'updateProxy',
  'network',
] as const

/**
 * Files under the imported directories that are not imported: tokens of the
 * removed subscription sign-in, and DreamCoder's own import record.
 */
const EXCLUDED_FILES = new Set(
  [
    'dreamcoder/oauth.json',
    'dreamcoder/openai-oauth.json',
    'dreamcoder/openai-oauth-file-backed',
    'dreamcoder/claude-code-import.json',
  ].map((file) => path.normalize(file)),
)

const DECISION_FILE = path.join('dreamcoder', 'claude-code-import.json')

/** Suffix of the partial copy, renamed into place once complete. */
const PARTIAL_SUFFIX = '.dreamcoder-import.tmp'

export type ClaudeCodeImportJob = {
  state: 'running' | 'done' | 'failed'
  total: number
  copied: number
  skipped: number
  error?: string
}

export type ClaudeCodeImportStatus = {
  /** Claude Code's directory, or null when it is DreamCoder's own. */
  claudeCodeDir: string | null
  claudeCodeHasData: boolean
  dreamcoderHasData: boolean
  /** The user imported or skipped before, from this or an earlier launch. */
  decided: boolean
  /** An import started but did not finish, for example because the app quit. */
  incomplete: boolean
  /** Offer the import on first launch. */
  offer: boolean
  job: ClaudeCodeImportJob | null
}

type JsonObject = Record<string, unknown>

/** Copies one file without overwriting. Throws EEXIST when the target exists. */
export type CopyFile = (source: string, target: string) => Promise<void>

/**
 * Clones the file where supported, else falls back to a plain copy. The copy
 * function is a parameter so tests can make the clone fail.
 */
export function createCloneOrCopy(
  copy: (source: string, target: string, mode: number) => Promise<void> = fs.copyFile,
): CopyFile {
  return async (source, target) => {
    try {
      await copy(source, target, fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE)
    } catch (error) {
      if (getErrnoCode(error) === 'EEXIST') throw error
      await copy(source, target, fsConstants.COPYFILE_EXCL)
    }
  }
}

export const cloneOrCopyFile: CopyFile = createCloneOrCopy()

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function readJsonObject(filePath: string): Promise<JsonObject | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf-8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath)
    return true
  } catch {
    return false
  }
}

async function hasEntries(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir)
    return entries.some((name) => name !== '.DS_Store')
  } catch {
    return false
  }
}

/** Whether a config directory holds sessions, providers or scheduled tasks. */
export async function configDirHasData(dir: string): Promise<boolean> {
  return (
    (await hasEntries(path.join(dir, 'projects'))) ||
    (await exists(path.join(dir, 'dreamcoder', 'providers.json'))) ||
    (await exists(path.join(dir, 'scheduled_tasks.json')))
  )
}

/** Regular files under the imported paths, relative to the source directory. */
export async function listImportedFiles(sourceDir: string): Promise<string[]> {
  const files: string[] = []
  async function walk(relativeDir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(path.join(sourceDir, relativeDir), {
        withFileTypes: true,
      })
    } catch {
      return
    }
    for (const entry of entries) {
      const relative = path.join(relativeDir, entry.name)
      // Symbolic links and special files are skipped: a link could point
      // anywhere, and copying its target is not what the user has.
      if (entry.isDirectory()) await walk(relative)
      else if (entry.isFile() && !EXCLUDED_FILES.has(relative)) files.push(relative)
    }
  }
  for (const dir of IMPORTED_DIRECTORIES) await walk(dir)
  for (const file of IMPORTED_FILES) {
    try {
      if ((await fs.lstat(path.join(sourceDir, file))).isFile()) files.push(file)
    } catch {
      // Not there
    }
  }
  return files
}

/**
 * Copies the listed files that are missing in the target, keeping their
 * modification times, which order the session list.
 *
 * Each file is copied to a partial file next to the target and linked into
 * place only when complete, so an interrupted import never leaves a truncated
 * file that a later run would take as already imported. Linking fails when
 * the target exists, so nothing is overwritten.
 */
export async function copyMissingFiles(
  sourceDir: string,
  targetDir: string,
  files: string[],
  copyFile: CopyFile,
  onProgress: (result: 'copied' | 'skipped') => void,
): Promise<void> {
  for (const relative of files) {
    const source = path.join(sourceDir, relative)
    const target = path.join(targetDir, relative)
    if (await exists(target)) {
      onProgress('skipped')
      continue
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    const partial = target + PARTIAL_SUFFIX
    // Left over from an interrupted run.
    await fs.rm(partial, { force: true })
    try {
      await copyFile(source, partial)
      const stat = await fs.stat(source)
      await fs.utimes(partial, stat.atime, stat.mtime)
      await placeWithoutOverwriting(partial, target)
    } catch (error) {
      await fs.rm(partial, { force: true })
      if (getErrnoCode(error) === 'EEXIST') {
        onProgress('skipped')
        continue
      }
      throw error
    }
    onProgress('copied')
  }
}

/** Moves a complete file into place; throws EEXIST when the target exists. */
async function placeWithoutOverwriting(partial: string, target: string): Promise<void> {
  try {
    await fs.link(partial, target)
  } catch (error) {
    const code = getErrnoCode(error)
    // File systems without hard links: rename, which would overwrite, so check first.
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EXDEV') throw error
    if (await exists(target)) {
      throw Object.assign(new Error(`${target} already exists`), { code: 'EEXIST' })
    }
    await fs.rename(partial, target)
    return
  }
  await fs.rm(partial, { force: true })
}

/** The imported settings keys that DreamCoder's settings do not have yet. */
export function pickImportedSettings(
  source: JsonObject,
  current: JsonObject,
): JsonObject {
  const picked: JsonObject = {}
  for (const key of IMPORTED_SETTINGS_KEYS) {
    if (key in source && !(key in current)) picked[key] = source[key]
  }
  return picked
}

/**
 * Claude Code's MCP servers that DreamCoder does not have yet, by name, added
 * to DreamCoder's. Returns null when there is nothing to add.
 */
export function mergeMcpServers(current: unknown, source: unknown): JsonObject | null {
  if (!isRecord(source) || Object.keys(source).length === 0) return null
  const existing = isRecord(current) ? current : {}
  const added = Object.keys(source).filter((name) => !(name in existing))
  if (added.length === 0) return null
  return { ...Object.fromEntries(added.map((name) => [name, source[name]])), ...existing }
}

export class ClaudeCodeImportService {
  private job: ClaudeCodeImportJob | null = null

  constructor(
    private readonly copyFile: CopyFile = cloneOrCopyFile,
    private readonly saveConfig: typeof saveGlobalConfig = saveGlobalConfig,
    private readonly saveProjectConfig: typeof saveCurrentProjectConfig = saveCurrentProjectConfig,
  ) {}

  async getStatus(): Promise<ClaudeCodeImportStatus> {
    const claudeCodeDir = getInheritedClaudeCodeDir() ?? null
    const claudeCodeHasData = claudeCodeDir
      ? await configDirHasData(claudeCodeDir)
      : false
    const dreamcoderHasData = await configDirHasData(getClaudeConfigHomeDir())
    const decision = await readJsonObject(
      path.join(getClaudeConfigHomeDir(), DECISION_FILE),
    )
    const decided = !!decision && ('importedAt' in decision || 'skippedAt' in decision)
    const incomplete = !!decision && 'startedAt' in decision && !decided
    return {
      claudeCodeDir,
      claudeCodeHasData,
      dreamcoderHasData,
      decided,
      incomplete,
      // An interrupted import already put data in DreamCoder's directory, so
      // it is offered again to finish it.
      offer: claudeCodeHasData && !decided && (!dreamcoderHasData || incomplete),
      job: this.job,
    }
  }

  /** Records that the user chose to start empty, so the offer is not shown again. */
  async skip(): Promise<void> {
    await this.writeDecision({ skippedAt: new Date().toISOString() })
  }

  /** Starts the import in the background; poll getStatus() for progress. */
  start(): ClaudeCodeImportJob {
    if (this.job?.state === 'running') return this.job
    const sourceDir = getInheritedClaudeCodeDir()
    if (!sourceDir) {
      throw ApiError.badRequest(
        "DreamCoder's directory is Claude Code's directory; there is nothing to import.",
      )
    }
    const job: ClaudeCodeImportJob = { state: 'running', total: 0, copied: 0, skipped: 0 }
    this.job = job
    void this.run(sourceDir, job)
    return job
  }

  /** Runs the import to the end; start() runs it in the background. */
  async run(sourceDir: string, job: ClaudeCodeImportJob): Promise<void> {
    const targetDir = getClaudeConfigHomeDir()
    try {
      await this.writeDecision({ startedAt: new Date().toISOString() })
      const files = await listImportedFiles(sourceDir)
      job.total = files.length
      await copyMissingFiles(sourceDir, targetDir, files, this.copyFile, (result) => {
        job[result]++
      })
      // Imported provider files may be in an older format.
      await rerunPersistentStorageMigrations()
      await clearOrphanedProviderEnv(targetDir)
      await this.importSettings(sourceDir)
      await this.importMcpServers()
      await this.writeDecision({ importedAt: new Date().toISOString() })
      job.state = 'done'
    } catch (error) {
      job.state = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
    }
  }

  private async importSettings(sourceDir: string): Promise<void> {
    const source = await readJsonObject(path.join(sourceDir, 'settings.json'))
    if (!source) return
    const settingsService = new SettingsService()
    const picked = pickImportedSettings(source, await settingsService.getUserSettings())
    if (Object.keys(picked).length > 0) {
      await settingsService.updateUserSettings(picked)
    }
  }

  private async importMcpServers(): Promise<void> {
    const source = await readJsonObject(getClaudeCodeGlobalConfigFile())
    if (!source) return
    // User scope. saveGlobalConfig does not write `projects`, so project
    // scope is saved per project below. Project trust is not imported.
    this.saveConfig((current) => {
      const servers = mergeMcpServers(current.mcpServers, source.mcpServers)
      return servers
        ? { ...current, mcpServers: servers as GlobalConfig['mcpServers'] }
        : current
    })
    const projects = isRecord(source.projects) ? source.projects : {}
    for (const [projectPath, projectConfig] of Object.entries(projects)) {
      if (!isRecord(projectConfig)) continue
      this.saveProjectConfig((current) => {
        const servers = mergeMcpServers(current.mcpServers, projectConfig.mcpServers)
        return servers
          ? { ...current, mcpServers: servers as ProjectConfig['mcpServers'] }
          : current
      }, projectPath)
    }
  }

  private async writeDecision(decision: JsonObject): Promise<void> {
    const filePath = path.join(getClaudeConfigHomeDir(), DECISION_FILE)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(decision, null, 2) + '\n', 'utf-8')
  }
}

/**
 * With an active provider its env replaces these keys at runtime. Without one,
 * an imported provider env, e.g. of the removed subscription sign-in, would
 * still route terminal runs, so it is removed.
 */
async function clearOrphanedProviderEnv(configDir: string): Promise<void> {
  if (readActiveProviderManagedEnv(configDir)) return
  const managedSettings = new ManagedSettingsService()
  const { env } = await managedSettings.readSettings()
  const managedKeys = getManagedEnvKeys()
  if (!isRecord(env) || !managedKeys.some((key) => key in env)) return
  await managedSettings.updateSettings((current) => {
    const cleaned = isRecord(current.env) ? { ...current.env } : {}
    for (const key of managedKeys) delete cleaned[key]
    return { settings: { ...current, env: cleaned }, result: undefined }
  })
}

export const claudeCodeImportService = new ClaudeCodeImportService()
