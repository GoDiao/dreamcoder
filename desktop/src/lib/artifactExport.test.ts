import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  suspend: vi.fn(),
  resume: vi.fn(),
  exportPage: vi.fn(),
  contentsId: vi.fn(),
  size: vi.fn(),
  runDeckCall: vi.fn(),
}))

vi.mock('../api/browser', () => ({ browserApi: { suspendEmulation: mocks.suspend, resumeEmulation: mocks.resume } }))
vi.mock('./shell', () => ({ exportBrowserPage: mocks.exportPage }))
vi.mock('./browserGuests', () => ({ getBrowserGuestContentsId: mocks.contentsId, browserGuestSize: mocks.size, runDeckCall: mocks.runDeckCall }))

import { EMPTY_BROWSER_PAGE, useBrowserStore } from '../stores/browserStore'
import { describeExportResult, exportArtifactPage, exportDialogMessages } from './artifactExport'

const messages = { externalLinks: 'links {count}', proceed: 'Save', cancel: 'Cancel' }
const input = { tabId: 't1', sessionId: 's1', title: 'Report', messages }

describe('exportArtifactPage', () => {
  beforeEach(() => {
    mocks.contentsId.mockReturnValue(31)
    mocks.size.mockReturnValue({ width: 640, height: 480 })
    mocks.runDeckCall.mockResolvedValue(undefined)
    mocks.suspend.mockResolvedValue({ changed: true })
    mocks.resume.mockResolvedValue({ changed: true })
    mocks.exportPage.mockResolvedValue({ status: 'saved', path: '/out.pdf' })
  })

  afterEach(() => {
    useBrowserStore.setState(useBrowserStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  const showDeck = () => useBrowserStore.setState({
    pageByTab: { t1: { ...EMPTY_BROWSER_PAGE, ready: true, deck: { artifact: 'd', slide: 'agenda', title: 'Agenda', index: 1, count: 3, mode: 'overview', editing: false } } },
  })

  it('takes the emulated view away, exports and puts it back, in that order', async () => {
    const order: string[] = []
    mocks.suspend.mockImplementation(async () => { order.push('suspend') })
    mocks.exportPage.mockImplementation(async () => { order.push('export'); return { status: 'saved', path: '/out.pdf' } })
    mocks.resume.mockImplementation(async () => { order.push('resume') })

    const result = await exportArtifactPage({ ...input, format: 'pdf' })

    expect(order).toEqual(['suspend', 'export', 'resume'])
    expect(mocks.suspend).toHaveBeenCalledWith('s1', 't1')
    expect(mocks.exportPage).toHaveBeenCalledWith({ webContentsId: 31, format: 'pdf', suggestedName: 'Report', messages })
    expect(result).toEqual({ status: 'saved', path: '/out.pdf' })
  })

  it('leaves the emulated view alone for PNG, which is rendered again in a hidden window, and gives the size the page is shown at, so that it is laid out as in the tab and captured whole', async () => {
    await exportArtifactPage({ ...input, format: 'png' })
    expect(mocks.suspend).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
    expect(mocks.size).toHaveBeenCalledWith('t1')
    expect(mocks.exportPage).toHaveBeenCalledWith({ webContentsId: 31, format: 'png', suggestedName: 'Report', messages, viewport: { width: 640, height: 480, wholePage: true } })
  })

  it('exports the PNG of a deck as one slide of 1920 by 1080 at pixel ratio 1', async () => {
    showDeck()
    await exportArtifactPage({ ...input, format: 'png' })
    expect(mocks.exportPage).toHaveBeenCalledWith(expect.objectContaining({ viewport: { width: 1920, height: 1080, scale: 1, wholePage: false } }))
    expect(mocks.size).not.toHaveBeenCalled()
  })

  it('refuses a PNG of a page that is not shown, which has no size to render at', async () => {
    mocks.size.mockReturnValue(null)
    await expect(exportArtifactPage({ ...input, format: 'png' })).rejects.toThrow('not shown')
    expect(mocks.exportPage).not.toHaveBeenCalled()
  })

  it('turns editing off and returns a deck to browse mode before building its standalone HTML, and not for the other formats', async () => {
    showDeck()
    const order: string[] = []
    mocks.runDeckCall.mockImplementation(async (_tabId: string, code: string) => { order.push(code) })
    mocks.exportPage.mockImplementation(async () => { order.push('export'); return { status: 'saved', path: '/out.html' } })

    await exportArtifactPage({ ...input, format: 'html' })
    expect(order).toEqual(['window.__dreamcoderDeck?.setEditing(false)', 'window.__dreamcoderDeck?.setMode("browse")', 'export'])

    await exportArtifactPage({ ...input, format: 'pdf' })
    await exportArtifactPage({ ...input, format: 'png' })
    expect(mocks.runDeckCall).toHaveBeenCalledTimes(2)
  })

  it('does not call into a page that is not a deck before building its standalone HTML', async () => {
    await exportArtifactPage({ ...input, format: 'html' })
    expect(mocks.runDeckCall).not.toHaveBeenCalled()
  })

  it('leaves the emulated view alone for standalone HTML, which is built from the page itself', async () => {
    await exportArtifactPage({ ...input, format: 'html' })
    expect(mocks.suspend).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('does not call the sidecar for a page that belongs to no chat', async () => {
    await exportArtifactPage({ ...input, sessionId: null, format: 'pdf' })
    expect(mocks.suspend).not.toHaveBeenCalled()
    expect(mocks.exportPage).toHaveBeenCalledOnce()
  })

  it('restores the emulated view when the export fails and when the user cancels', async () => {
    mocks.exportPage.mockRejectedValueOnce(new Error('disk full'))
    await expect(exportArtifactPage({ ...input, format: 'pdf' })).rejects.toThrow('disk full')
    expect(mocks.resume).toHaveBeenCalledTimes(1)

    mocks.exportPage.mockResolvedValueOnce({ status: 'cancelled' })
    expect(await exportArtifactPage({ ...input, format: 'pdf' })).toEqual({ status: 'cancelled' })
    expect(mocks.resume).toHaveBeenCalledTimes(2)
  })

  it('does not export a page that still shows the emulated view when taking it away failed', async () => {
    mocks.suspend.mockRejectedValue(new Error('detached'))
    await expect(exportArtifactPage({ ...input, format: 'pdf' })).rejects.toThrow('detached')
    expect(mocks.exportPage).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('logs a failure to restore instead of hiding the finished export', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.resume.mockRejectedValue(new Error('gone'))
    expect(await exportArtifactPage({ ...input, format: 'pdf' })).toEqual({ status: 'saved', path: '/out.pdf' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('refuses a page that is not loaded', async () => {
    mocks.contentsId.mockReturnValue(null)
    await expect(exportArtifactPage({ ...input, format: 'pdf' })).rejects.toThrow('not loaded')
    expect(mocks.suspend).not.toHaveBeenCalled()
  })
})

describe('describeExportResult', () => {
  const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ''}`

  it('says nothing for a cancel and reports where a file was saved', () => {
    expect(describeExportResult(t as never, { status: 'cancelled' })).toBeNull()
    expect(describeExportResult(t as never, { status: 'saved', path: '/out.pdf' })).toEqual({ kind: 'success', message: 'artifactExport.saved{"path":"/out.pdf"}' })
  })

  it('names the limit that was exceeded and the largest files', () => {
    const described = describeExportResult(t as never, {
      status: 'failed',
      reason: 'asset',
      limitBytes: 32 * 1024 * 1024,
      items: [{ url: 'http://x/big.png', bytes: 40 * 1024 * 1024 }],
    })
    expect(described?.kind).toBe('error')
    expect(described?.message).toContain('artifactExport.failed.asset')
    expect(described?.message).toContain('32 MB')
    expect(described?.message).toContain('http://x/big.png (40 MB)')
  })

  it('reports the page height limit in pixels, not bytes', () => {
    const described = describeExportResult(t as never, { status: 'failed', reason: 'pageTooTall', maxHeight: 16384 })
    expect(described?.message).toContain('"limit":"16384"')
  })
})

describe('exportDialogMessages', () => {
  it('leaves the count placeholder for the main process to fill in', () => {
    const t = (key: string, params?: Record<string, string | number>) => (key === 'artifactExport.externalLinks' ? `${params?.count} links` : key)
    expect(exportDialogMessages(t as never)).toEqual({ externalLinks: '{count} links', proceed: 'artifactExport.proceed', cancel: 'common.cancel' })
  })
})
