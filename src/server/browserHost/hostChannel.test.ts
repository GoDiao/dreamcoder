import { afterEach, describe, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import {
  BrowserHostChannel,
  BrowserHostError,
  createBrowserHostSocketData,
  parseBrowserHostInbound,
  type BrowserHostSocketData,
} from './hostChannel.js'
import {
  BROWSER_HOST_CLOSE_REPLACED,
  BROWSER_HOST_CLOSE_UNAUTHORIZED,
  BROWSER_HOST_PROTOCOL_VERSION,
  type BrowserViewInfo,
} from './protocol.js'

type FakeSocket = ServerWebSocket<BrowserHostSocketData> & {
  sent: Array<Record<string, unknown>>
  closed: Array<{ code: number | undefined; reason: string | undefined }>
}

function fakeSocket(): FakeSocket {
  const socket = {
    data: createBrowserHostSocketData(),
    readyState: 1,
    sent: [] as Array<Record<string, unknown>>,
    closed: [] as Array<{ code: number | undefined; reason: string | undefined }>,
    send(payload: string) {
      this.sent.push(JSON.parse(payload) as Record<string, unknown>)
      return payload.length
    },
    close(code?: number, reason?: string) {
      this.closed.push({ code, reason })
      this.readyState = 3
    },
  }
  return socket as unknown as FakeSocket
}

const view: BrowserViewInfo = {
  sessionId: 's1',
  tabId: 't1',
  webContentsId: 7,
  url: 'https://example.com/',
  title: 'Example',
  generation: 2,
  shown: true,
  active: true,
  foreground: true,
}

function hello(token: string, protocol = BROWSER_HOST_PROTOCOL_VERSION) {
  return JSON.stringify({ type: 'hello', token, protocol })
}

function connected(token = 'secret') {
  const channel = new BrowserHostChannel()
  channel.setToken(token)
  const socket = fakeSocket()
  channel.open(socket)
  channel.message(socket, hello(token))
  return { channel, socket }
}

const sockets: FakeSocket[] = []

afterEach(() => {
  for (const socket of sockets.splice(0)) if (socket.data.helloTimer) clearTimeout(socket.data.helloTimer)
})

describe('browser host handshake', () => {
  test('accepts the right token and answers ready', () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    expect(channel.isConnected()).toBe(true)
    expect(socket.sent).toEqual([{ type: 'ready' }])
    expect(socket.closed).toEqual([])
  })

  test('closes a wrong token with the unauthorized code', () => {
    const channel = new BrowserHostChannel()
    channel.setToken('secret')
    const socket = fakeSocket()
    channel.open(socket)
    channel.message(socket, hello('other'))
    sockets.push(socket)
    expect(channel.isConnected()).toBe(false)
    expect(socket.closed[0]?.code).toBe(BROWSER_HOST_CLOSE_UNAUTHORIZED)
  })

  test('refuses everything when the sidecar holds no token', () => {
    const channel = new BrowserHostChannel()
    const socket = fakeSocket()
    channel.open(socket)
    channel.message(socket, hello(''))
    sockets.push(socket)
    expect(socket.closed[0]?.code).toBe(BROWSER_HOST_CLOSE_UNAUTHORIZED)
  })

  test('refuses a protocol version it does not speak', () => {
    const channel = new BrowserHostChannel()
    channel.setToken('secret')
    const socket = fakeSocket()
    channel.open(socket)
    channel.message(socket, hello('secret', BROWSER_HOST_PROTOCOL_VERSION + 1))
    sockets.push(socket)
    expect(socket.closed[0]?.code).toBe(BROWSER_HOST_CLOSE_UNAUTHORIZED)
  })

  test('closes a first message that is not a hello', () => {
    const channel = new BrowserHostChannel()
    channel.setToken('secret')
    const socket = fakeSocket()
    channel.open(socket)
    channel.message(socket, JSON.stringify({ type: 'views', views: [] }))
    sockets.push(socket)
    expect(socket.closed[0]?.code).toBe(BROWSER_HOST_CLOSE_UNAUTHORIZED)
  })

  test('rejects a second connection while the first is open', () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    const second = fakeSocket()
    channel.open(second)
    channel.message(second, hello('secret'))
    sockets.push(second)
    expect(second.closed[0]?.code).toBe(BROWSER_HOST_CLOSE_REPLACED)
    expect(channel.isConnected()).toBe(true)
  })

  test('accepts a new connection after the first one closed', () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    channel.close(socket)
    const second = fakeSocket()
    channel.open(second)
    channel.message(second, hello('secret'))
    sockets.push(second)
    expect(channel.isConnected()).toBe(true)
  })
})

describe('browser host views and events', () => {
  test('stores the view list and notifies listeners', () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    let notified = 0
    channel.onViews(() => {
      notified += 1
    })
    channel.message(socket, JSON.stringify({ type: 'views', views: [view] }))
    expect(notified).toBe(1)
    expect(channel.listViews('s1')).toEqual([view])
    expect(channel.listViews('s2')).toEqual([])
    expect(channel.getView('t1')).toEqual(view)
  })

  test('drops malformed view lists', () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    channel.message(socket, JSON.stringify({ type: 'views', views: [{ ...view, generation: 'x' }] }))
    expect(channel.listViews('s1')).toEqual([])
  })

  test('clears views and notifies when the connection closes', () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    channel.message(socket, JSON.stringify({ type: 'views', views: [view] }))
    let notified = 0
    channel.onViews(() => {
      notified += 1
    })
    channel.close(socket)
    expect(notified).toBe(1)
    expect(channel.listViews('s1')).toEqual([])
  })

  test('forwards stop events to listeners', () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    const stopped: string[] = []
    channel.onStop((sessionId) => stopped.push(sessionId))
    channel.message(socket, JSON.stringify({ type: 'stop', sessionId: 's1' }))
    expect(stopped).toEqual(['s1'])
  })

  test('ignores views and results before the handshake', () => {
    const channel = new BrowserHostChannel()
    channel.setToken('secret')
    const socket = fakeSocket()
    channel.open(socket)
    channel.message(socket, JSON.stringify({ type: 'views', views: [view] }))
    sockets.push(socket)
    expect(channel.listViews('s1')).toEqual([])
  })
})

describe('browser host grant replies and trust requests', () => {
  test('forwards a grant reply from the authenticated desktop to listeners', () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    const replies: Array<{ requestId: string; decision: string }> = []
    channel.onGrantReply((reply) => replies.push(reply))
    channel.message(socket, JSON.stringify({ type: 'grant_reply', requestId: 'g1', decision: 'session' }))
    expect(replies).toEqual([{ requestId: 'g1', decision: 'session' }])
  })

  test('refuses a grant reply sent before the handshake and closes the socket', () => {
    const channel = new BrowserHostChannel()
    channel.setToken('secret')
    const replies: unknown[] = []
    channel.onGrantReply((reply) => replies.push(reply))
    const socket = fakeSocket()
    channel.open(socket)
    channel.message(socket, JSON.stringify({ type: 'grant_reply', requestId: 'g1', decision: 'session' }))
    sockets.push(socket)
    expect(replies).toEqual([])
    expect(socket.closed[0]?.code).toBe(BROWSER_HOST_CLOSE_UNAUTHORIZED)
  })

  test('refuses a trust request sent before the handshake', async () => {
    const channel = new BrowserHostChannel()
    channel.setToken('secret')
    const requests: unknown[] = []
    channel.setTrustHandler(async (request) => {
      requests.push(request)
      return []
    })
    const socket = fakeSocket()
    channel.open(socket)
    channel.message(socket, JSON.stringify({ type: 'trust', id: 't1', op: 'add', origin: 'https://example.com' }))
    sockets.push(socket)
    await Promise.resolve()
    expect(requests).toEqual([])
    expect(socket.sent).toEqual([])
    expect(socket.closed[0]?.code).toBe(BROWSER_HOST_CLOSE_UNAUTHORIZED)
  })

  test('answers a trust request with the origins the handler returns', async () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    const seen: unknown[] = []
    channel.setTrustHandler(async (request) => {
      seen.push(request)
      return ['https://example.com']
    })
    channel.message(socket, JSON.stringify({ type: 'trust', id: 't1', op: 'add', origin: 'https://example.com' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(seen).toEqual([{ op: 'add', origin: 'https://example.com' }])
    expect(socket.sent).toContainEqual({ type: 'trust_result', id: 't1', ok: true, origins: ['https://example.com'] })
  })

  test('answers a failing trust request with the error code and message', async () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    channel.setTrustHandler(async () => {
      throw Object.assign(new Error('nope'), { code: 'invalid_origin' })
    })
    channel.message(socket, JSON.stringify({ type: 'trust', id: 't2', op: 'remove', origin: 'x' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(socket.sent).toContainEqual({ type: 'trust_result', id: 't2', ok: false, error: { code: 'invalid_origin', message: 'nope' } })
  })

  test('answers that the list is unavailable when nothing handles trust requests', () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    channel.message(socket, JSON.stringify({ type: 'trust', id: 't3', op: 'list' }))
    expect(socket.sent).toContainEqual({
      type: 'trust_result',
      id: 't3',
      ok: false,
      error: { code: 'unavailable', message: expect.any(String) },
    })
  })
})

describe('browser host requests', () => {
  test('fails at once when no desktop is connected', async () => {
    const channel = new BrowserHostChannel()
    const error = await channel.request({ kind: 'inspect' }, { tabId: 't1' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BrowserHostError)
    expect((error as BrowserHostError).code).toBe('no_host')
  })

  test('sends a command and resolves with its value and dialogs', async () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    const promise = channel.request({ kind: 'activate' }, { tabId: 't1', expectGeneration: 3 })
    const command = socket.sent.find((message) => message.type === 'command') as Record<string, unknown>
    expect(command.tabId).toBe('t1')
    expect(command.expectGeneration).toBe(3)
    expect(command.command).toEqual({ kind: 'activate' })
    channel.message(
      socket,
      JSON.stringify({
        type: 'result',
        id: command.id,
        ok: true,
        value: { shown: true },
        dialogs: [{ kind: 'alert', message: 'hi', handledAs: 'accepted' }],
      }),
    )
    expect(await promise).toEqual({
      value: { shown: true },
      dialogs: [{ kind: 'alert', message: 'hi', handledAs: 'accepted' }],
    })
  })

  test('rejects with the error code from the desktop', async () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    const promise = channel.request({ kind: 'activate' }, { tabId: 't1' })
    const command = socket.sent.find((message) => message.type === 'command') as Record<string, unknown>
    channel.message(
      socket,
      JSON.stringify({ type: 'result', id: command.id, ok: false, error: { code: 'stale_document', message: 'moved' } }),
    )
    const error = (await promise.catch((caught: unknown) => caught)) as BrowserHostError
    expect(error.code).toBe('stale_document')
    expect(error.message).toBe('moved')
  })

  test('fails in-flight requests without replaying them when the connection drops', async () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    const promise = channel.request({ kind: 'activate' }, { tabId: 't1' })
    const sentBefore = socket.sent.length
    channel.close(socket)
    const error = (await promise.catch((caught: unknown) => caught)) as BrowserHostError
    expect(error.code).toBe('disconnected')
    expect(error.message).toContain('may already have run')
    expect(socket.sent.length).toBe(sentBefore)
  })

  test('times out, tells the desktop to cancel and ignores a late result', async () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    const promise = channel.request({ kind: 'activate' }, { tabId: 't1', timeoutMs: 20 })
    const command = socket.sent.find((message) => message.type === 'command') as Record<string, unknown>
    const error = (await promise.catch((caught: unknown) => caught)) as BrowserHostError
    expect(error.code).toBe('timeout')
    expect(socket.sent.some((message) => message.type === 'cancel' && message.id === command.id)).toBe(true)
    channel.message(socket, JSON.stringify({ type: 'result', id: command.id, ok: true, value: {} }))
  })

  test('cancels through an abort signal', async () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    const controller = new AbortController()
    const promise = channel.request({ kind: 'activate' }, { tabId: 't1', signal: controller.signal })
    controller.abort()
    const error = (await promise.catch((caught: unknown) => caught)) as BrowserHostError
    expect(error.code).toBe('cancelled')
    expect(socket.sent.some((message) => message.type === 'cancel')).toBe(true)
  })

  test('does not send anything for a signal that is already aborted', async () => {
    const { channel, socket } = connected()
    sockets.push(socket)
    const sentBefore = socket.sent.length
    const controller = new AbortController()
    controller.abort()
    const error = (await channel
      .request({ kind: 'activate' }, { tabId: 't1', signal: controller.signal })
      .catch((caught: unknown) => caught)) as BrowserHostError
    expect(error.code).toBe('cancelled')
    expect(socket.sent.length).toBe(sentBefore)
  })
})

describe('parseBrowserHostInbound', () => {
  test('accepts well-formed grant replies and trust requests', () => {
    expect(parseBrowserHostInbound(JSON.stringify({ type: 'grant_reply', requestId: 'g', decision: 'once' }))).toEqual({
      type: 'grant_reply',
      requestId: 'g',
      decision: 'once',
    })
    expect(parseBrowserHostInbound(JSON.stringify({ type: 'trust', id: 't', op: 'list' }))).toEqual({ type: 'trust', id: 't', op: 'list' })
    expect(parseBrowserHostInbound(JSON.stringify({ type: 'trust', id: 't', op: 'add', origin: 'https://a.test' }))).toEqual({
      type: 'trust',
      id: 't',
      op: 'add',
      origin: 'https://a.test',
    })
  })

  test('rejects malformed grant replies and trust requests', () => {
    const bad = [
      { type: 'grant_reply', requestId: 'g', decision: 'always' },
      { type: 'grant_reply', requestId: '', decision: 'deny' },
      { type: 'grant_reply', requestId: 7, decision: 'deny' },
      { type: 'grant_reply', requestId: 'x'.repeat(201), decision: 'deny' },
      { type: 'trust', id: 't', op: 'clear' },
      { type: 'trust', id: 't', op: 'add' },
      { type: 'trust', id: 't', op: 'remove', origin: 3 },
      { type: 'trust', id: 't', op: 'list', origin: 'https://a.test' },
      { type: 'trust', op: 'list' },
    ]
    for (const message of bad) expect(parseBrowserHostInbound(JSON.stringify(message))).toBeNull()
  })

  test('returns null for junk', () => {
    expect(parseBrowserHostInbound('nope')).toBeNull()
    expect(parseBrowserHostInbound('[]')).toBeNull()
    expect(parseBrowserHostInbound(JSON.stringify({ type: 'result', id: 'a' }))).toBeNull()
  })
})
