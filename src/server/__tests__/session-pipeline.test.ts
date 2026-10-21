import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import { OutputPipeline } from '../session/outputPipeline.js'
import type { SessionStateEvent } from '../session/state/types.js'
import type { ServerMessage } from '../ws/protocol.js'
import {
  __resetWebSocketHandlerStateForTests,
  closeSessionConnection,
  getSessionState,
  handleWebSocket,
  type WebSocketData,
} from '../ws/handler.js'
import { conversationService } from '../services/conversationService.js'
import { sessionService } from '../services/sessionService.js'
import { SessionStateStore, sessionStateStore } from '../session/state/store.js'
import { peekSessionRuntime } from '../ws/sessionRuntime.js'

function fakeSource() {
  const callbacks: Array<(msg: any) => void> = []
  return {
    callbacks,
    onOutput(_sessionId: string, callback: (msg: any) => void) {
      callbacks.push(callback)
    },
    removeOutputCallback(_sessionId: string, callback: (msg: any) => void) {
      const index = callbacks.indexOf(callback)
      if (index >= 0) callbacks.splice(index, 1)
    },
  }
}

describe('output pipeline', () => {
  it('drops output from a process generation it no longer follows', () => {
    const source = { ...fakeSource(), removeOutputCallback: () => {} }
    const broadcasts: ServerMessage[] = []
    const events: SessionStateEvent[] = []
    const pipeline = new OutputPipeline('s1', source, {
      broadcast: (_id, message) => broadcasts.push(message),
      apply: (_id, event) => events.push(event),
    })

    pipeline.attach(1)
    pipeline.attach(2)
    pipeline.gate = undefined
    expect(source.callbacks).toHaveLength(2)

    for (const callback of source.callbacks) {
      callback({ type: 'result', usage: { input_tokens: 0, output_tokens: 0 } })
    }

    expect(broadcasts).toEqual([{ type: 'message_complete', usage: { input_tokens: 0, output_tokens: 0 } }])
    expect(events).toEqual([{ type: 'turn_ended' }])
  })

  it('keeps tracking state while forwarding nothing before the first turn', () => {
    const source = fakeSource()
    const broadcasts: ServerMessage[] = []
    const events: SessionStateEvent[] = []
    const pipeline = new OutputPipeline('s1', source, {
      broadcast: (_id, message) => broadcasts.push(message),
      apply: (_id, event) => events.push(event),
    })
    pipeline.attach(1)

    source.callbacks[0]!({ type: 'system', subtype: 'init', cwd: '/repo', model: 'model-a', slash_commands: ['review'] })

    expect(broadcasts).toEqual([])
    expect(events).toContainEqual({ type: 'workspace_reported', workspace: { workDir: '/repo', workDirExists: true } })
    expect(events).toContainEqual({ type: 'runtime_effective_reported', modelId: 'model-a' })
    expect(events).toContainEqual({ type: 'slash_commands_reported', commands: [{ name: 'review', description: '' }] })
  })

  it('reads the CLI turn state events as turn boundaries without forwarding them', () => {
    const source = fakeSource()
    const broadcasts: ServerMessage[] = []
    const events: SessionStateEvent[] = []
    const pipeline = new OutputPipeline('s1', source, {
      broadcast: (_id, message) => broadcasts.push(message),
      apply: (_id, event) => events.push(event),
    })
    pipeline.attach(1)
    pipeline.gate = undefined
    const emit = source.callbacks[0]!

    emit({ type: 'system', subtype: 'session_state_changed', state: 'running', uuid: 'u1', session_id: 's1' })
    emit({ type: 'system', subtype: 'session_state_changed', state: 'requires_action', uuid: 'u2', session_id: 's1' })
    emit({ type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 2 } })
    emit({ type: 'system', subtype: 'session_state_changed', state: 'idle', uuid: 'u3', session_id: 's1' })
    emit({ type: 'system', subtype: 'session_state_changed', state: 'bogus', uuid: 'u4', session_id: 's1' })

    expect(broadcasts).toEqual([{ type: 'message_complete', usage: { input_tokens: 1, output_tokens: 2 } }])
    expect(events.map((event) => event.type === 'turn_state_reported' ? `state:${event.state}` : event.type)).toEqual([
      'state:running',
      'state:requires_action',
      'turn_ended',
      'state:idle',
    ])
  })

  it('ends the turn on the trailing idle event and keeps it idle when the result came first', () => {
    const store = new SessionStateStore()
    const source = fakeSource()
    const pipeline = new OutputPipeline('s1', source, {
      broadcast: () => {},
      apply: (id, event) => { store.apply(id, event) },
    })
    pipeline.attach(1)
    pipeline.gate = undefined
    const emit = source.callbacks[0]!

    emit({ type: 'system', subtype: 'session_state_changed', state: 'running', uuid: 'u1', session_id: 's1' })
    expect(store.get('s1').turn.phase).toBe('running')
    emit({ type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 0, output_tokens: 0 } })
    emit({ type: 'system', subtype: 'session_state_changed', state: 'idle', uuid: 'u2', session_id: 's1' })
    expect(store.get('s1').turn).toEqual({ phase: 'idle' })

    emit({ type: 'system', subtype: 'session_state_changed', state: 'running', uuid: 'u3', session_id: 's1' })
    emit({ type: 'system', subtype: 'session_state_changed', state: 'idle', uuid: 'u4', session_id: 's1' })
    expect(store.get('s1').turn).toEqual({ phase: 'idle' })
  })

  it('starts each process generation with a fresh stream state', () => {
    const source = fakeSource()
    const pipeline = new OutputPipeline('s1', source, { broadcast: () => {}, apply: () => {} })
    pipeline.attach(1)
    pipeline.stream.activeBlockTypes.set(0, 'text')
    pipeline.stream.stopRequested = true

    pipeline.attach(2)

    expect(pipeline.stream.activeBlockTypes.size).toBe(0)
    expect(pipeline.stream.stopRequested).toBe(false)
  })
})

function makeClientSocket(sessionId: string) {
  const sent: string[] = []
  return {
    data: {
      sessionId,
      connectedAt: Date.now(),
      channel: 'client',
      clientKind: 'desktop',
      sdkToken: null,
      serverPort: 0,
      serverHost: '127.0.0.1',
    },
    send: mock((payload: string) => {
      sent.push(payload)
    }),
    close: mock(() => {}),
    sent,
  } as unknown as ServerWebSocket<WebSocketData> & { sent: string[] }
}

describe('session state in the WebSocket handler', () => {
  afterEach(() => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
  })

  it('keeps showing the mode the CLI is really in when it rejects a switch', async () => {
    const sessionId = `mode-rejected-${crypto.randomUUID()}`
    const callbacks: Array<(msg: any) => void> = []
    spyOn(conversationService, 'hasSession').mockReturnValue(true)
    spyOn(conversationService, 'onOutput').mockImplementation((_id, callback) => {
      callbacks.push(callback)
    })
    spyOn(conversationService, 'setPermissionMode').mockReturnValue('mode-request-1')
    spyOn(sessionService, 'appendSessionPermissionMode').mockResolvedValue()
    spyOn(sessionService, 'getSessionRestoreInfo').mockResolvedValue(null)
    const ws = makeClientSocket(sessionId)
    handleWebSocket.open(ws)
    sessionStateStore.apply(sessionId, { type: 'permission_effective_reported', mode: 'default' })

    handleWebSocket.message(ws, JSON.stringify({ type: 'set_permission_mode', mode: 'plan' }))
    await Bun.sleep(0)
    for (const callback of callbacks) {
      callback({
        type: 'control_response',
        response: { subtype: 'error', request_id: 'mode-request-1', error: 'Plan mode is disabled' },
      })
    }

    const state = getSessionState(sessionId)!
    expect(state.permission).toEqual({ desired: 'plan', effective: 'default' })
    expect(state.process.lastError).toEqual({ code: 'PERMISSION_MODE_REJECTED', message: 'Plan mode is disabled' })
  })

  it('clears open permission requests when the process stops', () => {
    const sessionId = `process-stop-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    spyOn(sessionService, 'getSessionRestoreInfo').mockResolvedValue(null)
    handleWebSocket.open(ws)
    sessionStateStore.apply(sessionId, { type: 'process_phase_changed', phase: 'running', generation: 4 })
    sessionStateStore.apply(sessionId, {
      type: 'permission_request_opened',
      at: 1,
      request: { requestId: 'req-9', toolName: 'Bash', input: {} },
    })

    sessionStateStore.apply(sessionId, { type: 'process_phase_changed', phase: 'stopped', generation: 4 })

    expect(getSessionState(sessionId)?.pendingPermissions).toEqual([])
    expect(ws.sent.map((payload) => JSON.parse(payload))).toContainEqual(expect.objectContaining({
      type: 'session_patch',
      changes: expect.objectContaining({ pendingPermissions: [] }),
    }))
  })

  it('shows the mode a process was actually launched with', () => {
    const sessionId = `launch-mode-${crypto.randomUUID()}`
    sessionStateStore.apply(sessionId, { type: 'permission_desired_changed', mode: 'default' })

    ;(conversationService as any).emitProcessEvent({
      sessionId,
      generation: 1,
      phase: 'running',
      permissionMode: 'bypassPermissions',
    })

    expect(getSessionState(sessionId)?.permission).toEqual({ desired: 'default', effective: 'bypassPermissions' })
    expect(getSessionState(sessionId)?.process).toEqual({ phase: 'running', generation: 1 })
  })

  it('forgets answered permission requests once the turn ends', () => {
    const sessionId = `answered-${crypto.randomUUID()}`
    spyOn(sessionService, 'getSessionRestoreInfo').mockResolvedValue(null)
    spyOn(conversationService, 'respondToPermission').mockReturnValue(true as never)
    const ws = makeClientSocket(sessionId)
    handleWebSocket.open(ws)
    sessionStateStore.apply(sessionId, { type: 'turn_started', at: 1 })
    sessionStateStore.apply(sessionId, {
      type: 'permission_request_opened',
      at: 2,
      request: { requestId: 'req-a', toolName: 'Bash', input: {} },
    })

    handleWebSocket.message(ws, JSON.stringify({ type: 'permission_response', requestId: 'req-a', allowed: true }))
    expect(peekSessionRuntime(sessionId)?.answeredPermissions.size).toBe(1)
    sessionStateStore.apply(sessionId, { type: 'turn_ended' })

    expect(peekSessionRuntime(sessionId)?.answeredPermissions.size).toBe(0)
  })

  it('frees the process generation counter with the session', () => {
    const sessionId = `generation-free-${crypto.randomUUID()}`
    ;(conversationService as any).nextGeneration(sessionId)
    const ws = makeClientSocket(sessionId)
    spyOn(sessionService, 'getSessionRestoreInfo').mockResolvedValue(null)
    handleWebSocket.open(ws)

    closeSessionConnection(sessionId)

    expect((conversationService as any).generations.has(sessionId)).toBe(false)
  })

  it('does not force-kill a process that replaced the one being stopped', () => {
    const sessionId = `stop-generation-${crypto.randomUUID()}`
    let generation = 1
    spyOn(conversationService, 'hasSession').mockReturnValue(true)
    spyOn(conversationService, 'getGeneration').mockImplementation(() => generation)
    spyOn(conversationService, 'onOutput').mockImplementation(() => {})
    spyOn(conversationService, 'sendInterrupt').mockReturnValue(true)
    spyOn(sessionService, 'getSessionRestoreInfo').mockResolvedValue(null)
    const stopSession = spyOn(conversationService, 'stopSession').mockImplementation(() => {})
    const timers: Array<() => void> = []
    spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
      timers.push(callback)
      return 0
    }) as any)
    const ws = makeClientSocket(sessionId)
    handleWebSocket.open(ws)

    handleWebSocket.message(ws, JSON.stringify({ type: 'stop_generation' }))
    generation = 2
    for (const timer of timers) timer()

    expect(stopSession).not.toHaveBeenCalled()
  })
})
