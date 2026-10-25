import { afterEach, describe, expect, it, vi } from 'vitest'
import * as tauriShell from './index'
import * as electronShell from './electron'
import { ELECTRON_BRIDGE_KEY, unwrapInvokeError } from './electronBridge'

const conforms: typeof tauriShell = electronShell

function installBridge(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  const listeners = new Map<string, (payload: unknown) => void>()
  const bridge = {
    invoke: vi.fn(invoke),
    listen: vi.fn((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler)
      return () => listeners.delete(event)
    }),
    pathForFile: vi.fn((file: File) => (file.name === 'dropped.txt' ? '/Users/me/dropped.txt' : '')),
  }
  Object.assign(window, { [ELECTRON_BRIDGE_KEY]: bridge })
  return { bridge, listeners }
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)[ELECTRON_BRIDGE_KEY]
})

describe('electron shell', () => {
  it('exports the same functions as the Tauri shell', () => {
    expect(Object.keys(conforms).sort()).toEqual(Object.keys(tauriShell).sort())
  })

  it('routes calls through the preload bridge', async () => {
    const { bridge } = installBridge(async (command) => (command === 'get_server_url' ? 'http://127.0.0.1:4000' : null))
    await expect(electronShell.getServerUrl()).resolves.toBe('http://127.0.0.1:4000')
    await electronShell.openExternalLink('https://example.com')
    expect(bridge.invoke).toHaveBeenLastCalledWith('open_external', { url: 'https://example.com' })
  })

  it('returns the first path for single selections and null on cancel', async () => {
    const { bridge } = installBridge(async () => ['/a'])
    await expect(electronShell.pickDirectory({ title: 'Project' })).resolves.toBe('/a')
    expect(bridge.invoke).toHaveBeenLastCalledWith('dialog_open', { title: 'Project', directory: true, multiple: false })
    bridge.invoke.mockResolvedValueOnce(null)
    await expect(electronShell.pickFile({})).resolves.toBeNull()
  })

  it('delivers window events and unsubscribes', async () => {
    const { listeners } = installBridge(async () => undefined)
    const win = await electronShell.getAppWindow()
    const handler = vi.fn()
    const unlisten = await win.onResized(handler)
    listeners.get('window-resized')?.(undefined)
    expect(handler).toHaveBeenCalledOnce()
    unlisten()
    expect(listeners.has('window-resized')).toBe(false)
  })

  it('rejects functions the spike does not implement', async () => {
    installBridge(async () => undefined)
    await expect(electronShell.sendNotification({ title: 'Done' }))
      .rejects.toThrow('sendNotification is not implemented in the Electron spike')
  })

  it('routes app mode, export and update preparation to the main process', async () => {
    const { bridge } = installBridge(async () => undefined)
    await electronShell.setAppMode({ mode: 'portable', portableDir: '/data' })
    expect(bridge.invoke).toHaveBeenLastCalledWith('set_app_mode', { mode: 'portable', portableDir: '/data' })
    await electronShell.prepareAppModeRestart()
    expect(bridge.invoke).toHaveBeenLastCalledWith('prepare_app_mode_restart', undefined)
    await electronShell.writeSessionExport({ path: '/tmp/a.md', contents: '# A' })
    expect(bridge.invoke).toHaveBeenLastCalledWith('write_session_export', { path: '/tmp/a.md', contents: '# A' })
    await electronShell.prepareUpdateInstall()
    expect(bridge.invoke).toHaveBeenLastCalledWith('prepare_update_install', undefined)
    await electronShell.cancelUpdateInstall()
    expect(bridge.invoke).toHaveBeenLastCalledWith('cancel_update_install', undefined)
  })

  it('reports that updates are not configured instead of claiming the app is current', async () => {
    await expect(electronShell.checkForAppUpdate()).rejects.toThrow('Automatic updates are not configured for this build.')
  })

  it('strips the IPC wrapper from main-process errors', () => {
    expect(unwrapInvokeError(new Error("Error invoking remote method 'shell:invoke': Error: Exports must be .md or .json files")).message)
      .toBe('Exports must be .md or .json files')
    expect(unwrapInvokeError(new Error("Error invoking remote method 'shell:invoke': TypeError: bad input")).message).toBe('bad input')
    expect(unwrapInvokeError('plain').message).toBe('plain')
  })

  it('resolves dropped file paths through the preload bridge', () => {
    installBridge(async () => undefined)
    expect(electronShell.getFilePath(new File(['x'], 'dropped.txt'))).toBe('/Users/me/dropped.txt')
    expect(electronShell.getFilePath(new File(['x'], 'pasted.png'))).toBeUndefined()
  })
})
