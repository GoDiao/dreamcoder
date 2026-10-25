import { isTauriRuntime } from '../lib/desktopRuntime'
import { api, getAuthToken, getBaseUrl } from './client'

export type TerminalShellDetection = { shell: string; platform: 'windows' | 'macos' | 'linux' }
export type TerminalExit = { code: number; signal: string | null }

export type TerminalServerMessage =
  | { type: 'started'; shell: string; cwd: string; warning: string | null }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number; signal: string | null }
  | { type: 'error'; message: string }

export type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

export type TerminalConnection = {
  shell: string
  cwd: string
  warning: string | null
  write(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}

export type OpenTerminalInput = {
  cols: number
  rows: number
  cwd?: string
  onOutput(data: string): void
  onExit(exit: TerminalExit): void
  onError(message: string): void
}

function requireDesktop() {
  if (!isTauriRuntime()) {
    throw new Error('Terminal is available in the desktop app runtime.')
  }
}

export function buildTerminalSocketUrl(input: { cols: number; rows: number; cwd?: string }) {
  const url = new URL(getBaseUrl())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  url.pathname = `${basePath}/terminal`
  url.search = ''
  url.searchParams.set('cols', String(input.cols))
  url.searchParams.set('rows', String(input.rows))
  if (input.cwd) url.searchParams.set('cwd', input.cwd)
  const token = getAuthToken()
  if (token) url.searchParams.set('token', token)
  return url.toString()
}

async function openTerminal(input: OpenTerminalInput): Promise<TerminalConnection> {
  requireDesktop()
  return new Promise<TerminalConnection>((resolve, reject) => {
    const ws = new WebSocket(buildTerminalSocketUrl(input))
    let started = false
    let finished = false

    const send = (message: TerminalClientMessage) => {
      if (ws.readyState !== WebSocket.OPEN) throw new Error('Terminal is not connected.')
      ws.send(JSON.stringify(message))
    }

    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as TerminalServerMessage
      switch (message.type) {
        case 'started':
          started = true
          resolve({
            shell: message.shell,
            cwd: message.cwd,
            warning: message.warning,
            write: (data) => send({ type: 'input', data }),
            resize: (cols, rows) => send({ type: 'resize', cols, rows }),
            close: () => {
              finished = true
              ws.close()
            },
          })
          break
        case 'output':
          input.onOutput(message.data)
          break
        case 'exit':
          finished = true
          input.onExit({ code: message.code, signal: message.signal })
          break
        case 'error':
          if (started) input.onError(message.message)
          else {
            finished = true
            reject(new Error(message.message))
          }
          break
      }
    }

    ws.onclose = () => {
      if (!started) reject(new Error('Terminal connection closed before the shell started.'))
      else if (!finished) input.onError('Terminal connection closed.')
      finished = true
    }
  })
}

export const terminalApi = {
  isAvailable: isTauriRuntime,

  open: openTerminal,

  async detectDefaultShell() {
    requireDesktop()
    return api.get<TerminalShellDetection>('/api/terminal/default-shell')
  },

  async validateBashPath(path: string | null) {
    requireDesktop()
    const result = await api.post<{ path: string | null }>('/api/terminal/validate-bash-path', { path })
    return result.path
  },
}
