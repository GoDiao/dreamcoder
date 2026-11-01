export const ELECTRON_BRIDGE_KEY = 'dreamcoderShell'
export const BROWSER_PARTITION = 'persist:dreamcoder-browser'

export type BrowserRefusal = 'scheme' | 'noProject' | 'outsideProject' | 'notFound' | 'notHtml'
export type BrowserResolveResult = { ok: true; url: string } | { ok: false; reason: BrowserRefusal }

export type ElectronShellBridge = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
  listen: (event: string, handler: (payload: unknown) => void) => () => void
  pathForFile: (file: File) => string
}

export type ElectronDialogFilter = { name: string; extensions: string[] }

export const BROWSER_EXPORT_FORMATS = ['pdf', 'png', 'html'] as const
export type BrowserExportFormat = (typeof BROWSER_EXPORT_FORMATS)[number]

export type BrowserExportMessages = { externalLinks: string; proceed: string; cancel: string }

export type BrowserExportResult =
  | { status: 'saved'; path: string }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: 'entry' | 'asset' | 'total'; limitBytes: number; items: Array<{ url: string; bytes: number }> }
  | { status: 'failed'; reason: 'pageTooTall'; maxHeight: number }

export type ElectronOpenDialogInput = {
  title?: string
  directory: boolean
  multiple: boolean
  filters?: ElectronDialogFilter[]
}

const INVOKE_ERROR_PREFIX = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/

export function unwrapInvokeError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(message.replace(INVOKE_ERROR_PREFIX, ''))
}
