/**
 * Computer Use API — settings-page backend for cua-driver.
 *
 *   GET  /api/computer-use/status
 *   POST /api/computer-use/install
 *   POST /api/computer-use/permissions/grant
 *   GET  /api/computer-use/doctor
 *   GET  /api/computer-use/config
 *   PUT  /api/computer-use/config
 *   POST /api/computer-use/telemetry/disable
 *   POST /api/computer-use/open-settings
 *   POST /api/computer-use/legacy-runtime/cleanup
 */
import { lstat, readdir, rm, rmdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { CUA_MCP_SERVER_NAME } from '../../utils/computerUse/common.js'
import {
  loadStoredComputerUseConfig,
  normalizeDriverPath,
  saveStoredComputerUseConfig,
  type ComputerUseConfig,
} from '../../utils/computerUse/preauthorizedConfig.js'
import {
  getCuaDriverService,
  type CuaDriverService,
  type CuaDriverStatus,
} from '../services/cuaDriverService.js'

export type McpConflicts = {
  /** The user configured a server named `cua`; the built-in one overrides it. */
  reservedName: boolean
  /** Other user-configured servers whose command points at cua-driver. */
  duplicates: string[]
}

export type LegacyRuntime = {
  present: boolean
  path: string
  bytes: number
}

export type ComputerUseStatusResponse = CuaDriverStatus & {
  enabled: boolean
  driverPath: string | null
  conflicts: McpConflicts
  legacyRuntime: LegacyRuntime
}

type Deps = {
  service: () => CuaDriverService
  loadMcpServers: () => Promise<Record<string, ScopedMcpServerConfig>>
  legacyRuntimeDir: () => string
  openUrl: (url: string) => Promise<void>
}

const defaultDeps: Deps = {
  service: getCuaDriverService,
  loadMcpServers: async () => {
    const { enableConfigs } = await import('../../utils/config.js')
    const { getAllMcpConfigs } = await import('../../services/mcp/config.js')
    enableConfigs()
    return (await getAllMcpConfigs()).servers
  },
  legacyRuntimeDir: () => join(getClaudeConfigHomeDir(), '.runtime'),
  openUrl: async url => {
    const command =
      process.platform === 'darwin'
        ? ['open', url]
        : process.platform === 'win32'
          ? ['cmd', '/c', 'start', '', url]
          : ['xdg-open', url]
    await Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' }).exited
  },
}

let deps: Deps = defaultDeps

/** Test hook: swap dependencies, returns a restore function. */
export function __setComputerUseApiDepsForTests(overrides: Partial<Deps>): () => void {
  const previous = deps
  deps = { ...deps, ...overrides }
  return () => {
    deps = previous
  }
}

// ---------------------------------------------------------------------------
// MCP conflicts

function looksLikeCuaDriver(config: ScopedMcpServerConfig): boolean {
  if (config.type && config.type !== 'stdio') return false
  const command = (config as { command?: unknown }).command
  if (typeof command !== 'string') return false
  const name = basename(command.replace(/\\/g, '/')).toLowerCase()
  return name === 'cua-driver' || name === 'cua-driver.exe'
}

export function findMcpConflicts(servers: Record<string, ScopedMcpServerConfig>): McpConflicts {
  const conflicts: McpConflicts = { reservedName: false, duplicates: [] }
  for (const [name, config] of Object.entries(servers)) {
    // The built-in entry is only ever added at CLI startup with scope 'dynamic'.
    if (config.scope === 'dynamic') continue
    if (name === CUA_MCP_SERVER_NAME) {
      conflicts.reservedName = true
    } else if (looksLikeCuaDriver(config)) {
      conflicts.duplicates.push(name)
    }
  }
  conflicts.duplicates.sort()
  return conflicts
}

async function loadConflicts(): Promise<McpConflicts> {
  try {
    return findMcpConflicts(await deps.loadMcpServers())
  } catch {
    return { reservedName: false, duplicates: [] }
  }
}

// ---------------------------------------------------------------------------
// Legacy Python runtime (`<config>/.runtime`)

/** Files the Python-based Computer Use wrote into `.runtime`. */
const LEGACY_RUNTIME_ENTRIES = [
  'venv',
  'requirements.txt',
  'requirements.sha256',
  'venv-base-interpreter.txt',
  'mac_helper.py',
  'win_helper.py',
  'uia_helper.py',
]

async function sizeOf(path: string): Promise<number> {
  let stat
  try {
    stat = await lstat(path)
  } catch {
    return 0
  }
  if (!stat.isDirectory()) return stat.size
  let total = 0
  for (const entry of await readdir(path).catch(() => [] as string[])) {
    total += await sizeOf(join(path, entry))
  }
  return total
}

async function inspectLegacyRuntime(): Promise<LegacyRuntime> {
  const dir = deps.legacyRuntimeDir()
  let bytes = 0
  let present = false
  for (const entry of LEGACY_RUNTIME_ENTRIES) {
    const target = join(dir, entry)
    try {
      await lstat(target)
      present = true
      bytes += await sizeOf(target)
    } catch {}
  }
  return { present, path: dir, bytes }
}

async function removeLegacyRuntime(): Promise<LegacyRuntime> {
  const dir = deps.legacyRuntimeDir()
  for (const entry of LEGACY_RUNTIME_ENTRIES) {
    await rm(join(dir, entry), { recursive: true, force: true })
  }
  // Only removes the directory when nothing else is left in it.
  await rmdir(dir).catch(() => {})
  return inspectLegacyRuntime()
}

// ---------------------------------------------------------------------------
// Handlers

async function buildStatus(config: ComputerUseConfig): Promise<ComputerUseStatusResponse> {
  const [status, conflicts, legacyRuntime] = await Promise.all([
    deps.service().getStatus(config),
    loadConflicts(),
    inspectLegacyRuntime(),
  ])
  return {
    ...status,
    enabled: config.enabled,
    driverPath: config.driverPath,
    conflicts,
    legacyRuntime,
  }
}

async function requireDriverPath(): Promise<string | Response> {
  const config = await loadStoredComputerUseConfig()
  const resolved = await deps.service().resolvePath(config)
  if (!resolved) {
    return Response.json(
      { error: 'CUA_DRIVER_NOT_FOUND', message: 'cua-driver is not installed or the configured path does not exist' },
      { status: 409 },
    )
  }
  return resolved.path
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const SETTINGS_PANES: Record<string, string> = {
  Privacy_Accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  Privacy_ScreenCapture: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
}

export async function handleComputerUseApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  const action = segments.slice(2).join('/')

  if (action === 'status' && req.method === 'GET') {
    return Response.json(await buildStatus(await loadStoredComputerUseConfig()))
  }

  if (action === 'install' && req.method === 'POST') {
    const service = deps.service()
    if (!service.platformSupported) {
      return Response.json(
        { error: 'UNSUPPORTED_PLATFORM', message: `Computer Use is not supported on ${process.platform}` },
        { status: 400 },
      )
    }
    const body = (await readJson(req)) ?? {}
    // The settings switch asks to turn Computer Use on once the install
    // succeeds; doing it here survives the page being closed meanwhile.
    const onInstalled =
      body.enableOnSuccess === true
        ? async () => {
            const config = await loadStoredComputerUseConfig()
            await saveStoredComputerUseConfig({ ...config, enabled: true })
          }
        : undefined
    return Response.json(service.startInstall({ onInstalled }), { status: 202 })
  }

  if (action === 'config' && req.method === 'GET') {
    return Response.json(await loadStoredComputerUseConfig())
  }

  if (action === 'config' && req.method === 'PUT') {
    const body = await readJson(req)
    if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    const config = await loadStoredComputerUseConfig()
    if ('enabled' in body) {
      if (typeof body.enabled !== 'boolean') {
        return Response.json({ error: '"enabled" must be a boolean' }, { status: 400 })
      }
      config.enabled = body.enabled
    }
    if ('driverPath' in body) config.driverPath = normalizeDriverPath(body.driverPath)
    await saveStoredComputerUseConfig(config)
    return Response.json(config)
  }

  if (action === 'permissions/grant' && req.method === 'POST') {
    if (process.platform !== 'darwin') {
      return Response.json(
        { error: 'UNSUPPORTED_PLATFORM', message: 'Permission requests are only needed on macOS' },
        { status: 400 },
      )
    }
    const path = await requireDriverPath()
    if (path instanceof Response) return path
    const service = deps.service()
    const result = await service.requestPermissions(path)
    return Response.json({
      ok: result.code === 0,
      output: [result.stdout, result.stderr].filter(Boolean).join('\n'),
      permissions: await service.getPermissions(path),
    })
  }

  if (action === 'doctor' && req.method === 'GET') {
    const path = await requireDriverPath()
    if (path instanceof Response) return path
    const result = await deps.service().doctor(path)
    return Response.json({
      ok: result.code === 0,
      output: [result.stdout, result.stderr].filter(Boolean).join('\n'),
    })
  }

  if (action === 'telemetry/disable' && req.method === 'POST') {
    const path = await requireDriverPath()
    if (path instanceof Response) return path
    return Response.json({ telemetry: await deps.service().disableTelemetry(path) })
  }

  if (action === 'open-settings' && req.method === 'POST') {
    const body = (await readJson(req)) ?? {}
    const pane = typeof body.pane === 'string' ? body.pane : 'Privacy_Accessibility'
    if (process.platform !== 'darwin') {
      return Response.json({ error: 'Unsupported platform' }, { status: 400 })
    }
    const url = SETTINGS_PANES[pane]
    if (!url) return Response.json({ error: 'Invalid pane' }, { status: 400 })
    await deps.openUrl(url)
    return Response.json({ ok: true })
  }

  if (action === 'legacy-runtime/cleanup' && req.method === 'POST') {
    return Response.json(await removeLegacyRuntime())
  }

  return Response.json(
    { error: 'NOT_FOUND', message: `Unknown computer-use action: ${action}` },
    { status: 404 },
  )
}
