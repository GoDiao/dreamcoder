import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

import { resolveClaudeCliLauncher } from '../../utils/desktopBundledCli.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { getShellConfigPaths } from '../../utils/shellConfig.js'
import { getUserBinDir } from '../../utils/xdg.js'

const DESKTOP_CLI_NAME = 'dreamcoder'
const DESKTOP_CLI_WINDOWS_LEGACY_EXE = `${DESKTOP_CLI_NAME}.exe`
const PATH_BLOCK_START = '# >>> DreamCoder PATH >>>'
const PATH_BLOCK_END = '# <<< DreamCoder PATH <<<'
const WINDOWS_PATH_TARGET = 'Windows User PATH'
const WINDOWS_USER_BIN_EXPR = '%USERPROFILE%\\.local\\bin'

export type DesktopCliLauncherStatus = {
  supported: boolean
  command: string
  installed: boolean
  launcherPath: string
  binDir: string
  pathConfigured: boolean
  pathInCurrentShell: boolean
  availableInNewTerminals: boolean
  needsTerminalRestart: boolean
  configTarget: string | null
  lastError: string | null
}

let inFlightEnsure: Promise<DesktopCliLauncherStatus> | null = null

export function getDesktopCliCommandName(
  platform: NodeJS.Platform = process.platform,
) {
  return platform === 'win32' ? `${DESKTOP_CLI_NAME}.cmd` : DESKTOP_CLI_NAME
}

export function resolveHomeDir(env: NodeJS.ProcessEnv = process.env) {
  return env.HOME || env.USERPROFILE || homedir()
}

export function isPathEntryPresent(
  pathValue: string | undefined,
  targetDir: string,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = resolveHomeDir(),
) {
  if (!pathValue) return false

  if (platform === 'win32') {
    const normalizedTarget = normalizeWindowsPathEntry(targetDir, homeDir)
    return pathValue
      .split(';')
      .map((entry) => normalizeWindowsPathEntry(entry, homeDir))
      .some((entry) => entry === normalizedTarget)
  }

  const normalizedTarget = resolve(targetDir)
  return pathValue
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => {
      try {
        return resolve(entry) === normalizedTarget
      } catch {
        return false
      }
    })
}

export function upsertManagedPathBlock(
  existingContent: string,
  block: string,
): string {
  const escapedStart = PATH_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedEnd = PATH_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`, 'm')
  const nextBlock = `${block.trimEnd()}\n`

  if (pattern.test(existingContent)) {
    return existingContent.replace(pattern, nextBlock)
  }

  const trimmed = existingContent.trimEnd()
  if (!trimmed) {
    return nextBlock
  }

  return `${trimmed}\n\n${nextBlock}`
}

export function buildManagedPathBlock(
  shellType: 'zsh' | 'bash' | 'fish',
  binDir: string,
  homeDir: string = resolveHomeDir(),
) {
  const defaultBinDir = join(homeDir, '.local', 'bin')
  const pathExpr = resolve(binDir) === resolve(defaultBinDir) ? '$HOME/.local/bin' : binDir

  if (shellType === 'fish') {
    return [
      PATH_BLOCK_START,
      `if not contains "${pathExpr}" $PATH`,
      `  set -gx PATH "${pathExpr}" $PATH`,
      'end',
      PATH_BLOCK_END,
    ].join('\n')
  }

  return [
    PATH_BLOCK_START,
    `export PATH="${pathExpr}:$PATH"`,
    PATH_BLOCK_END,
  ].join('\n')
}

export async function ensureDesktopCliLauncherInstalled(): Promise<DesktopCliLauncherStatus> {
  if (inFlightEnsure) {
    return inFlightEnsure
  }

  const promise = ensureDesktopCliLauncherInstalledImpl()
  inFlightEnsure = promise

  try {
    return await promise
  } finally {
    if (inFlightEnsure === promise) {
      inFlightEnsure = null
    }
  }
}

async function ensureDesktopCliLauncherInstalledImpl(): Promise<DesktopCliLauncherStatus> {
  const homeDir = resolveHomeDir()
  const binDir = getUserBinDir({ homedir: homeDir })
  const launcherPath = join(binDir, getDesktopCliCommandName())
  const sourcePath = resolveBundledSidecarSourcePath()

  if (!sourcePath) {
    return buildStatus({
      supported: false,
      launcherPath,
      binDir,
      command: DESKTOP_CLI_NAME,
      installed: false,
      pathConfigured: false,
      pathInCurrentShell: isPathEntryPresent(process.env.PATH, binDir),
      configTarget: null,
      lastError: null,
    })
  }

  let lastError: string | null = null

  try {
    await syncLauncher(sourcePath, launcherPath)
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
  }

  const installed = await isUsableLauncher(launcherPath)
  const currentPathReady = isPathEntryPresent(process.env.PATH, binDir)

  let pathConfigured = currentPathReady
  let configTarget: string | null = null

  try {
    if (process.platform === 'win32') {
      const windowsResult = await ensureWindowsUserPathConfigured(binDir, homeDir)
      pathConfigured = currentPathReady || windowsResult.pathConfigured
      configTarget = windowsResult.configTarget
      lastError ||= windowsResult.lastError
    } else {
      const unixResult = await ensureUnixShellPathConfigured(binDir, homeDir)
      pathConfigured = currentPathReady || unixResult.pathConfigured
      configTarget = unixResult.configTarget
      lastError ||= unixResult.lastError
    }
  } catch (error) {
    lastError ||= error instanceof Error ? error.message : String(error)
  }

  return buildStatus({
    supported: true,
    command: DESKTOP_CLI_NAME,
    launcherPath,
    binDir,
    installed,
    pathConfigured,
    pathInCurrentShell: currentPathReady,
    configTarget,
    lastError,
  })
}

function buildStatus(
  input: Omit<
    DesktopCliLauncherStatus,
    'availableInNewTerminals' | 'needsTerminalRestart'
  >,
): DesktopCliLauncherStatus {
  const availableInNewTerminals =
    input.installed && (input.pathInCurrentShell || input.pathConfigured)

  return {
    ...input,
    availableInNewTerminals,
    needsTerminalRestart:
      availableInNewTerminals && !input.pathInCurrentShell,
  }
}

function resolveBundledSidecarSourcePath(): string | null {
  const launcher = resolveClaudeCliLauncher({
    cliPath: process.env.CLAUDE_CLI_PATH,
    execPath: process.execPath,
  })

  if (!launcher || launcher.kind !== 'sidecar') {
    return null
  }

  return launcher.command
}

async function syncLauncher(sourcePath: string, targetPath: string) {
  await mkdir(dirname(targetPath), { recursive: true })

  if (process.platform !== 'win32') {
    await syncUnixLauncherWrapper(sourcePath, targetPath)
    return
  }

  await syncWindowsLauncherWrapper(sourcePath, targetPath)
  await removeLegacyWindowsBinaryLauncher(targetPath)
}

async function syncUnixLauncherWrapper(sourcePath: string, targetPath: string) {
  const wrapper = buildUnixLauncherWrapper(sourcePath)

  const existing = await readFile(targetPath, 'utf8').catch(() => null)
  if (existing === wrapper) {
    await chmod(targetPath, 0o755)
    return
  }

  const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`
  await writeFile(tempPath, wrapper, { encoding: 'utf8', mode: 0o755 })

  try {
    await rename(tempPath, targetPath)
    await chmod(targetPath, 0o755)
  } finally {
    await unlink(tempPath).catch(() => undefined)
  }
}

function buildUnixLauncherWrapper(sourcePath: string) {
  const quotedSource = shellSingleQuote(sourcePath)
  const quotedAppRoot = shellSingleQuote(dirname(sourcePath))
  const portableConfigDir = process.env.CLAUDE_CONFIG_DIR
  const configExport = portableConfigDir
    ? `export CLAUDE_CONFIG_DIR=${shellSingleQuote(portableConfigDir)}\n`
    : ''

  return `#!/usr/bin/env bash
set -euo pipefail

SIDECAR=${quotedSource}
APP_ROOT=${quotedAppRoot}
${configExport}

if [[ ! -x "$SIDECAR" ]]; then
  echo "dreamcoder launcher could not find bundled sidecar: $SIDECAR" >&2
  exit 127
fi

# Bun-compiled macOS sidecars can be suspended by job control while reading the
# controlling TTY directly. A nested PTY keeps the terminal foreground handoff
# stable for the interactive TUI; non-interactive commands keep direct exec
# semantics and exit codes.
if [[ "$(uname -s)" == "Darwin" && -t 0 && -t 1 && -x /usr/bin/script ]]; then
  exec /usr/bin/script -q /dev/null "$SIDECAR" cli --app-root "$APP_ROOT" "$@"
fi

exec "$SIDECAR" cli --app-root "$APP_ROOT" "$@"
`
}

async function syncWindowsLauncherWrapper(sourcePath: string, targetPath: string) {
  const wrapper = buildWindowsLauncherWrapper(sourcePath)

  const existing = await readFile(targetPath, 'utf8').catch(() => null)
  if (existing === wrapper) {
    return
  }

  const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`
  await writeFile(tempPath, wrapper, { encoding: 'utf8' })

  try {
    await replaceFile(tempPath, targetPath)
  } finally {
    await unlink(tempPath).catch(() => undefined)
  }
}

export function buildWindowsLauncherWrapper(sourcePath: string) {
  const appRoot = dirname(sourcePath)
  const portableConfigDir = process.env.CLAUDE_CONFIG_DIR
  const configLine = portableConfigDir
    ? `set "CLAUDE_CONFIG_DIR=${portableConfigDir}"\r\n`
    : ''

  return [
    '@echo off',
    'setlocal',
    `set "SIDECAR=${sourcePath}"`,
    `set "APP_ROOT=${appRoot}"`,
    configLine.trimEnd(),
    'if not exist "%SIDECAR%" (',
    '  echo dreamcoder launcher could not find bundled sidecar: %SIDECAR% 1>&2',
    '  exit /b 127',
    ')',
    '"%SIDECAR%" cli --app-root "%APP_ROOT%" %*',
    'exit /b %ERRORLEVEL%',
    '',
  ].filter((line) => line.length > 0).join('\r\n')
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function replaceFile(tempPath: string, targetPath: string) {
  try {
    await unlink(targetPath)
  } catch {
    // noop
  }

  try {
    await rename(tempPath, targetPath)
    return
  } catch {
    // The existing executable may still be in use. Rename it away and retry.
  }

  const backupPath = `${targetPath}.old.${Date.now()}`
  try {
    await rename(targetPath, backupPath)
  } catch {
    // noop
  }

  await rename(tempPath, targetPath)
  await unlink(backupPath).catch(() => undefined)
}

async function removeLegacyWindowsBinaryLauncher(targetPath: string) {
  const legacyPath = join(dirname(targetPath), DESKTOP_CLI_WINDOWS_LEGACY_EXE)
  if (legacyPath === targetPath) return

  try {
    const legacyStats = await stat(legacyPath)
    if (!legacyStats.isFile()) return
  } catch {
    return
  }

  try {
    await unlink(legacyPath)
    return
  } catch {
    // Retry below by renaming the stale executable out of PATHEXT lookup.
  }

  const backupPath = `${legacyPath}.old.${Date.now()}`
  try {
    await rename(legacyPath, backupPath)
  } catch (error) {
    throw new Error(
      `failed to remove legacy Windows launcher ${legacyPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

async function isUsableLauncher(filePath: string) {
  try {
    const fileStats = await stat(filePath)
    return fileStats.isFile() && fileStats.size > 0
  } catch {
    return false
  }
}

async function ensureUnixShellPathConfigured(
  binDir: string,
  homeDir: string,
): Promise<{
  pathConfigured: boolean
  configTarget: string | null
  lastError: string | null
}> {
  const shellType = resolveShellType()
  const configPaths = getShellConfigPaths({ env: process.env, homedir: homeDir })
  const configTarget =
    configPaths[shellType] ??
    (process.platform === 'darwin' ? configPaths.zsh : configPaths.bash)

  if (!configTarget) {
    return {
      pathConfigured: false,
      configTarget: null,
      lastError: 'Could not resolve a shell config file for PATH setup',
    }
  }

  const block = buildManagedPathBlock(shellType, binDir, homeDir)
  const existingContent = await readFile(configTarget, 'utf8').catch(() => '')
  const nextContent = upsertManagedPathBlock(existingContent, block)

  if (nextContent !== existingContent) {
    await mkdir(dirname(configTarget), { recursive: true })
    await writeFile(configTarget, nextContent, 'utf8')
  }

  return {
    pathConfigured: true,
    configTarget,
    lastError: null,
  }
}

async function ensureWindowsUserPathConfigured(
  binDir: string,
  homeDir: string,
): Promise<{
  pathConfigured: boolean
  configTarget: string
  lastError: string | null
}> {
  const userPath = await readWindowsUserPath()
  if (isPathEntryPresent(userPath, binDir, 'win32', homeDir)) {
    return {
      pathConfigured: true,
      configTarget: WINDOWS_PATH_TARGET,
      lastError: null,
    }
  }

  const script = [
    `$bin = [Environment]::ExpandEnvironmentVariables('${WINDOWS_USER_BIN_EXPR}')`,
    `$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')`,
    `$segments = @()`,
    `if ($userPath) { $segments = $userPath.Split(';') | Where-Object { $_ -and $_.Trim() -ne '' } }`,
    `$normalized = $segments | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\\').ToLowerInvariant() }`,
    `if (-not ($normalized -contains $bin.TrimEnd('\\').ToLowerInvariant())) {`,
    `  $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { '${WINDOWS_USER_BIN_EXPR}' } else { '${WINDOWS_USER_BIN_EXPR};' + $userPath }`,
    `  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')`,
    `  $signature = @'`,
    `using System;`,
    `using System.Runtime.InteropServices;`,
    `public static class NativeMethods {`,
    `  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]`,
    `  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);`,
    `}`,
    `'@`,
    `  Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null`,
    `  $HWND_BROADCAST = [IntPtr]0xffff`,
    `  $WM_SETTINGCHANGE = 0x1A`,
    `  $SMTO_ABORTIFHUNG = 0x2`,
    `  $result = [IntPtr]::Zero`,
    `  [void][NativeMethods]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [IntPtr]::Zero, 'Environment', $SMTO_ABORTIFHUNG, 5000, [ref]$result)`,
    `}`,
  ].join('\n')

  const result = await execFileNoThrow(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { useCwd: false },
  )

  if (result.code !== 0) {
    return {
      pathConfigured: false,
      configTarget: WINDOWS_PATH_TARGET,
      lastError:
        result.stderr.trim() ||
        result.stdout.trim() ||
        result.error ||
        'Failed to update Windows user PATH',
    }
  }

  return {
    pathConfigured: true,
    configTarget: WINDOWS_PATH_TARGET,
    lastError: null,
  }
}

function resolveShellType(): 'zsh' | 'bash' | 'fish' {
  const shellPath = process.env.SHELL || ''
  if (shellPath.includes('fish')) return 'fish'
  if (shellPath.includes('bash')) return 'bash'
  if (shellPath.includes('zsh')) return 'zsh'
  return process.platform === 'darwin' ? 'zsh' : 'bash'
}

async function readWindowsUserPath() {
  const result = await execFileNoThrow(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Environment]::GetEnvironmentVariable('Path', 'User')`,
    ],
    { useCwd: false },
  )

  if (result.code !== 0) {
    return ''
  }

  return result.stdout.trim()
}

function normalizeWindowsPathEntry(entry: string, homeDir: string) {
  return entry
    .trim()
    .replace(/^"+|"+$/g, '')
    .replace(/%USERPROFILE%/gi, homeDir)
    .replace(/%HOMEDRIVE%%HOMEPATH%/gi, homeDir)
    .replace(/\//g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase()
}
