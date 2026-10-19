import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import type { CuaDriverService, CuaDriverStatus } from '../services/cuaDriverService.js'

const originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
let configDir: string
let api: typeof import('../api/computer-use.js')
let restoreDeps: (() => void) | null = null
let mcpServers: Record<string, ScopedMcpServerConfig> = {}
let opened: string[] = []

const installedStatus: CuaDriverStatus = {
  platform: 'darwin',
  platformSupported: true,
  state: 'installed',
  verifiedVersion: '0.34.0',
  version: '0.34.0',
  newerThanVerified: false,
  path: '/Applications/CuaDriver.app/Contents/MacOS/cua-driver',
  source: 'existing',
  install: null,
  permissions: { accessibility: 'granted', screenRecording: 'unknown' },
  telemetry: 'disabled',
}

function fakeService(overrides: Partial<CuaDriverService> = {}): CuaDriverService {
  return {
    platformSupported: true,
    getStatus: async () => installedStatus,
    resolvePath: async () => ({ path: installedStatus.path!, origin: 'detected' }),
    startInstall: () => ({ phase: 'downloading', startedAt: 'now', output: [] }),
    requestPermissions: async () => ({ code: 0, stdout: 'granted', stderr: '' }),
    getPermissions: async () => ({ accessibility: 'granted', screenRecording: 'granted' }),
    doctor: async () => ({ code: 0, stdout: 'all good', stderr: '' }),
    disableTelemetry: async () => 'disabled',
    ...overrides,
  } as unknown as CuaDriverService
}

function call(method: string, path: string, body?: unknown): Promise<Response> {
  const url = new URL(`http://localhost/api/computer-use/${path}`)
  return api.handleComputerUseApi(
    new Request(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    url,
    url.pathname.split('/').filter(Boolean),
  )
}

function useService(service: CuaDriverService) {
  restoreDeps?.()
  restoreDeps = api.__setComputerUseApiDepsForTests({
    service: () => service,
    loadMcpServers: async () => mcpServers,
    legacyRuntimeDir: () => join(configDir, '.runtime'),
    openUrl: async url => {
      opened.push(url)
    },
  })
}

beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'dreamcoder-computer-use-api-'))
  process.env.DREAMCODER_CONFIG_DIR = configDir
  api = await import('../api/computer-use.js')
})

beforeEach(async () => {
  process.env.DREAMCODER_CONFIG_DIR = configDir
  await rm(join(configDir, 'dreamcoder'), { recursive: true, force: true })
  await rm(join(configDir, '.runtime'), { recursive: true, force: true })
  mcpServers = {}
  opened = []
  useService(fakeService())
})

afterEach(() => {
  restoreDeps?.()
  restoreDeps = null
})

afterAll(async () => {
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await rm(configDir, { recursive: true, force: true })
})

describe('Computer Use config', () => {
  it('is off by default', async () => {
    const res = await call('GET', 'config')
    expect(await res.json()).toEqual({ enabled: false, driverPath: null })
  })

  it('persists enabled and the custom path, dropping legacy fields', async () => {
    await mkdir(join(configDir, 'dreamcoder'), { recursive: true })
    await writeFile(
      join(configDir, 'dreamcoder', 'computer-use-config.json'),
      JSON.stringify({ enabled: true, mode: 'vision', authorizedApps: [], pythonPath: '/py' }),
    )
    const res = await call('PUT', 'config', { driverPath: '  /opt/cua-driver ' })
    expect(await res.json()).toEqual({ enabled: true, driverPath: '/opt/cua-driver' })
    const raw = JSON.parse(
      await readFile(join(configDir, 'dreamcoder', 'computer-use-config.json'), 'utf8'),
    )
    expect(raw).toEqual({ enabled: true, driverPath: '/opt/cua-driver' })
  })

  it('rejects a non-boolean enabled', async () => {
    const res = await call('PUT', 'config', { enabled: 'yes' })
    expect(res.status).toBe(400)
  })
})

describe('Computer Use status', () => {
  it('combines driver status, config, conflicts and legacy runtime', async () => {
    mcpServers = {
      cua: { type: 'stdio', command: 'node', args: [], scope: 'user' },
      'cua-computer-use': {
        type: 'stdio',
        command: '/Users/me/.local/bin/cua-driver',
        args: ['mcp'],
        scope: 'local',
      },
      github: { type: 'http', url: 'https://example.com', scope: 'user' },
    } as Record<string, ScopedMcpServerConfig>
    await mkdir(join(configDir, '.runtime', 'venv'), { recursive: true })
    await writeFile(join(configDir, '.runtime', 'venv', 'x'), '12345')

    const body = await (await call('GET', 'status')).json()
    expect(body).toMatchObject({
      state: 'installed',
      enabled: false,
      driverPath: null,
      conflicts: { reservedName: true, duplicates: ['cua-computer-use'] },
      legacyRuntime: { present: true, bytes: 5 },
    })
  })

  it('ignores the built-in dynamic entry when looking for conflicts', () => {
    expect(
      api.findMcpConflicts({
        cua: { type: 'stdio', command: '/x/cua-driver', args: ['mcp'], scope: 'dynamic' },
      } as Record<string, ScopedMcpServerConfig>),
    ).toEqual({ reservedName: false, duplicates: [] })
  })

  it('detects cua-driver.exe on Windows paths', () => {
    expect(
      api.findMcpConflicts({
        mine: { type: 'stdio', command: 'C:\\tools\\cua-driver.exe', args: [], scope: 'user' },
      } as Record<string, ScopedMcpServerConfig>).duplicates,
    ).toEqual(['mine'])
  })

  it('still answers when MCP configs cannot be read', async () => {
    restoreDeps?.()
    restoreDeps = api.__setComputerUseApiDepsForTests({
      service: () => fakeService(),
      loadMcpServers: async () => {
        throw new Error('broken config')
      },
      legacyRuntimeDir: () => join(configDir, '.runtime'),
    })
    const body = await (await call('GET', 'status')).json()
    expect(body.conflicts).toEqual({ reservedName: false, duplicates: [] })
    expect(body.legacyRuntime.present).toBe(false)
  })
})

describe('Computer Use actions', () => {
  it('starts an install and returns progress', async () => {
    const res = await call('POST', 'install')
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ phase: 'downloading' })
  })

  it('refuses to install on unsupported platforms', async () => {
    useService(fakeService({ platformSupported: false } as Partial<CuaDriverService>))
    expect((await call('POST', 'install')).status).toBe(400)
  })

  it('returns doctor output', async () => {
    expect(await (await call('GET', 'doctor')).json()).toEqual({ ok: true, output: 'all good' })
  })

  it('reports a missing driver for driver commands', async () => {
    useService(fakeService({ resolvePath: async () => null }))
    const res = await call('GET', 'doctor')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('CUA_DRIVER_NOT_FOUND')
  })

  it('disables telemetry', async () => {
    expect(await (await call('POST', 'telemetry/disable')).json()).toEqual({ telemetry: 'disabled' })
  })

  it.skipIf(process.platform !== 'darwin')('requests permissions and returns the new state', async () => {
    expect(await (await call('POST', 'permissions/grant')).json()).toEqual({
      ok: true,
      output: 'granted',
      permissions: { accessibility: 'granted', screenRecording: 'granted' },
    })
  })

  it.skipIf(process.platform !== 'darwin')('opens only known settings panes', async () => {
    expect((await call('POST', 'open-settings', { pane: 'Privacy_ScreenCapture' })).status).toBe(200)
    expect(opened).toHaveLength(1)
    expect((await call('POST', 'open-settings', { pane: 'evil;rm -rf' })).status).toBe(400)
    expect(opened).toHaveLength(1)
  })

  it('removes only the legacy Python runtime files', async () => {
    const runtime = join(configDir, '.runtime')
    await mkdir(join(runtime, 'venv', 'bin'), { recursive: true })
    await writeFile(join(runtime, 'venv', 'bin', 'python3'), 'py')
    await writeFile(join(runtime, 'mac_helper.py'), 'helper')
    await writeFile(join(runtime, 'something-else'), 'keep me')

    const body = await (await call('POST', 'legacy-runtime/cleanup')).json()
    expect(body.present).toBe(false)
    expect(await readFile(join(runtime, 'something-else'), 'utf8')).toBe('keep me')
    await expect(stat(join(runtime, 'venv'))).rejects.toThrow()
  })

  it('returns 404 for removed endpoints', async () => {
    for (const path of ['setup', 'apps', 'authorized-apps', 'request-access']) {
      expect((await call('GET', path)).status).toBe(404)
    }
  })
})
