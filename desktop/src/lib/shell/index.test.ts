import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onFileDrop, onNotificationAction, pickDirectory, pickFiles, checkForAppUpdate } from './index'

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), open: vi.fn(), check: vi.fn(), onAction: vi.fn(), onDragDropEvent: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: native.open }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: native.check }))
vi.mock('@tauri-apps/plugin-notification', () => ({ onAction: native.onAction }))
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: native.onDragDropEvent }) }))

beforeEach(() => vi.clearAllMocks())

describe('shell transport', () => {
  it('preserves cancellation and multiple file selections', async () => {
    native.open.mockResolvedValueOnce(null).mockResolvedValueOnce(['/a', '/b'])
    await expect(pickDirectory({ title: 'Project' })).resolves.toBeNull()
    expect(native.open).toHaveBeenNthCalledWith(1, { title: 'Project', directory: true, multiple: false })
    await expect(pickFiles({})).resolves.toEqual(['/a', '/b'])
    expect(native.open).toHaveBeenNthCalledWith(2, { directory: false, multiple: true })
  })

  it('keeps update progress and lifecycle operations on the returned update', async () => {
    const download = vi.fn(async (handler) => handler({ event: 'Progress', data: { chunkLength: 100 } }))
    const update = { version: '1.0.0', download, install: vi.fn(), close: vi.fn() }
    native.check.mockResolvedValue(update)
    const result = await checkForAppUpdate({ proxy: 'http://localhost:7890' })
    expect(native.check).toHaveBeenCalledWith({ proxy: 'http://localhost:7890' })
    const handler = vi.fn()
    await result?.download(handler)
    expect(handler).toHaveBeenCalledWith({ event: 'Progress', data: { chunkLength: 100 } })
    await result?.close()
    expect(update.close).toHaveBeenCalledOnce()
  })

  it('normalizes notification listener cleanup', async () => {
    const unregister = vi.fn()
    native.onAction.mockResolvedValue({ unregister })
    const handler = vi.fn()
    const dispose = await onNotificationAction(handler)
    expect(native.onAction).toHaveBeenCalledWith(handler)
    dispose()
    expect(unregister).toHaveBeenCalledOnce()
  })

  it('preserves file drop payloads and disposal', async () => {
    const unlisten = vi.fn()
    const event = { payload: { type: 'drop', paths: ['/file'], position: { x: 30, y: 40 } } }
    native.onDragDropEvent.mockImplementation(async (handler) => { handler(event); return unlisten })
    const handler = vi.fn()
    expect(await onFileDrop(handler)).toBe(unlisten)
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('propagates native failures to the existing caller fallback', async () => {
    native.open.mockRejectedValue(new Error('native picker unavailable'))
    await expect(pickFiles({})).rejects.toThrow('native picker unavailable')
  })
})
