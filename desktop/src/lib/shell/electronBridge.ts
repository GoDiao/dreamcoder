export const ELECTRON_BRIDGE_KEY = 'dreamcoderShell'

export type ElectronShellBridge = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
  listen: (event: string, handler: (payload: unknown) => void) => () => void
}

export type ElectronDialogFilter = { name: string; extensions: string[] }

export type ElectronOpenDialogInput = {
  title?: string
  directory: boolean
  multiple: boolean
  filters?: ElectronDialogFilter[]
}
