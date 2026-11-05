import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  __resetWebSocketHandlerStateForTests,
  deliverUserTurn,
  handleWebSocket,
  type WebSocketData,
} from '../ws/handler.js'
import { conversationService } from '../services/conversationService.js'
import { setServerEndpoint } from '../ws/sessionRuntime.js'
import { sessionStateStore } from '../session/state/store.js'
import type { SessionOrigin } from '../../entrypoints/sdk/coreSchemas.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'

const configDirAtLoad = process.env.DREAMCODER_CONFIG_DIR

type FakeSocket = ServerWebSocket<WebSocketData> & { sent: string[] }

let configDir: string
let workDir: string

function makeClientSocket(sessionId: string): FakeSocket {
  const sent: string[] = []
  return {
    data: { sessionId, connectedAt: Date.now(), channel: 'client', clientKind: 'desktop', sdkToken: null },
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

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition')
    await Bun.sleep(5)
  }
}

async function writeSession(sessionId: string): Promise<void> {
  const dir = path.join(configDir, 'projects', sanitizePath(workDir))
  await fs.mkdir(dir, { recursive: true })
  const entries = [
    { type: 'session-meta', isMeta: true, workDir, timestamp: '2026-01-01T00:00:00.000Z' },
    {
      type: 'user',
      uuid: crypto.randomUUID(),
      parentUuid: null,
      isSidechain: false,
      sessionId,
      cwd: workDir,
      timestamp: '2026-01-01T00:01:00.000Z',
      message: { role: 'user', content: 'typed by hand' },
    },
  ]
  await fs.writeFile(path.join(dir, `${sessionId}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf-8')
}

function fakeCli() {
  const callbacks: Array<(msg: any) => void> = []
  let running = true
  spyOn(conversationService, 'hasSession').mockImplementation(() => running)
  spyOn(conversationService, 'getGeneration').mockReturnValue(1)
  spyOn(conversationService, 'onOutput').mockImplementation((_sessionId, callback) => {
    callbacks.push(callback)
  })
  spyOn(conversationService, 'hasOutputCallback').mockImplementation((_sessionId, callback) => callbacks.includes(callback))
  spyOn(conversationService, 'removeOutputCallback').mockImplementation((_sessionId, callback) => {
    const index = callbacks.indexOf(callback)
    if (index >= 0) callbacks.splice(index, 1)
  })
  const sendMessage = spyOn(conversationService, 'sendMessage').mockReturnValue(true)
  const sendInterrupt = spyOn(conversationService, 'sendInterrupt').mockReturnValue(true)
  const cancelQueuedMessage = spyOn(conversationService, 'cancelQueuedMessage').mockResolvedValue(true)
  const stopSession = spyOn(conversationService, 'stopSession').mockImplementation(() => {
    running = false
  })
  return {
    sendMessage,
    sendInterrupt,
    cancelQueuedMessage,
    stopSession,
    emit(msg: unknown) {
      for (const callback of [...callbacks]) callback(msg)
    },
  }
}

function replay(uuid: string, content: string) {
  return { type: 'user', uuid, isReplay: true, message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' }
}

function queuedIds(sessionId: string): string[] {
  return (sessionStateStore.peek(sessionId)?.queuedMessages ?? []).map((message) => message.id)
}

const sessionOrigin: SessionOrigin = { kind: 'session', sessionId: 'other', name: 'Other', purpose: 'message', summary: 'ping' }

let sessionId: string
let cli: ReturnType<typeof fakeCli>
let desktop: FakeSocket

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queued-messages-config-'))
  workDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'queued-messages-work-')))
  process.env.DREAMCODER_CONFIG_DIR = configDir
  setServerEndpoint({ serverHost: '127.0.0.1', serverPort: 4567 })
  spyOn(console, 'log').mockImplementation(() => {})
  sessionId = crypto.randomUUID()
  await writeSession(sessionId)
  cli = fakeCli()
  desktop = makeClientSocket(sessionId)
  handleWebSocket.open(desktop)
  await waitFor(() => received(desktop).some((msg) => msg.type === 'session_snapshot'))
  desktop.sent.length = 0
})

afterEach(async () => {
  setServerEndpoint(null)
  __resetWebSocketHandlerStateForTests()
  mock.restore()
  process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  await fs.rm(configDir, { recursive: true, force: true })
  await fs.rm(workDir, { recursive: true, force: true })
})

function startTurn() {
  sessionStateStore.apply(sessionId, { type: 'turn_started', at: 1 })
  desktop.sent.length = 0
}

describe('a user message sent during a turn', () => {
  it('goes to the CLI with later priority and waits in the queue state', async () => {
    startTurn()
    const id = crypto.randomUUID()

    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'and also this', id }))
    await waitFor(() => cli.sendMessage.mock.calls.length === 1)

    const [sentId, content, , uuid, origin, reports, priority] = cli.sendMessage.mock.calls[0]!
    expect(sentId).toBe(sessionId)
    expect(content).toBe('and also this')
    expect(uuid).toBe(id)
    expect(origin).toBeUndefined()
    expect(reports).toBeUndefined()
    expect(priority).toBe('later')
    expect(sessionStateStore.peek(sessionId)?.queuedMessages).toEqual([
      { id, content: 'and also this', attachmentCount: 0, createdAt: expect.any(Number) },
    ])
  })

  it('keeps the turn it joined and broadcasts neither a turn start nor a user message', async () => {
    startTurn()

    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'later', id: crypto.randomUUID() }))
    await waitFor(() => queuedIds(sessionId).length === 1)

    expect(sessionStateStore.peek(sessionId)?.turn).toEqual({ phase: 'running', startedAt: 1, activity: 'thinking' })
    const messages = received(desktop)
    expect(messages.some((msg) => msg.type === 'user_message')).toBe(false)
    const turnPatches = messages.filter((msg) => msg.type === 'session_patch' && msg.changes.turn)
    expect(turnPatches).toHaveLength(0)
  })

  it('gets an id and counts its attachments when the client sent none', async () => {
    startTurn()

    handleWebSocket.message(
      desktop,
      JSON.stringify({ type: 'user_message', content: 'see file', attachments: [{ type: 'file', path: '/a' }, { type: 'file', path: '/b' }] }),
    )
    await waitFor(() => queuedIds(sessionId).length === 1)

    const queued = sessionStateStore.peek(sessionId)!.queuedMessages[0]!
    expect(queued.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(cli.sendMessage.mock.calls[0]?.[3]).toBe(queued.id)
    expect(queued.attachmentCount).toBe(2)
  })

  it('keeps the order of several queued messages', async () => {
    startTurn()
    const first = crypto.randomUUID()
    const second = crypto.randomUUID()

    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'one', id: first }))
    await waitFor(() => queuedIds(sessionId).length === 1)
    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'two', id: second }))
    await waitFor(() => queuedIds(sessionId).length === 2)

    expect(queuedIds(sessionId)).toEqual([first, second])
  })

  it('queues behind earlier queued messages between two turns', async () => {
    startTurn()
    const first = crypto.randomUUID()
    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'one', id: first }))
    await waitFor(() => queuedIds(sessionId).length === 1)
    sessionStateStore.apply(sessionId, { type: 'turn_ended' })

    const second = crypto.randomUUID()
    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'two', id: second }))
    await waitFor(() => queuedIds(sessionId).length === 2)

    expect(cli.sendMessage.mock.calls[1]?.[6]).toBe('later')
    expect(queuedIds(sessionId)).toEqual([first, second])
  })

  it('is not queued when no turn is running', async () => {
    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'now', id: crypto.randomUUID() }))
    await waitFor(() => cli.sendMessage.mock.calls.length === 1)

    expect(cli.sendMessage.mock.calls[0]?.[6]).toBeUndefined()
    expect(queuedIds(sessionId)).toEqual([])
    expect(sessionStateStore.peek(sessionId)?.turn.phase).toBe('running')
  })

  it('is not queued when it is a slash command', async () => {
    startTurn()

    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: '/goal ship it', id: crypto.randomUUID() }))
    await waitFor(() => cli.sendMessage.mock.calls.length === 1)

    expect(cli.sendMessage.mock.calls[0]?.[6]).toBeUndefined()
    expect(queuedIds(sessionId)).toEqual([])
  })

  it('does not take the pending reports along', async () => {
    sessionStateStore.apply(sessionId, {
      type: 'report_queued',
      report: { id: crypto.randomUUID(), from: { sessionId: 'child', name: 'Child' }, summary: 'done', createdAt: 1 },
    })
    startTurn()

    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'later', id: crypto.randomUUID() }))
    await waitFor(() => queuedIds(sessionId).length === 1)

    expect(cli.sendMessage.mock.calls[0]?.[5]).toBeUndefined()
    expect(sessionStateStore.peek(sessionId)?.pendingReports).toHaveLength(1)
  })
})

describe('a message from another session during a turn', () => {
  it('is injected as before and not queued', async () => {
    startTurn()

    const result = await deliverUserTurn(sessionId, 'status?', { origin: sessionOrigin })

    expect(result.ok).toBe(true)
    expect(cli.sendMessage.mock.calls[0]?.[4]).toEqual(sessionOrigin)
    expect(cli.sendMessage.mock.calls[0]?.[6]).toBeUndefined()
    expect(queuedIds(sessionId)).toEqual([])
  })
})

describe('the CLI starting a queued message', () => {
  async function queue(...ids: string[]) {
    for (const id of ids) {
      handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: `m-${id}`, id }))
      await waitFor(() => queuedIds(sessionId).includes(id))
    }
  }

  it('removes it from the queue, shows it in the chat and starts a turn', async () => {
    startTurn()
    const id = crypto.randomUUID()
    await queue(id)
    cli.emit({ type: 'result', subtype: 'success', is_error: false, usage: {} })
    expect(sessionStateStore.peek(sessionId)?.turn.phase).toBe('idle')
    desktop.sent.length = 0

    cli.emit(replay(id, `m-${id}`))

    expect(queuedIds(sessionId)).toEqual([])
    expect(sessionStateStore.peek(sessionId)?.turn.phase).toBe('running')
    expect(received(desktop)).toContainEqual({ type: 'user_message', id, content: `m-${id}` })
  })

  it('handles every message of a batch', async () => {
    startTurn()
    const first = crypto.randomUUID()
    const second = crypto.randomUUID()
    await queue(first, second)
    cli.emit({ type: 'result', subtype: 'success', is_error: false, usage: {} })

    cli.emit(replay(first, `m-${first}`))
    expect(queuedIds(sessionId)).toEqual([second])
    cli.emit(replay(second, `m-${second}`))

    expect(queuedIds(sessionId)).toEqual([])
    expect(sessionStateStore.peek(sessionId)?.turn.phase).toBe('running')
  })

  it('does not restart a turn that is already running', async () => {
    startTurn()
    const id = crypto.randomUUID()
    await queue(id)

    cli.emit(replay(id, `m-${id}`))

    expect(queuedIds(sessionId)).toEqual([])
    expect(sessionStateStore.peek(sessionId)?.turn.startedAt).toBe(1)
  })

  it('leaves a replay of a message that was never queued alone', async () => {
    cli.emit(replay(crypto.randomUUID(), 'typed while idle'))

    expect(sessionStateStore.peek(sessionId)?.turn.phase).toBe('idle')
  })
})

describe('withdrawing a queued message', () => {
  async function queueOne() {
    startTurn()
    const id = crypto.randomUUID()
    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'oops', id }))
    await waitFor(() => queuedIds(sessionId).includes(id))
    return id
  }

  it('asks the CLI to drop it and removes it once the CLI did', async () => {
    const id = await queueOne()

    handleWebSocket.message(desktop, JSON.stringify({ type: 'cancel_queued_message', id }))
    await waitFor(() => queuedIds(sessionId).length === 0)

    expect(cli.cancelQueuedMessage).toHaveBeenCalledWith(sessionId, id)
  })

  it('keeps it when the CLI already started it', async () => {
    const id = await queueOne()
    cli.cancelQueuedMessage.mockResolvedValue(false)

    handleWebSocket.message(desktop, JSON.stringify({ type: 'cancel_queued_message', id }))
    await waitFor(() => cli.cancelQueuedMessage.mock.calls.length === 1)
    await Bun.sleep(20)

    expect(queuedIds(sessionId)).toEqual([id])
  })

  it('keeps it when the CLI does not answer', async () => {
    const id = await queueOne()
    cli.cancelQueuedMessage.mockRejectedValue(new Error('Timed out'))
    spyOn(console, 'warn').mockImplementation(() => {})

    handleWebSocket.message(desktop, JSON.stringify({ type: 'cancel_queued_message', id }))
    await waitFor(() => cli.cancelQueuedMessage.mock.calls.length === 1)
    await Bun.sleep(20)

    expect(queuedIds(sessionId)).toEqual([id])
  })

  it('ignores an id that is not queued', async () => {
    await queueOne()

    handleWebSocket.message(desktop, JSON.stringify({ type: 'cancel_queued_message', id: crypto.randomUUID() }))
    await Bun.sleep(20)

    expect(cli.cancelQueuedMessage).not.toHaveBeenCalled()
  })
})

describe('sending the queue now', () => {
  it('interrupts the turn without taking the stop path', async () => {
    startTurn()
    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'urgent', id: crypto.randomUUID() }))
    await waitFor(() => queuedIds(sessionId).length === 1)
    desktop.sent.length = 0

    handleWebSocket.message(desktop, JSON.stringify({ type: 'send_queued_now' }))

    expect(cli.sendInterrupt).toHaveBeenCalledTimes(1)
    expect(cli.sendInterrupt).toHaveBeenCalledWith(sessionId)
    expect(sessionStateStore.peek(sessionId)?.process.phase).not.toBe('stopping')
    expect(sessionStateStore.peek(sessionId)?.turn.phase).toBe('running')
    expect(queuedIds(sessionId)).toHaveLength(1)
  })

  it('makes Stop act like send now while something is queued', async () => {
    startTurn()
    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'urgent', id: crypto.randomUUID() }))
    await waitFor(() => queuedIds(sessionId).length === 1)

    handleWebSocket.message(desktop, JSON.stringify({ type: 'stop_generation' }))

    expect(cli.sendInterrupt).toHaveBeenCalledTimes(1)
    expect(sessionStateStore.peek(sessionId)?.process.phase).not.toBe('stopping')
    expect(sessionStateStore.peek(sessionId)?.turn.phase).toBe('running')
    expect(queuedIds(sessionId)).toHaveLength(1)
  })

  it('does nothing when nothing is queued', async () => {
    startTurn()

    handleWebSocket.message(desktop, JSON.stringify({ type: 'send_queued_now' }))

    expect(cli.sendInterrupt).not.toHaveBeenCalled()
  })

  it('hides the interruption as an error and shows the output of the turn it starts', async () => {
    startTurn()
    const id = crypto.randomUUID()
    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'urgent', id }))
    await waitFor(() => queuedIds(sessionId).length === 1)
    handleWebSocket.message(desktop, JSON.stringify({ type: 'send_queued_now' }))
    desktop.sent.length = 0

    cli.emit({ type: 'result', subtype: 'error_during_execution', is_error: true, usage: {} })
    cli.emit(replay(id, 'urgent'))
    cli.emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'on it' }] }, uuid: crypto.randomUUID() })
    cli.emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom', usage: {} })

    const messages = received(desktop)
    expect(messages.some((msg) => msg.type === 'content_delta' && msg.text === 'on it')).toBe(true)
    expect(messages.filter((msg) => msg.type === 'error').map((msg) => msg.message)).toEqual(['boom'])
  })
})

describe('the queue state when the CLI goes away', () => {
  async function queueOne() {
    startTurn()
    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'queued', id: crypto.randomUUID() }))
    await waitFor(() => queuedIds(sessionId).length === 1)
  }

  it('is cleared when the process stops', async () => {
    await queueOne()

    conversationService['emitProcessEvent']({ sessionId, generation: 1, phase: 'stopped' })

    expect(queuedIds(sessionId)).toEqual([])
  })

  it('is cleared when a new process starts', async () => {
    await queueOne()

    conversationService['emitProcessEvent']({ sessionId, generation: 2, phase: 'starting' })

    expect(queuedIds(sessionId)).toEqual([])
  })

  it('is cleared by /clear', async () => {
    await queueOne()
    const { sessionService } = await import('../services/sessionService.js')
    spyOn(sessionService, 'clearSessionTranscript').mockResolvedValue()

    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: '/clear' }))
    await waitFor(() => queuedIds(sessionId).length === 0)

    expect(cli.stopSession).toHaveBeenCalled()
  })
})

describe('queued messages and a restart at the end of the turn', () => {
  it('holds them while the restart is pending and sends them again in order afterwards', async () => {
    const { sessionService } = await import('../services/sessionService.js')
    spyOn(sessionService, 'appendSessionRuntimeConfig').mockResolvedValue()
    sessionStateStore.apply(sessionId, { type: 'runtime_desired_changed', selection: { providerId: null, modelId: 'model-a' } })
    startTurn()
    const first = crypto.randomUUID()
    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'one', id: first }))
    await waitFor(() => queuedIds(sessionId).length === 1)

    handleWebSocket.message(desktop, JSON.stringify({ type: 'set_runtime_config', providerId: null, modelId: 'model-b' }))
    await waitFor(() => !!sessionStateStore.peek(sessionId)?.process.pendingRestart)
    await waitFor(() => cli.cancelQueuedMessage.mock.calls.length === 1)
    expect(cli.cancelQueuedMessage).toHaveBeenCalledWith(sessionId, first)

    const second = crypto.randomUUID()
    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'two', id: second }))
    await waitFor(() => queuedIds(sessionId).length === 2)
    expect(cli.sendMessage).toHaveBeenCalledTimes(1)

    handleWebSocket.message(desktop, JSON.stringify({ type: 'set_runtime_config', providerId: null, modelId: 'model-a' }))
    await Bun.sleep(0)
    cli.emit({ type: 'result', usage: { input_tokens: 0, output_tokens: 0 } })
    await waitFor(() => cli.sendMessage.mock.calls.length === 3)

    const resent = cli.sendMessage.mock.calls.slice(1).map((call) => [call[1], call[3], call[6]])
    expect(resent).toEqual([['one', first, undefined], ['two', second, 'later']])
    expect(queuedIds(sessionId)).toEqual([second])
  })
})
