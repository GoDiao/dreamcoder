import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  __resetWebSocketHandlerStateForTests,
  closeSessionConnection,
  getActiveSessionIds,
  getSlashCommands,
  handleWebSocket,
  resolveSessionPermissionMode,
  translateCliMessage,
  updateSessionSlashCommands,
  type WebSocketData,
} from '../ws/handler.js'
import { conversationService } from '../services/conversationService.js'
import { sessionService } from '../services/sessionService.js'
import { SettingsService } from '../services/settingsService.js'
import { getSessionRuntime } from '../ws/sessionRuntime.js'

function makeClientSocket(sessionId: string) {
  const sent: string[] = []
  return {
    data: {
      sessionId,
      connectedAt: Date.now(),
      channel: 'client',
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

describe('WebSocket handler session isolation', () => {
  afterEach(() => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
  })

  it('ignores stale disconnects from an older socket for the same session', () => {
    const sessionId = `duplicate-${crypto.randomUUID()}`
    const first = makeClientSocket(sessionId)
    const second = makeClientSocket(sessionId)
    const clearCallbacks = spyOn(conversationService, 'clearOutputCallbacks')

    handleWebSocket.open(first)
    handleWebSocket.open(second)
    clearCallbacks.mockClear()

    handleWebSocket.close(first, 1000, 'stale tab closed')

    expect(getActiveSessionIds()).toContain(sessionId)
    expect(clearCallbacks).not.toHaveBeenCalled()
  })

  it('closes and removes an active client socket when a session is deleted', () => {
    const sessionId = `delete-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    const clearCallbacks = spyOn(conversationService, 'clearOutputCallbacks')

    handleWebSocket.open(ws)

    expect(closeSessionConnection(sessionId, 'session deleted')).toBe(true)

    expect(getActiveSessionIds()).not.toContain(sessionId)
    expect(ws.close).toHaveBeenCalledWith(1000, 'session deleted')
    expect(clearCallbacks).toHaveBeenCalledWith(sessionId)
  })

  it('replays pending permission requests when a client reconnects', () => {
    const sessionId = `permission-reconnect-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    spyOn(conversationService, 'hasSession').mockReturnValue(true)
    spyOn(conversationService, 'onOutput').mockImplementation(() => {})
    spyOn(conversationService, 'removeOutputCallback').mockImplementation(() => {})
    spyOn(conversationService, 'getPendingPermissionRequests').mockReturnValue([
      {
        requestId: 'request-ask-1',
        toolName: 'AskUserQuestion',
        toolUseId: 'tool-ask-1',
        input: {
          questions: [
            {
              header: 'Scope',
              question: 'Which scope?',
              options: [{ label: 'A', description: 'First' }, { label: 'B', description: 'Second' }],
            },
          ],
        },
        description: 'Answer questions?',
      },
    ])

    handleWebSocket.open(ws)

    expect(ws.sent.map((payload) => JSON.parse(payload))).toContainEqual({
      type: 'permission_request',
      requestId: 'request-ask-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-1',
      input: {
        questions: [
          {
            header: 'Scope',
            question: 'Which scope?',
            options: [{ label: 'A', description: 'First' }, { label: 'B', description: 'Second' }],
          },
        ],
      },
      description: 'Answer questions?',
    })
  })

  it('keeps disconnected sessions alive longer while user input is pending', () => {
    const sessionId = `permission-disconnect-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    const setTimeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any)
    spyOn(conversationService, 'getPendingPermissionRequests').mockReturnValue([
      {
        requestId: 'request-ask-1',
        toolName: 'AskUserQuestion',
        toolUseId: 'tool-ask-1',
        input: { questions: [] },
      },
    ])

    handleWebSocket.open(ws)
    setTimeoutSpy.mockClear()

    handleWebSocket.close(ws, 1006, 'renderer reconnecting')

    expect(setTimeoutSpy).toHaveBeenCalled()
    expect(setTimeoutSpy.mock.calls[0]?.[1]).toBeGreaterThan(30_000)
  })
})

describe('WebSocket handler session runtime lifetime', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-session-runtime-'))
    originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
    process.env.DREAMCODER_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
    if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
    else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('forgets a pending stop request once the session is closed', () => {
    const sessionId = `stop-close-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    spyOn(conversationService, 'hasSession').mockReturnValue(false)

    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({ type: 'stop_generation' }))
    closeSessionConnection(sessionId, 'session deleted')

    expect(translateCliMessage({ type: 'result', is_error: true, result: 'boom' }, sessionId))
      .toContainEqual({ type: 'error', message: 'boom', code: 'CLI_ERROR' })
  })

  it('test reset clears every per-session runtime state', () => {
    const sessionId = `reset-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    spyOn(conversationService, 'hasSession').mockReturnValue(false)
    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({ type: 'stop_generation' }))
    updateSessionSlashCommands(sessionId, ['review'], { notifyClient: false })

    __resetWebSocketHandlerStateForTests()

    expect(getSlashCommands(sessionId)).toEqual([])
    expect(translateCliMessage({ type: 'result', is_error: true, result: 'boom' }, sessionId))
      .toContainEqual({ type: 'error', message: 'boom', code: 'CLI_ERROR' })
  })

  it('keeps session runtime state across a disconnect and reconnect', () => {
    const sessionId = `reconnect-${crypto.randomUUID()}`
    const setTimeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation((() => 0) as any)
    const stopSession = spyOn(conversationService, 'stopSession').mockImplementation(() => {})
    const first = makeClientSocket(sessionId)
    handleWebSocket.open(first)
    updateSessionSlashCommands(sessionId, ['review'], { notifyClient: false })

    handleWebSocket.close(first, 1006, 'renderer reconnecting')

    expect(getActiveSessionIds()).not.toContain(sessionId)
    expect(getSlashCommands(sessionId)).toEqual([{ name: 'review', description: '' }])

    const second = makeClientSocket(sessionId)
    handleWebSocket.open(second)

    expect(getActiveSessionIds()).toContain(sessionId)
    expect(getSlashCommands(sessionId)).toEqual([{ name: 'review', description: '' }])

    handleWebSocket.close(second, 1006, 'renderer closed')
    const expireGracePeriod = setTimeoutSpy.mock.calls.at(-1)?.[0] as () => void
    expireGracePeriod()

    expect(stopSession).toHaveBeenCalledWith(sessionId)
    expect(getSlashCommands(sessionId)).toEqual([])
  })

  it('/clear resets conversation state but keeps the runtime override', async () => {
    const sessionId = `clear-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    spyOn(conversationService, 'hasSession').mockReturnValue(true)
    spyOn(conversationService, 'onOutput').mockImplementation(() => {})
    spyOn(conversationService, 'removeOutputCallback').mockImplementation(() => {})
    spyOn(conversationService, 'clearOutputCallbacks').mockImplementation(() => {})
    spyOn(conversationService, 'getSessionWorkDir').mockReturnValue(tmpDir)
    const stopSession = spyOn(conversationService, 'stopSession').mockImplementation(() => {})
    const startSession = spyOn(conversationService, 'startSession').mockResolvedValue(undefined as any)
    spyOn(sessionService, 'clearSessionTranscript').mockResolvedValue(undefined)

    handleWebSocket.open(ws)
    const runtimeConfig = JSON.stringify({ type: 'set_runtime_config', providerId: null, modelId: 'model-a' })
    handleWebSocket.message(ws, runtimeConfig)
    await waitFor(() => startSession.mock.calls.length === 1)
    updateSessionSlashCommands(sessionId, ['review'], { notifyClient: false })
    translateCliMessage({ type: 'assistant', error: 'boom' }, sessionId)

    handleWebSocket.message(ws, JSON.stringify({ type: 'user_message', content: '/clear' }))
    await waitFor(() => ws.sent.some((payload) => payload.includes('session_cleared')))

    expect(getSlashCommands(sessionId)).toEqual([])
    // A fresh stream state no longer treats this error as a duplicate of the pre-/clear one.
    expect(translateCliMessage({ type: 'result', is_error: true, result: 'boom' }, sessionId))
      .toContainEqual({ type: 'error', message: 'boom', code: 'CLI_ERROR' })
    // Resending the kept override is a no-op. A lost override would queue a
    // restart, which calls stopSession before its first I/O await.
    const stopCallsBefore = stopSession.mock.calls.length
    handleWebSocket.message(ws, runtimeConfig)
    await Bun.sleep(0)
    expect(stopSession).toHaveBeenCalledTimes(stopCallsBefore)
    expect(startSession).toHaveBeenCalledTimes(1)
  })
})

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition')
    await Bun.sleep(5)
  }
}

describe('WebSocket permission mode updates', () => {
  afterEach(() => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
  })

  it('rejects an unknown permission mode instead of forwarding it to the CLI', () => {
    const ws = makeClientSocket(`permission-mode-${crypto.randomUUID()}`)
    const setPermissionMode = spyOn(conversationService, 'setPermissionMode').mockReturnValue(true)

    handleWebSocket.message(ws, JSON.stringify({ type: 'set_permission_mode', mode: 'yolo' }))

    expect(setPermissionMode).not.toHaveBeenCalled()
    expect(ws.sent.map((payload) => JSON.parse(payload))).toContainEqual(
      expect.objectContaining({ type: 'error', code: 'INVALID_PERMISSION_MODE' }),
    )
  })

  it('forwards a known mode to a running CLI without touching the default for new sessions', async () => {
    const ws = makeClientSocket(`permission-mode-${crypto.randomUUID()}`)
    spyOn(conversationService, 'hasSession').mockReturnValue(true)
    spyOn(conversationService, 'getSessionPermissionMode').mockReturnValue('default')
    const setPermissionMode = spyOn(conversationService, 'setPermissionMode').mockReturnValue(true)
    const save = spyOn(sessionService, 'appendSessionPermissionMode').mockResolvedValue()
    const setDefault = spyOn(SettingsService.prototype, 'setPermissionMode')

    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({ type: 'set_permission_mode', mode: 'plan' }))
    await Bun.sleep(0)

    expect(setPermissionMode).toHaveBeenCalledWith(ws.data.sessionId, 'plan')
    expect(save).toHaveBeenCalledWith(ws.data.sessionId, 'plan')
    expect(setDefault).not.toHaveBeenCalled()
    expect(ws.sent.map((payload) => JSON.parse(payload))).toContainEqual({ type: 'permission_mode', mode: 'plan' })
  })

  it('saves the mode of a session whose CLI is not running, for its next start', async () => {
    const ws = makeClientSocket(`permission-mode-${crypto.randomUUID()}`)
    const setPermissionMode = spyOn(conversationService, 'setPermissionMode').mockReturnValue(true)
    const save = spyOn(sessionService, 'appendSessionPermissionMode').mockResolvedValue()
    const read = spyOn(sessionService, 'getSessionPermissionMode').mockResolvedValue(null)

    handleWebSocket.message(ws, JSON.stringify({ type: 'set_permission_mode', mode: 'acceptEdits' }))
    await Bun.sleep(0)

    expect(setPermissionMode).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledWith(ws.data.sessionId, 'acceptEdits')
    expect(await resolveSessionPermissionMode(ws.data.sessionId)).toBe('acceptEdits')
    expect(read).not.toHaveBeenCalled()
  })

  it('keeps a mode picked while the transcript is still being read', async () => {
    const ws = makeClientSocket(`permission-mode-${crypto.randomUUID()}`)
    let finishRead: (mode: 'default') => void = () => {}
    spyOn(sessionService, 'getSessionPermissionMode').mockReturnValue(
      new Promise((resolve) => { finishRead = resolve }),
    )
    spyOn(sessionService, 'appendSessionPermissionMode').mockResolvedValue()
    getSessionRuntime(ws.data.sessionId)

    const resolving = resolveSessionPermissionMode(ws.data.sessionId)
    handleWebSocket.message(ws, JSON.stringify({ type: 'set_permission_mode', mode: 'plan' }))
    finishRead('default')

    expect(await resolving).toBe('plan')
    expect(await resolveSessionPermissionMode(ws.data.sessionId)).toBe('plan')
  })

  it('applies a mode picked while the CLI is restarting once the restart is done', async () => {
    const ws = makeClientSocket(`permission-mode-${crypto.randomUUID()}`)
    const hasSession = spyOn(conversationService, 'hasSession').mockReturnValue(false)
    spyOn(conversationService, 'getSessionPermissionMode').mockReturnValue('default')
    const setPermissionMode = spyOn(conversationService, 'setPermissionMode').mockReturnValue(true)
    spyOn(sessionService, 'appendSessionPermissionMode').mockResolvedValue()
    let finishRestart: () => void = () => {}
    getSessionRuntime(ws.data.sessionId).runtimeTransition = new Promise<void>((resolve) => { finishRestart = resolve })

    handleWebSocket.message(ws, JSON.stringify({ type: 'set_permission_mode', mode: 'plan' }))
    await Bun.sleep(0)
    expect(setPermissionMode).not.toHaveBeenCalled()

    hasSession.mockReturnValue(true)
    finishRestart()
    await waitFor(() => setPermissionMode.mock.calls.length > 0)
    expect(setPermissionMode).toHaveBeenCalledWith(ws.data.sessionId, 'plan')
  })

  it('reads a session\'s mode from its transcript before the default for new sessions', async () => {
    const sessionId = `permission-mode-${crypto.randomUUID()}`
    spyOn(sessionService, 'getSessionPermissionMode').mockResolvedValue('plan')
    spyOn(SettingsService.prototype, 'getPermissionMode').mockResolvedValue('acceptEdits')

    expect(await resolveSessionPermissionMode(sessionId)).toBe('plan')
  })

  it('falls back to the default for new sessions when the transcript has no mode', async () => {
    const sessionId = `permission-mode-${crypto.randomUUID()}`
    spyOn(sessionService, 'getSessionPermissionMode').mockResolvedValue(null)
    spyOn(SettingsService.prototype, 'getPermissionMode').mockResolvedValue('acceptEdits')

    expect(await resolveSessionPermissionMode(sessionId)).toBe('acceptEdits')
  })

  it('tells a connecting client the session\'s mode', async () => {
    const ws = makeClientSocket(`permission-mode-${crypto.randomUUID()}`)
    spyOn(sessionService, 'getSessionPermissionMode').mockResolvedValue('plan')

    handleWebSocket.open(ws)
    await waitFor(() => ws.sent.some((payload) => JSON.parse(payload).type === 'permission_mode'))

    expect(ws.sent.map((payload) => JSON.parse(payload))).toContainEqual({ type: 'permission_mode', mode: 'plan' })
  })

  it('turns a mode change the CLI reports into a permission_mode message, not thinking', () => {
    const sessionId = `permission-mode-${crypto.randomUUID()}`
    const note = spyOn(conversationService, 'notePermissionMode')

    expect(
      translateCliMessage({ type: 'system', subtype: 'status', status: null, permissionMode: 'acceptEdits' }, sessionId),
    ).toEqual([{ type: 'permission_mode', mode: 'acceptEdits' }])
    expect(note).toHaveBeenCalledWith(sessionId, 'acceptEdits')
  })

  it('still treats a bare null status as the end of compaction', () => {
    const sessionId = `permission-mode-${crypto.randomUUID()}`

    expect(translateCliMessage({ type: 'system', subtype: 'status', status: null }, sessionId)).toEqual([
      { type: 'status', state: 'thinking', verb: 'Thinking' },
    ])
  })
})
