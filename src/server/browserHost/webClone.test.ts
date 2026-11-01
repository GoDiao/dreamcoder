import { beforeEach, describe, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import type { BackgroundBrowserEvent, BrowserHostChannel } from './hostChannel.js'
import type { BackgroundBrowserCommand } from './protocol.js'
import { BrowserSessionTokens } from './sessionTokens.js'
import { handleWebCloneHttp, handleWebCloneRoute, WebCloneBrowsers, type WebCloneSocketData } from './webClone.js'

class FakeChannel {
  connected = true
  commands: BackgroundBrowserCommand[] = []
  cdpResult: unknown = { result: { ok: true } }
  failWith: Error | null = null
  private events = new Set<(event: BackgroundBrowserEvent) => void>()
  private disconnects = new Set<() => void>()

  isConnected() {
    return this.connected
  }

  async requestBackground(command: BackgroundBrowserCommand) {
    this.commands.push(command)
    if (this.failWith) throw this.failWith
    return command.kind === 'cdp' ? this.cdpResult : {}
  }

  onBackgroundEvent(listener: (event: BackgroundBrowserEvent) => void) {
    this.events.add(listener)
    return () => this.events.delete(listener)
  }

  onDisconnect(listener: () => void) {
    this.disconnects.add(listener)
    return () => this.disconnects.delete(listener)
  }

  emit(event: BackgroundBrowserEvent) {
    this.events.forEach(listener => listener(event))
  }

  disconnect() {
    this.connected = false
    this.disconnects.forEach(listener => listener())
  }
}

type FakeSocket = ServerWebSocket<WebCloneSocketData> & { sent: Array<Record<string, any>>; closed: Array<{ code?: number; reason?: string }> }

function fakeSocket(data: WebCloneSocketData): FakeSocket {
  return {
    data,
    readyState: 1,
    sent: [],
    closed: [],
    send(payload: string) {
      this.sent.push(JSON.parse(payload))
      return payload.length
    },
    close(code?: number, reason?: string) {
      this.closed.push({ code, reason })
      this.readyState = 3
    },
  } as unknown as FakeSocket
}

let channel: FakeChannel
let tokens: BrowserSessionTokens
let grantCalls: Array<{ sessionId: string; origin: string; action: string }>
let denyGrants: boolean
let browsers: WebCloneBrowsers
let upgrades: WebCloneSocketData[]

beforeEach(() => {
  channel = new FakeChannel()
  tokens = new BrowserSessionTokens()
  grantCalls = []
  denyGrants = false
  browsers = new WebCloneBrowsers({
    channel: channel as unknown as BrowserHostChannel,
    tokens,
    grants: {
      async ensureOperation(request) {
        grantCalls.push({ sessionId: request.sessionId, origin: request.origin, action: request.action })
        if (denyGrants) throw new Error('not granted')
      },
    },
  })
  upgrades = []
})

const BASE = 'http://127.0.0.1:3456/web-clone-browser'

function call(method: string, path: string, token: string | null) {
  const url = new URL(`${BASE}${path}`)
  const request = new Request(url, { method, headers: token ? { authorization: `Bearer ${token}` } : {} })
  return handleWebCloneHttp(request, url, { browsers, upgrade: (data) => (upgrades.push(data), true) })
}

async function open(owner = 's1') {
  const token = tokens.issue(owner)
  const session = (await (await call('POST', '', token))!.json()) as { id: string; endpoint: string }
  const target = (await (await call('PUT', `/${session.id}/json/new?about%3Ablank`, token))!.json()) as { id: string; webSocketDebuggerUrl: string }
  return { token, session, target }
}

async function socketFor(owner = 's1') {
  const opened = await open(owner)
  const socket = fakeSocket({ channel: 'web-clone', browserSession: opened.session.id, target: opened.target.id, owner })
  browsers.open(socket)
  return { ...opened, socket }
}

const send = (socket: FakeSocket, message: Record<string, unknown>) => browsers.message(socket, JSON.stringify(message))

describe('the browser session http interface', () => {
  test('refuses a call without a token or with a token nobody holds', async () => {
    expect((await call('POST', '', null))!.status).toBe(401)
    expect((await call('POST', '', 'nope'))!.status).toBe(401)
    expect(channel.commands).toEqual([])
  })

  test('creates a session and answers where its pages are made', async () => {
    const { session } = await open()
    expect(session.endpoint).toBe(`${BASE}/${session.id}`)
  })

  test('makes a page through the desktop and answers its socket address under the session', async () => {
    const { session, target } = await open()
    expect(channel.commands).toEqual([{ kind: 'createTarget', session: session.id, target: target.id }])
    expect(target.webSocketDebuggerUrl).toBe(`ws://127.0.0.1:3456/web-clone-browser/${session.id}/devtools/page/${target.id}`)
  })

  test('closes a page and then answers 404 for it', async () => {
    const { token, session, target } = await open()
    expect((await call('GET', `/${session.id}/json/close/${target.id}`, token))!.status).toBe(200)
    expect(channel.commands.at(-1)).toEqual({ kind: 'closeTarget', session: session.id, target: target.id })
    expect((await call('GET', `/${session.id}/json/close/${target.id}`, token))!.status).toBe(404)
  })

  test('deletes a session and tells the desktop to drop all its pages', async () => {
    const { token, session } = await open()
    expect((await call('DELETE', `/${session.id}`, token))!.status).toBe(200)
    expect(channel.commands.at(-1)).toEqual({ kind: 'destroySession', session: session.id })
    expect((await call('PUT', `/${session.id}/json/new`, token))!.status).toBe(404)
  })

  test('does not show a session to another token', async () => {
    const { session } = await open('s1')
    const other = tokens.issue('s2')
    expect((await call('DELETE', `/${session.id}`, other))!.status).toBe(404)
    expect((await call('PUT', `/${session.id}/json/new`, other))!.status).toBe(404)
  })

  test('refuses the wrong method and unknown routes', async () => {
    const { token, session } = await open()
    expect((await call('GET', '', token))!.status).toBe(405)
    expect((await call('GET', `/${session.id}`, token))!.status).toBe(405)
    expect((await call('GET', `/${session.id}/json/new`, token))!.status).toBe(405)
    expect((await call('GET', `/${session.id}/other`, token))!.status).toBe(404)
  })

  test('upgrades the socket of a page it made and refuses an unknown page', async () => {
    const { token, session, target } = await open()
    expect(await call('GET', `/${session.id}/devtools/page/${target.id}`, token)).toBeUndefined()
    expect(upgrades).toEqual([{ channel: 'web-clone', browserSession: session.id, target: target.id, owner: 's1' }])
    expect((await call('GET', `/${session.id}/devtools/page/nope`, token))!.status).toBe(404)
  })

  test('answers 502 with the reason when the desktop cannot make the page', async () => {
    const { token, session } = await open()
    channel.failWith = new Error('window failed')
    const response = (await call('PUT', `/${session.id}/json/new`, token))!
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'window failed' })
  })
})

describe('the page socket', () => {
  test('forwards a command to the desktop and answers with its result under the same id', async () => {
    const { socket, session, target } = await socketFor()
    channel.cdpResult = { result: { frameTree: 1 } }
    await send(socket, { id: 7, method: 'Page.getFrameTree', params: { a: 1 } })
    expect(channel.commands.at(-1)).toEqual({ kind: 'cdp', session: session.id, target: target.id, method: 'Page.getFrameTree', params: { a: 1 } })
    expect(socket.sent).toEqual([{ id: 7, result: { frameTree: 1 } }])
  })

  test('answers an error in CDP shape when the desktop fails', async () => {
    const { socket } = await socketFor()
    channel.failWith = new Error('the window is gone')
    await send(socket, { id: 1, method: 'Runtime.enable' })
    expect(socket.sent).toEqual([{ id: 1, error: { code: -32000, message: 'the window is gone' } }])
  })

  test('refuses commands of the domains that reach outside the page without asking the desktop', async () => {
    const { socket } = await socketFor()
    const before = channel.commands.length
    for (const [id, method] of ['Browser.close', 'Target.createTarget', 'SystemInfo.getInfo', 'Storage.clearDataForOrigin'].entries()) {
      await send(socket, { id, method })
    }
    expect(socket.sent.every(reply => reply.error?.message.includes('is not available'))).toBe(true)
    expect(socket.sent).toHaveLength(4)
    expect(channel.commands).toHaveLength(before)
  })

  test('ignores a message that is not a command', async () => {
    const { socket } = await socketFor()
    await browsers.message(socket, 'not json')
    await send(socket, { method: 'Page.enable' })
    await send(socket, { id: 'x', method: 'Page.enable' })
    expect(socket.sent).toEqual([])
  })

  test('lets a page go to an external address only after the user agrees, naming the owner and the address', async () => {
    const { socket } = await socketFor('s9')
    await send(socket, { id: 1, method: 'Page.navigate', params: { url: 'https://example.com/a?b=1' } })
    expect(grantCalls).toEqual([{ sessionId: 's9', origin: 'https://example.com', action: 'Open https://example.com/a?b=1 to clone it' }])
    expect(channel.commands.at(-1)).toMatchObject({ kind: 'cdp', method: 'Page.navigate' })
    expect(socket.sent[0]).toEqual({ id: 1, result: { ok: true } })
  })

  test('does not navigate when the user does not agree', async () => {
    const { socket } = await socketFor()
    denyGrants = true
    const before = channel.commands.length
    await send(socket, { id: 1, method: 'Page.navigate', params: { url: 'https://example.com/' } })
    expect(socket.sent).toEqual([{ id: 1, error: { code: -32000, message: 'not granted' } }])
    expect(channel.commands).toHaveLength(before)
  })

  test('lets a local address through without asking', async () => {
    const { socket } = await socketFor()
    for (const url of ['http://localhost:3000/', 'http://127.0.0.1:8080/x', 'http://[::1]:1/']) {
      await send(socket, { id: 1, method: 'Page.navigate', params: { url } })
    }
    expect(grantCalls).toEqual([])
    expect(socket.sent).toHaveLength(3)
    expect(socket.sent.every(reply => reply.result)).toBe(true)
  })

  test('refuses navigation to anything that is not an http or https address', async () => {
    const { socket } = await socketFor()
    const before = channel.commands.length
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'about:blank', 'chrome://gpu', '/relative', '']) {
      await send(socket, { id: 1, method: 'Page.navigate', params: { url } })
    }
    expect(socket.sent).toHaveLength(7)
    expect(socket.sent.every(reply => reply.error)).toBe(true)
    expect(channel.commands).toHaveLength(before)
    expect(grantCalls).toEqual([])
  })

  test('sends the events of its page to its sockets and to nobody else', async () => {
    const first = await socketFor()
    const second = await socketFor()
    channel.emit({ kind: 'cdp', session: first.session.id, target: first.target.id, method: 'Network.requestWillBeSent', params: { requestId: '1' } })
    expect(first.socket.sent).toEqual([{ method: 'Network.requestWillBeSent', params: { requestId: '1' } }])
    expect(second.socket.sent).toEqual([])
  })

  test('closes the socket and forgets the page when the desktop says the page closed', async () => {
    const { socket, session, target, token } = await socketFor()
    channel.emit({ kind: 'closed', session: session.id, target: target.id })
    expect(socket.closed).toHaveLength(1)
    expect((await call('GET', `/${session.id}/devtools/page/${target.id}`, token))!.status).toBe(404)
  })

  test('closes every socket and forgets every session when the desktop disconnects', async () => {
    const { socket, session, token } = await socketFor()
    channel.disconnect()
    expect(socket.closed).toEqual([{ code: 1001, reason: 'the desktop app disconnected' }])
    expect((await call('DELETE', `/${session.id}`, token))!.status).toBe(404)
  })

  test('closes a socket for a page that is not there', () => {
    const socket = fakeSocket({ channel: 'web-clone', browserSession: 'nope', target: 'nope', owner: 's1' })
    browsers.open(socket)
    expect(socket.closed).toHaveLength(1)
  })
})

describe('ending sessions', () => {
  test('drops only the sessions of the owner whose CLI session ended', async () => {
    const mine = await open('s1')
    const theirs = await open('s2')
    await browsers.destroyForOwner('s1')
    expect(channel.commands.filter(command => command.kind === 'destroySession')).toEqual([{ kind: 'destroySession', session: mine.session.id }])
    expect((await call('PUT', `/${mine.session.id}/json/new`, mine.token))!.status).toBe(404)
    expect((await call('PUT', `/${theirs.session.id}/json/new`, theirs.token))!.status).toBe(200)
  })

  test('closes the sockets of a destroyed session', async () => {
    const { socket, session } = await socketFor()
    await browsers.destroy(session.id)
    expect(socket.closed).toEqual([{ code: 1000, reason: 'session closed' }])
  })

  test('still forgets the session when the desktop cannot be told', async () => {
    const { session, token } = await open()
    channel.failWith = new Error('gone')
    await browsers.destroy(session.id)
    expect((await call('DELETE', `/${session.id}`, token))!.status).toBe(404)
  })
})

describe('the route guard', () => {
  const route = (context: { clientAddress: string | null; origin: string | null }) => {
    const url = new URL(`${BASE}`)
    const request = new Request(url, { method: 'POST', headers: { authorization: `Bearer ${tokens.issue('s1')}` } })
    return handleWebCloneRoute(request, url, context, { browsers, upgrade: (data) => (upgrades.push(data), true) })
  }

  test('lets a loopback request without an Origin through to the interface', async () => {
    for (const clientAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect((await route({ clientAddress, origin: null }))!.status).toBe(200)
    }
  })

  test('refuses a request from another address without calling the interface', async () => {
    for (const clientAddress of ['192.168.1.20', '10.0.0.5', '8.8.8.8']) {
      expect((await route({ clientAddress, origin: null }))!.status).toBe(403)
    }
    expect(channel.commands).toEqual([])
  })

  test('refuses a request whose address is unknown', async () => {
    expect((await route({ clientAddress: null, origin: null }))!.status).toBe(403)
  })

  test('refuses a request that carries an Origin, as a web page in a browser would send', async () => {
    expect((await route({ clientAddress: '127.0.0.1', origin: 'https://evil.example' }))!.status).toBe(403)
    expect((await route({ clientAddress: '127.0.0.1', origin: 'http://localhost:3000' }))!.status).toBe(403)
  })
})
