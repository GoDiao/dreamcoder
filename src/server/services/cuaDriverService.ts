/**
 * CuaDriverService — the only place in DreamCoder that knows about cua-driver
 * (trycua/cua, MIT). It finds an existing install, installs the pinned version
 * through cua's official installer, reads permissions and telemetry state, and
 * runs `doctor`. The CLI imports `resolveCuaDriverPath` directly (no HTTP).
 *
 * Design: docs/computer-use/cua-driver-tech-design.md, ADR-0001 to ADR-0004.
 */
import { createHash } from 'node:crypto'
import { access, constants, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import type { ComputerUseConfig } from '../../utils/computerUse/preauthorizedConfig.js'

/**
 * Version DreamCoder installs, and the minimum it accepts for an existing
 * install (ADR-0001). Bumping it means re-checking the installer hashes below,
 * `CUA_READONLY_TOOLS` and the desktop tool display map.
 */
export const CUA_DRIVER_VERSION = '0.34.0'
export const CUA_DRIVER_RELEASE_TAG = `cua-driver-rs-v${CUA_DRIVER_VERSION}`

/**
 * Installer files, pinned by SHA256 in code rather than checked against the
 * release's own SHA256SUMS, which would only catch a corrupt download.
 * Only the scripts are pinned here: the installer then downloads the platform
 * package and checks it against that release's SHA256SUMS (plus Sigstore when
 * cosign is available), so a replaced release package is not caught without
 * cosign.
 *
 * The installers load a shared helper (`_install-common.*`) from their own
 * directory and otherwise fetch an unpinned copy from cua.ai. We put the
 * pinned copy from the release tag next to them so that fetch never happens.
 */
export type InstallerFile = { name: string; url: string; sha256: string }

const RELEASE_BASE = `https://github.com/trycua/cua/releases/download/${CUA_DRIVER_RELEASE_TAG}`
const TAG_SCRIPTS_BASE = `https://raw.githubusercontent.com/trycua/cua/${CUA_DRIVER_RELEASE_TAG}/libs/cua-driver/scripts`

const UNIX_INSTALLER: InstallerFile[] = [
  {
    name: '_install-rust.sh',
    url: `${RELEASE_BASE}/_install-rust.sh`,
    sha256: '06f239c68ef03d4b57cd04a0eebe228b627003b1856a764abff431600ea2a9d7',
  },
  {
    name: '_install-common.sh',
    url: `${TAG_SCRIPTS_BASE}/_install-common.sh`,
    sha256: '5bc3aa010eb8667a099b582a9ada9a8f93001745b842cc7cf3cc6c472520cf29',
  },
]

const WINDOWS_INSTALLER: InstallerFile[] = [
  {
    name: 'install.ps1',
    url: `${RELEASE_BASE}/install.ps1`,
    sha256: 'f3b32b6e8f95c0540185bf0ed6964f448d855188f0822350a67991e6736e2363',
  },
  {
    name: '_install-common.psm1',
    url: `${TAG_SCRIPTS_BASE}/_install-common.psm1`,
    sha256: '99f34a84ceab04d4b488b1db4d71536c7a7ac7e645ac2ec295b4fd85244085b6',
  },
]

export function getInstallerFiles(platform: NodeJS.Platform): InstallerFile[] {
  return platform === 'win32' ? WINDOWS_INSTALLER : UNIX_INSTALLER
}

/** Keeps cua-driver's telemetry and update check off (ADR-0003). */
export const CUA_DRIVER_PRIVACY_ENV: Readonly<Record<string, string>> = {
  DO_NOT_TRACK: '1',
  CUA_TELEMETRY_ENABLED: '0',
  CUA_DRIVER_RS_TELEMETRY_ENABLED: '0',
  // version_check.rs (0.34.0): 0|false|no|off disables the startup check.
  CUA_DRIVER_RS_UPDATE_CHECK: '0',
}

export type CuaDriverPlatform = 'darwin' | 'win32' | 'linux'

export function isCuaDriverSupportedPlatform(
  platform: NodeJS.Platform,
): platform is CuaDriverPlatform {
  return platform === 'darwin' || platform === 'win32' || platform === 'linux'
}

export type CommandResult = { code: number; stdout: string; stderr: string }

export type CuaDriverDeps = {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  homeDir: string
  isExecutable(path: string): Promise<boolean>
  run(
    command: string,
    args: string[],
    options?: {
      env?: Record<string, string>
      timeoutMs?: number
      onOutput?: (line: string) => void
    },
  ): Promise<CommandResult>
  download(url: string): Promise<Uint8Array>
  makeTempDir(): Promise<string>
  removeDir(path: string): Promise<void>
  writeFile(path: string, data: Uint8Array): Promise<void>
  readTextFile(path: string): Promise<string | null>
  writeTextFile(path: string, data: string): Promise<void>
  /** Extra environment for network access (proxy settings). */
  networkEnv(): Promise<Record<string, string>>
}

// ---------------------------------------------------------------------------
// Path resolution

export type CuaDriverSource = 'custom' | 'existing' | 'dreamcoder'

export function getStandardCuaDriverPaths(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  homeDir: string,
): string[] {
  if (platform === 'darwin') {
    return ['/Applications/CuaDriver.app/Contents/MacOS/cua-driver']
  }
  if (platform === 'win32') {
    const paths: string[] = []
    const localAppData = env.LOCALAPPDATA
    if (localAppData) {
      paths.push(
        winJoin(localAppData, 'Programs', 'Cua', 'cua-driver', 'bin', 'cua-driver.exe'),
      )
    }
    const userProfile = env.USERPROFILE || homeDir
    paths.push(
      winJoin(userProfile, '.cua-driver', 'packages', 'current', 'cua-driver.exe'),
    )
    return paths
  }
  if (platform === 'linux') {
    return [join(homeDir, '.local', 'bin', 'cua-driver')]
  }
  return []
}

function winJoin(...parts: string[]): string {
  return parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p)).join('\\')
}

function getPathCandidates(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  command = 'cua-driver',
): string[] {
  const pathValue = env.PATH ?? env.Path ?? ''
  const sep = platform === 'win32' ? ';' : delimiter
  const name = platform === 'win32' ? `${command}.exe` : command
  return pathValue
    .split(sep)
    .filter(Boolean)
    .map(dir => (platform === 'win32' ? winJoin(dir, name) : join(dir, name)))
}

export type ResolvedCuaDriver = {
  path: string
  /** 'custom' when it came from the config, otherwise found on the machine. */
  origin: 'custom' | 'detected'
}

/**
 * Finds a usable cua-driver executable: the configured path, then the standard
 * install locations, then PATH. A configured path that no longer exists is not
 * silently replaced by another install; the result is null.
 *
 * Local file checks only — no `--version`, no network. Called at CLI startup.
 */
export async function resolveCuaDriverPath(
  config: Pick<ComputerUseConfig, 'driverPath'>,
  deps: Pick<CuaDriverDeps, 'platform' | 'env' | 'homeDir' | 'isExecutable'> = defaultDeps(),
): Promise<ResolvedCuaDriver | null> {
  if (config.driverPath) {
    return (await deps.isExecutable(config.driverPath))
      ? { path: config.driverPath, origin: 'custom' }
      : null
  }
  const candidates = [
    ...getStandardCuaDriverPaths(deps.platform, deps.env, deps.homeDir),
    ...getPathCandidates(deps.platform, deps.env),
  ]
  for (const candidate of candidates) {
    if (await deps.isExecutable(candidate)) {
      return { path: candidate, origin: 'detected' }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Versions

export function parseCuaDriverVersion(output: string): string | null {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/)
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null
}

/** Numeric x.y.z comparison: negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

// ---------------------------------------------------------------------------
// Status types

export type PermissionState = 'granted' | 'denied' | 'unknown'

export type CuaDriverPermissions = {
  accessibility: PermissionState
  screenRecording: PermissionState
}

export type TelemetryState = 'enabled' | 'disabled' | 'unknown'

export type InstallPhase =
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'disabling_telemetry'
  | 'checking_version'
  | 'done'
  | 'failed'

export type InstallProgress = {
  phase: InstallPhase
  startedAt: string
  finishedAt?: string
  /** Last lines the installer printed, newest last. */
  output: string[]
  error?: string
}

export type CuaDriverInstallState =
  | 'not_installed'
  | 'installing'
  | 'installed'
  | 'outdated'
  | 'missing_executable'

export type CuaDriverStatus = {
  platform: NodeJS.Platform
  platformSupported: boolean
  state: CuaDriverInstallState
  verifiedVersion: string
  version: string | null
  newerThanVerified: boolean
  path: string | null
  source: CuaDriverSource | null
  install: InstallProgress | null
  /** null when the platform has no permission model cua-driver reports (Windows, Linux). */
  permissions: CuaDriverPermissions | null
  telemetry: TelemetryState
}

/** Marker DreamCoder writes after it installs cua-driver, to report the source. */
type InstallMarker = { version: string; path: string; installedAt: string }

function getInstallMarkerPath(): string {
  return join(getClaudeConfigHomeDir(), 'dreamcoder', 'cua-driver-install.json')
}

export function parsePermissionsJson(stdout: string): CuaDriverPermissions {
  const toState = (value: unknown): PermissionState =>
    value === true ? 'granted' : value === false ? 'denied' : 'unknown'
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    return {
      accessibility: toState(parsed.accessibility),
      screenRecording: toState(parsed.screen_recording),
    }
  } catch {
    return { accessibility: 'unknown', screenRecording: 'unknown' }
  }
}

export function parseTelemetryJson(stdout: string): TelemetryState {
  try {
    const parsed = JSON.parse(stdout) as { enabled?: unknown }
    if (parsed.enabled === true) return 'enabled'
    if (parsed.enabled === false) return 'disabled'
  } catch {}
  return 'unknown'
}

const MAX_OUTPUT_LINES = 20
const COMMAND_TIMEOUT_MS = 15_000
const INSTALL_TIMEOUT_MS = 10 * 60_000

// ---------------------------------------------------------------------------
// Service

export class CuaDriverService {
  private install: InstallProgress | null = null
  private installPromise: Promise<void> | null = null

  private readonly markerPath: () => string
  private readonly installerFiles: (platform: NodeJS.Platform) => InstallerFile[]

  constructor(
    private readonly deps: CuaDriverDeps = defaultDeps(),
    options: {
      markerPath?: () => string
      installerFiles?: (platform: NodeJS.Platform) => InstallerFile[]
    } = {},
  ) {
    this.markerPath = options.markerPath ?? getInstallMarkerPath
    this.installerFiles = options.installerFiles ?? getInstallerFiles
  }

  get platformSupported(): boolean {
    return isCuaDriverSupportedPlatform(this.deps.platform)
  }

  resolvePath(config: Pick<ComputerUseConfig, 'driverPath'>) {
    return resolveCuaDriverPath(config, this.deps)
  }

  async readVersion(path: string): Promise<string | null> {
    const result = await this.runDriver(path, ['--version'])
    return result.code === 0 ? parseCuaDriverVersion(result.stdout) : null
  }

  async getStatus(config: Pick<ComputerUseConfig, 'driverPath'>): Promise<CuaDriverStatus> {
    const base: CuaDriverStatus = {
      platform: this.deps.platform,
      platformSupported: this.platformSupported,
      state: 'not_installed',
      verifiedVersion: CUA_DRIVER_VERSION,
      version: null,
      newerThanVerified: false,
      path: null,
      source: null,
      install: this.install,
      permissions: null,
      telemetry: 'unknown',
    }
    if (!this.platformSupported) return base

    if (this.install && !isFinished(this.install)) {
      return { ...base, state: 'installing' }
    }

    const resolved = await this.resolvePath(config)
    if (!resolved) {
      return {
        ...base,
        state: config.driverPath ? 'missing_executable' : 'not_installed',
        path: config.driverPath,
        source: config.driverPath ? 'custom' : null,
      }
    }

    const version = await this.readVersion(resolved.path)
    const source = await this.getSource(resolved)
    const [permissions, telemetry] = await Promise.all([
      this.getPermissions(resolved.path),
      this.getTelemetry(resolved.path),
    ])
    const outdated = !version || compareVersions(version, CUA_DRIVER_VERSION) < 0
    return {
      ...base,
      state: outdated ? 'outdated' : 'installed',
      version,
      newerThanVerified: !!version && compareVersions(version, CUA_DRIVER_VERSION) > 0,
      path: resolved.path,
      source,
      permissions,
      telemetry,
    }
  }

  private async getSource(resolved: ResolvedCuaDriver): Promise<CuaDriverSource> {
    if (resolved.origin === 'custom') return 'custom'
    const raw = await this.deps.readTextFile(this.markerPath())
    if (raw) {
      try {
        const marker = JSON.parse(raw) as InstallMarker
        if (marker.path === resolved.path) return 'dreamcoder'
      } catch {}
    }
    return 'existing'
  }

  /** Read-only; never prompts. macOS only — other platforms return null. */
  async getPermissions(path: string): Promise<CuaDriverPermissions | null> {
    if (this.deps.platform !== 'darwin') return null
    const result = await this.runDriver(path, ['permissions', 'status', '--json'])
    if (result.code !== 0) {
      return { accessibility: 'unknown', screenRecording: 'unknown' }
    }
    return parsePermissionsJson(result.stdout)
  }

  /** Asks CuaDriver.app to show the system permission dialogs (macOS). */
  async requestPermissions(path: string): Promise<CommandResult> {
    return this.runDriver(path, ['permissions', 'grant'], 2 * 60_000)
  }

  async getTelemetry(path: string): Promise<TelemetryState> {
    const result = await this.runDriver(path, ['telemetry', 'status', '--json'])
    return result.code === 0 ? parseTelemetryJson(result.stdout) : 'unknown'
  }

  /** Persists telemetry off in ~/.cua-driver/config.json. */
  async disableTelemetry(path: string): Promise<TelemetryState> {
    await this.runDriver(path, ['telemetry', 'disable'])
    return this.getTelemetry(path)
  }

  async doctor(path: string): Promise<CommandResult> {
    return this.runDriver(path, ['doctor'], 60_000)
  }

  /**
   * Starts installing the pinned version and returns immediately. A second
   * call while one is running returns the running install's progress.
   */
  /**
   * `onInstalled` runs after a successful install, before the phase becomes
   * `done`; a failure there fails the install. It is ignored when an install
   * is already running.
   */
  startInstall(options: { onInstalled?: () => Promise<void> } = {}): InstallProgress {
    if (this.installPromise && this.install) return this.install
    if (!this.platformSupported) {
      throw new Error(`cua-driver is not supported on ${this.deps.platform}`)
    }
    this.install = {
      phase: 'downloading',
      startedAt: new Date().toISOString(),
      output: [],
    }
    const progress = this.install
    this.installPromise = this.runInstall(progress, options.onInstalled)
      .then(() => {
        console.log(`[cua-driver] Installed ${CUA_DRIVER_VERSION}`)
      })
      .catch(error => {
        progress.phase = 'failed'
        progress.error = error instanceof Error ? error.message : String(error)
        console.error(`[cua-driver] Install failed: ${progress.error}`)
      })
      .finally(() => {
        progress.finishedAt = new Date().toISOString()
        this.installPromise = null
      })
    return progress
  }

  /** For tests and callers that need to wait for the install to finish. */
  async waitForInstall(): Promise<InstallProgress | null> {
    if (this.installPromise) await this.installPromise
    return this.install
  }

  private async runInstall(
    progress: InstallProgress,
    onInstalled?: () => Promise<void>,
  ): Promise<void> {
    const files = this.installerFiles(this.deps.platform)
    const dir = await this.deps.makeTempDir()
    try {
      const downloaded: { file: InstallerFile; data: Uint8Array }[] = []
      for (const file of files) {
        try {
          downloaded.push({ file, data: await this.deps.download(file.url) })
        } catch (error) {
          throw new Error(
            `Download failed: ${file.url}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }

      progress.phase = 'verifying'
      for (const { file, data } of downloaded) {
        const actual = sha256Hex(data)
        if (actual !== file.sha256) {
          throw new Error(
            `SHA256 mismatch for ${file.name} (expected ${file.sha256}, got ${actual}). ` +
              'The download may be incomplete or tampered with; the installer was not run.',
          )
        }
        await this.deps.writeFile(join(dir, file.name), data)
      }

      progress.phase = 'installing'
      const requireSignature = await this.hasCosign()
      const env: Record<string, string> = {
        ...(await this.deps.networkEnv()),
        ...CUA_DRIVER_PRIVACY_ENV,
        CUA_DRIVER_RS_VERSION: CUA_DRIVER_VERSION,
      }
      const pushLine = (line: string) => {
        const trimmed = line.trimEnd()
        if (!trimmed) return
        progress.output.push(trimmed)
        if (progress.output.length > MAX_OUTPUT_LINES) progress.output.shift()
      }
      const [command, args] =
        this.deps.platform === 'win32'
          ? [
              'powershell.exe',
              [
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                winJoin(dir, 'install.ps1'),
                '-Release',
                CUA_DRIVER_VERSION,
                '-NoPathUpdate',
                '-NoAutoStart',
                ...(requireSignature ? ['-RequireSignature'] : []),
              ],
            ]
          : [
              'bash',
              [
                join(dir, '_install-rust.sh'),
                '--no-modify-path',
                ...(requireSignature ? ['--require-signature'] : []),
              ],
            ]
      const result = await this.deps.run(command, args, {
        env,
        timeoutMs: INSTALL_TIMEOUT_MS,
        onOutput: pushLine,
      })
      if (result.code !== 0) {
        const tail = [...result.stdout.split('\n'), ...result.stderr.split('\n')]
          .map(l => l.trimEnd())
          .filter(Boolean)
          .slice(-MAX_OUTPUT_LINES)
        if (progress.output.length === 0) progress.output.push(...tail)
        throw new Error(`Installer exited with code ${result.code}`)
      }

      progress.phase = 'checking_version'
      const resolved = await resolveCuaDriverPath({ driverPath: null }, this.deps)
      if (!resolved) {
        throw new Error('Installer finished but cua-driver was not found in the standard location')
      }
      const version = await this.readVersion(resolved.path)
      if (version !== CUA_DRIVER_VERSION) {
        throw new Error(
          `Installed cua-driver reports version ${version ?? 'unknown'}, expected ${CUA_DRIVER_VERSION}`,
        )
      }

      progress.phase = 'disabling_telemetry'
      const telemetry = await this.disableTelemetry(resolved.path)
      if (telemetry !== 'disabled') {
        throw new Error(`Could not turn cua-driver telemetry off (status: ${telemetry})`)
      }

      const marker: InstallMarker = {
        version,
        path: resolved.path,
        installedAt: new Date().toISOString(),
      }
      await this.deps.writeTextFile(this.markerPath(), JSON.stringify(marker, null, 2))
      if (onInstalled) {
        try {
          await onInstalled()
        } catch (error) {
          throw new Error(
            `cua-driver was installed, but Computer Use could not be turned on: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }
      progress.phase = 'done'
    } finally {
      await this.deps.removeDir(dir).catch(() => {})
    }
  }

  private async hasCosign(): Promise<boolean> {
    for (const candidate of getPathCandidates(this.deps.platform, this.deps.env, 'cosign')) {
      if (await this.deps.isExecutable(candidate)) return true
    }
    return false
  }

  private async runDriver(path: string, args: string[], timeoutMs = COMMAND_TIMEOUT_MS) {
    const result = await this.deps.run(path, args, { env: { ...CUA_DRIVER_PRIVACY_ENV }, timeoutMs })
    if (result.code !== 0) {
      console.warn(
        `[cua-driver] \`${args.join(' ')}\` exited with ${result.code}: ${result.stderr.slice(0, 300)}`,
      )
    }
    return result
  }
}

function isFinished(progress: InstallProgress): boolean {
  return progress.phase === 'done' || progress.phase === 'failed'
}

// ---------------------------------------------------------------------------
// Default (real) dependencies

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const file = Bun.file(path)
    const stat = await file.stat()
    if (!stat.isFile()) return false
    if (process.platform === 'win32') return true
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    env?: Record<string, string>
    timeoutMs?: number
    onOutput?: (line: string) => void
  } = {},
): Promise<CommandResult> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([command, ...args], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...options.env },
    })
  } catch (error) {
    return {
      code: -1,
      stdout: '',
      stderr: `Failed to run ${command}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  // On timeout, stop waiting for output: grandchildren (e.g. the installer's
  // download) can keep the pipes open after the direct child is killed.
  let timer: ReturnType<typeof setTimeout> | null = null
  const timedOut = new Promise<CommandResult>(resolve => {
    if (!options.timeoutMs) return
    const timeoutMs = options.timeoutMs
    timer = setTimeout(() => {
      proc.kill()
      resolve({ code: -1, stdout: '', stderr: `${command} timed out after ${Math.round(timeoutMs / 1000)}s` })
    }, timeoutMs)
  })
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    let all = ''
    let pending = ''
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true })
      all += text
      if (options.onOutput) {
        pending += text
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ''
        for (const line of lines) options.onOutput(line)
      }
    }
    if (options.onOutput && pending) options.onOutput(pending)
    return all
  }
  const finished = (async (): Promise<CommandResult> => {
    const [stdout, stderr] = await Promise.all([
      collect(proc.stdout as ReadableStream<Uint8Array>),
      collect(proc.stderr as ReadableStream<Uint8Array>),
    ])
    const code = await proc.exited
    return { code, stdout: stdout.trim(), stderr: stderr.trim() }
  })()
  try {
    return await Promise.race([finished, timedOut])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function downloadBytes(url: string): Promise<Uint8Array> {
  const { loadNetworkSettings, getManualNetworkProxyUrl } = await import(
    './networkSettings.js'
  )
  const proxy = getManualNetworkProxyUrl(await loadNetworkSettings())
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
    ...(proxy ? { proxy } : {}),
  } as RequestInit)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export function defaultDeps(): CuaDriverDeps {
  return {
    platform: process.platform,
    env: process.env,
    homeDir: homedir(),
    isExecutable: isExecutableFile,
    run: runCommand,
    download: downloadBytes,
    makeTempDir: () => mkdtemp(join(tmpdir(), 'dreamcoder-cua-install-')),
    removeDir: path => rm(path, { recursive: true, force: true }),
    writeFile: (path, data) => writeFile(path, data),
    readTextFile: path => readFile(path, 'utf8').catch(() => null),
    writeTextFile: async (path, data) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data, 'utf8')
    },
    networkEnv: async () => {
      const { loadNetworkSettings, buildNetworkEnvironment } = await import(
        './networkSettings.js'
      )
      const { API_TIMEOUT_MS: _timeout, ...env } = buildNetworkEnvironment(
        await loadNetworkSettings(),
      )
      return env
    },
  }
}

let sharedService: CuaDriverService | null = null

export function getCuaDriverService(): CuaDriverService {
  sharedService ??= new CuaDriverService()
  return sharedService
}
