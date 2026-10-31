import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BROWSER_HOST_CLOSE_REPLACED,
  BROWSER_HOST_CLOSE_UNAUTHORIZED,
  BROWSER_HOST_PROTOCOL_VERSION,
  BROWSER_MARKS_TIMEOUT_MS,
  BROWSER_PICK_TIMEOUT_MS,
  BROWSER_TRUST_TIMEOUT_MS,
  type BrowserHostResult,
} from '../../src/server/browserHost/protocol'
import type { BrowserResolveResult } from '../src/lib/shell/electronBridge'
import { PROJECT_SCHEME } from './browser'
import { createBrowserHost, type SocketListener, type WebContentsLike } from './browserHost'

const TOKEN = 'secret-token-value'
const URL = 'ws://127.0.0.1:4567/browser-host'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void }

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flush() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve()
}

class FakeSocket {
  sent: Record<string, unknown>[] = []
  closed = false

  constructor(
    readonly url: string,
    readonly listener: SocketListener,
  ) {}

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }

  close() {
    this.closed = true
  }

  open() {
    this.listener.onOpen()
  }

  receive(message: unknown) {
    this.listener.onMessage(JSON.stringify(message))
  }

  closeWith(code: number) {
    this.listener.onClose(code)
  }

  messages(type: string) {
    return this.sent.filter((message) => message.type === type)
  }

  result(id: string): BrowserHostResult | undefined {
    return this.sent.find((message) => message.type === 'result' && message.id === id) as BrowserHostResult | undefined
  }
}

class FakeDebugger extends EventEmitter {
  attachError: Error | null = null
  attachCalls = 0
  detachCalls = 0
  commands: { method: string; params: unknown }[] = []
  responses = new Map<string, unknown>()
  failures = new Map<string, Error>()
  held = new Map<string, Deferred<unknown>>()
  responders = new Map<string, (params: Record<string, unknown> | undefined) => unknown>([
    ['DOM.getNodeForLocation', (params) => ({ backendNodeId: params?.x })],
  ])

  attach() {
    this.attachCalls += 1
    if (this.attachError) throw this.attachError
  }

  detach() {
    this.detachCalls += 1
  }

  async sendCommand(method: string, params?: Record<string, unknown>) {
    this.commands.push({ method, params })
    const failure = this.failures.get(method)
    if (failure) throw failure
    const hold = this.held.get(method)
    if (hold) return hold.promise
    const responder = this.responders.get(method)
    if (responder && !this.responses.has(method)) return responder(params)
    return this.responses.get(method) ?? {}
  }

  emitCdp(method: string, params: unknown) {
    this.emit('message', {}, method, params)
  }

  calls(method: string) {
    return this.commands.filter((command) => command.method === method)
  }
}

class FakeContents extends EventEmitter {
  destroyed = false
  loading = false
  url = 'https://example.com/'
  title = 'Example'
  history = true
  debugger = new FakeDebugger()
  loadResult: Promise<void> = Promise.resolve()
  navigationHistory = { canGoBack: () => this.history, goBack: vi.fn() }
  mainFrame: { framesInSubtree: { url: string }[] } = { framesInSubtree: [] }
  loadURL = vi.fn((url: string) => {
    this.url = url
    return this.loadResult
  })

  constructor(
    readonly id: number,
    readonly hostWebContents: unknown,
    readonly session: unknown,
  ) {
    super()
  }

  isDestroyed() {
    return this.destroyed
  }

  isLoading() {
    return this.loading
  }

  getURL() {
    return this.url
  }

  getTitle() {
    return this.title
  }

  navigate(url: string) {
    this.url = url
    this.emit('did-navigate', {}, url)
  }
}

let main: object
let browserSession: object
let sockets: FakeSocket[]
let emitted: { event: string; payload: Record<string, unknown> }[]
let contentsById: Map<number, FakeContents>
let resolveInput: ReturnType<typeof vi.fn<(input: string, projectRoot: string | null) => Promise<BrowserResolveResult>>>
let classify: ReturnType<typeof vi.fn<(url: string) => 'allow' | 'external' | 'refuse'>>
let errorLog: ReturnType<typeof vi.spyOn>
let commandCounter = 0

function newHost() {
  return createBrowserHost({
    getMainWebContents: () => main,
    fromId: (id) => contentsById.get(id) as WebContentsLike | undefined,
    browserSession,
    emitToRenderer: (event, payload) => emitted.push({ event, payload: payload as Record<string, unknown> }),
    resolveInput,
    classify,
    createSocket: (url, listener) => {
      const socket = new FakeSocket(url, listener)
      sockets.push(socket)
      return socket
    },
  })
}

function connectReady(host: ReturnType<typeof newHost>) {
  host.connect({ url: URL, token: TOKEN })
  const socket = sockets[sockets.length - 1] as FakeSocket
  socket.open()
  socket.receive({ type: 'ready' })
  return socket
}

function addView(host: ReturnType<typeof newHost>, id = 1, tabId = 't1', sessionId = 's1') {
  const contents = new FakeContents(id, main, browserSession)
  contentsById.set(id, contents)
  host.registerView({ sessionId, tabId, webContentsId: id })
  return contents
}

async function run(
  socket: FakeSocket,
  tabId: string | null,
  command: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  commandCounter += 1
  const id = `c${commandCounter}`
  socket.receive({ type: 'command', id, tabId, command, ...extra })
  await flush()
  return { id, result: socket.result(id) }
}

function errorOf(result: BrowserHostResult | undefined) {
  if (!result || result.ok) throw new Error('expected an error result')
  return result.error
}

function valueOf(result: BrowserHostResult | undefined) {
  if (!result || !result.ok) throw new Error(`expected an ok result, got ${JSON.stringify(result)}`)
  return result.value as Record<string, unknown>
}

beforeEach(() => {
  vi.useFakeTimers()
  main = {}
  browserSession = {}
  sockets = []
  emitted = []
  contentsById = new Map()
  commandCounter = 0
  resolveInput = vi.fn(async () => ({ ok: true, url: 'https://example.com/' }) as BrowserResolveResult)
  classify = vi.fn(() => 'allow' as const)
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  errorLog.mockRestore()
})

describe('connection', () => {
  it('sends hello first, waits for ready, then sends the views', async () => {
    const host = newHost()
    addView(host)
    host.connect({ url: URL, token: TOKEN })
    const socket = sockets[0] as FakeSocket
    expect(socket.url).toBe(URL)
    expect(socket.sent).toEqual([])
    socket.open()
    expect(socket.sent).toEqual([{ type: 'hello', token: TOKEN, protocol: BROWSER_HOST_PROTOCOL_VERSION }])
    socket.receive({ type: 'ready' })
    const views = socket.messages('views')
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ views: [{ sessionId: 's1', tabId: 't1', webContentsId: 1, generation: 0 }] })
    host.dispose()
  })

  it('does not answer commands before ready', async () => {
    const host = newHost()
    host.connect({ url: URL, token: TOKEN })
    const socket = sockets[0] as FakeSocket
    socket.open()
    socket.receive({ type: 'command', id: 'x', tabId: null, command: { kind: 'resolve', input: 'a', projectRoot: null } })
    await flush()
    expect(socket.result('x')).toBeUndefined()
    host.dispose()
  })

  it('closes and retries when ready does not arrive in time', async () => {
    const host = newHost()
    host.connect({ url: URL, token: TOKEN })
    const first = sockets[0] as FakeSocket
    first.open()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(first.closed).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(sockets).toHaveLength(2)
    host.dispose()
  })

  it.each([BROWSER_HOST_CLOSE_UNAUTHORIZED, BROWSER_HOST_CLOSE_REPLACED])('does not reconnect after close code %i', async (code) => {
    const host = newHost()
    const socket = connectReady(host)
    socket.closeWith(code)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets).toHaveLength(1)
    expect(errorLog).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(TOKEN)
    host.dispose()
  })

  it('reconnects with a doubling delay capped at 5 s and resets after ready', async () => {
    const host = newHost()
    host.connect({ url: URL, token: TOKEN })
    const delays = [500, 1_000, 2_000, 4_000, 5_000, 5_000]
    for (const [index, delay] of delays.entries()) {
      const socket = sockets[index] as FakeSocket
      socket.closeWith(1006)
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(sockets).toHaveLength(index + 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(sockets).toHaveLength(index + 2)
    }
    const latest = sockets[sockets.length - 1] as FakeSocket
    latest.open()
    latest.receive({ type: 'ready' })
    latest.closeWith(1006)
    await vi.advanceTimersByTimeAsync(500)
    expect(sockets).toHaveLength(delays.length + 2)
    expect(errorLog).toHaveBeenCalledTimes(2)
    host.dispose()
  })

  it('keeps one socket and ignores a stale socket after reconnecting', async () => {
    const host = newHost()
    const first = connectReady(host)
    first.closeWith(1006)
    await vi.advanceTimersByTimeAsync(500)
    const second = sockets[1] as FakeSocket
    second.open()
    second.receive({ type: 'ready' })
    first.receive({ type: 'command', id: 'late', tabId: null, command: { kind: 'resolve', input: 'a', projectRoot: null } })
    await flush()
    expect(second.result('late')).toBeUndefined()
    host.dispose()
  })

  it('closes the socket and detaches debuggers on dispose', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate', params: {} })
    host.dispose()
    expect(socket.closed).toBe(true)
    expect(contents.debugger.detachCalls).toBe(1)
  })

  it('drops a command result when the connection closed while it ran', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    const hold = deferred<unknown>()
    contents.debugger.held.set('Runtime.evaluate', hold)
    socket.receive({ type: 'command', id: 'slow', tabId: 't1', command: { kind: 'cdp', method: 'Runtime.evaluate' } })
    await flush()
    socket.closeWith(1006)
    hold.resolve({})
    await flush()
    expect(socket.result('slow')).toBeUndefined()
    host.dispose()
  })
})

describe('view table', () => {
  it('sends the views once for several changes within 50 ms', async () => {
    const host = newHost()
    const socket = connectReady(host)
    addView(host, 1, 't1')
    addView(host, 2, 't2')
    host.updateView({ tabId: 't1', shown: true, active: true, foreground: true })
    expect(socket.messages('views')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(50)
    const views = socket.messages('views')
    expect(views).toHaveLength(2)
    expect(views[1]).toMatchObject({
      views: [
        { tabId: 't1', shown: true, active: true, foreground: true },
        { tabId: 't2', shown: false, active: false, foreground: false },
      ],
    })
    host.unregisterView('t2')
    await vi.advanceTimersByTimeAsync(50)
    expect(socket.messages('views')).toHaveLength(3)
    expect((socket.messages('views')[2] as { views: unknown[] }).views).toHaveLength(1)
    host.dispose()
  })

  it('throws for a view that cannot be registered', () => {
    const host = newHost()
    expect(() => host.registerView({ sessionId: 's', tabId: 't', webContentsId: 9 })).toThrow('does not exist')

    const destroyed = new FakeContents(2, main, browserSession)
    destroyed.destroyed = true
    contentsById.set(2, destroyed)
    expect(() => host.registerView({ sessionId: 's', tabId: 't', webContentsId: 2 })).toThrow('does not exist')

    contentsById.set(3, new FakeContents(3, {}, browserSession))
    expect(() => host.registerView({ sessionId: 's', tabId: 't', webContentsId: 3 })).toThrow('not a guest of the main window')

    contentsById.set(4, new FakeContents(4, main, {}))
    expect(() => host.registerView({ sessionId: 's', tabId: 't', webContentsId: 4 })).toThrow('browser partition')

    addView(host, 5, 'a')
    expect(() => host.registerView({ sessionId: 's', tabId: 'b', webContentsId: 5 })).toThrow('already registered')
    host.dispose()
  })

  it('throws when updating an unknown tab and ignores unregistering one', () => {
    const host = newHost()
    expect(() => host.updateView({ tabId: 'nope', shown: true, active: true, foreground: true })).toThrow('no browser view')
    expect(() => host.unregisterView('nope')).not.toThrow()
    host.dispose()
  })

  it('bumps the generation only on a main-frame did-navigate', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.emit('did-navigate-in-page', {}, 'https://example.com/#a', true)
    contents.emit('did-navigate-in-page', {}, 'https://example.com/frame', false)
    contents.emit('page-title-updated', {}, 'Changed')
    expect(valueOf((await run(socket, 't1', { kind: 'inspect' })).result)).toMatchObject({ generation: 0 })
    contents.navigate('https://example.com/next')
    contents.navigate('https://example.com/after')
    expect(valueOf((await run(socket, 't1', { kind: 'inspect' })).result)).toMatchObject({ generation: 2 })
    await vi.advanceTimersByTimeAsync(50)
    const views = socket.messages('views')
    expect(views[views.length - 1]).toMatchObject({
      views: [{ url: 'https://example.com/after', title: 'Changed', generation: 2 }],
    })
    host.dispose()
  })

  it('unregisters a view when its web contents is destroyed', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host, 1, 't1')
    contents.destroyed = true
    contents.emit('destroyed')
    expect(errorOf((await run(socket, 't1', { kind: 'release' })).result).code).toBe('no_view')
    await vi.advanceTimersByTimeAsync(50)
    const views = socket.messages('views')
    expect((views[views.length - 1] as { views: unknown[] }).views).toEqual([])
    host.dispose()
  })

  describe('when the page process is gone', () => {
    async function crashed() {
      const host = newHost()
      const socket = connectReady(host)
      const contents = addView(host)
      host.updateView({ tabId: 't1', shown: true, active: true, foreground: true })
      await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
      return { host, socket, contents }
    }

    it('keeps the view registered and bumps its generation', async () => {
      const { host, socket, contents } = await crashed()
      contents.emit('render-process-gone', {}, { reason: 'crashed' })
      expect(valueOf((await run(socket, 't1', { kind: 'inspect' })).result)).toMatchObject({ generation: 1 })
      await vi.advanceTimersByTimeAsync(50)
      const views = socket.messages('views')
      expect(views[views.length - 1]).toMatchObject({ views: [{ tabId: 't1', generation: 1 }] })
      expect(() => host.updateView({ tabId: 't1', shown: true, active: true, foreground: false })).not.toThrow()
      host.dispose()
    })

    it('detaches the debugger without sending it anything', async () => {
      const { host, contents } = await crashed()
      const sent = contents.debugger.commands.length
      contents.emit('render-process-gone', {}, { reason: 'crashed' })
      expect(contents.debugger.detachCalls).toBe(1)
      expect(contents.debugger.commands).toHaveLength(sent)
      host.dispose()
    })

    it('fails in-flight commands with view_closed', async () => {
      const { host, socket, contents } = await crashed()
      contents.debugger.held.set('Runtime.evaluate', deferred<unknown>())
      socket.receive({ type: 'command', id: 'slow', tabId: 't1', command: { kind: 'cdp', method: 'Runtime.evaluate' } })
      await flush()
      contents.emit('render-process-gone', {}, { reason: 'crashed' })
      await flush()
      expect(errorOf(socket.result('slow')).code).toBe('view_closed')
      host.dispose()
    })

    it('ends pick mode and tells the window without sending the page any command', async () => {
      const { host, contents } = await crashed()
      await host.setPickMode('t1', true)
      const sent = contents.debugger.commands.length
      contents.emit('render-process-gone', {}, { reason: 'crashed' })
      await flush()
      expect(emitted.filter((entry) => entry.event === 'browser-pick-state').map((entry) => entry.payload.active)).toEqual([true, false])
      expect(contents.debugger.commands).toHaveLength(sent)
      host.dispose()
    })

    it('refuses debugger commands until the page has loaded again, then attaches again', async () => {
      const { host, socket, contents } = await crashed()
      contents.emit('render-process-gone', {}, { reason: 'crashed' })
      const sent = contents.debugger.commands.length
      const refused = await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
      expect(errorOf(refused.result).code).toBe('cdp_error')
      expect(errorOf((await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 1 })).result).code).toBe('cdp_error')
      expect(contents.debugger.attachCalls).toBe(1)
      expect(contents.debugger.commands).toHaveLength(sent)
      contents.navigate('https://example.com/reloaded')
      expect(valueOf((await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })).result)).toEqual({ result: {} })
      expect(contents.debugger.attachCalls).toBe(2)
      host.dispose()
    })

    it('still navigates the crashed page', async () => {
      const { host, socket, contents } = await crashed()
      contents.emit('render-process-gone', {}, { reason: 'crashed' })
      const { result } = await run(socket, 't1', { kind: 'navigate', url: 'https://example.com/again' })
      expect(valueOf(result)).toMatchObject({ url: 'https://example.com/again' })
      host.dispose()
    })

    it('does not start pick mode while the page is gone', async () => {
      const { host, contents } = await crashed()
      contents.emit('render-process-gone', {}, { reason: 'crashed' })
      await expect(host.setPickMode('t1', true)).rejects.toThrow('crashed')
      host.dispose()
    })
  })

  it('fails in-flight commands with view_closed when the view is unregistered', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.debugger.held.set('Runtime.evaluate', deferred<unknown>())
    socket.receive({ type: 'command', id: 'slow', tabId: 't1', command: { kind: 'cdp', method: 'Runtime.evaluate' } })
    await flush()
    host.unregisterView('t1')
    await flush()
    expect(errorOf(socket.result('slow')).code).toBe('view_closed')
    expect(contents.debugger.detachCalls).toBe(1)
    host.dispose()
  })
})

describe('command targeting', () => {
  it('answers no_view for an unknown tab and for a missing tab', async () => {
    const host = newHost()
    const socket = connectReady(host)
    expect(errorOf((await run(socket, 'nope', { kind: 'navigate', url: 'https://a.test/' })).result).code).toBe('no_view')
    expect(errorOf((await run(socket, null, { kind: 'release' })).result).code).toBe('no_view')
    expect(errorOf((await run(socket, 'nope', { kind: 'inspect' })).result).code).toBe('no_view')
    host.dispose()
  })

  it('answers stale_document when expectGeneration differs', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.navigate('https://example.com/2')
    expect(errorOf((await run(socket, 't1', { kind: 'release' }, { expectGeneration: 0 })).result).code).toBe('stale_document')
    expect(valueOf((await run(socket, 't1', { kind: 'release' }, { expectGeneration: 1 })).result)).toEqual({})
    host.dispose()
  })

  it('answers internal for a malformed command kind and ignores a malformed message', async () => {
    const host = newHost()
    const socket = connectReady(host)
    addView(host)
    expect(errorOf((await run(socket, 't1', { kind: 'bogus' })).result).code).toBe('internal')
    socket.listener.onMessage('not json')
    socket.listener.onMessage(JSON.stringify({ type: 'command' }))
    await flush()
    expect(errorLog).toHaveBeenCalled()
    host.dispose()
  })
})

describe('resolve', () => {
  it('returns the url, origin and locality', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const cases: [string, string, boolean][] = [
      ['http://localhost:3000/a?b=1', 'http://localhost:3000', true],
      ['http://127.0.0.1:8080/', 'http://127.0.0.1:8080', true],
      ['https://example.com/x', 'https://example.com', false],
      ['https://localhost/x', 'https://localhost', false],
      [`${PROJECT_SCHEME}://abc123/index.html`, `${PROJECT_SCHEME}://abc123`, true],
    ]
    for (const [url, origin, local] of cases) {
      resolveInput.mockResolvedValueOnce({ ok: true, url })
      const { result } = await run(socket, null, { kind: 'resolve', input: 'x', projectRoot: '/p' })
      expect(valueOf(result)).toEqual({ ok: true, url, origin, local })
    }
    expect(resolveInput).toHaveBeenCalledWith('x', '/p')
    host.dispose()
  })

  it('reports a refusal as a value', async () => {
    const host = newHost()
    const socket = connectReady(host)
    resolveInput.mockResolvedValueOnce({ ok: false, reason: 'outsideProject' })
    const { result } = await run(socket, null, { kind: 'resolve', input: '../x', projectRoot: '/p' })
    expect(valueOf(result)).toEqual({ ok: false, reason: 'outsideProject' })
    host.dispose()
  })
})

describe('inspect', () => {
  it('reads the live values instead of the debounced snapshot', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    host.updateView({ tabId: 't1', shown: true, active: false, foreground: true })
    contents.url = 'http://localhost:5173/app'
    contents.title = 'App'
    contents.loading = true
    const { result } = await run(socket, 't1', { kind: 'inspect' })
    expect(valueOf(result)).toEqual({
      url: 'http://localhost:5173/app',
      origin: 'http://localhost:5173',
      local: true,
      frames: [],
      title: 'App',
      generation: 0,
      loading: true,
      shown: true,
      active: false,
      foreground: true,
    })
    host.dispose()
  })

  describe('embedded frames', () => {
    async function inspectFrames(url: string, frames: string[]) {
      const host = newHost()
      const socket = connectReady(host)
      const contents = addView(host)
      contents.url = url
      contents.mainFrame.framesInSubtree = frames.map((frame) => ({ url: frame }))
      const { result } = await run(socket, 't1', { kind: 'inspect' })
      host.dispose()
      return valueOf(result).frames
    }

    it('is empty for a page without frames', async () => {
      expect(await inspectFrames('https://example.com/', [])).toEqual([])
    })

    it('lists the external origins of a local page once each, in order', async () => {
      expect(
        await inspectFrames('http://localhost:5173/app', [
          'http://localhost:5173/app',
          'https://pay.example.org/checkout',
          'https://ads.example.net/slot',
          'https://pay.example.org/other',
        ]),
      ).toEqual(['https://pay.example.org', 'https://ads.example.net'])
    })

    it('ignores local frames and frames without an http origin', async () => {
      expect(
        await inspectFrames('https://example.com/', [
          'http://127.0.0.1:3000/x',
          `${PROJECT_SCHEME}://abc/index.html`,
          'about:blank',
          'data:text/html,hi',
          'not a url',
        ]),
      ).toEqual([])
    })

    it('leaves out the origin of the top page itself', async () => {
      expect(
        await inspectFrames('https://example.com/a', ['https://example.com/a', 'https://example.com/b', 'https://other.example.org/']),
      ).toEqual(['https://other.example.org'])
    })

    it('skips a frame that can no longer be read and answers empty when the frames cannot be listed', async () => {
      const host = newHost()
      const socket = connectReady(host)
      const contents = addView(host)
      const gone = {
        get url(): string {
          throw new Error('Object has been destroyed')
        },
      }
      contents.mainFrame.framesInSubtree = [gone, { url: 'https://ads.example.net/' }]
      expect(valueOf((await run(socket, 't1', { kind: 'inspect' })).result).frames).toEqual(['https://ads.example.net'])
      Object.defineProperty(contents.mainFrame, 'framesInSubtree', {
        get() {
          throw new Error('Object has been destroyed')
        },
      })
      expect(valueOf((await run(socket, 't1', { kind: 'inspect' })).result).frames).toEqual([])
      host.dispose()
    })
  })

  it('returns a null origin for addresses without one and ignores expectGeneration', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.url = 'about:blank'
    const { result } = await run(socket, 't1', { kind: 'inspect' }, { expectGeneration: 99 })
    expect(valueOf(result)).toMatchObject({ url: 'about:blank', origin: null, local: false })
    contents.url = `${PROJECT_SCHEME}://abc/index.html`
    expect(valueOf((await run(socket, 't1', { kind: 'inspect' })).result)).toMatchObject({
      origin: `${PROJECT_SCHEME}://abc`,
      local: true,
    })
    host.dispose()
  })
})

describe('openTab', () => {
  it('asks the renderer and waits for the tab to register', async () => {
    const host = newHost()
    const socket = connectReady(host)
    socket.receive({ type: 'command', id: 'o', tabId: null, command: { kind: 'openTab', sessionId: 's1', url: 'https://a.test/' } })
    await flush()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.event).toBe('browser-open-tab-request')
    const requestId = emitted[0]?.payload.requestId as string
    expect(emitted[0]?.payload).toMatchObject({ sessionId: 's1', url: 'https://a.test/' })
    expect(host.resolveOpenTab(requestId, 'tNew')).toBe(true)
    await flush()
    expect(socket.result('o')).toBeUndefined()
    addView(host, 7, 'tNew', 's1')
    await flush()
    expect(valueOf(socket.result('o'))).toEqual({ tabId: 'tNew' })
    expect(host.resolveOpenTab(requestId, 'tNew')).toBe(false)
    host.dispose()
  })

  it('answers no_view when the renderer never replies', async () => {
    const host = newHost()
    const socket = connectReady(host)
    socket.receive({ type: 'command', id: 'o', tabId: null, command: { kind: 'openTab', sessionId: 's1', url: null } })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(errorOf(socket.result('o')).code).toBe('no_view')
    host.dispose()
  })

  it('answers no_view when the tab replies but never registers within 10 s in total', async () => {
    const host = newHost()
    const socket = connectReady(host)
    socket.receive({ type: 'command', id: 'o', tabId: null, command: { kind: 'openTab', sessionId: 's1', url: null } })
    await flush()
    host.resolveOpenTab(emitted[0]?.payload.requestId as string, 'tNew')
    await vi.advanceTimersByTimeAsync(9_000)
    expect(socket.result('o')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(errorOf(socket.result('o')).code).toBe('no_view')
    host.dispose()
  })
})

describe('activate', () => {
  it('returns what the renderer reports', async () => {
    const host = newHost()
    const socket = connectReady(host)
    addView(host)
    socket.receive({ type: 'command', id: 'a', tabId: 't1', command: { kind: 'activate' } })
    await flush()
    expect(emitted[0]?.event).toBe('browser-activate-request')
    expect(emitted[0]?.payload).toMatchObject({ tabId: 't1' })
    host.resolveActivate(emitted[0]?.payload.requestId as string, true)
    await flush()
    expect(valueOf(socket.result('a'))).toEqual({ shown: true })
    host.dispose()
  })

  it('answers timeout after 3 s', async () => {
    const host = newHost()
    const socket = connectReady(host)
    addView(host)
    socket.receive({ type: 'command', id: 'a', tabId: 't1', command: { kind: 'activate' } })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(errorOf(socket.result('a')).code).toBe('timeout')
    host.dispose()
  })
})

describe('navigate', () => {
  it('refuses an address the classifier does not allow', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    classify.mockReturnValueOnce('refuse')
    const { result } = await run(socket, 't1', { kind: 'navigate', url: 'file:///etc/passwd' })
    expect(errorOf(result).code).toBe('refused_url')
    expect(contents.loadURL).not.toHaveBeenCalled()
    host.dispose()
  })

  it('loads the address and reports the final state', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    const { result } = await run(socket, 't1', { kind: 'navigate', url: 'https://example.com/next' })
    expect(contents.loadURL).toHaveBeenCalledWith('https://example.com/next')
    expect(valueOf(result)).toEqual({ url: 'https://example.com/next', generation: 0, loading: false })
    host.dispose()
  })

  it('does not treat ERR_ABORTED as a failure and waits for the page to stop loading', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.loadResult = Promise.reject(new Error("ERR_ABORTED (-3) loading 'https://example.com/next'"))
    contents.loading = true
    socket.receive({ type: 'command', id: 'n', tabId: 't1', command: { kind: 'navigate', url: 'https://example.com/next' } })
    await flush()
    expect(socket.result('n')).toBeUndefined()
    contents.loading = false
    contents.emit('did-stop-loading')
    await flush()
    expect(valueOf(socket.result('n'))).toMatchObject({ loading: false })
    host.dispose()
  })

  it('reports other load failures', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.loadResult = Promise.reject(new Error("ERR_CONNECTION_REFUSED (-102) loading 'http://localhost:1/'"))
    const { result } = await run(socket, 't1', { kind: 'navigate', url: 'http://localhost:1/' })
    const error = errorOf(result)
    expect(error.code).toBe('internal')
    expect(error.message).toContain('ERR_CONNECTION_REFUSED')
    host.dispose()
  })

  it('returns loading true when the page is still loading after 15 s', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.loadResult = new Promise(() => undefined)
    contents.loading = true
    socket.receive({ type: 'command', id: 'n', tabId: 't1', command: { kind: 'navigate', url: 'https://example.com/slow' } })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(valueOf(socket.result('n'))).toMatchObject({ loading: true })
    host.dispose()
  })
})

describe('history', () => {
  it('fails when there is nothing to go back to', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.history = false
    const error = errorOf((await run(socket, 't1', { kind: 'history', direction: 'back' })).result)
    expect(error).toEqual({ code: 'internal', message: 'no history entry to go back to' })
    expect(contents.navigationHistory.goBack).not.toHaveBeenCalled()
    host.dispose()
  })

  it('goes back and waits for the navigation', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    socket.receive({ type: 'command', id: 'h', tabId: 't1', command: { kind: 'history', direction: 'back' } })
    await flush()
    expect(contents.navigationHistory.goBack).toHaveBeenCalledTimes(1)
    expect(socket.result('h')).toBeUndefined()
    contents.navigate('https://example.com/previous')
    await flush()
    expect(valueOf(socket.result('h'))).toEqual({ url: 'https://example.com/previous', generation: 1 })
    host.dispose()
  })

  it('answers after 5 s when no navigation event arrives', async () => {
    const host = newHost()
    const socket = connectReady(host)
    addView(host)
    socket.receive({ type: 'command', id: 'h', tabId: 't1', command: { kind: 'history', direction: 'back' } })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(valueOf(socket.result('h'))).toMatchObject({ generation: 0 })
    host.dispose()
  })
})

describe('cdp', () => {
  it('rejects methods outside the allowlist without attaching', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    const error = errorOf((await run(socket, 't1', { kind: 'cdp', method: 'Network.getCookies' })).result)
    expect(error.code).toBe('unsupported_method')
    expect(contents.debugger.attachCalls).toBe(0)
    host.dispose()
  })

  it('attaches lazily once, enables the domains and returns the result', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    expect(contents.debugger.attachCalls).toBe(0)
    contents.debugger.responses.set('Runtime.evaluate', { result: { value: 2 } })
    const first = await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate', params: { expression: '1+1' } })
    expect(valueOf(first.result)).toEqual({ result: { result: { value: 2 } } })
    expect(contents.debugger.attachCalls).toBe(1)
    expect(contents.debugger.commands.map((command) => command.method)).toEqual([
      'Page.enable',
      'Runtime.enable',
      'Network.enable',
      'Log.enable',
      'Runtime.evaluate',
    ])
    expect(contents.debugger.calls('Runtime.evaluate')[0]?.params).toEqual({ expression: '1+1' })
    await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate', params: {} })
    expect(contents.debugger.attachCalls).toBe(1)
    host.dispose()
  })

  it('reports attach_failed with the Electron message', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.debugger.attachError = new Error('Another debugger is already attached to the WebContents.')
    const error = errorOf((await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })).result)
    expect(error).toEqual({ code: 'attach_failed', message: 'Another debugger is already attached to the WebContents.' })
    const events = errorOf((await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 10 })).result)
    expect(events.code).toBe('attach_failed')
    host.dispose()
  })

  it('reports attach_failed and detaches when a domain cannot be enabled', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.debugger.failures.set('Network.enable', new Error('boom'))
    const error = errorOf((await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })).result)
    expect(error.code).toBe('attach_failed')
    expect(contents.debugger.detachCalls).toBe(1)
    host.dispose()
  })

  it('reports cdp_error when sendCommand rejects', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.debugger.failures.set('Runtime.evaluate', new Error('Cannot find context'))
    const error = errorOf((await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })).result)
    expect(error).toEqual({ code: 'cdp_error', message: 'Cannot find context' })
    host.dispose()
  })

  it('attaches again after the debugger was detached from outside', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
    contents.debugger.emit('detach', {}, 'replaced_with_devtools')
    await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
    expect(contents.debugger.attachCalls).toBe(2)
    host.dispose()
  })

  it('fails an in-flight command with cdp_error when the debugger detaches', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
    contents.debugger.held.set('Runtime.evaluate', deferred<unknown>())
    socket.receive({ type: 'command', id: 'slow', tabId: 't1', command: { kind: 'cdp', method: 'Runtime.evaluate' } })
    await flush()
    contents.debugger.emit('detach', {}, 'replaced_with_devtools')
    await flush()
    const error = errorOf(socket.result('slow'))
    expect(error.code).toBe('cdp_error')
    expect(error.message).toContain('replaced_with_devtools')
    host.dispose()
  })

  it('fails an in-flight command with view_closed when the detach comes from a destroyed web contents', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
    contents.debugger.held.set('Runtime.evaluate', deferred<unknown>())
    socket.receive({ type: 'command', id: 'slow', tabId: 't1', command: { kind: 'cdp', method: 'Runtime.evaluate' } })
    await flush()
    contents.destroyed = true
    contents.debugger.emit('detach', {}, 'target closed')
    await flush()
    expect(errorOf(socket.result('slow')).code).toBe('view_closed')
    host.dispose()
  })

  it('releases by detaching and clearing the buffers', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 10 })
    contents.debugger.emitCdp('Log.entryAdded', { entry: { level: 'info', text: 'hi' } })
    expect(valueOf((await run(socket, 't1', { kind: 'release' })).result)).toEqual({})
    expect(contents.debugger.detachCalls).toBe(1)
    const events = await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 10 })
    expect(valueOf(events.result).entries).toEqual([])
    expect(contents.debugger.attachCalls).toBe(2)
    host.dispose()
  })
})

describe('events', () => {
  async function attached() {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 1 })
    return { host, socket, contents }
  }

  it('collects console messages, exceptions and log entries', async () => {
    const { host, socket, contents } = await attached()
    contents.debugger.emitCdp('Runtime.consoleAPICalled', {
      type: 'warning',
      args: [{ type: 'string', value: 'count' }, { type: 'number', value: 3 }, { type: 'object', description: 'Object' }],
      stackTrace: { callFrames: [{ url: 'https://example.com/app.js', lineNumber: 9 }] },
    })
    contents.debugger.emitCdp('Runtime.exceptionThrown', {
      exceptionDetails: { text: 'Uncaught', url: 'https://example.com/app.js', lineNumber: 0, exception: { description: 'Error: bad' } },
    })
    contents.debugger.emitCdp('Log.entryAdded', { entry: { level: 'verbose', text: 'net note', url: 'https://example.com/' } })
    const value = valueOf((await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 10 })).result)
    expect(value).toMatchObject({ dropped: 0, next: 3, since: 0 })
    expect(value.entries).toMatchObject([
      { seq: 1, level: 'warning', text: 'count 3 Object', url: 'https://example.com/app.js', line: 10 },
      { seq: 2, level: 'error', text: 'Error: bad', line: 1 },
      { seq: 3, level: 'debug', text: 'net note' },
    ])
    host.dispose()
  })

  it('returns entries after since, at most limit, and continues from next', async () => {
    const { host, socket, contents } = await attached()
    for (let i = 1; i <= 5; i += 1) {
      contents.debugger.emitCdp('Log.entryAdded', { entry: { level: 'info', text: `m${i}` } })
    }
    const first = valueOf((await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 2 })).result)
    expect((first.entries as { text: string }[]).map((entry) => entry.text)).toEqual(['m1', 'm2'])
    expect(first.next).toBe(2)
    const second = valueOf((await run(socket, 't1', { kind: 'events', channel: 'console', since: 2, limit: 10 })).result)
    expect((second.entries as { text: string }[]).map((entry) => entry.text)).toEqual(['m3', 'm4', 'm5'])
    expect(second.next).toBe(5)
    const empty = valueOf((await run(socket, 't1', { kind: 'events', channel: 'console', since: 5, limit: 10 })).result)
    expect(empty).toMatchObject({ entries: [], next: 5, since: 5 })
    host.dispose()
  })

  it('merges network events by request id', async () => {
    const { host, socket, contents } = await attached()
    contents.debugger.emitCdp('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { url: 'https://example.com/api', method: 'POST', headers: { Accept: '*/*', 'X-Count': 2 } },
    })
    contents.debugger.emitCdp('Network.requestWillBeSent', {
      requestId: 'r2',
      request: { url: 'https://example.com/missing', method: 'GET', headers: {} },
    })
    const early = valueOf((await run(socket, 't1', { kind: 'events', channel: 'network', since: 0, limit: 10 })).result)
    expect(early.next).toBe(2)
    contents.debugger.emitCdp('Network.responseReceived', {
      requestId: 'r1',
      response: { status: 201, mimeType: 'application/json', headers: { 'Content-Type': 'application/json' } },
    })
    contents.debugger.emitCdp('Network.loadingFailed', { requestId: 'r2', errorText: 'net::ERR_FAILED' })
    contents.debugger.emitCdp('Network.responseReceived', { requestId: 'unknown', response: { status: 200 } })
    const later = valueOf((await run(socket, 't1', { kind: 'events', channel: 'network', since: 2, limit: 10 })).result)
    expect(later.entries).toMatchObject([
      {
        requestId: 'r1',
        method: 'POST',
        url: 'https://example.com/api',
        status: 201,
        mimeType: 'application/json',
        requestHeaders: { Accept: '*/*', 'X-Count': '2' },
        responseHeaders: { 'Content-Type': 'application/json' },
      },
      { requestId: 'r2', failed: 'net::ERR_FAILED' },
    ])
    host.dispose()
  })

  it('splits a redirect into two entries', async () => {
    const { host, socket, contents } = await attached()
    contents.debugger.emitCdp('Network.requestWillBeSent', { requestId: 'r', request: { url: 'https://a.test/', method: 'GET' } })
    contents.debugger.emitCdp('Network.requestWillBeSent', {
      requestId: 'r',
      request: { url: 'https://a.test/next', method: 'GET' },
      redirectResponse: { status: 302, headers: { Location: '/next' } },
    })
    const value = valueOf((await run(socket, 't1', { kind: 'events', channel: 'network', since: 0, limit: 10 })).result)
    expect(value.entries).toMatchObject([{ url: 'https://a.test/', status: 302 }, { url: 'https://a.test/next' }])
    host.dispose()
  })

  it('keeps at most 500 entries and counts what it dropped', async () => {
    const { host, socket, contents } = await attached()
    for (let i = 1; i <= 520; i += 1) {
      contents.debugger.emitCdp('Log.entryAdded', { entry: { level: 'info', text: `m${i}` } })
    }
    const value = valueOf((await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 1_000 })).result)
    const entries = value.entries as { seq: number }[]
    expect(entries).toHaveLength(500)
    expect(entries[0]?.seq).toBe(21)
    expect(value).toMatchObject({ dropped: 20, next: 520 })
    host.dispose()
  })

  it('keeps the serialized size under about 1 MB', async () => {
    const { host, socket, contents } = await attached()
    const text = 'x'.repeat(10_000)
    for (let i = 0; i < 400; i += 1) contents.debugger.emitCdp('Log.entryAdded', { entry: { level: 'info', text } })
    const value = valueOf((await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 1_000 })).result)
    const entries = value.entries as { text: string }[]
    expect(entries.length).toBeLessThan(400)
    expect(entries.length).toBeGreaterThan(100)
    expect(JSON.stringify(entries).length).toBeLessThan(1_050_000)
    expect(value.dropped).toBe(400 - entries.length)
    expect(entries[0]?.text.length).toBeLessThan(10_000)
    host.dispose()
  })

  describe('on a main-frame navigation', () => {
    function request(contents: FakeContents, requestId: string, url: string, type: string, loaderId: string, redirectStatus?: number) {
      contents.debugger.emitCdp('Network.requestWillBeSent', {
        requestId,
        loaderId,
        type,
        request: { url, method: 'GET' },
        ...(redirectStatus === undefined ? {} : { redirectResponse: { status: redirectStatus } }),
      })
    }

    function respond(contents: FakeContents, requestId: string, status: number) {
      contents.debugger.emitCdp('Network.responseReceived', { requestId, response: { status } })
    }

    function commit(contents: FakeContents, loaderId: string, url: string) {
      contents.debugger.emitCdp('Page.frameNavigated', { frame: { id: 'main', loaderId, url } })
      contents.navigate(url)
    }

    async function networkUrls(socket: FakeSocket) {
      const value = valueOf((await run(socket, 't1', { kind: 'events', channel: 'network', since: 0, limit: 50 })).result)
      return (value.entries as { url: string; status?: number }[]).map((entry) => `${entry.url}${entry.status === undefined ? '' : ` ${entry.status}`}`)
    }

    it('clears the console but not on an in-page navigation', async () => {
      const { host, socket, contents } = await attached()
      contents.debugger.emitCdp('Log.entryAdded', { entry: { level: 'info', text: 'old' } })
      contents.emit('did-navigate-in-page', {}, 'https://example.com/#x', true)
      expect(valueOf((await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 10 })).result).entries).toHaveLength(1)
      contents.navigate('https://example.com/other')
      expect(valueOf((await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 10 })).result).entries).toEqual([])
      contents.debugger.emitCdp('Log.entryAdded', { entry: { level: 'info', text: 'new' } })
      const value = valueOf((await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 10 })).result)
      expect(value.entries).toMatchObject([{ seq: 2, text: 'new' }])
      host.dispose()
    })

    it('keeps the new main document with its status and drops the old page', async () => {
      const { host, socket, contents } = await attached()
      request(contents, 'old-doc', 'https://a.test/', 'Document', 'L1')
      respond(contents, 'old-doc', 200)
      request(contents, 'old-img', 'https://a.test/logo.png', 'Image', 'L1')
      request(contents, 'new-doc', 'https://b.test/', 'Document', 'L2')
      respond(contents, 'new-doc', 200)
      commit(contents, 'L2', 'https://b.test/')
      expect(await networkUrls(socket)).toEqual(['https://b.test/ 200'])
      host.dispose()
    })

    it('keeps the redirect hops of the new document', async () => {
      const { host, socket, contents } = await attached()
      request(contents, 'old-doc', 'https://a.test/', 'Document', 'L1')
      request(contents, 'new-doc', 'https://b.test/start', 'Document', 'L2')
      request(contents, 'new-doc', 'https://b.test/next', 'Document', 'L2', 302)
      request(contents, 'new-doc', 'https://b.test/final', 'Document', 'L2', 302)
      respond(contents, 'new-doc', 200)
      commit(contents, 'L2', 'https://b.test/final')
      expect(await networkUrls(socket)).toEqual(['https://b.test/start 302', 'https://b.test/next 302', 'https://b.test/final 200'])
      host.dispose()
    })

    it('drops frame documents and requests of other documents, even of the same type', async () => {
      const { host, socket, contents } = await attached()
      request(contents, 'frame-doc', 'https://ads.test/', 'Document', 'L9')
      request(contents, 'old-script', 'https://a.test/app.js', 'Script', 'L1')
      request(contents, 'new-doc', 'https://b.test/', 'Document', 'L2')
      request(contents, 'new-script', 'https://b.test/app.js', 'Script', 'L2')
      commit(contents, 'L2', 'https://b.test/')
      expect(await networkUrls(socket)).toEqual(['https://b.test/'])
      host.dispose()
    })

    it('ignores the commit of a frame that is not the main one', async () => {
      const { host, socket, contents } = await attached()
      request(contents, 'new-doc', 'https://b.test/', 'Document', 'L2')
      request(contents, 'frame-doc', 'https://ads.test/', 'Document', 'L9')
      contents.debugger.emitCdp('Page.frameNavigated', { frame: { id: 'child', parentId: 'main', loaderId: 'L9', url: 'https://ads.test/' } })
      contents.debugger.emitCdp('Page.frameNavigated', { frame: { id: 'main', loaderId: 'L2', url: 'https://b.test/' } })
      contents.navigate('https://b.test/')
      expect(await networkUrls(socket)).toEqual(['https://b.test/'])
      host.dispose()
    })

    it('drops everything when the commit was not seen, and does not reuse an earlier commit', async () => {
      const { host, socket, contents } = await attached()
      request(contents, 'doc', 'https://b.test/', 'Document', 'L2')
      contents.navigate('https://b.test/')
      expect(await networkUrls(socket)).toEqual([])
      request(contents, 'again', 'https://c.test/', 'Document', 'L3')
      commit(contents, 'L3', 'https://c.test/')
      request(contents, 'next', 'https://d.test/', 'Document', 'L4')
      contents.navigate('https://d.test/')
      expect(await networkUrls(socket)).toEqual([])
      host.dispose()
    })

    it('records entries after the navigation as usual and keeps their order and cursor', async () => {
      const { host, socket, contents } = await attached()
      request(contents, 'old', 'https://a.test/', 'Document', 'L1')
      request(contents, 'doc', 'https://b.test/', 'Document', 'L2')
      commit(contents, 'L2', 'https://b.test/')
      request(contents, 'img', 'https://b.test/logo.png', 'Image', 'L2')
      respond(contents, 'img', 404)
      respond(contents, 'doc', 200)
      const value = valueOf((await run(socket, 't1', { kind: 'events', channel: 'network', since: 0, limit: 10 })).result)
      expect(value.entries).toMatchObject([
        { requestId: 'img', status: 404 },
        { requestId: 'doc', status: 200 },
      ])
      expect(value.next).toBe((value.entries as { seq: number }[])[1]?.seq)
      host.dispose()
    })

    it('lets a response that arrives after the navigation still update the kept document', async () => {
      const { host, socket, contents } = await attached()
      request(contents, 'doc', 'https://b.test/', 'Document', 'L2')
      commit(contents, 'L2', 'https://b.test/')
      respond(contents, 'doc', 301)
      expect(await networkUrls(socket)).toEqual(['https://b.test/ 301'])
      host.dispose()
    })
  })

  it('does not report the messages that existed before the first attach', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.debugger.sendCommand = async (method: string) => {
      if (method === 'Runtime.enable') contents.debugger.emitCdp('Log.entryAdded', { entry: { level: 'info', text: 'replayed' } })
      return {}
    }
    const value = valueOf((await run(socket, 't1', { kind: 'events', channel: 'console', since: 0, limit: 10 })).result)
    expect(value.entries).toEqual([])
    host.dispose()
  })
})

describe('dialogs', () => {
  it.each([
    ['alert', true, 'accepted'],
    ['confirm', false, 'dismissed'],
    ['prompt', false, 'dismissed'],
    ['beforeunload', true, 'accepted'],
  ] as const)('handles a %s dialog by policy', async (kind, accept, handledAs) => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
    contents.debugger.emitCdp('Page.javascriptDialogOpening', { type: kind, message: 'are you sure?' })
    await flush()
    expect(contents.debugger.calls('Page.handleJavaScriptDialog')).toEqual([
      { method: 'Page.handleJavaScriptDialog', params: { accept } },
    ])
    const { result } = await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
    expect(result).toMatchObject({ dialogs: [{ kind, message: 'are you sure?', handledAs }] })
    host.dispose()
  })

  it('attaches the records to the next result only and truncates long messages', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
    contents.debugger.emitCdp('Page.javascriptDialogOpening', { type: 'alert', message: 'a'.repeat(900) })
    contents.debugger.emitCdp('Page.javascriptDialogOpening', { type: 'confirm', message: 'second' })
    await flush()
    const first = (await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })).result
    expect(first && 'dialogs' in first ? first.dialogs : []).toHaveLength(2)
    expect((first as { dialogs: { message: string }[] }).dialogs[0]?.message.length).toBeLessThanOrEqual(501)
    const second = (await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })).result
    expect(second).not.toHaveProperty('dialogs')
    host.dispose()
  })

  it('attaches the records to an error result as well', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
    contents.debugger.emitCdp('Page.javascriptDialogOpening', { type: 'alert', message: 'oops' })
    await flush()
    contents.debugger.failures.set('Runtime.evaluate', new Error('failed'))
    const { result } = await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
    expect(errorOf(result).code).toBe('cdp_error')
    expect(result).toMatchObject({ dialogs: [{ kind: 'alert' }] })
    host.dispose()
  })

  it('logs and drops the record when the dialog cannot be handled', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
    contents.debugger.failures.set('Page.handleJavaScriptDialog', new Error('no dialog'))
    contents.debugger.emitCdp('Page.javascriptDialogOpening', { type: 'alert', message: 'x' })
    await flush()
    expect(errorLog).toHaveBeenCalled()
    contents.debugger.failures.delete('Page.handleJavaScriptDialog')
    const { result } = await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
    expect(result).not.toHaveProperty('dialogs')
    host.dispose()
  })
})

describe('cancel and stop', () => {
  it('cancels an in-flight command', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.debugger.held.set('Runtime.evaluate', deferred<unknown>())
    socket.receive({ type: 'command', id: 'slow', tabId: 't1', command: { kind: 'cdp', method: 'Runtime.evaluate' } })
    await flush()
    expect(socket.result('slow')).toBeUndefined()
    socket.receive({ type: 'cancel', id: 'slow' })
    await flush()
    expect(errorOf(socket.result('slow')).code).toBe('cancelled')
    socket.receive({ type: 'cancel', id: 'unknown' })
    host.dispose()
  })

  it('cancels a command that waits for the renderer', async () => {
    const host = newHost()
    const socket = connectReady(host)
    addView(host)
    socket.receive({ type: 'command', id: 'a', tabId: 't1', command: { kind: 'activate' } })
    await flush()
    socket.receive({ type: 'cancel', id: 'a' })
    await flush()
    expect(errorOf(socket.result('a')).code).toBe('cancelled')
    expect(host.resolveActivate(emitted[0]?.payload.requestId as string, true)).toBe(false)
    host.dispose()
  })

  it('stops a session: detaches its views, aborts its commands and tells the sidecar', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const mine = addView(host, 1, 't1', 's1')
    const other = addView(host, 2, 't2', 's2')
    await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate' })
    await run(socket, 't2', { kind: 'cdp', method: 'Runtime.evaluate' })
    mine.debugger.held.set('Runtime.evaluate', deferred<unknown>())
    socket.receive({ type: 'command', id: 'slow', tabId: 't1', command: { kind: 'cdp', method: 'Runtime.evaluate' } })
    socket.receive({ type: 'command', id: 'open', tabId: null, command: { kind: 'openTab', sessionId: 's1', url: null } })
    await flush()
    host.stopSession('s1')
    await flush()
    expect(errorOf(socket.result('slow')).code).toBe('stopped')
    expect(errorOf(socket.result('open')).code).toBe('stopped')
    expect(mine.debugger.detachCalls).toBe(1)
    expect(other.debugger.detachCalls).toBe(0)
    expect(socket.messages('stop')).toEqual([{ type: 'stop', sessionId: 's1' }])
    const again = await run(socket, 't1', { kind: 'cdp', method: 'Page.getFrameTree' })
    expect(valueOf(again.result)).toEqual({ result: {} })
    expect(mine.debugger.attachCalls).toBe(2)
    host.dispose()
  })
})

describe('grant replies and trusted sites', () => {
  function trustRequest(socket: FakeSocket) {
    return socket.messages('trust')[socket.messages('trust').length - 1] as { id: string; op: string; origin?: string }
  }

  it('relays a grant reply to the sidecar', () => {
    const host = newHost()
    const socket = connectReady(host)
    host.replyGrant('g1', 'session')
    expect(socket.messages('grant_reply')).toEqual([{ type: 'grant_reply', requestId: 'g1', decision: 'session' }])
    host.dispose()
  })

  it('refuses a grant reply while the sidecar is not connected', () => {
    const host = newHost()
    expect(() => host.replyGrant('g1', 'deny')).toThrow('the sidecar is not connected')
    host.connect({ url: URL, token: TOKEN })
    sockets[0]?.open()
    expect(() => host.replyGrant('g1', 'deny')).toThrow('the sidecar is not connected')
    expect(sockets[0]?.messages('grant_reply')).toEqual([])
    host.dispose()
  })

  it('lists, adds and removes trusted sites through the sidecar', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const listed = host.trust('list')
    expect(trustRequest(socket)).toMatchObject({ op: 'list' })
    expect(trustRequest(socket)).not.toHaveProperty('origin')
    socket.receive({ type: 'trust_result', id: trustRequest(socket).id, ok: true, origins: ['https://a.test'] })
    await expect(listed).resolves.toEqual(['https://a.test'])

    const added = host.trust('add', 'https://b.test')
    expect(trustRequest(socket)).toMatchObject({ op: 'add', origin: 'https://b.test' })
    socket.receive({ type: 'trust_result', id: trustRequest(socket).id, ok: true, origins: ['https://a.test', 'https://b.test'] })
    await expect(added).resolves.toEqual(['https://a.test', 'https://b.test'])

    const removed = host.trust('remove', 'https://a.test')
    expect(trustRequest(socket)).toMatchObject({ op: 'remove', origin: 'https://a.test' })
    socket.receive({ type: 'trust_result', id: trustRequest(socket).id, ok: true, origins: ['https://b.test'] })
    await expect(removed).resolves.toEqual(['https://b.test'])
    host.dispose()
  })

  it('rejects with the sidecar error code when it refuses a trusted-site change', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const added = host.trust('add', 'https://*.b.test')
    socket.receive({ type: 'trust_result', id: trustRequest(socket).id, ok: false, error: { code: 'invalid_origin', message: 'not an exact origin' } })
    await expect(added).rejects.toThrow('invalid_origin')
    host.dispose()
  })

  it('rejects a trusted-site request while the sidecar is not connected', async () => {
    const host = newHost()
    await expect(host.trust('list')).rejects.toThrow('the sidecar is not connected')
    host.dispose()
  })

  it('rejects a trusted-site request the sidecar never answers', async () => {
    const host = newHost()
    connectReady(host)
    const listed = host.trust('list')
    const settled = expect(listed).rejects.toThrow('did not answer')
    vi.advanceTimersByTime(BROWSER_TRUST_TIMEOUT_MS)
    await settled
    host.dispose()
  })

  it('rejects a pending trusted-site request when the connection drops', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const listed = host.trust('list')
    const settled = expect(listed).rejects.toThrow('connection to the sidecar closed')
    socket.closeWith(1006)
    await settled
    host.dispose()
  })

  it('ignores a trusted-site answer nobody asked for', async () => {
    const host = newHost()
    const socket = connectReady(host)
    socket.receive({ type: 'trust_result', id: 'unknown', ok: true, origins: [] })
    const listed = host.trust('list')
    socket.receive({ type: 'trust_result', id: trustRequest(socket).id, ok: true, origins: [] })
    await expect(listed).resolves.toEqual([])
    host.dispose()
  })
})

describe('picking elements', () => {
  const VALUE = { ref: '7', tag: 'button', label: 'button.buy' }

  function showView(host: ReturnType<typeof newHost>, tabId = 't1') {
    host.updateView({ tabId, shown: true, active: true, foreground: true })
  }

  async function startPicking() {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    showView(host)
    await host.setPickMode('t1', true)
    return { host, socket, contents }
  }

  function states() {
    return emitted.filter((entry) => entry.event === 'browser-pick-state').map((entry) => entry.payload.active)
  }

  function events(name: string) {
    return emitted.filter((entry) => entry.event === name).map((entry) => entry.payload)
  }

  function pickRequest(socket: FakeSocket) {
    const requests = socket.messages('pick')
    return requests[requests.length - 1] as { id: string; tabId: string; generation: number; backendNodeId: number }
  }

  function pointer(contents: FakeContents, type: string, x: number, button = 'left') {
    const event = { preventDefault: vi.fn() }
    contents.emit('before-mouse-event', event, { type, x, y: 0, button })
    return event
  }

  function click(contents: FakeContents, node: number) {
    return pointer(contents, 'mouseDown', node)
  }

  async function hover(contents: FakeContents, node: number) {
    const event = pointer(contents, 'mouseMove', node)
    await flush()
    return event
  }

  function outlines(contents: FakeContents) {
    return contents.debugger.calls('Overlay.highlightQuad')
  }

  it('attaches, enables DOM before Overlay and starts listening to the pointer without Chromium inspect mode', async () => {
    const { contents } = await startPicking()
    expect(contents.debugger.attachCalls).toBe(1)
    const methods = contents.debugger.commands.map((command) => command.method)
    expect(methods.indexOf('DOM.enable')).toBeGreaterThan(methods.indexOf('Log.enable'))
    expect(methods.indexOf('Overlay.enable')).toBeGreaterThan(methods.indexOf('DOM.enable'))
    expect(methods).not.toContain('Overlay.setInspectMode')
    expect(states()).toEqual([true])
  })

  const BORDER = [40, 40, 362, 40, 362, 142, 40, 142]

  function boxFor(contents: FakeContents) {
    contents.debugger.responses.set('DOM.getBoxModel', { model: { border: BORDER } })
    contents.debugger.responses.set('Runtime.evaluate', { result: { value: 2 } })
  }

  it('draws the hovered element as an orange outline in page coordinates and swallows the pointer', async () => {
    const host = newHost()
    connectReady(host)
    const contents = addView(host)
    showView(host)
    boxFor(contents)
    await host.setPickMode('t1', true)

    const event = await hover(contents, 6)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(contents.debugger.calls('DOM.getNodeForLocation')[0]?.params).toEqual({ x: 6, y: 0 })
    expect(contents.debugger.calls('DOM.getBoxModel')[0]?.params).toEqual({ backendNodeId: 6 })
    expect(outlines(contents)[0]?.params).toEqual({
      quad: BORDER.map((n) => n / 2),
      color: { r: 249, g: 115, b: 22, a: 0.14 },
      outlineColor: { r: 249, g: 115, b: 22, a: 1 },
    })
  })

  it('looks the element up in document coordinates when the page is scrolled', async () => {
    const { contents } = await startPicking()
    boxFor(contents)
    contents.debugger.responses.set('Page.getLayoutMetrics', { cssLayoutViewport: { pageX: 10, pageY: 1300 } })
    await hover(contents, 6)
    expect(contents.debugger.calls('DOM.getNodeForLocation')[0]?.params).toEqual({ x: 16, y: 1300 })
    expect(contents.debugger.calls('DOM.getBoxModel')[0]?.params).toEqual({ backendNodeId: 16 })
    expect(outlines(contents)[0]?.params).toMatchObject({ quad: BORDER })
  })

  it('keeps following the pointer after an outline is drawn', async () => {
    const { contents } = await startPicking()
    boxFor(contents)
    await hover(contents, 6)
    await hover(contents, 7)
    await hover(contents, 8)
    expect(outlines(contents)).toHaveLength(3)
  })

  it('does not redraw while the pointer stays on the same element', async () => {
    const { contents } = await startPicking()
    boxFor(contents)
    await hover(contents, 6)
    await hover(contents, 6)
    expect(outlines(contents)).toHaveLength(1)
  })

  it('keeps only the latest hover while one is being looked up', async () => {
    const { contents } = await startPicking()
    boxFor(contents)
    const gate = deferred<unknown>()
    contents.debugger.held.set('DOM.getNodeForLocation', gate)

    for (const node of [1, 2, 3]) pointer(contents, 'mouseMove', node)
    await flush()
    contents.debugger.held.delete('DOM.getNodeForLocation')
    gate.resolve({ backendNodeId: 1 })
    await flush()

    expect(contents.debugger.calls('DOM.getNodeForLocation').map((call) => (call.params as { x: number }).x)).toEqual([1, 3])
  })

  it('takes the outline down when the pointer leaves the page', async () => {
    const { contents } = await startPicking()
    boxFor(contents)
    await hover(contents, 6)
    pointer(contents, 'mouseLeave', 0)
    await flush()
    expect(contents.debugger.calls('Overlay.hideHighlight')).toHaveLength(1)
    await hover(contents, 6)
    expect(outlines(contents)).toHaveLength(2)
  })

  it('leaves the page alone outside pick mode, and lets the wheel scroll', async () => {
    const host = newHost()
    connectReady(host)
    const contents = addView(host)
    showView(host)
    boxFor(contents)
    expect(pointer(contents, 'mouseMove', 6).preventDefault).not.toHaveBeenCalled()
    await host.setPickMode('t1', true)
    expect(pointer(contents, 'mouseWheel', 6).preventDefault).not.toHaveBeenCalled()
    await host.setPickMode('t1', false)
    await flush()
    expect(pointer(contents, 'mouseMove', 6).preventDefault).not.toHaveBeenCalled()
    expect(outlines(contents)).toHaveLength(0)
  })

  it('ignores positions without an element or a box, and logs other failures', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { contents } = await startPicking()
    boxFor(contents)
    contents.debugger.failures.set('DOM.getNodeForLocation', new Error('No node found at given location'))
    await hover(contents, 5)
    contents.debugger.failures.delete('DOM.getNodeForLocation')
    contents.debugger.failures.set('DOM.getBoxModel', new Error('Could not compute box model.'))
    await hover(contents, 7)
    pointer(contents, 'mouseMove', Number.NaN)
    await flush()

    expect(outlines(contents)).toHaveLength(0)
    expect(error).not.toHaveBeenCalled()

    contents.debugger.failures.set('DOM.getBoxModel', new Error('Target closed'))
    await hover(contents, 8)
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('takes the outline down before asking the sidecar to describe a pick, and stops drawing and the page', async () => {
    const { socket, contents } = await startPicking()
    boxFor(contents)

    const down = click(contents, 42)
    await flush()
    const moved = await hover(contents, 6)
    const up = pointer(contents, 'mouseUp', 42)

    const methods = contents.debugger.commands.map((command) => command.method)
    expect(methods).toContain('Overlay.hideHighlight')
    expect(outlines(contents)).toHaveLength(0)
    expect(socket.messages('pick')).toHaveLength(1)
    for (const event of [down, moved, up]) expect(event.preventDefault).toHaveBeenCalled()
  })

  it('does not pick on another button, or where there is no element, and keeps picking', async () => {
    const { socket, contents } = await startPicking()
    boxFor(contents)
    pointer(contents, 'mouseDown', 42, 'right')
    pointer(contents, 'mouseDown', 0)
    contents.debugger.failures.set('DOM.getNodeForLocation', new Error('No node found at given location'))
    click(contents, 42)
    await flush()
    contents.debugger.failures.delete('DOM.getNodeForLocation')
    expect(socket.messages('pick')).toHaveLength(0)
    expect(events('browser-pick-started')).toHaveLength(0)
    await hover(contents, 6)
    expect(outlines(contents)).toHaveLength(1)
  })

  it('does nothing when asked to start again', async () => {
    const { host, contents } = await startPicking()
    await host.setPickMode('t1', true)
    expect(contents.debugger.calls('DOM.enable')).toHaveLength(1)
    expect(states()).toEqual([true])
  })

  it('refuses a tab that is not shown or unknown, without touching the debugger', async () => {
    const host = newHost()
    connectReady(host)
    const contents = addView(host)
    await expect(host.setPickMode('t1', true)).rejects.toThrow('not shown')
    await expect(host.setPickMode('nope', true)).rejects.toThrow('no browser view')
    expect(contents.debugger.attachCalls).toBe(0)
    expect(states()).toEqual([])
  })

  it('reports an attach failure and does not stay in pick mode', async () => {
    const host = newHost()
    connectReady(host)
    const contents = addView(host)
    showView(host)
    contents.debugger.attachError = new Error('Another debugger is already attached')
    await expect(host.setPickMode('t1', true)).rejects.toThrow('already attached')
    expect(states()).toEqual([false])
    const guest = await run(sockets[0] as FakeSocket, 't1', { kind: 'cdp', method: 'Input.insertText', params: { text: 'x' } })
    expect(errorOf(guest.result).code).toBe('attach_failed')
  })

  it('leaves pick mode when toggled off', async () => {
    const { host, contents } = await startPicking()
    await host.setPickMode('t1', false)
    await flush()
    expect(contents.debugger.calls('Overlay.hideHighlight')).toHaveLength(1)
    expect(contents.debugger.calls('Overlay.disable')).toHaveLength(1)
    expect(contents.debugger.calls('DOM.disable')).toHaveLength(1)
    expect(states()).toEqual([true, false])
  })

  it('sends a pick to the sidecar, tells the window, and re-arms after the answer', async () => {
    const { socket, contents } = await startPicking()
    click(contents, 42)
    await flush()
    const started = events('browser-pick-started')
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ tabId: 't1', sessionId: 's1' })
    const request = pickRequest(socket)
    expect(request).toMatchObject({ type: 'pick', tabId: 't1', generation: 0, backendNodeId: 42 })
    boxFor(contents)
    await hover(contents, 9)
    expect(outlines(contents)).toHaveLength(0)
    socket.receive({ type: 'pick_result', id: request.id, ok: true, value: VALUE })
    await flush()
    expect(events('browser-pick-done')).toEqual([
      { tabId: 't1', sessionId: 's1', pickId: started[0]?.pickId, ok: true, generation: 0, value: VALUE },
    ])
    await hover(contents, 9)
    expect(outlines(contents)).toHaveLength(1)
    expect(states()).toEqual([true])
  })

  it('tells the sidecar when the pick request expires', async () => {
    const { socket, contents } = await startPicking()
    vi.setSystemTime(5_000_000)
    click(contents, 42)
    await flush()
    expect(pickRequest(socket)).toMatchObject({ expiresAt: 5_000_000 + BROWSER_PICK_TIMEOUT_MS })
  })

  it('lets the user pick several elements in a row', async () => {
    const { socket, contents } = await startPicking()
    for (const node of [1, 2, 3]) {
      click(contents, node)
      await flush()
      socket.receive({ type: 'pick_result', id: pickRequest(socket).id, ok: true, value: VALUE })
      await flush()
    }
    expect(socket.messages('pick').map((message) => (message as { backendNodeId: number }).backendNodeId)).toEqual([1, 2, 3])
    expect(events('browser-pick-done')).toHaveLength(3)
  })

  it('reports a failed pick, logs it, and keeps picking', async () => {
    const { socket, contents } = await startPicking()
    click(contents, 42)
    await flush()
    socket.receive({ type: 'pick_result', id: pickRequest(socket).id, ok: false, error: { code: 'cdp_error', message: 'No node with given id' } })
    await flush()
    expect(events('browser-pick-done')[0]).toMatchObject({ ok: false, cancelled: false, error: 'No node with given id' })
    expect(JSON.stringify(errorLog.mock.calls)).toContain('No node with given id')
    boxFor(contents)
    await hover(contents, 9)
    expect(outlines(contents)).toHaveLength(1)
  })

  it('fails the pick when the sidecar does not answer in time', async () => {
    const { contents } = await startPicking()
    click(contents, 42)
    await flush()
    await vi.advanceTimersByTimeAsync(BROWSER_PICK_TIMEOUT_MS)
    expect(events('browser-pick-done')[0]).toMatchObject({ ok: false, cancelled: false, error: expect.stringContaining('in time') })
    boxFor(contents)
    await hover(contents, 9)
    expect(outlines(contents)).toHaveLength(1)
  })

  it('fails the pick right away when the sidecar connection is gone', async () => {
    const { socket, contents } = await startPicking()
    socket.closeWith(BROWSER_HOST_CLOSE_UNAUTHORIZED)
    click(contents, 42)
    await flush()
    expect(events('browser-pick-done')[0]).toMatchObject({ ok: false, cancelled: false, error: 'the sidecar is not connected' })
  })

  it('fails the pick when the connection drops while the sidecar describes it', async () => {
    const { socket, contents } = await startPicking()
    click(contents, 42)
    await flush()
    socket.closeWith(1006)
    await flush()
    expect(events('browser-pick-done')[0]).toMatchObject({ ok: false, cancelled: false, error: 'the connection to the sidecar closed' })
  })

  it('ignores a click outside pick mode', async () => {
    const { host, socket, contents } = await startPicking()
    await host.setPickMode('t1', false)
    const event = click(contents, 5)
    await flush()
    expect(socket.messages('pick')).toHaveLength(0)
    expect(events('browser-pick-started')).toHaveLength(0)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  describe('cancelling', () => {
    async function pickInFlight() {
      const setup = await startPicking()
      click(setup.contents, 42)
      await setup.host.setPickMode('t1', true)
      await flush()
      return setup
    }

    async function answerLate(socket: FakeSocket) {
      socket.receive({ type: 'pick_result', id: pickRequest(socket).id, ok: true, value: VALUE })
      await flush()
    }

    function expectCancelled(contents: FakeContents) {
      expect(events('browser-pick-done')).toHaveLength(1)
      expect(events('browser-pick-done')[0]).toMatchObject({ ok: false, cancelled: true })
      expect(events('browser-pick-done')[0]).not.toHaveProperty('value')
      expect(contents.debugger.calls('Overlay.disable')).toHaveLength(1)
    }

    it('discards a pick in flight when the user toggles pick mode off', async () => {
      const { host, socket, contents } = await pickInFlight()
      await host.setPickMode('t1', false)
      await flush()
      await answerLate(socket)
      expectCancelled(contents)
      expect(states()).toEqual([true, false])
    })

    it('discards a pick in flight when the user turns pick mode off and on again', async () => {
      const { host, socket, contents } = await pickInFlight()
      await host.setPickMode('t1', false)
      await host.setPickMode('t1', true)
      await answerLate(socket)
      expect(events('browser-pick-done')[0]).toMatchObject({ ok: false, cancelled: true })
      expect(contents.debugger.calls('Overlay.disable')).toHaveLength(1)
      boxFor(contents)
      await hover(contents, 9)
      expect(outlines(contents)).toHaveLength(1)
    })

    it('ends pick mode on Escape in the page and discards the pick in flight', async () => {
      const { socket, contents } = await pickInFlight()
      contents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' })
      await flush()
      await answerLate(socket)
      expectCancelled(contents)
      expect(states()).toEqual([true, false])
    })

    it('ignores other keys, key releases and Escape outside pick mode', async () => {
      const { host, contents } = await startPicking()
      contents.emit('before-input-event', {}, { type: 'keyDown', key: 'a' })
      contents.emit('before-input-event', {}, { type: 'keyUp', key: 'Escape' })
      expect(states()).toEqual([true])
      await host.setPickMode('t1', false)
      contents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' })
      expect(states()).toEqual([true, false])
    })

    it('ends pick mode and discards the pick when the page navigates', async () => {
      const { socket, contents } = await pickInFlight()
      contents.navigate('https://example.com/next')
      await flush()
      await answerLate(socket)
      expectCancelled(contents)
      expect(states()).toEqual([true, false])
    })

    it('ends pick mode and discards the pick when the tab stops being shown', async () => {
      const { host, socket, contents } = await pickInFlight()
      host.updateView({ tabId: 't1', shown: false, active: true, foreground: true })
      await flush()
      await answerLate(socket)
      expectCancelled(contents)
      expect(states()).toEqual([true, false])
    })

    it('keeps picking when only the active flag changes', async () => {
      const { host } = await startPicking()
      host.updateView({ tabId: 't1', shown: true, active: false, foreground: true })
      expect(states()).toEqual([true])
    })

    it('tells the window and sends no commands when the tab is unregistered', async () => {
      const { host, contents } = await startPicking()
      const before = contents.debugger.commands.length
      host.unregisterView('t1')
      await flush()
      expect(states()).toEqual([true, false])
      expect(contents.debugger.commands).toHaveLength(before)
    })

    it('tells the window when the debugger is detached from under it', async () => {
      const { contents } = await startPicking()
      contents.debugger.emit('detach', {}, 'target closed')
      await flush()
      expect(states()).toEqual([true, false])
    })

    it('tells the window when the agent is stopped', async () => {
      const { host } = await startPicking()
      host.stopSession('s1')
      expect(states()).toEqual([true, false])
    })

    it('leaves pick mode off when it is cancelled while still arming', async () => {
      const host = newHost()
      connectReady(host)
      const contents = addView(host)
      showView(host)
      const hold = deferred<unknown>()
      contents.debugger.held.set('Overlay.enable', hold)
      const arming = host.setPickMode('t1', true)
      await flush()
      contents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' })
      hold.resolve({})
      await arming
      await flush()
      expect(states()).toEqual([false])
      expect(contents.debugger.calls('Overlay.disable')).not.toHaveLength(0)
    })

    it('stops picking when re-arming fails', async () => {
      const { socket, contents } = await startPicking()
      click(contents, 42)
      await flush()
      contents.debugger.failures.set('Runtime.evaluate', new Error('gone'))
      await answerLate(socket)
      expect(states()).toEqual([true, false])
      expect(JSON.stringify(errorLog.mock.calls)).toContain('re-arming')
    })
  })

  describe('the agent while the user is picking', () => {
    const INPUT_COMMANDS = [
      { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 1, y: 2 } },
      { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'a' } },
      { method: 'Input.insertText', params: { text: 'hi' } },
    ]

    it.each(INPUT_COMMANDS)('refuses $method with user_picking and sends nothing to the page', async ({ method, params }) => {
      const { socket, contents } = await startPicking()
      const before = contents.debugger.calls(method).length
      const { result } = await run(socket, 't1', { kind: 'cdp', method, params })
      expect(errorOf(result)).toMatchObject({ code: 'user_picking' })
      expect(contents.debugger.calls(method)).toHaveLength(before)
    })

    it('still answers read-only commands', async () => {
      const { socket, contents } = await startPicking()
      contents.debugger.responses.set('Runtime.evaluate', { result: { type: 'string', value: 'x' } })
      const evaluated = await run(socket, 't1', { kind: 'cdp', method: 'Runtime.evaluate', params: { expression: '1' } })
      expect(valueOf(evaluated.result)).toMatchObject({ result: { result: { value: 'x' } } })
      const shot = await run(socket, 't1', { kind: 'cdp', method: 'Page.captureScreenshot', params: {} })
      expect(shot.result?.ok).toBe(true)
      const inspected = await run(socket, 't1', { kind: 'inspect' })
      expect(inspected.result?.ok).toBe(true)
    })

    it('does not queue input: it accepts it again as soon as picking ends', async () => {
      const { host, socket, contents } = await startPicking()
      const refused = await run(socket, 't1', { kind: 'cdp', method: 'Input.insertText', params: { text: 'x' } })
      expect(errorOf(refused.result).code).toBe('user_picking')
      await host.setPickMode('t1', false)
      const allowed = await run(socket, 't1', { kind: 'cdp', method: 'Input.insertText', params: { text: 'x' } })
      expect(allowed.result?.ok).toBe(true)
      expect(contents.debugger.calls('Input.insertText')).toHaveLength(1)
    })

    it('only refuses input for the tab being picked', async () => {
      const { host, socket } = await startPicking()
      const other = addView(host, 2, 't2')
      const { result } = await run(socket, 't2', { kind: 'cdp', method: 'Input.insertText', params: { text: 'x' } })
      expect(result?.ok).toBe(true)
      expect(other.debugger.calls('Input.insertText')).toHaveLength(1)
    })
  })
})

describe('marks on the page', () => {
  function marksRequest(socket: FakeSocket) {
    const requests = socket.messages('marks')
    return requests[requests.length - 1] as { id: string; tabId: string; generation: number; refs: string[] }
  }

  it('sends the refs of the current document to the sidecar and returns the ones that are alive', async () => {
    const host = newHost()
    const socket = connectReady(host)
    addView(host)
    const synced = host.syncMarks('t1', [
      { ref: '7', generation: 0 },
      { ref: '9', generation: 0 },
    ])
    expect(marksRequest(socket)).toMatchObject({ type: 'marks', tabId: 't1', generation: 0, refs: ['7', '9'] })
    socket.receive({ type: 'marks_result', id: marksRequest(socket).id, ok: true, alive: ['7'] })
    await expect(synced).resolves.toEqual(['7'])
  })

  it('tells the sidecar when the request expires', async () => {
    const host = newHost()
    const socket = connectReady(host)
    addView(host)
    vi.setSystemTime(7_000_000)
    const synced = host.syncMarks('t1', [{ ref: '1', generation: 0 }])
    expect(marksRequest(socket)).toMatchObject({ expiresAt: 7_000_000 + BROWSER_MARKS_TIMEOUT_MS })
    socket.receive({ type: 'marks_result', id: marksRequest(socket).id, ok: true, alive: [] })
    await synced
  })

  it('does not send refs that belong to an earlier document, so reused numbers cannot mark the wrong element', async () => {
    const host = newHost()
    const socket = connectReady(host)
    const contents = addView(host)
    contents.navigate('https://example.com/next')
    const synced = host.syncMarks('t1', [
      { ref: '3', generation: 0 },
      { ref: '3', generation: 1 },
    ])
    expect(marksRequest(socket)).toMatchObject({ generation: 1, refs: ['3'] })
    socket.receive({ type: 'marks_result', id: marksRequest(socket).id, ok: true, alive: ['3'] })
    await expect(synced).resolves.toEqual(['3'])
  })

  it('asks the sidecar to clear the marks when nothing is current', async () => {
    const host = newHost()
    const socket = connectReady(host)
    addView(host)
    const synced = host.syncMarks('t1', [])
    expect(marksRequest(socket).refs).toEqual([])
    socket.receive({ type: 'marks_result', id: marksRequest(socket).id, ok: true, alive: [] })
    await expect(synced).resolves.toEqual([])
  })

  it('rejects with the sidecar error', async () => {
    const host = newHost()
    const socket = connectReady(host)
    addView(host)
    const synced = host.syncMarks('t1', [{ ref: '1', generation: 0 }])
    socket.receive({ type: 'marks_result', id: marksRequest(socket).id, ok: false, error: { code: 'stale_document', message: 'moved' } })
    await expect(synced).rejects.toThrow('stale_document: moved')
  })

  it('rejects an unknown tab, a missing sidecar and an unanswered request', async () => {
    const host = newHost()
    await expect(host.syncMarks('nope', [])).rejects.toThrow('no browser view')
    addView(host)
    await expect(host.syncMarks('t1', [])).rejects.toThrow('the sidecar is not connected')
    connectReady(host)
    const silent = host.syncMarks('t1', [])
    const failure = expect(silent).rejects.toThrow('in time')
    await vi.advanceTimersByTimeAsync(BROWSER_MARKS_TIMEOUT_MS)
    await failure
  })

  it('ignores an answer nobody asked for', async () => {
    const host = newHost()
    const socket = connectReady(host)
    addView(host)
    socket.receive({ type: 'marks_result', id: 'unknown', ok: true, alive: [] })
    const synced = host.syncMarks('t1', [])
    socket.receive({ type: 'marks_result', id: marksRequest(socket).id, ok: true, alive: [] })
    await expect(synced).resolves.toEqual([])
  })

  it('rejects when the connection drops before the answer', async () => {
    const host = newHost()
    const socket = connectReady(host)
    addView(host)
    const synced = host.syncMarks('t1', [])
    const failure = expect(synced).rejects.toThrow('connection to the sidecar closed')
    socket.closeWith(1006)
    await failure
  })
})
