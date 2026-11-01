import type { ServerWebSocket } from 'bun'
import { handleWebSocket, type WebSocketData } from './handler.js'
import { browserHostChannel, type BrowserHostSocketData } from '../browserHost/hostChannel.js'
import { terminalSocket, type TerminalSocketData } from './terminalSocket.js'

export type ServerSocketData = WebSocketData | TerminalSocketData | BrowserHostSocketData

function isTerminalSocket(ws: ServerWebSocket<ServerSocketData>): ws is ServerWebSocket<TerminalSocketData> {
  return ws.data.channel === 'terminal'
}

function isBrowserHostSocket(ws: ServerWebSocket<ServerSocketData>): ws is ServerWebSocket<BrowserHostSocketData> {
  return ws.data.channel === 'browser-host'
}

function asSessionSocket(ws: ServerWebSocket<ServerSocketData>): ServerWebSocket<WebSocketData> {
  return ws as ServerWebSocket<WebSocketData>
}

export const serverWebSocket = {
  open(ws: ServerWebSocket<ServerSocketData>) {
    if (isTerminalSocket(ws)) return void terminalSocket.open(ws)
    if (isBrowserHostSocket(ws)) return browserHostChannel.open(ws)
    handleWebSocket.open(asSessionSocket(ws))
  },

  message(ws: ServerWebSocket<ServerSocketData>, rawMessage: string | Buffer) {
    if (isTerminalSocket(ws)) return terminalSocket.message(ws, rawMessage)
    if (isBrowserHostSocket(ws)) return browserHostChannel.message(ws, rawMessage)
    handleWebSocket.message(asSessionSocket(ws), rawMessage)
  },

  close(ws: ServerWebSocket<ServerSocketData>, code: number, reason: string) {
    if (isTerminalSocket(ws)) return terminalSocket.close(ws)
    if (isBrowserHostSocket(ws)) return browserHostChannel.close(ws)
    handleWebSocket.close(asSessionSocket(ws), code, reason)
  },

  drain(ws: ServerWebSocket<ServerSocketData>) {
    if (isTerminalSocket(ws) || isBrowserHostSocket(ws)) return
    handleWebSocket.drain(asSessionSocket(ws))
  },
}
