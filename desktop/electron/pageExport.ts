import path from 'node:path'
import type { BrowserExportFormat, BrowserExportMessages, BrowserExportResult, ElectronDialogFilter } from '../src/lib/shell/electronBridge'
import type { GuestContents } from './browserCapture'
import { standaloneHtmlSource, type StandaloneResult } from './standaloneHtml'

export type ExportInput = { format: BrowserExportFormat; suggestedName: string; messages: BrowserExportMessages }

export type ExportDeps = {
  chooseFile: (options: { defaultPath: string; filters: ElectronDialogFilter[] }) => Promise<string | null>
  confirm: (options: { message: string; proceed: string; cancel: string }) => Promise<boolean>
  writeFile: (file: string, data: Buffer | string) => Promise<void>
}

export const EXPORT_LIMITS = { entryBytes: 5 * 1024 * 1024, assetBytes: 32 * 1024 * 1024, totalBytes: 100 * 1024 * 1024 }
export const MAX_PNG_HEIGHT = 16_384
const EXPORT_WORLD = 4243

const FILTERS: Record<BrowserExportFormat, ElectronDialogFilter> = {
  pdf: { name: 'PDF', extensions: ['pdf'] },
  png: { name: 'PNG', extensions: ['png'] },
  html: { name: 'HTML', extensions: ['html'] },
}

export function exportFileName(suggestedName: string, format: BrowserExportFormat) {
  const base = suggestedName.replace(/[\\/:*?"<>|\0]/g, '_').trim().slice(0, 80) || 'artifact'
  return `${base}.${format}`
}

function withExtension(file: string, format: BrowserExportFormat) {
  return path.extname(file).toLowerCase() === `.${format}` ? file : `${file}.${format}`
}

class PageTooTall extends Error {}

async function capturePng(contents: GuestContents): Promise<Buffer> {
  const debuggerHandle = contents.debugger
  const attachedHere = !debuggerHandle.isAttached()
  if (attachedHere) debuggerHandle.attach('1.3')
  try {
    const metrics = (await debuggerHandle.sendCommand('Page.getLayoutMetrics')) as {
      cssContentSize?: { width: number; height: number }
      contentSize: { width: number; height: number }
    }
    const size = metrics.cssContentSize ?? metrics.contentSize
    const width = Math.ceil(size.width)
    const height = Math.ceil(size.height)
    if (height > MAX_PNG_HEIGHT) throw new PageTooTall()
    const shot = (await debuggerHandle.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    })) as { data: string }
    return Buffer.from(shot.data, 'base64')
  } finally {
    if (attachedHere) {
      try {
        debuggerHandle.detach()
      } catch (error) {
        console.error('[browser] detaching the export debugger failed', error)
      }
    }
  }
}

export async function exportPage(contents: GuestContents, input: ExportInput, deps: ExportDeps): Promise<BrowserExportResult> {
  const { format } = input
  const choose = async () => {
    const file = await deps.chooseFile({ defaultPath: exportFileName(input.suggestedName, format), filters: [FILTERS[format]] })
    return file ? withExtension(file, format) : null
  }

  if (format === 'html') {
    const built = (await contents.executeJavaScriptInIsolatedWorld(EXPORT_WORLD, [{ code: standaloneHtmlSource(EXPORT_LIMITS) }])) as StandaloneResult
    if (!built.ok) return { status: 'failed', reason: built.reason, limitBytes: built.limitBytes, items: built.items }
    if (built.externalLinks.length > 0) {
      const proceed = await deps.confirm({
        message: input.messages.externalLinks.replace('{count}', String(built.externalLinks.length)),
        proceed: input.messages.proceed,
        cancel: input.messages.cancel,
      })
      if (!proceed) return { status: 'cancelled' }
    }
    const file = await choose()
    if (!file) return { status: 'cancelled' }
    await deps.writeFile(file, built.html)
    return { status: 'saved', path: file }
  }

  const file = await choose()
  if (!file) return { status: 'cancelled' }
  if (format === 'pdf') {
    await deps.writeFile(file, await contents.printToPDF({ printBackground: true, preferCSSPageSize: true }))
    return { status: 'saved', path: file }
  }
  try {
    await deps.writeFile(file, await capturePng(contents))
  } catch (error) {
    if (error instanceof PageTooTall) return { status: 'failed', reason: 'pageTooTall', maxHeight: MAX_PNG_HEIGHT }
    throw error
  }
  return { status: 'saved', path: file }
}
