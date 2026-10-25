import type { ServerWebSocket } from 'bun'
import { handleWebSocket, type WebSocketData } from './handler.js'
import { terminalSocket, type TerminalSocketData } from './terminalSocket.js'

export type ServerSocketData = WebSocketData | TerminalSocketData

function isTerminalSocket(ws: ServerWebSocket<ServerSocketData>): ws is ServerWebSocket<TerminalSocketData> {
  return ws.data.channel === 'terminal'
}

function asSessionSocket(ws: ServerWebSocket<ServerSocketData>): ServerWebSocket<WebSocketData> {
  return ws as ServerWebSocket<WebSocketData>
}

export const serverWebSocket = {
  open(ws: ServerWebSocket<ServerSocketData>) {
    if (isTerminalSocket(ws)) return void terminalSocket.open(ws)
    handleWebSocket.open(asSessionSocket(ws))
  },

  message(ws: ServerWebSocket<ServerSocketData>, rawMessage: string | Buffer) {
    if (isTerminalSocket(ws)) return terminalSocket.message(ws, rawMessage)
    handleWebSocket.message(asSessionSocket(ws), rawMessage)
  },

  close(ws: ServerWebSocket<ServerSocketData>, code: number, reason: string) {
    if (isTerminalSocket(ws)) return terminalSocket.close(ws)
    handleWebSocket.close(asSessionSocket(ws), code, reason)
  },

  drain(ws: ServerWebSocket<ServerSocketData>) {
    if (isTerminalSocket(ws)) return
    handleWebSocket.drain(asSessionSocket(ws))
  },
}
