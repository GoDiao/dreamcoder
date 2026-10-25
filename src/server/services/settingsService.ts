import * as fs from 'fs/promises'
import { randomBytes } from 'node:crypto'
import * as path from 'path'
import { ApiError } from '../middleware/errorHandler.js'
import { normalizeJsonObject, readRecoverableJsonFile } from './recoverableJsonFile.js'
import { ensurePersistentStorageUpgraded } from './persistentStorageMigrations.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { DEFAULT_PERMISSION_MODES, type DefaultPermissionMode } from '../ws/protocol.js'
import { isDefaultPermissionMode } from './permissionModes.js'

export class SettingsService {
  private static writeLocks = new Map<string, Promise<unknown>>()
  private projectRoot?: string

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot
  }

  private getConfigDir(): string {
    return getClaudeConfigHomeDir()
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

  async getPermissionMode(): Promise<DefaultPermissionMode> {
    const settings = await this.getUserSettings()
    const mode = settings.defaultMode
    return isDefaultPermissionMode(mode) ? mode : 'default'
  }

  async setPermissionMode(mode: string): Promise<void> {
    if (!isDefaultPermissionMode(mode)) {
      throw ApiError.badRequest(
        `Invalid permission mode: "${mode}". Valid modes: ${DEFAULT_PERMISSION_MODES.join(', ')}`,
      )
    }
    await this.updateUserSettings({ defaultMode: mode })
  }
}
