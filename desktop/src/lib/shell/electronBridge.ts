export const ELECTRON_BRIDGE_KEY = 'dreamcoderShell'

export type ElectronShellBridge = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
  listen: (event: string, handler: (payload: unknown) => void) => () => void
  pathForFile: (file: File) => string
}

export type ElectronDialogFilter = { name: string; extensions: string[] }

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
