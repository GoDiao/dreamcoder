import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import {
  __resetWebSocketHandlerStateForTests,
  getSessionState,
  handleWebSocket,
  type WebSocketData,
} from '../ws/handler.js'
import { conversationService } from '../services/conversationService.js'
import { sessionService } from '../services/sessionService.js'
import { sessionStateStore } from '../session/state/store.js'
import type { ClientKind } from '../ws/protocol.js'
import { SessionBrowserGrants } from '../browserHost/grants.js'

type FakeSocket = ServerWebSocket<WebSocketData> & { sent: string[] }

function makeClientSocket(sessionId: string, clientKind: ClientKind = 'desktop'): FakeSocket {
  const sent: string[] = []
  return {
    data: {
      sessionId,
      connectedAt: Date.now(),
      channel: 'client',
      clientKind,
      sdkToken: null,
      serverPort: 0,
      serverHost: '127.0.0.1',
    },
    send: mock((payload: string) => {
      sent.push(payload)
    }),
    close: mock(() => {}),
    sent,
  } as unknown as FakeSocket
}

function received(ws: FakeSocket) {
  return ws.sent.map((payload) => JSON.parse(payload))
}

function fakeCli() {
  const callbacks: Array<(msg: any) => void> = []
  spyOn(conversationService, 'hasSession').mockReturnValue(true)
  spyOn(conversationService, 'onOutput').mockImplementation((_sessionId, callback) => {
    callbacks.push(callback)
  })
  spyOn(conversationService, 'hasOutputCallback').mockImplementation((_sessionId, callback) =>
    callbacks.includes(callback),
  )
  spyOn(conversationService, 'removeOutputCallback').mockImplementation((_sessionId, callback) => {
    const index = callbacks.indexOf(callback)
    if (index >= 0) callbacks.splice(index, 1)
  })
  spyOn(sessionService, 'getSessionRestoreInfo').mockResolvedValue(null)
  return {
    callbacks,
    emit(msg: unknown) {
      for (const callback of [...callbacks]) callback(msg)
    },
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition')
    await Bun.sleep(5)
  }
}

const streamedToolCall = [
  { type: 'stream_event', event: { type: 'message_start' } },
  { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading.' } } },
  { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
  { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-1', name: 'Read' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"/tmp/a"}' } } },
  { type: 'stream_event', event: { type: 'content_block_stop', index: 1 } },
  {
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Reading.' }, { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/a' } }] },
  },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'hello' }] } },
]

describe('WebSocket broadcast to every client of a session', () => {
  afterEach(() => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
  })

  it('translates each CLI message once and sends both clients the same events', () => {
    const sessionId = `broadcast-${crypto.randomUUID()}`
    const cli = fakeCli()
    const desktop = makeClientSocket(sessionId)
    const phone = makeClientSocket(sessionId, 'h5')

    handleWebSocket.open(desktop)
    handleWebSocket.open(phone)
    desktop.sent.length = 0
    phone.sent.length = 0

    for (const msg of streamedToolCall) cli.emit(msg)

    expect(cli.callbacks).toHaveLength(1)
    expect(received(phone)).toEqual(received(desktop))
    const toolCompletions = received(desktop).filter((msg) => msg.type === 'tool_use_complete')
    expect(toolCompletions).toEqual([
      { type: 'tool_use_complete', toolName: 'Read', toolUseId: 'tool-1', input: { file_path: '/tmp/a' } },
    ])
    expect(received(desktop).filter((msg) => msg.type === 'content_delta' && msg.text)).toHaveLength(1)
  })

  it('tells every client that the turn stopped', () => {
    const sessionId = `broadcast-stop-${crypto.randomUUID()}`
    fakeCli()
    spyOn(conversationService, 'sendInterrupt').mockReturnValue(true)
    spyOn(globalThis, 'setTimeout').mockImplementation((() => 0) as any)
    const desktop = makeClientSocket(sessionId)
    const phone = makeClientSocket(sessionId, 'h5')
    handleWebSocket.open(desktop)
    handleWebSocket.open(phone)

    sessionStateStore.apply(sessionId, { type: 'turn_started', at: 1 })
    handleWebSocket.message(desktop, JSON.stringify({ type: 'stop_generation' }))

    expect(received(phone)).toContainEqual(expect.objectContaining({ type: 'session_patch', changes: { turn: { phase: 'idle' } } }))
  })
})

describe('WebSocket permission replies', () => {
  afterEach(() => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
  })

  it('takes the first reply, tells every client who answered, and rejects later replies', () => {
    const sessionId = `permission-first-${crypto.randomUUID()}`
    fakeCli()
    const respond = spyOn(conversationService, 'respondToPermission').mockReturnValue(true)
    sessionStateStore.apply(sessionId, {
      type: 'permission_request_opened',
      at: 1,
      request: { requestId: 'req-1', toolName: 'Bash', input: { command: 'ls' } },
    })
    const desktop = makeClientSocket(sessionId)
    const phone = makeClientSocket(sessionId, 'h5')
    handleWebSocket.open(desktop)
    handleWebSocket.open(phone)

    handleWebSocket.message(phone, JSON.stringify({ type: 'permission_response', requestId: 'req-1', allowed: false }))
    handleWebSocket.message(desktop, JSON.stringify({ type: 'permission_response', requestId: 'req-1', allowed: true }))

    expect(respond).toHaveBeenCalledTimes(1)
    expect(respond.mock.calls[0]?.slice(0, 3)).toEqual([sessionId, 'req-1', false])
    const resolved = { type: 'permission_resolved', requestId: 'req-1', allowed: false, by: 'h5' }
    expect(received(desktop)).toContainEqual(resolved)
    expect(received(phone)).toContainEqual(resolved)
    expect(received(desktop)).toContainEqual(expect.objectContaining({ type: 'error', code: 'PERMISSION_ALREADY_RESOLVED' }))
    expect(received(phone).some((msg) => msg.type === 'error')).toBe(false)
  })

  it('shows a pending browser grant to every client but does not let the open WebSocket answer it', async () => {
    const sessionId = `browser-grant-${crypto.randomUUID()}`
    fakeCli()
    const respond = spyOn(conversationService, 'respondToPermission').mockReturnValue(true)
    const desktop = makeClientSocket(sessionId)
    const phone = makeClientSocket(sessionId, 'h5')
    handleWebSocket.open(desktop)
    handleWebSocket.open(phone)
    const grants = new SessionBrowserGrants({ store: sessionStateStore, trust: { has: async () => false } })

    const call = grants.ensureOperation({ sessionId, origin: 'https://example.com', action: 'Click element [1]' }, undefined).catch((error: unknown) => error)
    await waitFor(() => (sessionStateStore.peek(sessionId)?.pendingBrowserGrants.length ?? 0) === 1)
    const requestId = sessionStateStore.peek(sessionId)!.pendingBrowserGrants[0]!.requestId
    for (const client of [desktop, phone]) {
      expect(received(client)).toContainEqual(
        expect.objectContaining({
          type: 'session_patch',
          changes: { pendingBrowserGrants: [expect.objectContaining({ requestId, origin: 'https://example.com', allowOnce: true, allowSession: true })] },
        }),
      )
    }

    handleWebSocket.message(desktop, JSON.stringify({ type: 'permission_response', requestId, allowed: true }))
    handleWebSocket.message(phone, JSON.stringify({ type: 'permission_response', requestId, allowed: true, rule: 'always' }))

    expect(respond).not.toHaveBeenCalled()
    expect(sessionStateStore.peek(sessionId)?.pendingBrowserGrants).toHaveLength(1)
    expect(received(desktop)).toContainEqual(expect.objectContaining({ type: 'error', code: 'PERMISSION_REQUEST_EXPIRED' }))

    grants.cancelSession(sessionId)
    await call
    for (const client of [desktop, phone]) {
      expect(received(client)).toContainEqual(expect.objectContaining({ type: 'session_patch', changes: { pendingBrowserGrants: [] } }))
    }
  })

  it('tells every client which tab the agent is operating and when it stops', () => {
    const sessionId = `browser-activity-${crypto.randomUUID()}`
    fakeCli()
    const desktop = makeClientSocket(sessionId)
    const phone = makeClientSocket(sessionId, 'h5')
    handleWebSocket.open(desktop)
    handleWebSocket.open(phone)

    sessionStateStore.apply(sessionId, { type: 'browser_activity_changed', activity: { tabId: 't1' } })
    sessionStateStore.apply(sessionId, { type: 'browser_activity_changed', activity: null })

    for (const client of [desktop, phone]) {
      const changes = received(client)
        .filter((msg) => msg.type === 'session_patch' && 'browserActivity' in msg.changes)
        .map((msg) => msg.changes.browserActivity)
      expect(changes).toEqual([{ tabId: 't1' }, null])
    }
  })

  it('tells every client when the CLI withdraws a permission request', () => {
    const sessionId = `permission-cancel-${crypto.randomUUID()}`
    const cli = fakeCli()
    const desktop = makeClientSocket(sessionId)
    const phone = makeClientSocket(sessionId, 'h5')
    handleWebSocket.open(desktop)
    handleWebSocket.open(phone)

    cli.emit({ type: 'control_request', request_id: 'req-2', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} } })
    cli.emit({ type: 'control_cancel_request', request_id: 'req-2' })

    for (const client of [desktop, phone]) {
      const pendingLists = received(client)
        .filter((msg) => msg.type === 'session_patch' && msg.changes.pendingPermissions)
        .map((msg) => msg.changes.pendingPermissions.map((request: { requestId: string }) => request.requestId))
      expect(pendingLists).toEqual([['req-2'], []])
    }
  })
})

describe('WebSocket restarts wait for the turn to end', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
  })

  it('does not restart the CLI when a client connects mid-turn with another model', async () => {
    const sessionId = `restart-defer-${crypto.randomUUID()}`
    const cli = fakeCli()
    const stopSession = spyOn(conversationService, 'stopSession').mockImplementation(() => {})
    const startSession = spyOn(conversationService, 'startSession').mockResolvedValue(undefined as any)
    spyOn(conversationService, 'getSessionWorkDir').mockReturnValue('/tmp')
    const desktop = makeClientSocket(sessionId)
    handleWebSocket.open(desktop)
    sessionStateStore.apply(sessionId, { type: 'turn_started', at: 1 })

    const phone = makeClientSocket(sessionId, 'h5')
    handleWebSocket.open(phone)
    handleWebSocket.message(phone, JSON.stringify({ type: 'set_runtime_config', providerId: null, modelId: 'model-b' }))
    await Bun.sleep(0)

    expect(stopSession).not.toHaveBeenCalled()

    cli.emit({ type: 'result', usage: { input_tokens: 1, output_tokens: 1 } })
    await waitFor(() => startSession.mock.calls.length === 1)

    expect(stopSession).toHaveBeenCalledWith(sessionId)
    expect(received(desktop)).toContainEqual({ type: 'message_complete', usage: { input_tokens: 1, output_tokens: 1 } })
  })

  it('defers a switch into Bypass until the turn ends', async () => {
    const sessionId = `bypass-defer-${crypto.randomUUID()}`
    const cli = fakeCli()
    sessionStateStore.apply(sessionId, { type: 'permission_effective_reported', mode: 'default' })
    spyOn(sessionService, 'appendSessionPermissionMode').mockResolvedValue()
    const stopSession = spyOn(conversationService, 'stopSession').mockImplementation(() => {})
    const startSession = spyOn(conversationService, 'startSession').mockResolvedValue(undefined as any)
    spyOn(conversationService, 'getSessionWorkDir').mockReturnValue('/tmp')
    const desktop = makeClientSocket(sessionId)
    handleWebSocket.open(desktop)
    sessionStateStore.apply(sessionId, { type: 'turn_started', at: 1 })

    handleWebSocket.message(desktop, JSON.stringify({ type: 'set_permission_mode', mode: 'bypassPermissions' }))
    await Bun.sleep(5)
    expect(stopSession).not.toHaveBeenCalled()

    cli.emit({ type: 'result', usage: { input_tokens: 0, output_tokens: 0 } })
    await waitFor(() => startSession.mock.calls.length === 1)
    expect(startSession.mock.calls[0]?.[3]).toEqual(expect.objectContaining({ permissionMode: 'bypassPermissions' }))
  })
})

describe('WebSocket queued restarts are dropped when the change is undone', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
  })

  it('does not restart when Bypass is switched back off before the turn ends', async () => {
    const sessionId = `bypass-undo-${crypto.randomUUID()}`
    const cli = fakeCli()
    sessionStateStore.apply(sessionId, { type: 'permission_effective_reported', mode: 'default' })
    spyOn(sessionService, 'appendSessionPermissionMode').mockResolvedValue()
    spyOn(conversationService, 'setPermissionMode').mockReturnValue(null)
    const stopSession = spyOn(conversationService, 'stopSession').mockImplementation(() => {})
    const desktop = makeClientSocket(sessionId)
    handleWebSocket.open(desktop)
    sessionStateStore.apply(sessionId, { type: 'turn_started', at: 1 })

    handleWebSocket.message(desktop, JSON.stringify({ type: 'set_permission_mode', mode: 'bypassPermissions' }))
    handleWebSocket.message(desktop, JSON.stringify({ type: 'set_permission_mode', mode: 'default' }))
    cli.emit({ type: 'result', usage: { input_tokens: 0, output_tokens: 0 } })
    await Bun.sleep(5)

    expect(stopSession).not.toHaveBeenCalled()
    expect(getSessionState(sessionId)?.process.pendingRestart).toBeUndefined()
  })

  it('does not restart when the model is switched back before the turn ends', async () => {
    const sessionId = `model-undo-${crypto.randomUUID()}`
    const cli = fakeCli()
    sessionStateStore.apply(sessionId, { type: 'runtime_desired_changed', selection: { providerId: null, modelId: 'model-a' } })
    spyOn(sessionService, 'appendSessionRuntimeConfig').mockResolvedValue()
    const stopSession = spyOn(conversationService, 'stopSession').mockImplementation(() => {})
    const desktop = makeClientSocket(sessionId)
    handleWebSocket.open(desktop)
    sessionStateStore.apply(sessionId, { type: 'turn_started', at: 1 })

    handleWebSocket.message(desktop, JSON.stringify({ type: 'set_runtime_config', providerId: null, modelId: 'model-b' }))
    await Bun.sleep(0)
    handleWebSocket.message(desktop, JSON.stringify({ type: 'set_runtime_config', providerId: null, modelId: 'model-a' }))
    await Bun.sleep(0)
    cli.emit({ type: 'result', usage: { input_tokens: 0, output_tokens: 0 } })
    await Bun.sleep(5)

    expect(stopSession).not.toHaveBeenCalled()
    expect(getSessionState(sessionId)?.process.pendingRestart).toBeUndefined()
  })
})

describe('WebSocket session snapshot and patches', () => {
  afterEach(() => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
  })

  it('sends a snapshot on connect and numbered patches to every client', async () => {
    const sessionId = `snapshot-${crypto.randomUUID()}`
    fakeCli()
    const desktop = makeClientSocket(sessionId)
    handleWebSocket.open(desktop)
    await waitFor(() => received(desktop).some((msg) => msg.type === 'session_snapshot'))
    const snapshot = received(desktop).find((msg) => msg.type === 'session_snapshot')

    const phone = makeClientSocket(sessionId, 'h5')
    handleWebSocket.open(phone)
    sessionStateStore.apply(sessionId, { type: 'turn_started', at: 5 })

    const versions = received(desktop)
      .filter((msg) => msg.type === 'session_patch' && msg.version > snapshot.state.version)
      .map((msg) => msg.version)
    expect(versions).toEqual([snapshot.state.version + 1, snapshot.state.version + 2])
    expect(received(phone)).toContainEqual({
      type: 'session_patch',
      version: snapshot.state.version + 2,
      changes: { turn: { phase: 'running', startedAt: 5, activity: 'thinking' } },
    })
  })

  it('sends a fresh snapshot when a client asks for one', async () => {
    const sessionId = `snapshot-request-${crypto.randomUUID()}`
    fakeCli()
    const desktop = makeClientSocket(sessionId)
    handleWebSocket.open(desktop)
    await waitFor(() => received(desktop).some((msg) => msg.type === 'session_snapshot'))
    desktop.sent.length = 0

    handleWebSocket.message(desktop, JSON.stringify({ type: 'request_snapshot' }))
    await waitFor(() => received(desktop).some((msg) => msg.type === 'session_snapshot'))
  })

  it('passes the client message id to the CLI', async () => {
    const sessionId = `message-id-${crypto.randomUUID()}`
    fakeCli()
    spyOn(conversationService, 'startSession').mockResolvedValue(1 as any)
    const sendMessage = spyOn(conversationService, 'sendMessage').mockReturnValue(true)
    const desktop = makeClientSocket(sessionId)
    handleWebSocket.open(desktop)
    const id = crypto.randomUUID()

    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'hello', id }))
    await waitFor(() => sendMessage.mock.calls.length === 1)

    expect(sendMessage.mock.calls[0]?.[3]).toBe(id)
  })

  it('forwards message ids and prompts typed on another client', () => {
    const sessionId = `echo-${crypto.randomUUID()}`
    const cli = fakeCli()
    const desktop = makeClientSocket(sessionId)
    handleWebSocket.open(desktop)
    desktop.sent.length = 0

    cli.emit({
      type: 'user',
      isReplay: true,
      uuid: 'user-uuid-1',
      message: { role: 'user', content: [{ type: 'text', text: 'typed on the phone' }] },
    })
    cli.emit({
      type: 'assistant',
      uuid: 'assistant-uuid-1',
      message: { content: [{ type: 'text', text: 'answer' }] },
    })

    expect(received(desktop)).toContainEqual({ type: 'user_message', id: 'user-uuid-1', content: 'typed on the phone' })
    expect(received(desktop)).toContainEqual({ type: 'message_id', id: 'assistant-uuid-1' })
  })
})
