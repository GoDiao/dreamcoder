import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  desktopSidecarEnvironment,
  detectPosixShell,
  ensureUtf8Locale,
  isExecutable,
  normalizeBashPath,
  parseEnvBlock,
  readDesktopTerminalConfig,
  resolvePosixOverride,
  resolveTerminalCwd,
  resolveWindowsOverride,
  selectShell,
  shellSearchDirs,
  spawnWithFallback,
  startTerminal,
  type TerminalExit,
} from '../services/terminalService.js'

const posix = process.platform !== 'win32'

let tmpDir = ''
let originalConfigDir: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-service-test-'))
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('shell detection', () => {
  test('prefers a valid environment shell, including fish', () => {
    for (const shell of ['/bin/zsh', '/bin/bash', '/opt/homebrew/bin/fish']) {
      expect(detectPosixShell(true, shell, '/bin/bash', () => true)).toBe(shell)
    }
  })

  test('uses the account shell when the environment shell is missing, blank or stale', () => {
    for (const shell of [undefined, '', '  ', '/missing/fish']) {
      expect(detectPosixShell(false, shell, '/usr/bin/fish', (p) => p === '/usr/bin/fish')).toBe('/usr/bin/fish')
    }
  })

  test('falls back by platform and trims paths', () => {
    expect(detectPosixShell(true, undefined, undefined, () => false)).toBe('/bin/zsh')
    expect(detectPosixShell(false, '/missing', '', () => false)).toBe('/bin/bash')
    expect(detectPosixShell(false, ' /bin/bash ', undefined, () => true)).toBe('/bin/bash')
  })

  test('searches Homebrew first on macOS and only absolute PATH entries', () => {
    const pathValue = ['/bin', '/usr/bin', '/custom/bin', 'relative'].join(path.delimiter)
    const macDirs = shellSearchDirs(true, pathValue)
    const linuxDirs = shellSearchDirs(false, pathValue)
    const installed = (p: string) => ['/bin/bash', '/opt/homebrew/bin/bash'].includes(p)
    expect(resolvePosixOverride('bash', undefined, macDirs, installed)).toBe('/opt/homebrew/bin/bash')
    expect(resolvePosixOverride('bash', undefined, linuxDirs, installed)).toBe('/bin/bash')
    expect(macDirs.every((dir) => path.isAbsolute(dir))).toBe(true)
  })
})

describe('shell overrides', () => {
  test('finds named shells and reports missing installations', () => {
    const dirs = ['/bin', '/opt/homebrew/bin']
    for (const choice of ['bash', 'zsh', 'fish']) {
      const installed = `/opt/homebrew/bin/${choice}`
      expect(resolvePosixOverride(choice, undefined, dirs, (p) => p === installed)).toBe(installed)
    }
    expect(() => resolvePosixOverride('fish', undefined, dirs, () => false)).toThrow('not installed')
  })

  test('validates custom POSIX shells and ignores system or unknown choices', () => {
    expect(resolvePosixOverride('custom', ' /custom/fish ', [], (p) => p === '/custom/fish')).toBe('/custom/fish')
    expect(() => resolvePosixOverride('custom', undefined, [], () => false)).toThrow('absolute executable path')
    for (const choice of ['system', 'pwsh', 'unknown']) {
      expect(resolvePosixOverride(choice, undefined, [], () => false)).toBeNull()
    }
  })

  test('maps Windows choices to executables', () => {
    expect(resolveWindowsOverride('system', undefined)).toBeNull()
    expect(resolveWindowsOverride('pwsh', undefined)).toBe('pwsh.exe')
    expect(resolveWindowsOverride('powershell', undefined)).toBe('powershell.exe')
    expect(resolveWindowsOverride('cmd', undefined)).toBe('cmd.exe')
    expect(resolveWindowsOverride('custom', ' C:\\Tools\\nu.exe ')).toBe('C:\\Tools\\nu.exe')
    expect(() => resolveWindowsOverride('custom', '  ')).toThrow('custom terminal shell path is empty')
  })

  test('reads the terminal settings the desktop app saves', () => {
    expect(readDesktopTerminalConfig({
      desktopTerminal: { startupShell: 'custom', customShellPath: '/bin/sh', bashPath: 'C:\\Git\\bash.exe' },
    })).toEqual({ startupShell: 'custom', customShellPath: '/bin/sh', bashPath: 'C:\\Git\\bash.exe' })
    expect(readDesktopTerminalConfig({})).toEqual({})
    expect(readDesktopTerminalConfig({ desktopTerminal: { bashPath: null, startupShell: 3 } })).toEqual({})
  })
})

describe('shell selection and fallback', () => {
  test('a missing configured shell falls back to the system default with a warning', () => {
    const selection = selectShell('/bin/bash', () => resolvePosixOverride('fish', undefined, [], () => false))
    const { child, selection: selected } = spawnWithFallback(selection, (shell) => shell)
    expect(child).toBe('/bin/bash')
    expect(selected.warning).toContain('fish')
  })

  test('a shell that fails to spawn retries the system default once', () => {
    const attempts: string[] = []
    const { selection } = spawnWithFallback(selectShell('/bin/bash', () => '/custom/fish'), (shell) => {
      attempts.push(shell)
      if (shell === '/custom/fish') throw new Error('executable disappeared')
      return shell
    })
    expect(attempts).toEqual(['/custom/fish', '/bin/bash'])
    expect(selection.shell).toBe('/bin/bash')
    expect(selection.warning).toContain('executable disappeared')
  })

  test('a valid override or the system choice runs without a warning', () => {
    for (const override of [null, '/custom/fish']) {
      const selection = selectShell('/bin/bash', () => override)
      const { selection: selected } = spawnWithFallback(selection, (shell) => shell)
      expect(selected.shell).toBe(override ?? '/bin/bash')
      expect(selected.warning).toBeNull()
    }
  })

  test('a failing system default reports an error without retrying', () => {
    let attempts = 0
    expect(() => spawnWithFallback(selectShell('/missing/bash', () => null), () => {
      attempts += 1
      throw new Error('not found')
    })).toThrow('/missing/bash')
    expect(attempts).toBe(1)
  })
})

describe('paths and environment', () => {
  test('executable check rejects relative, missing, directory and non-executable paths', async () => {
    expect(isExecutable('bash')).toBe(false)
    expect(isExecutable(path.join(tmpDir, 'missing'))).toBe(false)
    expect(isExecutable(tmpDir)).toBe(false)
    if (posix) {
      const plain = path.join(tmpDir, 'plain')
      await fs.writeFile(plain, '')
      expect(isExecutable(plain)).toBe(false)
      expect(isExecutable('/bin/sh')).toBe(true)
    }
  })

  test('bash path normalization clears blanks and rejects missing files', async () => {
    expect(normalizeBashPath('   ')).toBeNull()
    expect(normalizeBashPath(null)).toBeNull()
    expect(() => normalizeBashPath(path.join(tmpDir, 'missing-bash'))).toThrow('terminal bash path does not exist')
    const bash = path.join(tmpDir, 'bash.exe')
    await fs.writeFile(bash, '')
    expect(normalizeBashPath(`  ${bash}  `)).toBe(bash)
  })

  test('cwd defaults to the config directory override, then home', () => {
    process.env.DREAMCODER_CONFIG_DIR = tmpDir
    expect(resolveTerminalCwd(undefined)).toBe(tmpDir)
    expect(resolveTerminalCwd('  ')).toBe(tmpDir)
    delete process.env.DREAMCODER_CONFIG_DIR
    expect(resolveTerminalCwd(undefined)).toBe(os.homedir())
    expect(() => resolveTerminalCwd(path.join(tmpDir, 'missing'))).toThrow('terminal cwd does not exist')
  })

  test('forces a UTF-8 locale only where the shell uses a non-UTF-8 one', () => {
    const cLocale: Record<string, string> = { LANG: 'C', LC_CTYPE: 'POSIX', LC_ALL: 'C' }
    ensureUtf8Locale(cLocale, 'macos')
    expect(cLocale).toEqual({ LANG: 'en_US.UTF-8', LC_CTYPE: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' })
    const utf8: Record<string, string> = { LANG: 'zh_CN.UTF-8', LC_CTYPE: 'en_US.UTF8', LC_ALL: 'C.UTF-8' }
    ensureUtf8Locale(utf8, 'linux')
    expect(utf8).toEqual({ LANG: 'zh_CN.UTF-8', LC_CTYPE: 'en_US.UTF8', LC_ALL: 'C.UTF-8' })
  })

  test('parses a NUL-delimited environment block', () => {
    expect(parseEnvBlock('PATH=/opt/homebrew/bin:/usr/bin\0NODE_PATH=/tmp/node\0EMPTY=\0=skipped\0')).toEqual({
      PATH: '/opt/homebrew/bin:/usr/bin',
      NODE_PATH: '/tmp/node',
      EMPTY: '',
    })
  })
})

describe.skipIf(!posix)('desktop sidecar environment', () => {
  let originalShell: string | undefined

  beforeEach(() => {
    originalShell = process.env.SHELL
  })

  afterEach(() => {
    if (originalShell === undefined) delete process.env.SHELL
    else process.env.SHELL = originalShell
  })

  test('takes the login shell environment but keeps what the launcher set', async () => {
    const shell = path.join(tmpDir, 'login-shell')
    await fs.writeFile(
      shell,
      "#!/bin/sh\nprintf 'PATH=/login/bin\\000DREAMCODER_CONFIG_DIR=/profile/config\\000XDG_CACHE_HOME=/profile/cache\\000LANG=C\\000'\n",
    )
    await fs.chmod(shell, 0o755)
    await Bun.spawn([shell], { stdout: 'ignore' }).exited
    process.env.SHELL = shell

    const env = await desktopSidecarEnvironment(
      { PATH: '/usr/bin', DREAMCODER_CONFIG_DIR: '/launcher/config', KEEP: 'yes' },
      ['DREAMCODER_CONFIG_DIR', 'XDG_CACHE_HOME'],
    )

    expect(env.PATH).toBe('/login/bin')
    expect(env.DREAMCODER_CONFIG_DIR).toBe('/launcher/config')
    expect(env.XDG_CACHE_HOME).toBe('/profile/cache')
    expect(env.KEEP).toBe('yes')
    expect(env.SHELL).toBe(shell)
    expect(env.LANG).toMatch(/UTF-8$/)
  })

  test('stops waiting for the login shell after the timeout even when a child holds its output', async () => {
    const shell = path.join(tmpDir, 'slow-shell')
    await fs.writeFile(shell, '#!/bin/sh\nsleep 4 &\nsleep 4\n')
    await fs.chmod(shell, 0o755)
    process.env.SHELL = shell
    const warn = spyOn(console, 'warn').mockImplementation(() => {})

    const started = Date.now()
    const env = await desktopSidecarEnvironment({ PATH: '/usr/bin' }, [])

    expect(Date.now() - started).toBeLessThan(3500)
    expect(env.PATH).toBe('/usr/bin')
    warn.mockRestore()
  })

  test('keeps the inherited environment when the login shell fails', async () => {
    const shell = path.join(tmpDir, 'broken-shell')
    await fs.writeFile(shell, '#!/bin/sh\nexit 1\n')
    await fs.chmod(shell, 0o755)
    process.env.SHELL = shell

    const env = await desktopSidecarEnvironment({ PATH: '/usr/bin' }, [])

    expect(env.PATH).toBe('/usr/bin')
    expect(env.SHELL).toBe(shell)
  })
})

describe.skipIf(!posix)('PTY terminal', () => {
  function collect() {
    let output = ''
    let resolveExit: (exit: TerminalExit) => void = () => {}
    const exited = new Promise<TerminalExit>((resolve) => { resolveExit = resolve })
    return {
      onData: (data: string) => { output += data },
      onExit: (exit: TerminalExit) => resolveExit(exit),
      output: () => output,
      exited,
    }
  }

  async function waitFor(check: () => boolean) {
    for (let attempt = 0; attempt < 100 && !check(); attempt += 1) await Bun.sleep(20)
    expect(check()).toBe(true)
  }

  test('runs the configured shell in the requested cwd, resizes and reports the exit code', async () => {
    const events = collect()
    const terminal = await startTerminal({
      cols: 80,
      rows: 24,
      cwd: tmpDir,
      config: { startupShell: 'custom', customShellPath: '/bin/sh' },
      onData: events.onData,
      onExit: events.onExit,
    })
    expect(terminal.shell).toBe('/bin/sh')
    expect(terminal.cwd).toBe(tmpDir)
    expect(terminal.warning).toBeNull()

    terminal.resize(132, 40)
    terminal.write('stty size; pwd; printf "\\345\\256\\211\\350\\243\\205\\n"; exit 3\n')

    expect(await events.exited).toEqual({ code: 3, signal: null })
    expect(events.output()).toContain('40 132')
    expect(events.output()).toContain(await fs.realpath(tmpDir))
    expect(events.output()).toContain('安装')
  })

  test('falls back to the system shell with a warning when the custom shell is missing', async () => {
    const events = collect()
    const terminal = await startTerminal({
      cols: 80,
      rows: 24,
      cwd: tmpDir,
      config: { startupShell: 'custom', customShellPath: path.join(tmpDir, 'missing-shell') },
      onData: events.onData,
      onExit: events.onExit,
    })
    expect(terminal.warning).toContain('missing-shell')
    terminal.write('exit 0\n')
    expect((await events.exited).code).toBe(0)
  })

  test('kill ends the shell and reports the signal', async () => {
    const events = collect()
    const terminal = await startTerminal({
      cols: 80,
      rows: 24,
      cwd: tmpDir,
      config: { startupShell: 'custom', customShellPath: '/bin/sh' },
      onData: events.onData,
      onExit: events.onExit,
    })
    terminal.write('echo ready\n')
    await waitFor(() => events.output().includes('ready'))
    terminal.kill()
    expect((await events.exited).signal).toBe('SIGHUP')
  })
})
