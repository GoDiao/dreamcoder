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
    await expect(electronShell.getMacNotificationPermission()).resolves.toBe('unknown')
    await expect(electronShell.requestMacNotificationPermission()).resolves.toBe('unknown')
    await expect(electronShell.getWindowsNotificationPermission()).resolves.toBe(true)
    await expect(electronShell.isNotificationPermissionGranted()).resolves.toBe(true)
    bridge.invoke.mockResolvedValue(false)
    await expect(electronShell.requestWindowsNotificationPermission()).resolves.toBe('unsupported')
    await expect(electronShell.getMacNotificationPermission()).resolves.toBe('unsupported')
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
  it('sends browser commands to the main process', async () => {
    const { bridge } = installBridge(async () => ({ ok: true, url: 'http://localhost:3000/' }))
    await expect(electronShell.resolveBrowserInput({ input: 'localhost:3000', projectRoot: '/repo', searchEngine: 'google' })).resolves.toEqual({ ok: true, url: 'http://localhost:3000/' })
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_resolve', { input: 'localhost:3000', projectRoot: '/repo', searchEngine: 'google' })
    await electronShell.openBrowserUrlInSystem('https://example.com/')
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_open_in_system', { url: 'https://example.com/' })
    await electronShell.openBrowserExternalProtocol('zoommtg://x')
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_open_protocol', { url: 'zoommtg://x' })
    await electronShell.clearBrowserData()
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_clear_data', undefined)
  })

  it('sends the browser control commands to the main process', async () => {
    const { bridge } = installBridge(async () => undefined)
    await electronShell.registerBrowserView({ sessionId: 's', tabId: 't', webContentsId: 7 })
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_view_register', { sessionId: 's', tabId: 't', webContentsId: 7 })
    await electronShell.updateBrowserView({ tabId: 't', shown: true, active: true, foreground: false })
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_view_update', { tabId: 't', shown: true, active: true, foreground: false })
    await electronShell.unregisterBrowserView({ tabId: 't' })
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_view_unregister', { tabId: 't' })
    await electronShell.stopBrowserControl({ sessionId: 's' })
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_stop', { sessionId: 's' })
    await electronShell.finishBrowserOpenTab({ requestId: 'r', tabId: 't' })
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_open_tab_done', { requestId: 'r', tabId: 't' })
    await electronShell.finishBrowserActivate({ requestId: 'r', shown: false })
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_activate_done', { requestId: 'r', shown: false })
  })

  it('sends pick mode and element marks to the main process', async () => {
    const { bridge } = installBridge(async () => ['12'])
    await electronShell.setBrowserPickMode({ tabId: 't', active: true })
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_pick_set', { tabId: 't', active: true })
    await expect(electronShell.syncBrowserMarks({ tabId: 't', refs: [{ ref: '12', generation: 2 }] })).resolves.toEqual(['12'])
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_marks_sync', { tabId: 't', refs: [{ ref: '12', generation: 2 }] })
  })

  it('treats pick mode as a no-op and every mark as alive without a shell bridge', async () => {
    await expect(electronShell.setBrowserPickMode({ tabId: 't', active: true })).resolves.toBeUndefined()
    await expect(
      electronShell.syncBrowserMarks({ tabId: 't', refs: [{ ref: '1', generation: 0 }, { ref: '2', generation: 0 }] }),
    ).resolves.toEqual(['1', '2'])
    const unlisten = await electronShell.onBrowserPickState(vi.fn())
    expect(() => unlisten()).not.toThrow()
  })

  it('delivers pick events from the main process', async () => {
    const { listeners } = installBridge(async () => undefined)
    const state = vi.fn()
    const started = vi.fn()
    const done = vi.fn()
    await electronShell.onBrowserPickState(state)
    await electronShell.onBrowserPickStarted(started)
    await electronShell.onBrowserPickDone(done)

    listeners.get('browser-pick-state')?.({ tabId: 't', active: true })
    listeners.get('browser-pick-started')?.({ tabId: 't', sessionId: 's', pickId: 'p' })
    listeners.get('browser-pick-done')?.({ tabId: 't', sessionId: 's', pickId: 'p', ok: false, cancelled: true })

    expect(state).toHaveBeenCalledWith({ tabId: 't', active: true })
    expect(started).toHaveBeenCalledWith({ tabId: 't', sessionId: 's', pickId: 'p' })
    expect(done).toHaveBeenCalledWith({ tabId: 't', sessionId: 's', pickId: 'p', ok: false, cancelled: true })
  })

  it('sends browser grant replies and trusted-site changes to the main process', async () => {
    const { bridge } = installBridge(async () => ['https://example.com'])
    await electronShell.replyBrowserGrant({ requestId: 'g1', decision: 'session' })
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_grant_reply', { requestId: 'g1', decision: 'session' })
    await expect(electronShell.listTrustedBrowserOrigins()).resolves.toEqual(['https://example.com'])
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_trust_list', undefined)
    await expect(electronShell.trustBrowserOrigin('https://example.com')).resolves.toEqual(['https://example.com'])
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_trust_add', { origin: 'https://example.com' })
    await electronShell.untrustBrowserOrigin('https://example.com')
    expect(bridge.invoke).toHaveBeenLastCalledWith('browser_trust_remove', { origin: 'https://example.com' })
  })

  it('delivers browser control requests from the main process', async () => {
    const { listeners } = installBridge(async () => undefined)
    const openTab = vi.fn()
    const activate = vi.fn()
    await electronShell.onBrowserOpenTabRequest(openTab)
    await electronShell.onBrowserActivateRequest(activate)

    listeners.get('browser-open-tab-request')?.({ requestId: 'r1', sessionId: 's', url: null })
    listeners.get('browser-activate-request')?.({ requestId: 'r2', tabId: 't' })

    expect(openTab).toHaveBeenCalledWith({ requestId: 'r1', sessionId: 's', url: null })
    expect(activate).toHaveBeenCalledWith({ requestId: 'r2', tabId: 't' })
  })

  it('treats the browser control commands and requests as no-ops without a shell bridge', async () => {
    await expect(electronShell.registerBrowserView({ sessionId: 's', tabId: 't', webContentsId: 7 })).resolves.toBeUndefined()
    await expect(electronShell.updateBrowserView({ tabId: 't', shown: true, active: true, foreground: true })).resolves.toBeUndefined()
    await expect(electronShell.finishBrowserActivate({ requestId: 'r', shown: true })).resolves.toBeUndefined()
    const unlisten = await electronShell.onBrowserOpenTabRequest(vi.fn())
    expect(() => unlisten()).not.toThrow()
  })

  it('delivers browser events from the main process', async () => {
    const { listeners } = installBridge(async () => undefined)
    const blocked = vi.fn()
    const external = vi.fn()
    const shortcut = vi.fn()
    await electronShell.onBrowserBlocked(blocked)
    await electronShell.onBrowserExternalRequest(external)
    await electronShell.onBrowserShortcut(shortcut)

    listeners.get('browser-blocked')?.({ guestId: 1, url: 'http://x.test', reason: 'scheme' })
    listeners.get('browser-external-request')?.({ url: 'vscode://x' })
    listeners.get('browser-shortcut')?.({ key: 'k' })

    expect(blocked).toHaveBeenCalledWith({ guestId: 1, url: 'http://x.test', reason: 'scheme' })
    expect(external).toHaveBeenCalledWith({ url: 'vscode://x' })
    expect(shortcut).toHaveBeenCalledWith({ key: 'k' })
  })
})
