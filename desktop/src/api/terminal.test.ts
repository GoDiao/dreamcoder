import { beforeEach, describe, expect, it, vi } from 'vitest'
import { terminalApi } from './terminal'

const native = vi.hoisted(() => ({ available: true, invoke: vi.fn() }))
vi.mock('../lib/desktopRuntime', () => ({ isTauriRuntime: () => native.available }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))

describe('default shell detection helper', () => {
  beforeEach(() => {
    native.available = true
    native.invoke.mockReset()
  })

  it.each([
    { platform: 'macos', shell: '/bin/zsh' },
    { platform: 'linux', shell: '/bin/bash' },
    { platform: 'linux', shell: '/usr/bin/fish' },
    { platform: 'windows', shell: 'powershell.exe' },
  ])('reads the native detected shell on $platform: $shell', async (detected) => {
    native.invoke.mockResolvedValue(detected)
    await expect(terminalApi.detectDefaultShell()).resolves.toEqual(detected)
    expect(native.invoke).toHaveBeenCalledWith('detect_default_terminal_shell', undefined)
  })

  it('does not attempt native detection outside the desktop runtime', async () => {
    native.available = false
    await expect(terminalApi.detectDefaultShell()).rejects.toThrow('desktop app runtime')
    expect(native.invoke).not.toHaveBeenCalled()
  })

  it('surfaces native detection errors', async () => {
    native.invoke.mockRejectedValue(new Error('native runtime unavailable'))
    await expect(terminalApi.detectDefaultShell()).rejects.toThrow('native runtime unavailable')
  })
})
