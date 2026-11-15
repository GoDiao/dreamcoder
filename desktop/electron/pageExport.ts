import path from 'node:path'
import type { BrowserExportFormat, BrowserExportMessages, BrowserExportResult, ElectronDialogFilter } from '../src/lib/shell/electronBridge'
import type { GuestContents } from './browserCapture'
import { MAX_PNG_HEIGHT, PageTooTall, type CaptureViewport } from './pageCapture'
import { standaloneHtmlSource, type StandaloneResult } from './standaloneHtml'

export type ExportInput = { format: BrowserExportFormat; suggestedName: string; messages: BrowserExportMessages; viewport?: CaptureViewport }

export type ExportDeps = {
  chooseFile: (options: { defaultPath: string; filters: ElectronDialogFilter[] }) => Promise<string | null>
  confirm: (options: { message: string; proceed: string; cancel: string }) => Promise<boolean>
  writeFile: (file: string, data: Buffer | string) => Promise<void>
  capturePng: (url: string, viewport: CaptureViewport) => Promise<Buffer>
}

export const EXPORT_LIMITS = { entryBytes: 5 * 1024 * 1024, assetBytes: 32 * 1024 * 1024, totalBytes: 100 * 1024 * 1024 }
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

  if (format === 'pdf') {
    const file = await choose()
    if (!file) return { status: 'cancelled' }
    await deps.writeFile(file, await contents.printToPDF({ printBackground: true, preferCSSPageSize: true }))
    return { status: 'saved', path: file }
  }

  const { viewport } = input
  if (!viewport) throw new Error('a PNG export needs the viewport to render the page in')
  const file = await choose()
  if (!file) return { status: 'cancelled' }
  try {
    await deps.writeFile(file, await deps.capturePng(contents.getURL(), viewport))
  } catch (error) {
    if (error instanceof PageTooTall) return { status: 'failed', reason: 'pageTooTall', maxHeight: MAX_PNG_HEIGHT }
    throw error
  }
  return { status: 'saved', path: file }
}
