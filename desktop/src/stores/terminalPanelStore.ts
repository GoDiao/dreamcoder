import { create } from 'zustand'
import { destroyTerminalRuntime } from '../lib/terminalRuntime'

export const SESSION_TERMINAL_RUNTIME_PREFIX = '__session_terminal__'

export type SessionTerminal = {
  /** Runtime id in the terminal runtime registry. */
  id: string
  /** 1-based number shown in the tab title. */
  index: number
  /** Shell name reported by the running terminal, e.g. "zsh". */
  shell?: string
}

type SessionTerminalState = {
  terminals: SessionTerminal[]
  activeTerminalId: string
  nextIndex: number
}

type TerminalPanelStore = {
  terminalsBySession: Record<string, SessionTerminalState | undefined>

  ensureSession: (sessionId: string) => void
  addTerminal: (sessionId: string) => string
  closeTerminal: (sessionId: string, terminalId: string) => void
  setActiveTerminal: (sessionId: string, terminalId: string) => void
  setTerminalShell: (sessionId: string, terminalId: string, shell: string) => void
  getActiveTerminalId: (sessionId: string) => string | undefined
  clearSession: (sessionId: string) => void
}

function createRuntimeId(sessionId: string, index: number) {
  return index === 1
    ? `${SESSION_TERMINAL_RUNTIME_PREFIX}${sessionId}`
    : `${SESSION_TERMINAL_RUNTIME_PREFIX}${sessionId}::${index}`
}

function createInitialState(sessionId: string): SessionTerminalState {
  const id = createRuntimeId(sessionId, 1)
  return {
    terminals: [{ id, index: 1 }],
    activeTerminalId: id,
    nextIndex: 2,
  }
}

function removeRecordKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record
  const { [key]: _removed, ...rest } = record
  return rest
}

export function getShellDisplayName(shell: string | undefined) {
  if (!shell) return undefined
  const name = shell.split(/[\\/]/).pop()?.replace(/\.exe$/i, '')
  return name || undefined
}

export const useTerminalPanelStore = create<TerminalPanelStore>((set, get) => ({
  terminalsBySession: {},

  ensureSession: (sessionId) => {
    if (get().terminalsBySession[sessionId]) return
    set((state) => ({
      terminalsBySession: {
        ...state.terminalsBySession,
        [sessionId]: createInitialState(sessionId),
      },
    }))
  },

  addTerminal: (sessionId) => {
    const current = get().terminalsBySession[sessionId]
    if (!current) {
      const initial = createInitialState(sessionId)
      set((state) => ({
        terminalsBySession: { ...state.terminalsBySession, [sessionId]: initial },
      }))
      return initial.activeTerminalId
    }

    const id = createRuntimeId(sessionId, current.nextIndex)
    set((state) => ({
      terminalsBySession: {
        ...state.terminalsBySession,
        [sessionId]: {
          terminals: [...current.terminals, { id, index: current.nextIndex }],
          activeTerminalId: id,
          nextIndex: current.nextIndex + 1,
        },
      },
    }))
    return id
  },

  closeTerminal: (sessionId, terminalId) => {
    const current = get().terminalsBySession[sessionId]
    if (!current || current.terminals.length <= 1) return
    const index = current.terminals.findIndex((terminal) => terminal.id === terminalId)
    if (index < 0) return

    destroyTerminalRuntime(terminalId)
    const terminals = current.terminals.filter((terminal) => terminal.id !== terminalId)
    const activeTerminalId = current.activeTerminalId === terminalId
      ? terminals[Math.min(index, terminals.length - 1)]!.id
      : current.activeTerminalId

    set((state) => ({
      terminalsBySession: {
        ...state.terminalsBySession,
        [sessionId]: { ...current, terminals, activeTerminalId },
      },
    }))
  },

  setActiveTerminal: (sessionId, terminalId) =>
    set((state) => {
      const current = state.terminalsBySession[sessionId]
      if (!current || !current.terminals.some((terminal) => terminal.id === terminalId)) return state
      return {
        terminalsBySession: {
          ...state.terminalsBySession,
          [sessionId]: { ...current, activeTerminalId: terminalId },
        },
      }
    }),

  setTerminalShell: (sessionId, terminalId, shell) =>
    set((state) => {
      const current = state.terminalsBySession[sessionId]
      const terminal = current?.terminals.find((item) => item.id === terminalId)
      if (!current || !terminal || terminal.shell === shell) return state
      return {
        terminalsBySession: {
          ...state.terminalsBySession,
          [sessionId]: {
            ...current,
            terminals: current.terminals.map((item) => item.id === terminalId ? { ...item, shell } : item),
          },
        },
      }
    }),

  getActiveTerminalId: (sessionId) => get().terminalsBySession[sessionId]?.activeTerminalId,

  clearSession: (sessionId) =>
    set((state) => {
      const current = state.terminalsBySession[sessionId]
      current?.terminals.forEach((terminal) => destroyTerminalRuntime(terminal.id))
      return {
        terminalsBySession: removeRecordKey(state.terminalsBySession, sessionId),
      }
    }),
}))
