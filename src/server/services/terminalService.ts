import { accessSync, constants, statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import * as path from 'node:path'
import { getConfigDirOverride } from '../../utils/envUtils.js'
import { normalizeJsonObject } from './recoverableJsonFile.js'

export type TerminalPlatform = 'windows' | 'macos' | 'linux'

export type DesktopTerminalConfig = {
  startupShell?: string
  customShellPath?: string
  bashPath?: string | null
}

export type ShellSelection = {
  shell: string
  warning: string | null
  systemDefault: string
}

export type TerminalExit = {
  code: number
  signal: string | null
}

export type TerminalProcess = {
  shell: string
  cwd: string
  warning: string | null
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type StartTerminalOptions = {
  cols: number
  rows: number
  cwd?: string
  config: DesktopTerminalConfig
  onData(data: string): void
  onExit(exit: TerminalExit): void
}

const MIN_COLS = 20
const MIN_ROWS = 8
const LOGIN_ENV_TIMEOUT_MS = 2000
const PTY_DRAIN_TIMEOUT_MS = 200

export function currentTerminalPlatform(): TerminalPlatform {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return 'linux'
}

export function readDesktopTerminalConfig(settings: Record<string, unknown>): DesktopTerminalConfig {
  const raw = normalizeJsonObject(settings.desktopTerminal) ?? {}
  return {
    ...(typeof raw.startupShell === 'string' ? { startupShell: raw.startupShell } : {}),
    ...(typeof raw.customShellPath === 'string' ? { customShellPath: raw.customShellPath } : {}),
    ...(typeof raw.bashPath === 'string' ? { bashPath: raw.bashPath } : {}),
  }
}

export function isExecutable(filePath: string): boolean {
  if (!path.isAbsolute(filePath)) return false
  try {
    if (!statSync(filePath).isFile()) return false
    if (process.platform !== 'win32') accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function detectPosixShell(
  macos: boolean,
  envShell: string | undefined,
  accountShell: string | undefined,
  executable: (filePath: string) => boolean,
): string {
  const found = [envShell, accountShell]
    .map((shell) => shell?.trim())
    .find((shell): shell is string => Boolean(shell) && executable(shell!))
  return found ?? (macos ? '/bin/zsh' : '/bin/bash')
}

export function shellSearchDirs(macos: boolean, pathValue: string | undefined): string[] {
  return [
    ...(macos ? ['/opt/homebrew/bin', '/usr/local/bin'] : []),
    ...(pathValue ?? '').split(path.posix.delimiter).filter((dir) => path.posix.isAbsolute(dir)),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
}

export function resolvePosixOverride(
  choice: string,
  customPath: string | undefined,
  searchDirs: string[],
  executable: (filePath: string) => boolean,
): string | null {
  if (choice === 'zsh' || choice === 'bash' || choice === 'fish') {
    const found = searchDirs.map((dir) => path.posix.join(dir, choice)).find(executable)
    if (!found) throw new Error(`terminal shell ${choice} is not installed or executable`)
    return found
  }
  if (choice === 'custom') {
    const trimmed = (customPath ?? '').trim()
    if (!executable(trimmed)) {
      throw new Error(`custom terminal shell must be an absolute executable path: ${trimmed}`)
    }
    return trimmed
  }
  return null
}

export function resolveWindowsOverride(choice: string, customPath: string | undefined): string | null {
  switch (choice) {
    case 'pwsh':
      return 'pwsh.exe'
    case 'powershell':
      return 'powershell.exe'
    case 'cmd':
      return 'cmd.exe'
    case 'custom': {
      const trimmed = (customPath ?? '').trim()
      if (!trimmed) throw new Error('custom terminal shell path is empty')
      return trimmed
    }
    default:
      return null
  }
}

export function resolveShellOverride(platform: TerminalPlatform, config: DesktopTerminalConfig): string | null {
  const choice = config.startupShell?.trim()
  if (!choice) return null
  if (platform === 'windows') return resolveWindowsOverride(choice, config.customShellPath)
  return resolvePosixOverride(
    choice,
    config.customShellPath,
    shellSearchDirs(platform === 'macos', process.env.PATH),
    isExecutable,
  )
}

function readAccountShell(): string | undefined {
  try {
    return userInfo().shell ?? undefined
  } catch (error) {
    console.warn('[terminal] Could not read the account shell', error)
    return undefined
  }
}

export function defaultShell(platform: TerminalPlatform, bashPath: string | null | undefined): string {
  if (platform === 'windows') {
    const trimmed = bashPath?.trim()
    if (trimmed && isFile(trimmed)) return trimmed
    return process.env.COMSPEC || 'powershell.exe'
  }
  const envShell = process.env.SHELL
  const accountShell = envShell && isExecutable(envShell.trim()) ? undefined : readAccountShell()
  return detectPosixShell(platform === 'macos', envShell, accountShell, isExecutable)
}

export function selectShell(systemDefault: string, resolveOverride: () => string | null): ShellSelection {
  try {
    return { shell: resolveOverride() ?? systemDefault, warning: null, systemDefault }
  } catch (error) {
    return { shell: systemDefault, warning: errorMessage(error), systemDefault }
  }
}

export function resolveTerminalShell(platform: TerminalPlatform, config: DesktopTerminalConfig): ShellSelection {
  return selectShell(defaultShell(platform, config.bashPath), () => resolveShellOverride(platform, config))
}

export function spawnWithFallback<T>(
  selection: ShellSelection,
  spawn: (shell: string) => T,
): { child: T; selection: ShellSelection } {
  try {
    return { child: spawn(selection.shell), selection }
  } catch (error) {
    if (selection.shell === selection.systemDefault) {
      throw new Error(`spawn terminal shell ${selection.shell}: ${errorMessage(error)}`)
    }
    const fallback: ShellSelection = {
      ...selection,
      shell: selection.systemDefault,
      warning: `could not start ${selection.shell}: ${errorMessage(error)}`,
    }
    try {
      return { child: spawn(fallback.shell), selection: fallback }
    } catch (fallbackError) {
      throw new Error(`spawn fallback shell ${fallback.shell}: ${errorMessage(fallbackError)}`)
    }
  }
}

export function normalizeBashPath(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (!isFile(trimmed)) throw new Error(`terminal bash path does not exist: ${trimmed}`)
  return trimmed
}

export function resolveTerminalCwd(cwd: string | undefined): string {
  const requested = cwd?.trim()
  const resolved = requested || getConfigDirOverride() || homedir() || process.cwd()
  if (!isDirectory(resolved)) throw new Error(`terminal cwd does not exist: ${resolved}`)
  return resolved
}

export function isUtf8Locale(value: string): boolean {
  return value.trim().toLowerCase().replaceAll('-', '').includes('utf8')
}

export function defaultUtf8Locale(platform: TerminalPlatform): string {
  return platform === 'macos' ? 'en_US.UTF-8' : 'C.UTF-8'
}

export function ensureUtf8Locale(env: Record<string, string>, platform: TerminalPlatform): void {
  for (const key of ['LANG', 'LC_CTYPE', 'LC_ALL']) {
    const value = env[key]
    if (value === undefined || !isUtf8Locale(value)) env[key] = defaultUtf8Locale(platform)
  }
}

export function parseEnvBlock(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const entry of text.split('\0')) {
    const equals = entry.indexOf('=')
    if (equals <= 0) continue
    env[entry.slice(0, equals)] = entry.slice(equals + 1)
  }
  return env
}

async function loginShellEnvironment(shell: string): Promise<Record<string, string>> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([shell, '-l', '-c', 'env -0'], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' })
  } catch (error) {
    console.warn(`[terminal] Could not read the login environment of ${shell}`, error)
    return {}
  }
  const read = Promise.all([new Response(proc.stdout as ReadableStream).text(), proc.exited])
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      proc.kill()
      resolve(null)
    }, LOGIN_ENV_TIMEOUT_MS)
  })
  try {
    const result = await Promise.race([read, timedOut])
    if (!result) {
      console.warn(`[terminal] Timed out reading the login environment of ${shell}`)
      read.catch((error) => console.warn(`[terminal] Login environment read of ${shell} failed after the timeout`, error))
      return {}
    }
    const [output, code] = result
    return code === 0 ? parseEnvBlock(output) : {}
  } finally {
    clearTimeout(timer)
  }
}

export async function shellEnvironment(
  shell: string,
  platform: TerminalPlatform,
  base: Record<string, string | undefined> = process.env,
): Promise<Record<string, string>> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value
  }
  if (platform !== 'windows') {
    Object.assign(env, await loginShellEnvironment(shell))
    env.SHELL = shell
  }
  ensureUtf8Locale(env, platform)
  return env
}

export async function desktopSidecarEnvironment(
  base: Record<string, string | undefined>,
  launcherKeys: readonly string[],
): Promise<Record<string, string>> {
  const platform = currentTerminalPlatform()
  const env = await shellEnvironment(defaultShell(platform, undefined), platform, base)
  for (const key of launcherKeys) {
    const value = base[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

export async function terminalEnvironment(shell: string, platform: TerminalPlatform): Promise<Record<string, string>> {
  return { ...await shellEnvironment(shell, platform), TERM: 'xterm-256color', COLORTERM: 'truecolor' }
}

export async function startTerminal(options: StartTerminalOptions): Promise<TerminalProcess> {
  const platform = currentTerminalPlatform()
  const cwd = resolveTerminalCwd(options.cwd)
  const initial = resolveTerminalShell(platform, options.config)
  const env = await terminalEnvironment(initial.shell, platform)
  const decoder = new TextDecoder()
  let resolvePtyClosed: () => void = () => {}
  const ptyClosed = new Promise<void>((resolve) => { resolvePtyClosed = resolve })

  const { child, selection } = spawnWithFallback(initial, (shell) => Bun.spawn([shell], {
    cwd,
    env: { ...env, ...(platform !== 'windows' ? { SHELL: shell } : {}) },
    terminal: {
      cols: Math.max(options.cols, MIN_COLS),
      rows: Math.max(options.rows, MIN_ROWS),
      data: (_terminal, chunk) => {
        const text = decoder.decode(chunk, { stream: true })
        if (text) options.onData(text)
      },
      exit: () => resolvePtyClosed(),
    },
  }))
  const terminal = child.terminal!

  void child.exited.then(async (code) => {
    await Promise.race([ptyClosed, Bun.sleep(PTY_DRAIN_TIMEOUT_MS)])
    const rest = decoder.decode()
    if (rest) options.onData(rest)
    if (!terminal.closed) terminal.close()
    options.onExit({ code, signal: child.signalCode ?? null })
  })

  return {
    shell: selection.shell,
    cwd,
    warning: selection.warning,
    write: (data) => {
      terminal.write(data)
    },
    resize: (cols, rows) => {
      terminal.resize(Math.max(cols, MIN_COLS), Math.max(rows, MIN_ROWS))
    },
    kill: () => {
      child.kill(platform === 'windows' ? undefined : 'SIGHUP')
    },
  }
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
