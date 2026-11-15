import { describe, expect, it, vi } from 'vitest'
import type { GuestContents } from './browserCapture'
import { MAX_PNG_HEIGHT, PageTooTall } from './pageCapture'
import { EXPORT_LIMITS, exportFileName, exportPage, type ExportDeps, type ExportInput } from './pageExport'

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
    capturePng: vi.fn(async () => Buffer.from('PNGDATA')),
    ...overrides,
  }
}

function guest(overrides: Partial<GuestContents> = {}): GuestContents {
  return {
    isDestroyed: () => false,
    hostWebContents: 'main',
    session: 'browser',
    getURL: () => 'dreamcoder-project://abc/talk/index.html#agenda',
    capturePage: vi.fn(),
    printToPDF: vi.fn(async () => Buffer.from('PDFDATA')),
    executeJavaScriptInIsolatedWorld: vi.fn(),
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
  const viewport = { width: 1920, height: 1080, scale: 1, wholePage: false }

  it('renders the address of the page again in the given viewport and writes that picture, without touching the page itself', async () => {
    const contents = guest()
    const d = deps()
    const outcome = await exportPage(contents, { ...input('png'), viewport }, d)

    expect(d.capturePng).toHaveBeenCalledWith('dreamcoder-project://abc/talk/index.html#agenda', viewport)
    expect(contents.capturePage).not.toHaveBeenCalled()
    expect(d.writes).toEqual([['/Users/me/out.file.png', Buffer.from('PNGDATA')]])
    expect(outcome).toEqual({ status: 'saved', path: '/Users/me/out.file.png' })
  })

  it('refuses a page taller than the screenshot limit', async () => {
    const d = deps({ capturePng: vi.fn(async () => { throw new PageTooTall() }) })
    expect(await exportPage(guest(), { ...input('png'), viewport: { width: 800, height: 600, wholePage: true } }, d)).toEqual({ status: 'failed', reason: 'pageTooTall', maxHeight: MAX_PNG_HEIGHT })
    expect(d.writes).toEqual([])
  })

  it('passes on any other capture error', async () => {
    const d = deps({ capturePng: vi.fn(async () => { throw new Error('the page failed to load') }) })
    await expect(exportPage(guest(), { ...input('png'), viewport }, d)).rejects.toThrow('the page failed to load')
  })

  it('does not render anything when the dialog is cancelled', async () => {
    const d = deps({ chooseFile: vi.fn(async () => null) })
    expect(await exportPage(guest(), { ...input('png'), viewport }, d)).toEqual({ status: 'cancelled' })
    expect(d.capturePng).not.toHaveBeenCalled()
  })

  it('fails without a viewport to render in', async () => {
    await expect(exportPage(guest(), input('png'), deps())).rejects.toThrow('needs the viewport')
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
