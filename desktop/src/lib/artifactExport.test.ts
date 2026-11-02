import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  suspend: vi.fn(),
  resume: vi.fn(),
  exportPage: vi.fn(),
  contentsId: vi.fn(),
}))

vi.mock('../api/browser', () => ({ browserApi: { suspendEmulation: mocks.suspend, resumeEmulation: mocks.resume } }))
vi.mock('./shell', () => ({ exportBrowserPage: mocks.exportPage }))
vi.mock('./browserGuests', () => ({ getBrowserGuestContentsId: mocks.contentsId }))

import { describeExportResult, exportArtifactPage, exportDialogMessages } from './artifactExport'

const messages = { externalLinks: 'links {count}', proceed: 'Save', cancel: 'Cancel' }
const input = { tabId: 't1', sessionId: 's1', title: 'Report', messages }

describe('exportArtifactPage', () => {
  beforeEach(() => {
    mocks.contentsId.mockReturnValue(31)
    mocks.suspend.mockResolvedValue({ changed: true })
    mocks.resume.mockResolvedValue({ changed: true })
    mocks.exportPage.mockResolvedValue({ status: 'saved', path: '/out.pdf' })
  })

  afterEach(() => {
    vi.clearAllMocks()
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

  it('also does it for PNG', async () => {
    await exportArtifactPage({ ...input, format: 'png' })
    expect(mocks.suspend).toHaveBeenCalledOnce()
    expect(mocks.resume).toHaveBeenCalledOnce()
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
    expect(await exportArtifactPage({ ...input, format: 'png' })).toEqual({ status: 'cancelled' })
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
