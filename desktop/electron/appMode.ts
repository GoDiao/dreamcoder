import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const CONFIG_DIR_ENV = 'DREAMCODER_CONFIG_DIR'
export const PORTABLE_MARKER_ENV = 'DREAMCODER_APP_PORTABLE_DIR'
export const PORTABLE_DIR_NAME = 'CLAUDE_CONFIG_DIR'
export const APP_MODE_FILE = 'app-mode.json'
export const WINDOW_STATE_FILE = 'window-state.json'
export const TERMINAL_CONFIG_FILE = 'terminal-config.json'
export const TAURI_IDENTIFIER = 'com.dreamcoder.desktop'

export type AppMode = 'default' | 'portable'

export type AppModeConfig = {
  mode: AppMode
  portable_dir: string | null
}

export type AppModeLocations = {
  defaultPortableDir: string
  systemConfigDir: string
}

const PORTABLE_DATA_FILES = ['settings.json', '.claude.json', '.mcp.json', WINDOW_STATE_FILE, TERMINAL_CONFIG_FILE]
const PORTABLE_DATA_DIRS = ['Cache', 'EBWebView', 'projects', 'skills', 'plugins', 'cowork_plugins', 'dreamcoder']

export function appModeLocations(executablePath: string, appDataDir: string): AppModeLocations {
  return {
    defaultPortableDir: path.join(path.dirname(executablePath), PORTABLE_DIR_NAME),
    systemConfigDir: path.join(appDataDir, TAURI_IDENTIFIER),
  }
}

function isDirectory(target: string) {
  try {
    return statSync(target).isDirectory()
  } catch {
    return false
  }
}

function isFile(target: string) {
  try {
    return statSync(target).isFile()
  } catch {
    return false
  }
}

export function dirHasPortableData(dir: string): boolean {
  if (!isDirectory(dir)) return false
  return PORTABLE_DATA_FILES.some((file) => isFile(path.join(dir, file)))
    || PORTABLE_DATA_DIRS.some((name) => isDirectory(path.join(dir, name)))
}

export function readAppModeConfig(dir: string): AppModeConfig | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path.join(dir, APP_MODE_FILE), 'utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const value = parsed as Record<string, unknown>
  const mode = typeof value.mode === 'string' && value.mode.toLowerCase() === 'portable' ? 'portable' : 'default'
  const portableDir = typeof value.portable_dir === 'string' ? value.portable_dir : null
  return { mode, portable_dir: portableDir }
}

export function writeAppModeConfig(dir: string, config: AppModeConfig) {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, APP_MODE_FILE), JSON.stringify(config, null, 2))
  } catch (error) {
    console.error(`[electron] failed to write ${APP_MODE_FILE} in ${dir}`, error)
  }
}

export function determineStartupPortableDir(env: NodeJS.ProcessEnv, locations: AppModeLocations): string | null {
  if (env[CONFIG_DIR_ENV]) return null
  const { defaultPortableDir, systemConfigDir } = locations

  const local = readAppModeConfig(defaultPortableDir)
  if (local) {
    if (local.mode !== 'portable') return null
    if (dirHasPortableData(defaultPortableDir)) return defaultPortableDir
    return local.portable_dir ?? defaultPortableDir
  }

  const system = readAppModeConfig(systemConfigDir)
  if (system) return system.mode === 'portable' ? system.portable_dir ?? defaultPortableDir : null

  return dirHasPortableData(defaultPortableDir) ? defaultPortableDir : null
}

export function currentAppMode(env: NodeJS.ProcessEnv, locations: AppModeLocations) {
  const configDir = env[CONFIG_DIR_ENV] || null
  const configDirSource = configDir ? (env[PORTABLE_MARKER_ENV] ? 'portable' : 'environment') : 'system'
  return {
    mode: configDir ? 'portable' : 'default',
    portableDir: configDir ?? locations.defaultPortableDir,
    defaultPortableDir: locations.defaultPortableDir,
    configDirSource,
  } as const
}

export function detectPortableDir(locations: AppModeLocations) {
  return {
    defaultPortableDir: locations.defaultPortableDir,
    hasData: dirHasPortableData(locations.defaultPortableDir),
  }
}

export function setAppMode(
  env: NodeJS.ProcessEnv,
  locations: AppModeLocations,
  input: { mode: string; portableDir: string | null },
) {
  const activeConfigDir = env[CONFIG_DIR_ENV] || locations.systemConfigDir
  let config: AppModeConfig = { mode: 'default', portable_dir: null }
  let targetPortableDir: string | null = null

  if (input.mode === 'portable') {
    const selected = input.portableDir?.trim() || locations.defaultPortableDir
    if (existsSync(selected) && !isDirectory(selected)) {
      throw new Error(`portable config path is not a directory: ${selected}`)
    }
    mkdirSync(selected, { recursive: true })
    config = { mode: 'portable', portable_dir: selected === locations.defaultPortableDir ? null : selected }
    targetPortableDir = selected
  }

  writeAppModeConfig(activeConfigDir, config)
  if (targetPortableDir && targetPortableDir !== activeConfigDir) writeAppModeConfig(targetPortableDir, config)
  if (locations.systemConfigDir !== activeConfigDir) writeAppModeConfig(locations.systemConfigDir, config)
}

export function clearPortableEnvForRestart(env: NodeJS.ProcessEnv) {
  if (!env[PORTABLE_MARKER_ENV]) return
  delete env[CONFIG_DIR_ENV]
  delete env[PORTABLE_MARKER_ENV]
}

export function legacyTerminalConfigPath(env: NodeJS.ProcessEnv, locations: AppModeLocations) {
  return path.join(env[CONFIG_DIR_ENV] || locations.systemConfigDir, TERMINAL_CONFIG_FILE)
}
