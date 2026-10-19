import { describe, expect, it } from 'bun:test'
import {
  CUA_DRIVER_VERSION,
  CuaDriverService,
  compareVersions,
  defaultDeps,
  getStandardCuaDriverPaths,
  parseCuaDriverVersion,
  parsePermissionsJson,
  parseTelemetryJson,
  resolveCuaDriverPath,
  sha256Hex,
  getInstallerFiles,
  type CommandResult,
  type CuaDriverDeps,
  type InstallerFile,
} from '../services/cuaDriverService.js'

const MAC_APP = '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'

type FakeOptions = {
  platform?: NodeJS.Platform
  executables?: string[]
  env?: Record<string, string>
  version?: string
  downloads?: Record<string, Uint8Array | Error>
  installerCode?: number
  onInstall?: () => void
  telemetry?: 'enabled' | 'disabled'
  permissions?: string
}

function fakeDeps(options: FakeOptions = {}) {
  const executables = new Set(options.executables ?? [])
  const calls: { command: string; args: string[]; env?: Record<string, string> }[] = []
  const written = new Map<string, Uint8Array>()
  const textFiles = new Map<string, string>()
  let telemetry = options.telemetry ?? 'enabled'
  const removed: string[] = []

  const deps: CuaDriverDeps = {
    platform: options.platform ?? 'darwin',
    env: options.env ?? { PATH: '/usr/bin:/bin' },
    homeDir: '/Users/test',
    isExecutable: async path => executables.has(path),
    run: async (command, args, runOptions): Promise<CommandResult> => {
      calls.push({ command, args, env: runOptions?.env })
      if (command === 'bash' || command === 'powershell.exe') {
        runOptions?.onOutput?.('installing...')
        if ((options.installerCode ?? 0) === 0) {
          executables.add(MAC_APP)
          options.onInstall?.()
        }
        return { code: options.installerCode ?? 0, stdout: '', stderr: 'boom' }
      }
      if (args[0] === '--version') {
        return { code: 0, stdout: `cua-driver ${options.version ?? CUA_DRIVER_VERSION}`, stderr: '' }
      }
      if (args[0] === 'telemetry' && args[1] === 'disable') {
        telemetry = 'disabled'
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'telemetry') {
        return { code: 0, stdout: JSON.stringify({ enabled: telemetry === 'enabled' }), stderr: '' }
      }
      if (args[0] === 'permissions') {
        return {
          code: 0,
          stdout: options.permissions ?? JSON.stringify({ accessibility: true, screen_recording: false }),
          stderr: '',
        }
      }
      return { code: 1, stdout: '', stderr: 'unexpected' }
    },
    download: async url => {
      const name = url.split('/').pop()!
      const value = options.downloads?.[name]
      if (value instanceof Error) throw value
      if (!value) throw new Error(`no fixture for ${name}`)
      return value
    },
    makeTempDir: async () => '/tmp/cua-test',
    removeDir: async path => {
      removed.push(path)
    },
    writeFile: async (path, data) => {
      written.set(path, data)
    },
    readTextFile: async path => textFiles.get(path) ?? null,
    writeTextFile: async (path, data) => {
      textFiles.set(path, data)
    },
    networkEnv: async () => ({ HTTPS_PROXY: 'http://proxy:8080' }),
  }
  return { deps, calls, written, textFiles, removed }
}

const MARKER = '/config/cua-driver-install.json'

describe('cua-driver path resolution', () => {
  it('prefers the configured path', async () => {
    const { deps } = fakeDeps({ executables: ['/custom/cua-driver', MAC_APP] })
    expect(await resolveCuaDriverPath({ driverPath: '/custom/cua-driver' }, deps)).toEqual({
      path: '/custom/cua-driver',
      origin: 'custom',
    })
  })

  it('does not fall back when the configured path is missing', async () => {
    const { deps } = fakeDeps({ executables: [MAC_APP] })
    expect(await resolveCuaDriverPath({ driverPath: '/gone/cua-driver' }, deps)).toBeNull()
  })

  it('checks the standard location before PATH', async () => {
    const { deps } = fakeDeps({ executables: ['/usr/bin/cua-driver', MAC_APP] })
    expect(await resolveCuaDriverPath({ driverPath: null }, deps)).toEqual({
      path: MAC_APP,
      origin: 'detected',
    })
  })

  it('falls back to PATH', async () => {
    const { deps } = fakeDeps({ executables: ['/bin/cua-driver'] })
    expect((await resolveCuaDriverPath({ driverPath: null }, deps))?.path).toBe('/bin/cua-driver')
  })

  it('returns null when nothing is installed', async () => {
    const { deps } = fakeDeps()
    expect(await resolveCuaDriverPath({ driverPath: null }, deps)).toBeNull()
  })

  it('knows the Windows and Linux install locations', () => {
    expect(
      getStandardCuaDriverPaths(
        'win32',
        { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local', USERPROFILE: 'C:\\Users\\a' },
        'C:\\Users\\a',
      ),
    ).toEqual([
      'C:\\Users\\a\\AppData\\Local\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe',
      'C:\\Users\\a\\.cua-driver\\packages\\current\\cua-driver.exe',
    ])
    expect(getStandardCuaDriverPaths('linux', {}, '/home/a')).toEqual([
      '/home/a/.local/bin/cua-driver',
    ])
  })
})

describe('cua-driver output parsing', () => {
  it('parses versions', () => {
    expect(parseCuaDriverVersion('cua-driver 0.34.0\n')).toBe('0.34.0')
    expect(parseCuaDriverVersion('garbage')).toBeNull()
  })

  it('compares versions numerically', () => {
    expect(compareVersions('0.34.0', '0.34.0')).toBe(0)
    expect(compareVersions('0.9.0', '0.34.0')).toBeLessThan(0)
    expect(compareVersions('0.35.4', '0.34.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
  })

  it('maps permission booleans to three states', () => {
    expect(parsePermissionsJson('{"accessibility":true,"screen_recording":false}')).toEqual({
      accessibility: 'granted',
      screenRecording: 'denied',
    })
    expect(parsePermissionsJson('{"accessibility":"unknown"}')).toEqual({
      accessibility: 'unknown',
      screenRecording: 'unknown',
    })
    expect(parsePermissionsJson('not json')).toEqual({
      accessibility: 'unknown',
      screenRecording: 'unknown',
    })
  })

  it('parses telemetry status', () => {
    expect(parseTelemetryJson('{"enabled":false,"source":"persisted"}')).toBe('disabled')
    expect(parseTelemetryJson('{"enabled":true}')).toBe('enabled')
    expect(parseTelemetryJson('')).toBe('unknown')
  })
})

describe('CuaDriverService status', () => {
  it('reports not installed', async () => {
    const { deps } = fakeDeps()
    const status = await new CuaDriverService(deps, { markerPath: () => MARKER }).getStatus({ driverPath: null })
    expect(status.state).toBe('not_installed')
    expect(status.platformSupported).toBe(true)
  })

  it('reports a missing configured executable separately', async () => {
    const { deps } = fakeDeps({ executables: [MAC_APP] })
    const status = await new CuaDriverService(deps, { markerPath: () => MARKER }).getStatus({
      driverPath: '/gone/cua-driver',
    })
    expect(status.state).toBe('missing_executable')
    expect(status.source).toBe('custom')
  })

  it('reports an existing install with permissions and telemetry', async () => {
    const { deps, calls } = fakeDeps({ executables: [MAC_APP] })
    const status = await new CuaDriverService(deps, { markerPath: () => MARKER }).getStatus({ driverPath: null })
    expect(status).toMatchObject({
      state: 'installed',
      version: CUA_DRIVER_VERSION,
      newerThanVerified: false,
      source: 'existing',
      path: MAC_APP,
      permissions: { accessibility: 'granted', screenRecording: 'denied' },
      telemetry: 'enabled',
    })
    for (const call of calls) {
      expect(call.env).toMatchObject({ DO_NOT_TRACK: '1', CUA_DRIVER_RS_UPDATE_CHECK: '0' })
    }
  })

  it('flags a newer existing install without treating it as outdated', async () => {
    const { deps } = fakeDeps({ executables: [MAC_APP], version: '0.35.4' })
    const status = await new CuaDriverService(deps, { markerPath: () => MARKER }).getStatus({ driverPath: null })
    expect(status.state).toBe('installed')
    expect(status.newerThanVerified).toBe(true)
  })

  it('reports an older install as outdated', async () => {
    const { deps } = fakeDeps({ executables: [MAC_APP], version: '0.30.1' })
    const status = await new CuaDriverService(deps, { markerPath: () => MARKER }).getStatus({ driverPath: null })
    expect(status.state).toBe('outdated')
  })

  it('has no permission model outside macOS', async () => {
    const exe = '/home/test/.local/bin/cua-driver'
    const { deps } = fakeDeps({ platform: 'linux', executables: [exe] })
    deps.homeDir = '/home/test'
    const status = await new CuaDriverService(deps, { markerPath: () => MARKER }).getStatus({ driverPath: null })
    expect(status.state).toBe('installed')
    expect(status.permissions).toBeNull()
  })

  it('reports unsupported platforms', async () => {
    const { deps } = fakeDeps({ platform: 'freebsd' })
    const status = await new CuaDriverService(deps, { markerPath: () => MARKER }).getStatus({ driverPath: null })
    expect(status.platformSupported).toBe(false)
  })
})

describe('CuaDriverService install', () => {
  const fixture = (name: string) => new TextEncoder().encode(`fixture:${name}`)

  // Installer files whose pinned hashes match the fixture bytes.
  function fixtureFiles(platform: NodeJS.Platform): InstallerFile[] {
    return getInstallerFiles(platform).map(file => ({
      ...file,
      sha256: sha256Hex(fixture(file.name)),
    }))
  }

  function serveFixtures(deps: CuaDriverDeps) {
    deps.download = async url => fixture(url.split('/').pop()!)
  }

  function makeService(deps: CuaDriverDeps, pinned = true) {
    return new CuaDriverService(deps, {
      markerPath: () => MARKER,
      installerFiles: pinned ? fixtureFiles : getInstallerFiles,
    })
  }

  it('pins every installer file by SHA256 to the release tag', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      for (const file of getInstallerFiles(platform)) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(file.url).toContain(`cua-driver-rs-v${CUA_DRIVER_VERSION}`)
      }
    }
  })

  it('aborts before running the installer when a hash does not match', async () => {
    const { deps, calls } = fakeDeps()
    serveFixtures(deps)
    const service = makeService(deps, false)
    service.startInstall()
    const progress = await service.waitForInstall()
    expect(progress?.phase).toBe('failed')
    expect(progress?.error).toContain('SHA256 mismatch for _install-rust.sh')
    expect(calls.some(c => c.command === 'bash')).toBe(false)
  })

  it('reports download failures and cleans up', async () => {
    const { deps, removed } = fakeDeps({
      downloads: { '_install-rust.sh': new Error('ETIMEDOUT') },
    })
    const service = makeService(deps)
    service.startInstall()
    const progress = await service.waitForInstall()
    expect(progress?.phase).toBe('failed')
    expect(progress?.error).toContain('ETIMEDOUT')
    expect(removed).toEqual(['/tmp/cua-test'])
  })

  it('is a singleton while running', async () => {
    const { deps } = fakeDeps()
    let release!: () => void
    deps.download = () =>
      new Promise((_, reject) => {
        release = () => reject(new Error('stop'))
      })
    const service = makeService(deps)
    const first = service.startInstall()
    const second = service.startInstall()
    expect(second).toBe(first)
    expect((await service.getStatus({ driverPath: null })).state).toBe('installing')
    release()
    await service.waitForInstall()
  })

  it('runs the pinned installer with privacy env, then disables telemetry and records the source', async () => {
    const { deps, calls, written, textFiles } = fakeDeps()
    serveFixtures(deps)
    const service = makeService(deps)
    service.startInstall()
    const progress = await service.waitForInstall()
    expect(progress?.error).toBeUndefined()
    expect(progress?.phase).toBe('done')
    expect(progress?.output).toContain('installing...')

    expect([...written.keys()].sort()).toEqual([
      '/tmp/cua-test/_install-common.sh',
      '/tmp/cua-test/_install-rust.sh',
    ])
    const install = calls.find(c => c.command === 'bash')!
    expect(install.args).toEqual(['/tmp/cua-test/_install-rust.sh', '--no-modify-path'])
    expect(install.env).toMatchObject({
      CUA_DRIVER_RS_VERSION: CUA_DRIVER_VERSION,
      CUA_TELEMETRY_ENABLED: '0',
      HTTPS_PROXY: 'http://proxy:8080',
    })
    expect(calls.some(c => c.args.join(' ') === 'telemetry disable')).toBe(true)
    expect(JSON.parse(textFiles.get(MARKER)!)).toMatchObject({
      version: CUA_DRIVER_VERSION,
      path: MAC_APP,
    })

    const status = await service.getStatus({ driverPath: null })
    expect(status.source).toBe('dreamcoder')
    expect(status.telemetry).toBe('disabled')
  })

  it('asks the installer to verify signatures when cosign is available', async () => {
    const { deps, calls } = fakeDeps({ executables: ['/usr/bin/cosign'] })
    serveFixtures(deps)
    const service = makeService(deps)
    service.startInstall()
    await service.waitForInstall()
    expect(calls.find(c => c.command === 'bash')!.args).toContain('--require-signature')
  })

  it('runs onInstalled before reporting done', async () => {
    const { deps } = fakeDeps()
    serveFixtures(deps)
    const service = makeService(deps)
    let called = 0
    service.startInstall({ onInstalled: async () => { called++ } })
    expect((await service.waitForInstall())?.phase).toBe('done')
    expect(called).toBe(1)
  })

  it('fails the install when onInstalled fails', async () => {
    const { deps } = fakeDeps()
    serveFixtures(deps)
    const service = makeService(deps)
    service.startInstall({ onInstalled: async () => { throw new Error('disk full') } })
    const progress = await service.waitForInstall()
    expect(progress?.phase).toBe('failed')
    expect(progress?.error).toContain('could not be turned on: disk full')
  })

  it('does not run onInstalled when the install fails', async () => {
    const { deps } = fakeDeps({ installerCode: 1 })
    serveFixtures(deps)
    const service = makeService(deps)
    let called = 0
    service.startInstall({ onInstalled: async () => { called++ } })
    await service.waitForInstall()
    expect(called).toBe(0)
  })

  it('fails when the installer exits non-zero', async () => {
    const { deps } = fakeDeps({ installerCode: 3 })
    serveFixtures(deps)
    const service = makeService(deps)
    service.startInstall()
    const progress = await service.waitForInstall()
    expect(progress?.phase).toBe('failed')
    expect(progress?.error).toContain('code 3')
    expect(progress?.output.length).toBeGreaterThan(0)
  })

  it('fails when the installed version does not match', async () => {
    const { deps } = fakeDeps({ version: '0.35.0' })
    serveFixtures(deps)
    const service = makeService(deps)
    service.startInstall()
    const progress = await service.waitForInstall()
    expect(progress?.phase).toBe('failed')
    expect(progress?.error).toContain('expected 0.34.0')
  })

  it('passes -NoAutoStart to the Windows installer', async () => {
    const { deps, calls } = fakeDeps({ platform: 'win32', env: { Path: 'C:\\bin' } })
    serveFixtures(deps)
    const service = makeService(deps)
    service.startInstall()
    await service.waitForInstall()
    const install = calls.find(c => c.command === 'powershell.exe')!
    const release = install.args.indexOf('-Release')
    expect(install.args.slice(release, release + 2)).toEqual(['-Release', CUA_DRIVER_VERSION])
    expect(install.args).toContain('-NoAutoStart')
    expect(install.args).toContain('-NoPathUpdate')
  })
})

describe('default command runner', () => {
  it.skipIf(process.platform === 'win32')(
    'stops the whole process group on timeout',
    async () => {
      const duration = `31.${process.pid % 1000}${Date.now() % 1000}`
      const started = Date.now()
      const result = await defaultDeps().run('sh', ['-c', `sleep ${duration} & sleep ${duration}`], {
        timeoutMs: 300,
      })
      expect(result.code).toBe(-1)
      expect(result.stderr).toContain('timed out')
      expect(Date.now() - started).toBeLessThan(5_000)
      await new Promise(resolve => setTimeout(resolve, 200))
      // The backgrounded grandchild was stopped together with its group.
      const ps = Bun.spawnSync(['pgrep', '-f', `sleep ${duration}`])
      expect(new TextDecoder().decode(ps.stdout).trim()).toBe('')
    },
  )

  it('collects output and exit code', async () => {
    const lines: string[] = []
    const result = await defaultDeps().run('sh', ['-c', 'echo one; echo two 1>&2; exit 3'], {
      onOutput: line => lines.push(line),
    })
    expect(result).toEqual({ code: 3, stdout: 'one', stderr: 'two' })
    expect(lines.sort()).toEqual(['one', 'two'])
  })
})
