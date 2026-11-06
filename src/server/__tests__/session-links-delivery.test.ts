import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  __resetWebSocketHandlerStateForTests,
  deliverUserTurn,
  handleRawCliMessage,
  handleWebSocket,
  type WebSocketData,
} from '../ws/handler.js'
import { conversationService } from '../services/conversationService.js'
import { sessionService } from '../services/sessionService.js'
import { setServerEndpoint } from '../ws/sessionRuntime.js'
import { sessionStateStore } from '../session/state/store.js'
import type { SessionOrigin } from '../../entrypoints/sdk/coreSchemas.js'
import { wrapCrossSessionBody } from '../../utils/crossSessionEnvelope.js'
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

async function writeSession(
  sessionId: string,
  options: { relation?: Record<string, unknown>; title?: string; startedBy?: SessionOrigin } = {},
): Promise<void> {
  const dir = path.join(configDir, 'projects', sanitizePath(workDir))
  await fs.mkdir(dir, { recursive: true })
  const user = {
    type: 'user',
    uuid: crypto.randomUUID(),
    parentUuid: null,
    isSidechain: false,
    sessionId,
    cwd: workDir,
    timestamp: '2026-01-01T00:01:00.000Z',
    message: {
      role: 'user',
      content: options.startedBy ? wrapCrossSessionBody('do the work', options.startedBy) : 'typed by hand',
    },
    ...(options.startedBy ? { origin: options.startedBy } : {}),
  }
  const entries = [
    { type: 'session-meta', isMeta: true, workDir, timestamp: '2026-01-01T00:00:00.000Z', ...options.relation },
    user,
    ...(options.title ? [{ type: 'custom-title', customTitle: options.title }] : []),
  ]
  await fs.writeFile(path.join(dir, `${sessionId}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf-8')
}

function fakeCli(options: { running: boolean }) {
  const callbacks: Array<(msg: any) => void> = []
  let running = options.running
  spyOn(conversationService, 'hasSession').mockImplementation(() => running)
  spyOn(conversationService, 'onOutput').mockImplementation((_sessionId, callback) => {
    callbacks.push(callback)
  })
  spyOn(conversationService, 'hasOutputCallback').mockImplementation((_sessionId, callback) => callbacks.includes(callback))
  spyOn(conversationService, 'removeOutputCallback').mockImplementation((_sessionId, callback) => {
    const index = callbacks.indexOf(callback)
    if (index >= 0) callbacks.splice(index, 1)
  })
  const startSession = spyOn(conversationService, 'startSession').mockImplementation(async () => {
    running = true
    return 1 as any
  })
  const sendMessage = spyOn(conversationService, 'sendMessage').mockReturnValue(true)
  const stopSession = spyOn(conversationService, 'stopSession').mockImplementation(() => {
    running = false
  })
  const replies: Array<{ sessionId: string; requestId: string; result: any }> = []
  spyOn(conversationService, 'respondToHostRequest').mockImplementation((sessionId, requestId, result) => {
    replies.push({ sessionId, requestId, result })
    return true
  })
  return {
    callbacks,
    startSession,
    sendMessage,
    stopSession,
    replies,
    emit(msg: unknown) {
      for (const callback of [...callbacks]) callback(msg)
    },
  }
}

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-links-delivery-config-'))
  workDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'session-links-delivery-work-')))
  process.env.DREAMCODER_CONFIG_DIR = configDir
  setServerEndpoint({ serverHost: '127.0.0.1', serverPort: 4567 })
  spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  setServerEndpoint(null)
  __resetWebSocketHandlerStateForTests()
  mock.restore()
  process.env.DREAMCODER_CONFIG_DIR = configDirAtLoad
  await fs.rm(configDir, { recursive: true, force: true })
  await fs.rm(workDir, { recursive: true, force: true })
})

describe('delivering a session message', () => {
  let callerId: string
  let targetId: string
  beforeEach(() => {
    callerId = crypto.randomUUID()
    targetId = crypto.randomUUID()
  })

  async function sendFromCaller(cli: ReturnType<typeof fakeCli>, message = 'status?') {
    const before = cli.replies.length
    handleRawCliMessage(callerId, {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'session_send', to: targetId, message, summary: 'ping' },
    })
    await waitFor(() => cli.replies.length > before)
    return cli.replies[cli.replies.length - 1]!
  }

  it('starts the target CLI from the server address and delivers with the caller as origin', async () => {
    await writeSession(callerId, { title: 'Lead' })
    await writeSession(targetId)
    const cli = fakeCli({ running: false })

    const reply = await sendFromCaller(cli)

    expect(reply.sessionId).toBe(callerId)
    expect(reply.result).toEqual({ response: { delivered: true } })
    expect(cli.startSession).toHaveBeenCalledTimes(1)
    const [startedId, startedDir, sdkUrl] = cli.startSession.mock.calls[0]!
    expect(startedId).toBe(targetId)
    expect(startedDir).toBe(workDir)
    expect(sdkUrl).toStartWith(`ws://127.0.0.1:4567/sdk/${targetId}?token=`)
    expect(cli.sendMessage).toHaveBeenCalledTimes(1)
    const [sentId, content, attachments, uuid, origin] = cli.sendMessage.mock.calls[0]!
    expect(sentId).toBe(targetId)
    expect(content).toBe('status?')
    expect(attachments).toBeUndefined()
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(origin).toEqual({ kind: 'session', sessionId: callerId, name: 'Lead', purpose: 'message', summary: 'ping' })
  })

  it('delivers to a running CLI without starting another', async () => {
    await writeSession(callerId, { title: 'Lead' })
    await writeSession(targetId)
    const cli = fakeCli({ running: true })

    const reply = await sendFromCaller(cli)

    expect(reply.result).toEqual({ response: { delivered: true } })
    expect(cli.startSession).not.toHaveBeenCalled()
    expect(cli.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('shows the message live to the clients of the target with its origin and the id the CLI got', async () => {
    await writeSession(callerId, { title: 'Lead' })
    await writeSession(targetId)
    const cli = fakeCli({ running: true })
    const viewer = makeClientSocket(targetId)
    handleWebSocket.open(viewer)
    viewer.sent.length = 0

    await sendFromCaller(cli, 'look at this')

    const sentUuid = cli.sendMessage.mock.calls[0]![3]
    expect(received(viewer)).toContainEqual({
      type: 'user_message',
      id: sentUuid,
      content: 'look at this',
      origin: { kind: 'session', sessionId: callerId, name: 'Lead', purpose: 'message', summary: 'ping' },
    })
  })

  it('reports a start failure to the caller and to the clients of the target', async () => {
    await writeSession(callerId, { title: 'Lead' })
    await writeSession(targetId)
    const cli = fakeCli({ running: false })
    cli.startSession.mockRejectedValue(new Error('spawn failed'))
    const viewer = makeClientSocket(targetId)
    handleWebSocket.open(viewer)
    viewer.sent.length = 0

    const reply = await sendFromCaller(cli)

    expect(reply.result.response.delivered).toBe(false)
    expect(reply.result.response.error).toContain('spawn failed')
    expect(cli.sendMessage).not.toHaveBeenCalled()
    expect(received(viewer).some((msg) => msg.type === 'error')).toBe(true)
  })

  it('answers a session_list request on the connection it arrived on', async () => {
    await writeSession(callerId, { title: 'Lead' })
    const cli = fakeCli({ running: true })

    handleRawCliMessage(callerId, { type: 'control_request', request_id: 'list-1', request: { subtype: 'session_list' } })
    await waitFor(() => cli.replies.length === 1)

    expect(cli.replies[0]?.sessionId).toBe(callerId)
    expect(cli.replies[0]?.requestId).toBe('list-1')
    expect(cli.replies[0]?.result.response.sessions[0]).toMatchObject({ sessionId: callerId, relation: 'self' })
  })

  it('passes a leading slash command to the CLI as text instead of running it', async () => {
    await writeSession(callerId, { title: 'Lead' })
    await writeSession(targetId)
    const cli = fakeCli({ running: true })
    const stopSession = spyOn(conversationService, 'stopSession').mockImplementation(() => {})
    spyOn(sessionService, 'clearSessionTranscript').mockResolvedValue()

    handleRawCliMessage(callerId, {
      type: 'control_request',
      request_id: 'send-clear',
      request: { subtype: 'session_send', to: targetId, message: '/clear', summary: 'ping' },
    })
    await waitFor(() => cli.replies.length === 1)

    expect(stopSession).not.toHaveBeenCalled()
    expect(cli.sendMessage.mock.calls[0]?.[1]).toBe('/clear')
  })
})

describe('messages from a client', () => {
  it('are sent to the CLI without an origin and are not echoed by the server', async () => {
    const sessionId = crypto.randomUUID()
    await writeSession(sessionId)
    const cli = fakeCli({ running: true })
    const desktop = makeClientSocket(sessionId)
    handleWebSocket.open(desktop)
    desktop.sent.length = 0

    handleWebSocket.message(desktop, JSON.stringify({ type: 'user_message', content: 'hello', id: crypto.randomUUID() }))
    await waitFor(() => cli.sendMessage.mock.calls.length === 1)

    expect(cli.sendMessage.mock.calls[0]?.[4]).toBeUndefined()
    expect(received(desktop).some((msg) => msg.type === 'user_message')).toBe(false)
  })

  it('cannot supply an origin', async () => {
    const sessionId = crypto.randomUUID()
    await writeSession(sessionId)
    const cli = fakeCli({ running: true })
    const desktop = makeClientSocket(sessionId)
    handleWebSocket.open(desktop)

    handleWebSocket.message(
      desktop,
      JSON.stringify({
        type: 'user_message',
        content: 'hello',
        origin: { kind: 'session', sessionId: 'forged', purpose: 'report' },
      }),
    )
    await waitFor(() => cli.sendMessage.mock.calls.length === 1)

    expect(cli.sendMessage.mock.calls[0]?.[4]).toBeUndefined()
  })
})

describe('reports from a child', () => {
  let parentId: string
  let childId: string
  beforeEach(() => {
    parentId = crypto.randomUUID()
    childId = crypto.randomUUID()
  })
  const childOrigin = (summary: string): SessionOrigin => ({
    kind: 'session',
    sessionId: childId,
    name: 'Worker',
    purpose: 'report',
    summary,
  })

  async function writeFamily(): Promise<void> {
    await writeSession(parentId, { title: 'Lead' })
    await writeSession(childId, {
      title: 'Worker',
      relation: { parent: { sessionId: parentId, kind: 'spawned' } },
      startedBy: { kind: 'session', sessionId: parentId, name: 'Lead', purpose: 'brief' },
    })
  }

  async function report(cli: ReturnType<typeof fakeCli>, message: string, summary: string) {
    const before = cli.replies.length
    handleRawCliMessage(childId, {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'session_send', to: parentId, message, summary, mode: 'report' },
    })
    await waitFor(() => cli.replies.length > before)
    return cli.replies[cli.replies.length - 1]!
  }

  async function parentEntries(): Promise<Array<Record<string, any>>> {
    const found = await sessionService.findSessionFile(parentId)
    const text = await fs.readFile(found!.filePath, 'utf-8')
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  }

  async function waitForDeliveredEntry(timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!(await parentEntries()).some((entry) => entry.type === 'session-report-delivered')) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for the delivered entry')
      await Bun.sleep(5)
    }
  }

  it('does not run or wake the parent when a child ends a turn', async () => {
    await writeFamily()
    const cli = fakeCli({ running: true })
    handleWebSocket.open(makeClientSocket(childId))

    cli.emit({ type: 'result', subtype: 'success', is_error: false, result: 'All done.' })
    await Bun.sleep(100)

    expect(cli.sendMessage).not.toHaveBeenCalled()
    expect(cli.startSession).not.toHaveBeenCalled()
  })

  it('waits for the parent to be idle and starts nothing', async () => {
    await writeFamily()
    const cli = fakeCli({ running: false })

    const reply = await report(cli, 'half way', 'half way there')

    expect(reply.result).toEqual({ response: { delivered: true } })
    expect(cli.startSession).not.toHaveBeenCalled()
    expect(cli.sendMessage).not.toHaveBeenCalled()
    expect(sessionStateStore.peek(parentId)?.pendingReports).toHaveLength(1)
  })

  it('goes into the parent CLI at once when the parent is in a turn', async () => {
    await writeFamily()
    const cli = fakeCli({ running: true })
    sessionStateStore.apply(parentId, { type: 'turn_started', at: Date.now() })

    await report(cli, 'half way', 'half way there')

    expect(cli.sendMessage).toHaveBeenCalledTimes(1)
    const [targetId, content, , , origin, reports] = cli.sendMessage.mock.calls[0]!
    expect(targetId).toBe(parentId)
    expect(content).toBe('half way')
    expect(origin).toEqual(childOrigin('half way there'))
    expect(reports).toEqual([])
  })

  it('travels with the next user message of the parent and is then no longer pending', async () => {
    await writeFamily()
    const cli = fakeCli({ running: true })
    await report(cli, 'first body', 'first')
    await report(cli, 'second body', 'second')
    const stored = (await parentEntries()).filter((entry) => entry.type === 'session-report')
    const parent = makeClientSocket(parentId)
    handleWebSocket.open(parent)
    parent.sent.length = 0

    handleWebSocket.message(parent, JSON.stringify({ type: 'user_message', content: 'what is new?', id: crypto.randomUUID() }))
    await waitFor(() => cli.sendMessage.mock.calls.length === 1)

    const [, content, , , origin, reports] = cli.sendMessage.mock.calls[0]!
    expect(content).toBe('what is new?')
    expect(origin).toBeUndefined()
    expect(reports).toEqual([
      { id: stored[0]!.id, message: 'first body', origin: childOrigin('first') },
      { id: stored[1]!.id, message: 'second body', origin: childOrigin('second') },
    ])
    expect(sessionStateStore.peek(parentId)?.pendingReports).toEqual([])
    await waitForDeliveredEntry()
    const delivered = (await parentEntries()).filter((entry) => entry.type === 'session-report-delivered')
    expect(delivered.map((entry) => entry.ids)).toEqual([stored.map((entry) => entry.id)])
    expect(received(parent)).toContainEqual({
      type: 'user_message',
      id: stored[0]!.id,
      content: 'first body',
      origin: childOrigin('first'),
    })
  })

  it('is sent once when two user turns race for one queued report', async () => {
    await writeFamily()
    const cli = fakeCli({ running: true })
    await report(cli, 'progress body', 'progress')

    const results = await Promise.all([
      deliverUserTurn(parentId, 'first'),
      deliverUserTurn(parentId, 'second'),
    ])

    expect(results.map((result) => result.ok)).toEqual([true, true])
    expect(cli.sendMessage).toHaveBeenCalledTimes(2)
    const sentReports = cli.sendMessage.mock.calls.flatMap((call) => call[5] ?? [])
    expect(sentReports.map((sent) => sent.message)).toEqual(['progress body'])
  })

  it('travels with a session message that wakes the parent', async () => {
    await writeFamily()
    const cli = fakeCli({ running: false })
    await report(cli, 'progress body', 'progress')

    handleRawCliMessage(childId, {
      type: 'control_request',
      request_id: 'wake',
      request: { subtype: 'session_send', to: parentId, message: 'finished', summary: 'finished' },
    })
    await waitFor(() => cli.sendMessage.mock.calls.length === 1)

    const [, content, , , origin, reports] = cli.sendMessage.mock.calls[0]!
    expect(content).toBe('finished')
    expect(origin).toMatchObject({ purpose: 'message' })
    expect(reports).toEqual([{ id: expect.any(String), message: 'progress body', origin: childOrigin('progress') }])
    expect(sessionStateStore.peek(parentId)?.pendingReports).toEqual([])
  })

  it('is not marked delivered when the CLI is not running', async () => {
    await writeFamily()
    const cli = fakeCli({ running: false })
    await report(cli, 'progress body', 'progress')
    cli.sendMessage.mockReturnValue(false)
    const parent = makeClientSocket(parentId)
    handleWebSocket.open(parent)

    handleWebSocket.message(parent, JSON.stringify({ type: 'user_message', content: 'hello', id: crypto.randomUUID() }))
    await waitFor(() => cli.sendMessage.mock.calls.length === 1)
    await Bun.sleep(50)

    expect(sessionStateStore.peek(parentId)?.pendingReports).toHaveLength(1)
    expect((await parentEntries()).some((entry) => entry.type === 'session-report-delivered')).toBe(false)
  })

  it('is restored as pending after the server forgets the session', async () => {
    await writeFamily()
    const cli = fakeCli({ running: false })
    await report(cli, 'progress body', 'progress')
    const expected = sessionStateStore.peek(parentId)!.pendingReports
    sessionStateStore.dispose(parentId)

    const restored = await sessionStateStore.ensure(parentId)

    expect(restored.pendingReports).toEqual(expected)
    expect(restored.pendingReports).toHaveLength(1)
  })

  it('is not restored once delivered', async () => {
    await writeFamily()
    const cli = fakeCli({ running: true })
    await report(cli, 'progress body', 'progress')
    const parent = makeClientSocket(parentId)
    handleWebSocket.open(parent)
    handleWebSocket.message(parent, JSON.stringify({ type: 'user_message', content: 'hello', id: crypto.randomUUID() }))
    await waitFor(() => cli.sendMessage.mock.calls.length === 1)
    await waitFor(() => sessionStateStore.peek(parentId)?.pendingReports.length === 0)
    await waitForDeliveredEntry()
    sessionStateStore.dispose(parentId)

    const restored = await sessionStateStore.ensure(parentId)

    expect(restored.pendingReports).toEqual([])
  })
})

const CLEANUP_DELAY_MS = 30_000

function captureCleanupTimers() {
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const scheduled: Array<{ handle: object; run: () => void }> = []
  const cleared: object[] = []
  spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void, delay?: number, ...args: unknown[]) => {
    if (delay !== CLEANUP_DELAY_MS) return (realSetTimeout as any)(run, delay, ...args)
    const handle = {}
    scheduled.push({ handle, run })
    return handle
  }) as any)
  spyOn(globalThis, 'clearTimeout').mockImplementation(((handle: object) => {
    if (scheduled.some((entry) => entry.handle === handle)) cleared.push(handle)
    else (realClearTimeout as any)(handle)
  }) as any)
  return { scheduled, cleared }
}

function runTurn(sessionId: string) {
  sessionStateStore.apply(sessionId, { type: 'turn_started', at: Date.now() })
  sessionStateStore.apply(sessionId, { type: 'turn_ended' })
}

describe('stopping the CLI of a session without clients', () => {
  it('stops it after its turn ends and forgets the session', async () => {
    const sessionId = crypto.randomUUID()
    await writeSession(sessionId)
    const cli = fakeCli({ running: true })
    const timers = captureCleanupTimers()

    runTurn(sessionId)

    expect(timers.scheduled).toHaveLength(1)
    expect(cli.stopSession).not.toHaveBeenCalled()
    timers.scheduled[0]!.run()
    expect(cli.stopSession).toHaveBeenCalledWith(sessionId)
    expect(sessionStateStore.peek(sessionId)).toBeUndefined()
  })

  it('leaves a session with a connected client running', async () => {
    const sessionId = crypto.randomUUID()
    await writeSession(sessionId)
    const cli = fakeCli({ running: true })
    const viewer = makeClientSocket(sessionId)
    handleWebSocket.open(viewer)
    const timers = captureCleanupTimers()

    runTurn(sessionId)

    expect(timers.scheduled).toHaveLength(0)
    expect(cli.stopSession).not.toHaveBeenCalled()
  })

  it('does not stop it when a new turn starts first', async () => {
    const sessionId = crypto.randomUUID()
    await writeSession(sessionId)
    const cli = fakeCli({ running: true })
    const timers = captureCleanupTimers()
    runTurn(sessionId)

    sessionStateStore.apply(sessionId, { type: 'turn_started', at: Date.now() })

    expect(timers.cleared).toEqual([timers.scheduled[0]!.handle])
    expect(cli.stopSession).not.toHaveBeenCalled()
  })

  it('does not stop it when a client connects first', async () => {
    const sessionId = crypto.randomUUID()
    await writeSession(sessionId)
    const cli = fakeCli({ running: true })
    const timers = captureCleanupTimers()
    runTurn(sessionId)

    handleWebSocket.open(makeClientSocket(sessionId))

    expect(timers.cleared).toEqual([timers.scheduled[0]!.handle])
    timers.scheduled[0]!.run()
    expect(cli.stopSession).not.toHaveBeenCalled()
  })

  it('starts the CLI again when a message arrives after the cleanup', async () => {
    const callerId = crypto.randomUUID()
    const targetId = crypto.randomUUID()
    await writeSession(callerId, { title: 'Lead' })
    await writeSession(targetId)
    const cli = fakeCli({ running: true })
    const timers = captureCleanupTimers()
    runTurn(targetId)
    timers.scheduled[0]!.run()
    expect(cli.stopSession).toHaveBeenCalledWith(targetId)

    handleRawCliMessage(callerId, {
      type: 'control_request',
      request_id: 'after-cleanup',
      request: { subtype: 'session_send', to: targetId, message: 'are you there?', summary: 'ping' },
    })
    await waitFor(() => cli.replies.length === 1)

    expect(cli.replies[0]?.result).toEqual({ response: { delivered: true } })
    expect(cli.startSession).toHaveBeenCalledTimes(1)
    expect(cli.startSession.mock.calls[0]?.[0]).toBe(targetId)
    expect(cli.sendMessage.mock.calls[0]?.[0]).toBe(targetId)
  })
})
