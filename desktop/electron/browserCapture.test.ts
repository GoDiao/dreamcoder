import { describe, expect, it, vi } from 'vitest'
import { captureThumbnail, findGuest, THUMBNAIL_QUALITY, THUMBNAIL_WIDTH, type CaptureImage, type GuestContents } from './browserCapture'

function image(width: number, height: number): CaptureImage & { resized: ReturnType<typeof vi.fn> } {
  const resized = vi.fn((options: { width: number }) => image(options.width, Math.round((height * options.width) / width)))
  return {
    getSize: () => ({ width, height }),
    resize: resized,
    resized,
    toJPEG: vi.fn((quality: number) => Buffer.from(`jpeg:${width}x${height}:q${quality}`)),
  }
}

function guest(overrides: Partial<GuestContents> = {}, host: unknown = 'main', session: unknown = 'browser'): GuestContents {
  return {
    isDestroyed: () => false,
    hostWebContents: host,
    session,
    capturePage: vi.fn(async () => image(1280, 800)),
    printToPDF: vi.fn(),
    executeJavaScriptInIsolatedWorld: vi.fn(),
    debugger: { isAttached: () => false, attach: vi.fn(), detach: vi.fn(), sendCommand: vi.fn() },
    ...overrides,
  }
}

const lookup = (contents: GuestContents | null) => ({
  fromId: () => contents,
  getMainWebContents: () => 'main',
  browserSession: 'browser',
})

describe('findGuest', () => {
  it('returns a guest of the main window that uses the browser partition', () => {
    const contents = guest()
    expect(findGuest(lookup(contents), 5)).toBe(contents)
  })

  it('refuses a missing or destroyed page, another window and another partition', () => {
    expect(() => findGuest(lookup(null), 5)).toThrow('does not exist')
    expect(() => findGuest(lookup(guest({ isDestroyed: () => true })), 5)).toThrow('does not exist')
    expect(() => findGuest(lookup(guest({}, 'other-window')), 5)).toThrow('not a guest of the main window')
    expect(() => findGuest(lookup(guest({}, 'main', 'default')), 5)).toThrow('does not use the browser partition')
  })
})

describe('captureThumbnail', () => {
  it('shrinks a wide page to the thumbnail width and returns a base64 JPEG', async () => {
    const contents = guest()
    const data = await captureThumbnail(contents)
    expect(Buffer.from(data, 'base64').toString()).toBe(`jpeg:${THUMBNAIL_WIDTH}x200:q${THUMBNAIL_QUALITY}`)
  })

  it('keeps a page that is already small', async () => {
    const small = image(200, 100)
    const data = await captureThumbnail(guest({ capturePage: async () => small }))
    expect(small.resized).not.toHaveBeenCalled()
    expect(Buffer.from(data, 'base64').toString()).toContain('jpeg:200x100')
  })

  it('refuses an empty capture', async () => {
    await expect(captureThumbnail(guest({ capturePage: async () => image(0, 0) }))).rejects.toThrow('nothing to capture')
  })
})
