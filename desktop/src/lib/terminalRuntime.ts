import type { Terminal as XTermTerminal, IDisposable } from '@xterm/xterm'
import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit'
import { terminalApi } from '../api/terminal'

export type TerminalStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error' | 'unavailable'

export type TerminalShellInfo = {
  shell: string
  cwd: string
}

export type TerminalRuntime = {
  id: string
  terminal: XTermTerminal | null
  fit: XTermFitAddon | null
  nativeSessionId: number | null
  unlisteners: Array<() => void>
  dataDisposable: IDisposable | null
  status: TerminalStatus
  error: string | null
  shellInfo: TerminalShellInfo | null
  listeners: Set<() => void>
}

const runtimes = new Map<string, TerminalRuntime>()
let localRuntimeCounter = 0

function xtermMemLog(event: string, id: string) {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const m = process.memoryUsage()
    console.log(
      `[mem:xterm] ${event} id=${id} count=${runtimes.size}` +
      ` rss=${(m.rss / 1024 / 1024).toFixed(1)}MB` +
      ` heapUsed=${(m.heapUsed / 1024 / 1024).toFixed(1)}MB`
    )
  }
}

export function createLocalTerminalRuntimeId() {
  localRuntimeCounter += 1
  return `local-terminal-${localRuntimeCounter}`
}

export function getTerminalRuntime(id: string, initialStatus: TerminalStatus): TerminalRuntime {
  const existing = runtimes.get(id)
  if (existing) return existing

  const runtime: TerminalRuntime = {
    id,
    terminal: null,
    fit: null,
    nativeSessionId: null,
    unlisteners: [],
    dataDisposable: null,
    status: initialStatus,
    error: null,
    shellInfo: null,
    listeners: new Set(),
  }
  runtimes.set(id, runtime)
  xtermMemLog('create', id)
  return runtime
}

export function updateTerminalRuntime(
  runtime: TerminalRuntime,
  patch: Partial<Pick<TerminalRuntime, 'terminal' | 'fit' | 'nativeSessionId' | 'status' | 'error' | 'shellInfo'>>,
) {
  Object.assign(runtime, patch)
  notifyTerminalRuntime(runtime)
}

export function notifyTerminalRuntime(runtime: TerminalRuntime) {
  runtime.listeners.forEach((listener) => listener())
}

export function subscribeTerminalRuntime(runtime: TerminalRuntime, listener: () => void) {
  runtime.listeners.add(listener)
  return () => {
    runtime.listeners.delete(listener)
  }
}

export function attachTerminalRuntime(runtime: TerminalRuntime, host: HTMLElement) {
  const terminal = runtime.terminal
  if (!terminal) return

  const element = terminal.element
  if (element) {
    if (element.parentElement !== host) {
      host.replaceChildren(element)
    }
  } else {
    host.innerHTML = ''
    terminal.open(host)
  }
  runtime.fit?.fit()
}

export function destroyTerminalRuntime(id: string) {
  const runtime = runtimes.get(id)
  if (!runtime) return
  runtimes.delete(id)
  xtermMemLog('destroy', id)

  const sessionId = runtime.nativeSessionId
  runtime.nativeSessionId = null
  if (sessionId) {
    void terminalApi.kill(sessionId).catch(() => {})
  }

  runtime.dataDisposable?.dispose()
  runtime.dataDisposable = null
  runtime.unlisteners.forEach((unlisten) => unlisten())
  runtime.unlisteners = []
  runtime.terminal?.dispose()
  runtime.terminal = null
  runtime.fit = null
  runtime.listeners.clear()
}
