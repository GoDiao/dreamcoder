import { describe, expect, it, vi } from 'vitest'
import type { GuestContents } from './browserCapture'
import { EXPORT_LIMITS, exportFileName, exportPage, MAX_PNG_HEIGHT, type ExportDeps, type ExportInput } from './pageExport'

const messages = { externalLinks: '{count} external links stay online.', proceed: 'Save', cancel: 'Cancel' }
const input = (format: ExportInput['format'], suggestedName = 'Quarterly report'): ExportInput => ({ format, suggestedName, messages })

function deps(overrides: Partial<ExportDeps> = {}): ExportDeps & { writes: Array<[string, Buffer | string]> } {
  const writes: Array<[string, Buffer | string]> = []
  return {
    writes,
    chooseFile: vi.fn(async () => '/Users/me/out.file'),
    confirm: vi.fn(async () => true),
    writeFile: vi.fn(async (file, data) => {
      writes.push([file, data])
    }),
    ...overrides,
  }
}

function debuggerHandle(attached: boolean, layout = { width: 800, height: 3000 }) {
  const handle = {
    attached,
    isAttached: () => handle.attached,
    attach: vi.fn(() => {
      if (handle.attached) throw new Error('Another debugger is already attached')
      handle.attached = true
    }),
    detach: vi.fn(() => {
      handle.attached = false
    }),
    sendCommand: vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'Page.getLayoutMetrics') return { cssContentSize: layout, contentSize: layout }
      if (method === 'Page.captureScreenshot') return { data: Buffer.from('PNGDATA').toString('base64') }
      return {}
    }),
  }
  return handle
}

function guest(overrides: Partial<GuestContents> = {}, handle = debuggerHandle(false)): GuestContents {
  return {
    isDestroyed: () => false,
    hostWebContents: 'main',
    session: 'browser',
    capturePage: vi.fn(),
    printToPDF: vi.fn(async () => Buffer.from('PDFDATA')),
    executeJavaScriptInIsolatedWorld: vi.fn(),
    debugger: handle,
    ...overrides,
  }
}

describe('exportFileName', () => {
  it('turns the title into a safe file name with the format extension', () => {
    expect(exportFileName('Q3: plan/draft?', 'pdf')).toBe('Q3_ plan_draft_.pdf')
    expect(exportFileName('   ', 'png')).toBe('artifact.png')
    expect(exportFileName('x'.repeat(200), 'html')).toHaveLength(85)
  })
})

describe('export PDF', () => {
  it('asks where to save first, prints with backgrounds and the page own page size, and writes only there', async () => {
    const contents = guest()
    const d = deps()
    const outcome = await exportPage(contents, input('pdf'), d)

    expect(d.chooseFile).toHaveBeenCalledWith({ defaultPath: 'Quarterly report.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    expect(contents.printToPDF).toHaveBeenCalledWith({ printBackground: true, preferCSSPageSize: true })
    expect(d.writes).toEqual([['/Users/me/out.file.pdf', Buffer.from('PDFDATA')]])
    expect(outcome).toEqual({ status: 'saved', path: '/Users/me/out.file.pdf' })
  })

  it('does not print or write when the dialog is cancelled', async () => {
    const contents = guest()
    const d = deps({ chooseFile: vi.fn(async () => null) })
    expect(await exportPage(contents, input('pdf'), d)).toEqual({ status: 'cancelled' })
    expect(contents.printToPDF).not.toHaveBeenCalled()
    expect(d.writes).toEqual([])
  })

  it('keeps a file name that already has the extension', async () => {
    const d = deps({ chooseFile: vi.fn(async () => '/Users/me/Report.PDF') })
    await exportPage(guest(), input('pdf'), d)
    expect(d.writes[0]?.[0]).toBe('/Users/me/Report.PDF')
  })
})

describe('export PNG', () => {
  it('captures the whole page beyond the viewport with its own debugger and detaches it afterwards', async () => {
    const handle = debuggerHandle(false, { width: 800, height: 3000.4 })
    const d = deps()
    const outcome = await exportPage(guest({}, handle), input('png'), d)

    expect(handle.attach).toHaveBeenCalledOnce()
    expect(handle.sendCommand).toHaveBeenCalledWith('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 800, height: 3001, scale: 1 },
    })
    expect(handle.detach).toHaveBeenCalledOnce()
    expect(handle.attached).toBe(false)
    expect(d.writes).toEqual([['/Users/me/out.file.png', Buffer.from('PNGDATA')]])
    expect(outcome).toEqual({ status: 'saved', path: '/Users/me/out.file.png' })
  })

  it('reuses a debugger somebody else attached and leaves it attached', async () => {
    const handle = debuggerHandle(true)
    await exportPage(guest({}, handle), input('png'), deps())

    expect(handle.attach).not.toHaveBeenCalled()
    expect(handle.detach).not.toHaveBeenCalled()
    expect(handle.attached).toBe(true)
  })

  it('detaches a debugger it attached even when capturing fails, so a later attach by the browser host works', async () => {
    const handle = debuggerHandle(false)
    handle.sendCommand.mockImplementation(async (method: string) => {
      if (method === 'Page.getLayoutMetrics') return { contentSize: { width: 1, height: 1 } }
      throw new Error('capture failed')
    })
    const d = deps()

    await expect(exportPage(guest({}, handle), input('png'), d)).rejects.toThrow('capture failed')

    expect(handle.detach).toHaveBeenCalledOnce()
    expect(handle.attached).toBe(false)
    expect(() => handle.attach()).not.toThrow()
    expect(d.writes).toEqual([])
  })

  it('still reports the capture error when detaching fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handle = debuggerHandle(false)
    handle.detach.mockImplementation(() => {
      throw new Error('already gone')
    })

    await expect(exportPage(guest({}, handle), input('png'), deps())).resolves.toMatchObject({ status: 'saved' })
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('refuses a page taller than the screenshot limit and detaches', async () => {
    const handle = debuggerHandle(false, { width: 800, height: MAX_PNG_HEIGHT + 1 })
    const d = deps()

    expect(await exportPage(guest({}, handle), input('png'), d)).toEqual({ status: 'failed', reason: 'pageTooTall', maxHeight: MAX_PNG_HEIGHT })
    expect(handle.detach).toHaveBeenCalledOnce()
    expect(d.writes).toEqual([])
  })

  it('does not attach when the dialog is cancelled', async () => {
    const handle = debuggerHandle(false)
    await exportPage(guest({}, handle), input('png'), deps({ chooseFile: vi.fn(async () => null) }))
    expect(handle.attach).not.toHaveBeenCalled()
  })

  it('uses the css content size when the page reports one and the plain size otherwise', async () => {
    const handle = debuggerHandle(false)
    handle.sendCommand.mockImplementation(async (method: string) =>
      method === 'Page.getLayoutMetrics' ? { contentSize: { width: 640, height: 480 } } : { data: '' },
    )
    await exportPage(guest({}, handle), input('png'), deps())
    expect(handle.sendCommand).toHaveBeenCalledWith('Page.captureScreenshot', expect.objectContaining({ clip: expect.objectContaining({ width: 640, height: 480 }) }))
  })
})

describe('export standalone HTML', () => {
  const built = (externalLinks: string[]) => ({ ok: true as const, html: '<!DOCTYPE html><p>hi</p>', externalLinks })

  it('builds the file in an isolated world of the page, asks where to save and writes the HTML', async () => {
    const contents = guest({ executeJavaScriptInIsolatedWorld: vi.fn(async () => built([])) })
    const d = deps()

    const outcome = await exportPage(contents, input('html'), d)

    const [world, scripts] = vi.mocked(contents.executeJavaScriptInIsolatedWorld).mock.calls[0]!
    expect(typeof world).toBe('number')
    expect(scripts[0]?.code).toContain(JSON.stringify(EXPORT_LIMITS))
    expect(d.confirm).not.toHaveBeenCalled()
    expect(d.writes).toEqual([['/Users/me/out.file.html', '<!DOCTYPE html><p>hi</p>']])
    expect(outcome).toEqual({ status: 'saved', path: '/Users/me/out.file.html' })
  })

  it('tells the user how many external links stay online before asking where to save', async () => {
    const order: string[] = []
    const d = deps({
      confirm: vi.fn(async () => {
        order.push('confirm')
        return true
      }),
      chooseFile: vi.fn(async () => {
        order.push('choose')
        return '/Users/me/x.html'
      }),
    })
    const contents = guest({ executeJavaScriptInIsolatedWorld: vi.fn(async () => built(['https://a', 'https://b'])) })

    await exportPage(contents, input('html'), d)

    expect(d.confirm).toHaveBeenCalledWith({ message: '2 external links stay online.', proceed: 'Save', cancel: 'Cancel' })
    expect(order).toEqual(['confirm', 'choose'])
  })

  it('writes nothing and opens no dialog when the user declines the external links', async () => {
    const d = deps({ confirm: vi.fn(async () => false) })
    const contents = guest({ executeJavaScriptInIsolatedWorld: vi.fn(async () => built(['https://a'])) })

    expect(await exportPage(contents, input('html'), d)).toEqual({ status: 'cancelled' })
    expect(d.chooseFile).not.toHaveBeenCalled()
    expect(d.writes).toEqual([])
  })

  it('writes nothing when the save dialog is cancelled', async () => {
    const d = deps({ chooseFile: vi.fn(async () => null) })
    const contents = guest({ executeJavaScriptInIsolatedWorld: vi.fn(async () => built([])) })
    expect(await exportPage(contents, input('html'), d)).toEqual({ status: 'cancelled' })
    expect(d.writes).toEqual([])
  })

  it('reports which limit was exceeded and the largest resources without opening a dialog', async () => {
    const items = [{ url: 'http://x/big.png', bytes: 40_000_000 }]
    const contents = guest({ executeJavaScriptInIsolatedWorld: vi.fn(async () => ({ ok: false, reason: 'asset', limitBytes: EXPORT_LIMITS.assetBytes, items })) })
    const d = deps()

    expect(await exportPage(contents, input('html'), d)).toEqual({ status: 'failed', reason: 'asset', limitBytes: EXPORT_LIMITS.assetBytes, items })
    expect(d.chooseFile).not.toHaveBeenCalled()
  })
})
