import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getClaudeConfigHomeDir } from '../envUtils.js'

/**
 * Computer Use settings, stored in `<config>/dreamcoder/computer-use-config.json`.
 *
 * Fields from the Python-based implementation (`mode`, `authorizedApps`,
 * `grantFlags`, `pythonPath`) are ignored on read and dropped on the next save.
 */
export type StoredComputerUseConfig = {
  enabled?: boolean
  driverPath?: string | null
}

export type ComputerUseConfig = {
  enabled: boolean
  driverPath: string | null
}

// Off by default: turning Computer Use on downloads cua-driver.
export const DEFAULT_COMPUTER_USE_ENABLED = false

export function getComputerUseConfigPath(): string {
  return join(getClaudeConfigHomeDir(), 'dreamcoder', 'computer-use-config.json')
}

export function normalizeDriverPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function resolveStoredComputerUseConfig(
  config?: StoredComputerUseConfig | null,
): ComputerUseConfig {
  return {
    enabled:
      typeof config?.enabled === 'boolean'
        ? config.enabled
        : DEFAULT_COMPUTER_USE_ENABLED,
    driverPath: normalizeDriverPath(config?.driverPath),
  }
}

export async function loadStoredComputerUseConfig(): Promise<ComputerUseConfig> {
  try {
    const raw = await readFile(getComputerUseConfigPath(), 'utf8')
    return resolveStoredComputerUseConfig(JSON.parse(raw))
  } catch {
    return resolveStoredComputerUseConfig()
  }
}

export async function saveStoredComputerUseConfig(
  config: ComputerUseConfig,
): Promise<void> {
  const configPath = getComputerUseConfigPath()
  await mkdir(dirname(configPath), { recursive: true })
  const stored: StoredComputerUseConfig = {
    enabled: config.enabled,
    driverPath: normalizeDriverPath(config.driverPath),
  }
  await writeFile(configPath, JSON.stringify(stored, null, 2), 'utf8')
}
