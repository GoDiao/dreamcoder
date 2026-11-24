import type { StdoutMessage } from '../../entrypoints/sdk/controlTypes.js'

export type Transport = {
  connect(): Promise<void>
  write(message: StdoutMessage): Promise<void>
  close(): void
  setOnData(callback: (data: string) => void): void
  setOnClose(callback: (closeCode?: number) => void): void
  isConnectedStatus(): boolean
  isClosedStatus(): boolean
}
