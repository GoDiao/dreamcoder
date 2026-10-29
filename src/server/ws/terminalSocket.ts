import type { ServerWebSocket } from 'bun'
import { SettingsService } from '../services/settingsService.js'
import {
  readDesktopTerminalConfig,
  startTerminal,
  type TerminalProcess,
} from '../services/terminalService.js'

export type TerminalSocketData = {
  channel: 'terminal'
  cols: number
  rows: number
  cwd: string | undefined
  process: TerminalProcess | null
  closed: boolean
}

export type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

export type TerminalServerMessage =
  | { type: 'started'; shell: string; cwd: string; warning: string | null }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number; signal: string | null }
  | { type: 'error'; message: string }

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

export function createTerminalSocketData(url: URL): TerminalSocketData {
  return {
    channel: 'terminal',
    cols: readDimension(url.searchParams.get('cols'), DEFAULT_COLS),
    rows: readDimension(url.searchParams.get('rows'), DEFAULT_ROWS),
    cwd: url.searchParams.get('cwd') || undefined,
    process: null,
    closed: false,
  }
}

export function parseTerminalClientMessage(raw: string): TerminalClientMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const message = value as Record<string, unknown>
  if (message.type === 'input' && typeof message.data === 'string') {
    return { type: 'input', data: message.data }
  }
  if (message.type === 'resize' && isDimension(message.cols) && isDimension(message.rows)) {
    return { type: 'resize', cols: message.cols, rows: message.rows }
  }
  return null
}

export const terminalSocket = {
  async open(ws: ServerWebSocket<TerminalSocketData>) {
    try {
      const settings = await new SettingsService().getUserSettings()
      const process = await startTerminal({
        cols: ws.data.cols,
        rows: ws.data.rows,
        cwd: ws.data.cwd,
        config: readDesktopTerminalConfig(settings),
        onData: (data) => send(ws, { type: 'output', data }),
        onExit: (exit) => {
          ws.data.process = null
          send(ws, { type: 'exit', ...exit })
          ws.close(1000, 'Terminal exited')
        },
      })
      if (ws.data.closed) {
        process.kill()
        return
      }
      ws.data.process = process
      send(ws, { type: 'started', shell: process.shell, cwd: process.cwd, warning: process.warning })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[terminal] Failed to start a terminal', error)
      send(ws, { type: 'error', message })
      ws.close(1011, 'Terminal failed to start')
    }
  },

  message(ws: ServerWebSocket<TerminalSocketData>, rawMessage: string | Buffer) {
    const message = parseTerminalClientMessage(typeof rawMessage === 'string' ? rawMessage : rawMessage.toString())
    if (!message) {
      send(ws, { type: 'error', message: 'Invalid terminal message' })
      return
    }
    const process = ws.data.process
    if (!process) return
    try {
      if (message.type === 'input') process.write(message.data)
      else process.resize(message.cols, message.rows)
    } catch (error) {
      send(ws, { type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  },

  close(ws: ServerWebSocket<TerminalSocketData>) {
    ws.data.closed = true
    ws.data.process?.kill()
    ws.data.process = null
  },
}

function send(ws: ServerWebSocket<TerminalSocketData>, message: TerminalServerMessage) {
  ws.send(JSON.stringify(message))
}

function readDimension(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return isDimension(parsed) ? parsed : fallback
}

function isDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1000
}
