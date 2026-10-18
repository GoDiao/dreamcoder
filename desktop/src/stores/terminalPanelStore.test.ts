import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({
  destroyTerminalRuntime: vi.fn(),
}))

vi.mock('../lib/terminalRuntime', () => ({
  destroyTerminalRuntime: runtimeMocks.destroyTerminalRuntime,
}))

import {
  SESSION_TERMINAL_RUNTIME_PREFIX,
  getShellDisplayName,
  useTerminalPanelStore,
} from './terminalPanelStore'

describe('terminalPanelStore', () => {
  beforeEach(() => {
    runtimeMocks.destroyTerminalRuntime.mockReset()
    useTerminalPanelStore.setState(useTerminalPanelStore.getInitialState(), true)
  })

  it('creates one terminal per session on first use', () => {
    const store = useTerminalPanelStore.getState()
    store.ensureSession('session-a')
    store.ensureSession('session-a')

    const state = useTerminalPanelStore.getState().terminalsBySession['session-a']
    expect(state?.terminals).toEqual([{ id: `${SESSION_TERMINAL_RUNTIME_PREFIX}session-a`, index: 1 }])
    expect(state?.activeTerminalId).toBe(`${SESSION_TERMINAL_RUNTIME_PREFIX}session-a`)
    expect(useTerminalPanelStore.getState().terminalsBySession['session-b']).toBeUndefined()
  })

  it('adds, switches and closes terminals, never closing the last one', () => {
    const store = useTerminalPanelStore.getState()
    store.ensureSession('s')
    const second = store.addTerminal('s')
    const third = store.addTerminal('s')

    let state = useTerminalPanelStore.getState().terminalsBySession.s!
    expect(state.terminals.map((terminal) => terminal.index)).toEqual([1, 2, 3])
    expect(state.activeTerminalId).toBe(third)

    store.setActiveTerminal('s', second)
    store.closeTerminal('s', second)
    state = useTerminalPanelStore.getState().terminalsBySession.s!
    expect(runtimeMocks.destroyTerminalRuntime).toHaveBeenCalledWith(second)
    expect(state.terminals.map((terminal) => terminal.index)).toEqual([1, 3])
    expect(state.activeTerminalId).toBe(third)

    store.closeTerminal('s', third)
    store.closeTerminal('s', state.terminals[0]!.id)
    state = useTerminalPanelStore.getState().terminalsBySession.s!
    expect(state.terminals).toHaveLength(1)
    expect(runtimeMocks.destroyTerminalRuntime).toHaveBeenCalledTimes(2)

    expect(store.addTerminal('s')).toContain('::4')
  })

  it('records the shell name and destroys every runtime when the session is cleared', () => {
    const store = useTerminalPanelStore.getState()
    store.ensureSession('s')
    const second = store.addTerminal('s')
    store.setTerminalShell('s', second, 'zsh')

    expect(useTerminalPanelStore.getState().terminalsBySession.s?.terminals[1]?.shell).toBe('zsh')

    store.clearSession('s')
    expect(runtimeMocks.destroyTerminalRuntime).toHaveBeenCalledTimes(2)
    expect(useTerminalPanelStore.getState().terminalsBySession.s).toBeUndefined()
  })

  it('derives a display name from a shell path', () => {
    expect(getShellDisplayName('/bin/zsh')).toBe('zsh')
    expect(getShellDisplayName('C:\\Windows\\System32\\cmd.exe')).toBe('cmd')
    expect(getShellDisplayName(undefined)).toBeUndefined()
  })
})
