import { describe, expect, it, vi } from 'vitest'
import { assertDevServerAvailable, waitForDevServer } from './electron-dev-server'

describe('electron dev server startup', () => {
  it('refuses a port that already has an HTTP server', async () => {
    await expect(assertDevServerAvailable('http://localhost:1420', vi.fn().mockResolvedValue({ ok: false }))).rejects.toThrow('already in use')
  })

  it('fails when the Vite child exits before it becomes ready', async () => {
    await expect(waitForDevServer('http://localhost:1420', { exitCode: 1 }, { fetcher: vi.fn() })).rejects.toThrow('exited before startup with code 1')
  })

  it('accepts a stable response from the Vite child', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    await waitForDevServer('http://localhost:1420', { exitCode: null }, { fetcher: vi.fn().mockResolvedValue({ ok: true }), sleep })
    expect(sleep).toHaveBeenCalledWith(500)
  })
})
