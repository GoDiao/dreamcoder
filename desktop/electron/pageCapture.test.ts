import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAPTURE_READY_TIMEOUT_MS, capturePagePng, MAX_PNG_HEIGHT, PageTooTall, type CaptureDeps, type CaptureWindow } from './pageCapture'

type Handler = (...args: unknown[]) => void

const URL = 'dreamcoder-project://abc/talk/index.html#agenda'
const page = { width: 800, height: 600, wholePage: true }

class FakeWindow implements CaptureWindow {
  calls: string[] = []
  destroyed = false
  handlers = new Map<string, Handler>()
  openHandler: ((details: { url: string }) => { action: 'deny' }) | null = null
  commands: Array<{ method: string; params?: Record<string, unknown> }> = []
  contentHeight = 3000.4
  loadFailure: Error | null = null
  settle: () => Promise<unknown> = async () => undefined

  webContents = {
    loadURL: async (url: string) => {
      if (this.loadFailure && url !== 'about:blank') throw this.loadFailure
      this.calls.push(`load:${url}`)
    },
    setWindowOpenHandler: (handler: (details: { url: string }) => { action: 'deny' }) => {
      this.openHandler = handler
    },
    on: (event: string, listener: Handler) => {
      this.handlers.set(event, listener)
    },
    executeJavaScript: async (code: string) => {
      this.calls.push(code.includes('prepareCapture') ? 'settle' : 'script')
      return this.settle()
    },
    debugger: {
      attach: (version?: string) => {
        this.calls.push(`attach:${version}`)
      },
      sendCommand: async (method: string, params?: Record<string, unknown>) => {
        this.calls.push(method)
        this.commands.push({ method, params })
        if (method === 'Page.getLayoutMetrics') return { cssContentSize: { width: 800, height: this.contentHeight }, contentSize: { width: 1600, height: this.contentHeight * 2 } }
        if (method === 'Page.captureScreenshot') return { data: Buffer.from('PNGDATA').toString('base64') }
        return {}
      },
    },
  }

  isDestroyed() {
    return this.destroyed
  }

  destroy() {
    this.destroyed = true
  }

  command(method: string) {
    return this.commands.find((entry) => entry.method === method)?.params
  }
}

function setup(allowRedirect: CaptureDeps['allowRedirect'] = () => false) {
  const window = new FakeWindow()
  const createWindow = vi.fn(() => window)
  return { window, createWindow, deps: { createWindow, allowRedirect } }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('capturePagePng', () => {
  it('renders a deck slide in a hidden window of exactly the given viewport and captures that one screen', async () => {
    const { window, createWindow, deps } = setup()
    const png = await capturePagePng(URL, { width: 1920, height: 1080, scale: 1, wholePage: false }, deps)

    expect(createWindow).toHaveBeenCalledWith({ width: 1920, height: 1080 })
    expect(window.calls).toEqual(['load:about:blank', 'attach:1.3', 'Emulation.setDeviceMetricsOverride', `load:${URL}`, 'settle', 'Page.captureScreenshot'])
    expect(window.command('Emulation.setDeviceMetricsOverride')).toEqual({ width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    expect(window.command('Page.captureScreenshot')).toEqual({ format: 'png', fromSurface: true })
    expect(png).toEqual(Buffer.from('PNGDATA'))
    expect(window.destroyed).toBe(true)
  })

  it('renders a page in a viewport of the given size with the pixel ratio of the screen and captures its whole height', async () => {
    const { window, createWindow, deps } = setup()
    await capturePagePng(URL, page, deps)

    expect(createWindow).toHaveBeenCalledWith({ width: 800, height: 600 })
    expect(window.command('Emulation.setDeviceMetricsOverride')).toEqual({ width: 800, height: 600, deviceScaleFactor: 0, mobile: false })
    expect(window.command('Page.captureScreenshot')).toEqual({
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 800, height: 3001, scale: 1 },
    })
    expect(window.destroyed).toBe(true)
  })

  it('refuses a page taller than the limit and still destroys the window', async () => {
    const { window, deps } = setup()
    window.contentHeight = MAX_PNG_HEIGHT + 1
    await expect(capturePagePng(URL, page, deps)).rejects.toBeInstanceOf(PageTooTall)
    expect(window.command('Page.captureScreenshot')).toBeUndefined()
    expect(window.destroyed).toBe(true)
  })

  it('destroys the window when the page cannot be loaded', async () => {
    const { window, deps } = setup()
    window.loadFailure = new Error('ERR_FILE_NOT_FOUND')
    await expect(capturePagePng(URL, page, deps)).rejects.toThrow('ERR_FILE_NOT_FOUND')
    expect(window.destroyed).toBe(true)
  })

  it('lets the page open no window and go nowhere else, and follows a redirect only to an allowed address', async () => {
    const { window, deps } = setup((url) => url.startsWith('https://ok.example'))
    await capturePagePng(URL, page, deps)

    expect(window.openHandler?.({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    const navigate = { preventDefault: vi.fn() }
    window.handlers.get('will-navigate')?.(navigate, 'https://ok.example/next')
    expect(navigate.preventDefault).toHaveBeenCalledOnce()
    const refused = { preventDefault: vi.fn() }
    window.handlers.get('will-redirect')?.(refused, 'https://evil.example')
    expect(refused.preventDefault).toHaveBeenCalledOnce()
    const allowed = { preventDefault: vi.fn() }
    window.handlers.get('will-redirect')?.(allowed, 'https://ok.example/moved')
    expect(allowed.preventDefault).not.toHaveBeenCalled()
  })

  it('captures the page as it is when it does not settle in time', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { window, deps } = setup()
    window.settle = () => new Promise(() => undefined)
    const pending = capturePagePng(URL, { width: 1920, height: 1080, scale: 1, wholePage: false }, deps)
    await vi.advanceTimersByTimeAsync(CAPTURE_READY_TIMEOUT_MS)
    expect(await pending).toEqual(Buffer.from('PNGDATA'))
    expect(window.destroyed).toBe(true)
  })
})
