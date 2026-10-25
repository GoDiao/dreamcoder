import { afterEach, describe, expect, it, vi } from 'vitest'
import * as tauriShell from './index'
import * as electronShell from './electron'
import { ELECTRON_BRIDGE_KEY } from './electronBridge'

const conforms: typeof tauriShell = electronShell

function installBridge(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  const listeners = new Map<string, (payload: unknown) => void>()
  const bridge = {
    invoke: vi.fn(invoke),
    listen: vi.fn((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler)
      return () => listeners.delete(event)
    }),
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
    await expect(electronShell.spawnTerminal({ cols: 80, rows: 24, settings: { startupShell: 'system', customShellPath: '', bashPath: '' } }))
      .rejects.toThrow('spawnTerminal is not implemented in the Electron spike')
  })
})
