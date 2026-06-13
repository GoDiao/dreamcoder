import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { logForDebugging } from '../../utils/debug.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import type { Transport } from './Transport.js'

/**
 * PipeTransport communicates via stdin/stdout instead of WebSocket.
 * This eliminates one network hop when the CLI is spawned as a child process
 * by the server, reducing latency by ~2-5ms per streaming delta.
 *
 * Protocol: newline-delimited JSON over stdin (read) and stdout (write).
 */
export class PipeTransport implements Transport {
  private onData?: (data: string) => void
  private onCloseCallback?: (closeCode?: number) => void
  private onConnectCallback?: () => void
  private state: 'idle' | 'connected' | 'closed' = 'idle'
  private stdinBuffer = ''
  private readLoopPromise: Promise<void> | null = null

  constructor() {}

  async connect(): Promise<void> {
    if (this.state !== 'idle') {
      logForDebugging('PipeTransport: Cannot connect, current state is ' + this.state, { level: 'error' })
      return
    }

    this.state = 'connected'
    logForDebugging('PipeTransport: Connected via stdin/stdout')

    // Start reading from stdin
    this.readLoopPromise = this.readStdinLoop()

    // Notify connect
    this.onConnectCallback?.()
  }

  private async readStdinLoop(): Promise<void> {
    const decoder = new TextDecoder()

    try {
      // Read from process.stdin
      const reader = (process.stdin as any).readable?.getReader?.() ?? null

      if (reader) {
        // Bun/Node with readable stream
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          this.processChunk(chunk)
        }
      } else {
        // Fallback: read from stdin using data events
        process.stdin.setEncoding('utf8')
        process.stdin.resume()

        await new Promise<void>((resolve) => {
          process.stdin.on('data', (chunk: string) => {
            this.processChunk(chunk)
          })
          process.stdin.on('end', () => {
            resolve()
          })
          process.stdin.on('error', (err) => {
            logForDebugging('PipeTransport: stdin error: ' + err.message, { level: 'error' })
            resolve()
          })
        })
      }
    } catch (err) {
      logForDebugging('PipeTransport: stdin read error: ' + String(err), { level: 'error' })
    }

    // Connection closed
    this.state = 'closed'
    this.onCloseCallback?.()
  }

  private processChunk(chunk: string): void {
    this.stdinBuffer += chunk

    // Process complete lines
    const lines = this.stdinBuffer.split('\n')
    // Keep the last incomplete line in the buffer
    this.stdinBuffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && this.onData) {
        this.onData(trimmed + '\n')
      }
    }
  }

  send(data: string): void {
    if (this.state !== 'connected') {
      logForDebugging('PipeTransport: Cannot send, state is ' + this.state, { level: 'error' })
      return
    }

    // Write to stdout
    process.stdout.write(data)
  }

  close(): void {
    if (this.state === 'closed') return

    this.state = 'closed'
    logForDebugging('PipeTransport: Closing')

    // Close stdin to signal we're done
    process.stdin.destroy()

    this.onCloseCallback?.()
  }

  isConnectedStatus(): boolean {
    return this.state === 'connected'
  }

  isClosedStatus(): boolean {
    return this.state === 'closed'
  }

  setOnData(callback: (data: string) => void): void {
    this.onData = callback
  }

  setOnConnect(callback: () => void): void {
    this.onConnectCallback = callback
  }

  setOnClose(callback: (closeCode?: number) => void): void {
    this.onCloseCallback = callback
  }

  getStateLabel(): string {
    return this.state
  }

  async write(message: StdoutMessage): Promise<void> {
    const line = jsonStringify(message) + '\n'
    this.send(line)
  }
}
