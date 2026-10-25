import { isTauriRuntime } from '../lib/desktopRuntime'
import * as shell from '../lib/shell'
import type { DesktopTerminalSettings } from '../types/settings'

export type { TerminalSpawnResult, TerminalOutputPayload, TerminalExitPayload, TerminalShellDetection } from '../lib/shell'

async function inDesktop<T>(action: () => Promise<T>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error('Terminal is available in the desktop app runtime.')
  }
  return action()
}

export const terminalApi = {
  isAvailable: isTauriRuntime,

  spawn(input: { cols: number; rows: number; cwd?: string; settings: DesktopTerminalSettings }) {
    return inDesktop(() => shell.spawnTerminal(input))
  },

  write(sessionId: number, data: string) {
    return inDesktop(() => shell.writeTerminal(sessionId, data))
  },

  resize(sessionId: number, cols: number, rows: number) {
    return inDesktop(() => shell.resizeTerminal(sessionId, cols, rows))
  },

  kill(sessionId: number) {
    return inDesktop(() => shell.killTerminal(sessionId))
  },

  onOutput: shell.onTerminalOutput,
  onExit: shell.onTerminalExit,

  detectDefaultShell(settings: DesktopTerminalSettings) {
    return inDesktop(() => shell.detectDefaultTerminalShell(settings))
  },

  validateBashPath(path: string | null) {
    return inDesktop(() => shell.validateTerminalBashPath(path))
  },
}
