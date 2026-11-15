export const MAX_PNG_HEIGHT = 16_384
export const MAX_CAPTURE_WIDTH = 8_192
export const CAPTURE_READY_TIMEOUT_MS = 15_000

export type CaptureViewport = { width: number; height: number; scale?: number; wholePage: boolean }

type Listener = (...args: unknown[]) => void
type PreventableEvent = { preventDefault(): void }

type CaptureContents = {
  loadURL(url: string): Promise<void>
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(event: string, listener: Listener): unknown
  executeJavaScript(code: string): Promise<unknown>
  debugger: {
    attach(protocolVersion?: string): void
    sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>
  }
}

export type CaptureWindow = {
  webContents: CaptureContents
  isDestroyed(): boolean
  destroy(): void
}

export type CaptureDeps = {
  createWindow(size: { width: number; height: number }): CaptureWindow
  allowRedirect(url: string): boolean
}

export class PageTooTall extends Error {}

async function pageSettled() {
  const deck = (window as unknown as { __dreamcoderDeck?: { prepareCapture(): Promise<void> } }).__dreamcoderDeck
  if (deck) await deck.prepareCapture()
  await document.fonts.ready
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish()
  }
  await new Promise((resolve) => setTimeout(resolve, 100))
}

const SETTLED_SOURCE = `(${pageSettled.toString()})()`

function guard(contents: CaptureContents, deps: CaptureDeps) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', ((event: PreventableEvent) => event.preventDefault()) as Listener)
  contents.on('will-redirect', ((event: PreventableEvent, url: string) => {
    if (!deps.allowRedirect(url)) event.preventDefault()
  }) as Listener)
}

async function waitUntilSettled(contents: CaptureContents) {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn('[browser] the page did not settle in time; capturing it as it is')
      resolve()
    }, CAPTURE_READY_TIMEOUT_MS)
  })
  try {
    await Promise.race([contents.executeJavaScript(SETTLED_SOURCE), timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function contentHeight(contents: CaptureContents) {
  const metrics = (await contents.debugger.sendCommand('Page.getLayoutMetrics')) as {
    cssContentSize?: { width: number; height: number }
    contentSize: { width: number; height: number }
  }
  return Math.ceil((metrics.cssContentSize ?? metrics.contentSize).height)
}

export async function capturePagePng(url: string, viewport: CaptureViewport, deps: CaptureDeps): Promise<Buffer> {
  const window = deps.createWindow({ width: viewport.width, height: viewport.height })
  try {
    const contents = window.webContents
    guard(contents, deps)
    await contents.loadURL('about:blank')
    contents.debugger.attach('1.3')
    await contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.scale ?? 0,
      mobile: false,
    })
    await contents.loadURL(url)
    await waitUntilSettled(contents)
    const whole = viewport.wholePage ? await contentHeight(contents) : null
    if (whole !== null && whole > MAX_PNG_HEIGHT) throw new PageTooTall()
    const shot = (await contents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      ...(whole !== null && { captureBeyondViewport: true, clip: { x: 0, y: 0, width: viewport.width, height: whole, scale: 1 } }),
    })) as { data: string }
    return Buffer.from(shot.data, 'base64')
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}
