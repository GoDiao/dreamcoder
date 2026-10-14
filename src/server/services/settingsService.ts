import * as fs from 'fs/promises'
import { randomBytes } from 'node:crypto'
import * as path from 'path'
import * as os from 'os'
import { ApiError } from '../middleware/errorHandler.js'
import { normalizeJsonObject, readRecoverableJsonFile } from './recoverableJsonFile.js'
import { ensurePersistentStorageUpgraded } from './persistentStorageMigrations.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

const VALID_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'dontAsk',
] as const

export type PermissionMode = (typeof VALID_PERMISSION_MODES)[number]

export class SettingsService {
  private static writeLocks = new Map<string, Promise<void>>()
  private projectRoot?: string

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot
  }

  private getConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  }

  private getUserSettingsPath(): string {
    return path.join(this.getConfigDir(), 'settings.json')
  }

  private getProjectSettingsPath(projectRoot?: string): string {
    const root = projectRoot || this.projectRoot
    if (!root) {
      throw ApiError.badRequest('Project root is required for project settings')
    }
    return path.join(root, '.claude', 'settings.json')
  }

  private async readJsonFile(filePath: string): Promise<Record<string, unknown>> {
    await ensurePersistentStorageUpgraded()
    return readRecoverableJsonFile({
      filePath,
      label: 'settings',
      defaultValue: {},
      normalize: normalizeJsonObject,
    })
  }

  async getSettings(projectRoot?: string): Promise<Record<string, unknown>> {
    const user = await this.getUserSettings()
    try {
      const project = await this.getProjectSettings(projectRoot)
      return Object.assign({}, user, project)
    } catch {
      return user
    }
  }

  async getUserSettings(): Promise<Record<string, unknown>> {
    return this.readJsonFile(this.getUserSettingsPath())
  }

  async getProjectSettings(projectRoot?: string): Promise<Record<string, unknown>> {
    return this.readJsonFile(this.getProjectSettingsPath(projectRoot))
  }

  private async withWriteLock<T>(
    filePath: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previousWrite = SettingsService.writeLocks.get(filePath) ?? Promise.resolve()
    const nextWrite = previousWrite
      .catch(() => {})
      .then(task)

    SettingsService.writeLocks.set(filePath, nextWrite)

    try {
      return await nextWrite
    } finally {
      if (SettingsService.writeLocks.get(filePath) === nextWrite) {
        SettingsService.writeLocks.delete(filePath)
      }
    }
  }

  private async writeJsonFile(
    filePath: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const dir = path.dirname(filePath)
    const contents = JSON.stringify(data, null, 2) + '\n'
    let lastError: unknown

    for (let attempt = 0; attempt < 2; attempt++) {
      const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}`
      try {
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(tmpFile, contents, 'utf-8')
        await fs.rename(tmpFile, filePath)
        resetSettingsCache()
        return
      } catch (err) {
        lastError = err
        await fs.unlink(tmpFile).catch(() => {})

        if (
          (err as NodeJS.ErrnoException).code !== 'ENOENT' ||
          attempt === 1
        ) {
          break
        }
      }
    }

    throw ApiError.internal(
      `Failed to write settings to ${filePath}: ${lastError}`,
    )
  }

  async updateUserSettings(settings: Record<string, unknown>): Promise<void> {
    const filePath = this.getUserSettingsPath()
    await this.withWriteLock(filePath, async () => {
      const current = await this.readJsonFile(filePath)
      const merged = Object.assign({}, current, settings)
      await this.writeJsonFile(filePath, merged)
    })
  }

  async updateProjectSettings(
    settings: Record<string, unknown>,
    projectRoot?: string,
  ): Promise<void> {
    const filePath = this.getProjectSettingsPath(projectRoot)
    await this.withWriteLock(filePath, async () => {
      const current = await this.readJsonFile(filePath)
      const merged = Object.assign({}, current, settings)
      await this.writeJsonFile(filePath, merged)
    })
  }

  async getPermissionMode(): Promise<string> {
    const settings = await this.getUserSettings()
    const mode = settings.defaultMode
    return typeof mode === 'string' && VALID_PERMISSION_MODES.includes(mode as PermissionMode)
      ? mode
      : 'default'
  }

  async setPermissionMode(mode: string): Promise<void> {
    if (!VALID_PERMISSION_MODES.includes(mode as PermissionMode)) {
      throw ApiError.badRequest(
        `Invalid permission mode: "${mode}". Valid modes: ${VALID_PERMISSION_MODES.join(', ')}`,
      )
    }
    await this.updateUserSettings({ defaultMode: mode })
  }
}
