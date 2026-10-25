import { afterEach, describe, expect, it, vi } from 'vitest'
import * as electronShell from './index'
import { ELECTRON_BRIDGE_KEY, unwrapInvokeError } from './electronBridge'

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

  it('reports notification permission from main-process support', async () => {
    const { bridge } = installBridge(async (command) => (command === 'notification_supported' ? true : undefined))
    await expect(electronShell.getMacNotificationPermission()).resolves.toBe('granted')
    await expect(electronShell.requestMacNotificationPermission()).resolves.toBe('granted')
    await expect(electronShell.getWindowsNotificationPermission()).resolves.toBe(true)
    await expect(electronShell.isNotificationPermissionGranted()).resolves.toBe(true)
    bridge.invoke.mockResolvedValue(false)
    await expect(electronShell.requestWindowsNotificationPermission()).resolves.toBe('unsupported')
    await expect(electronShell.requestNotificationPermission()).resolves.toBe('denied')
  })

  it('sends notifications with the payload a click should return', async () => {
    const { bridge, listeners } = installBridge(async () => true)
    await expect(electronShell.sendMacNotification({ title: 'Done', body: 'Turn finished', target: '{"type":"scheduled"}' })).resolves.toBe(true)
    expect(bridge.invoke).toHaveBeenLastCalledWith('notification_send', { title: 'Done', body: 'Turn finished', clickPayload: '{"type":"scheduled"}' })
    await electronShell.sendNotification({ title: 'Done', id: 3, extra: { dcTarget: 'x' } })
    expect(bridge.invoke).toHaveBeenLastCalledWith('notification_send', { title: 'Done', body: undefined, clickPayload: { id: 3, extra: { dcTarget: 'x' } } })

    const clicked = vi.fn()
    const unlisten = await electronShell.onNotificationClicked(clicked)
    listeners.get('desktop-notification-clicked')?.({ id: 3 })
    expect(clicked).toHaveBeenCalledWith({ payload: { id: 3 } })
    unlisten()
    expect(listeners.has('desktop-notification-clicked')).toBe(false)
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

  it('rejects instead of throwing when the page has no shell bridge', async () => {
    const pending = electronShell.getAppVersion()
    await expect(pending).rejects.toThrow('Electron shell bridge is not available')
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
