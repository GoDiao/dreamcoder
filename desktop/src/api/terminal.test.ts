import { beforeEach, describe, expect, it, vi } from 'vitest'
import { terminalApi } from './terminal'
import type { DesktopTerminalSettings } from '../types/settings'

const native = vi.hoisted(() => ({ available: true, detect: vi.fn(), spawn: vi.fn() }))
vi.mock('../lib/desktopRuntime', () => ({ isTauriRuntime: () => native.available }))
vi.mock('../lib/shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/shell')>()),
  detectDefaultTerminalShell: native.detect,
  spawnTerminal: native.spawn,
}))

describe('terminal settings boundary', () => {
  const settings: DesktopTerminalSettings = { startupShell: 'custom', customShellPath: '/opt/shell', bashPath: '/opt/bash' }

  beforeEach(() => {
    native.available = true
    native.detect.mockReset()
    native.spawn.mockReset()
  })

  it.each([
    { platform: 'macos', shell: '/bin/zsh' },
    { platform: 'linux', shell: '/bin/bash' },
    { platform: 'linux', shell: '/usr/bin/fish' },
    { platform: 'windows', shell: 'powershell.exe' },
  ])('detects the default shell with the supplied settings on $platform', async (detected) => {
    native.detect.mockResolvedValue(detected)
    await expect(terminalApi.detectDefaultShell(settings)).resolves.toEqual(detected)
    expect(native.detect).toHaveBeenCalledWith(settings)
  })

  it('passes the supplied settings on every spawn', async () => {
    await terminalApi.spawn({ cols: 80, rows: 24, cwd: '/work', settings })
    expect(native.spawn).toHaveBeenLastCalledWith({ cols: 80, rows: 24, cwd: '/work', settings })
    const defaults: DesktopTerminalSettings = { startupShell: 'system', customShellPath: '', bashPath: null }
    await terminalApi.spawn({ cols: 100, rows: 30, settings: defaults })
    expect(native.spawn).toHaveBeenLastCalledWith({ cols: 100, rows: 30, settings: defaults })
  })

  it('does not attempt native calls outside the desktop runtime', async () => {
    native.available = false
    await expect(terminalApi.detectDefaultShell(settings)).rejects.toThrow('desktop app runtime')
    await expect(terminalApi.spawn({ cols: 80, rows: 24, settings })).rejects.toThrow('desktop app runtime')
    expect(native.detect).not.toHaveBeenCalled()
    expect(native.spawn).not.toHaveBeenCalled()
  })

  it('surfaces native detection errors', async () => {
    native.detect.mockRejectedValue(new Error('native runtime unavailable'))
    await expect(terminalApi.detectDefaultShell(settings)).rejects.toThrow('native runtime unavailable')
  })
})
