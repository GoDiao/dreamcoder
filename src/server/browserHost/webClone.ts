import type { ServerWebSocket } from 'bun'
import { BACKGROUND_CDP_BLOCKED_DOMAINS } from './protocol.js'
import type { BackgroundBrowserEvent, BrowserHostChannel } from './hostChannel.js'
import { WEB_CLONE_BROWSER_PATH } from './names.js'
import { isLocalNonBrowserRequest, isLoopbackHost } from '../h5AccessPolicy.js'
import type { BrowserGrants } from './service.js'
import { BrowserSessionTokens, bearerToken, unauthorizedResponse } from './sessionTokens.js'

export const webCloneTokens = new BrowserSessionTokens()

export type WebCloneSocketData = { channel: 'web-clone'; browserSession: string; target: string; owner: string }

type CloneSession = {
  id: string
  owner: string
  targets: Map<string, Set<ServerWebSocket<WebCloneSocketData>>>
}

export type WebCloneDeps = {
  channel: BrowserHostChannel
  grants: Pick<BrowserGrants, 'ensureOperation'>
  tokens?: BrowserSessionTokens
}


function cdpError(message: string) {
  return { error: { code: -32000, message } }
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class WebCloneBrowsers {
  private readonly channel: BrowserHostChannel
  private readonly grants: Pick<BrowserGrants, 'ensureOperation'>
  readonly tokens: BrowserSessionTokens
  private readonly sessions = new Map<string, CloneSession>()
  private readonly controllers = new Map<ServerWebSocket<WebCloneSocketData>, AbortController>()

  constructor(deps: WebCloneDeps) {
    this.channel = deps.channel
    this.grants = deps.grants
    this.tokens = deps.tokens ?? webCloneTokens
    this.channel.onBackgroundEvent(event => this.deliver(event))
    this.channel.onDisconnect(() => this.forgetAll())
  }

  ownerOf(token: string | null): string | null {
    return token ? this.tokens.resolve(token) : null
  }

  async create(owner: string): Promise<string> {
    const id = crypto.randomUUID()
    this.sessions.set(id, { id, owner, targets: new Map() })
    return id
  }

  has(id: string, owner: string): boolean {
    return this.sessions.get(id)?.owner === owner
  }

  async createTarget(id: string): Promise<string> {
    const session = this.require(id)
    const target = crypto.randomUUID()
    await this.channel.requestBackground({ kind: 'createTarget', session: id, target })
    session.targets.set(target, new Set())
    return target
  }

  async closeTarget(id: string, target: string): Promise<boolean> {
    const session = this.require(id)
    if (!session.targets.has(target)) return false
    await this.dropTarget(session, target)
    return true
  }

  async destroy(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    for (const sockets of session.targets.values()) for (const socket of sockets) socket.close(1000, 'session closed')
    await this.channel.requestBackground({ kind: 'destroySession', session: id }, { timeoutMs: 5_000 }).catch(() => undefined)
  }

  async destroyForOwner(owner: string): Promise<void> {
    const ids = [...this.sessions.values()].filter(session => session.owner === owner).map(session => session.id)
    await Promise.all(ids.map(id => this.destroy(id)))
  }

  hasTarget(id: string, target: string): boolean {
    return this.sessions.get(id)?.targets.has(target) === true
  }

  open(ws: ServerWebSocket<WebCloneSocketData>) {
    const session = this.sessions.get(ws.data.browserSession)
    const sockets = session?.targets.get(ws.data.target)
    if (!sockets) {
      ws.close(1008, 'unknown target')
      return
    }
    sockets.add(ws)
    this.controllers.set(ws, new AbortController())
  }

  close(ws: ServerWebSocket<WebCloneSocketData>) {
    this.controllers.get(ws)?.abort()
    this.controllers.delete(ws)
    this.sessions.get(ws.data.browserSession)?.targets.get(ws.data.target)?.delete(ws)
  }

  async message(ws: ServerWebSocket<WebCloneSocketData>, raw: string | Buffer) {
    let request: { id?: unknown; method?: unknown; params?: unknown }
    try {
      request = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
    } catch {
      return
    }
    if (typeof request.id !== 'number' || typeof request.method !== 'string') return
    const params = typeof request.params === 'object' && request.params !== null ? (request.params as Record<string, unknown>) : undefined
    const reply = (body: Record<string, unknown>) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ id: request.id, ...body }))
    }
    try {
      const refusal = await this.screen(ws, request.method, params)
      if (refusal) return reply(cdpError(refusal))
      const result = await this.channel.requestBackground(
        { kind: 'cdp', session: ws.data.browserSession, target: ws.data.target, method: request.method, ...(params ? { params } : {}) },
        { signal: this.controllers.get(ws)?.signal, timeoutMs: 120_000 },
      )
      reply({ result: (result as { result?: unknown } | null)?.result ?? {} })
    } catch (error) {
      reply(cdpError(describe(error)))
    }
  }

  private async screen(ws: ServerWebSocket<WebCloneSocketData>, method: string, params: Record<string, unknown> | undefined): Promise<string | null> {
    const domain = method.split('.')[0] ?? ''
    if (BACKGROUND_CDP_BLOCKED_DOMAINS.includes(domain)) return `${method} is not available in this browser.`
    if (method !== 'Page.navigate') return null
    const raw = typeof params?.url === 'string' ? params.url : ''
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return `Page.navigate needs an absolute URL, got ${JSON.stringify(raw.slice(0, 80))}.`
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return `Only http and https addresses can be opened, not ${url.protocol}.`
    if (isLoopbackHost(url.hostname)) return null
    await this.grants.ensureOperation(
      { sessionId: ws.data.owner, origin: url.origin, action: `Open ${url.toString()} to clone it` },
      this.controllers.get(ws)?.signal,
    )
    return null
  }

  private deliver(event: BackgroundBrowserEvent) {
    const session = this.sessions.get(event.session)
    const sockets = session?.targets.get(event.target)
    if (!session || !sockets) return
    if (event.kind === 'closed') {
      session.targets.delete(event.target)
      for (const socket of sockets) socket.close(1000, 'target closed')
      return
    }
    const payload = JSON.stringify({ method: event.method, params: event.params ?? {} })
    for (const socket of sockets) if (socket.readyState === 1) socket.send(payload)
  }

  private async dropTarget(session: CloneSession, target: string) {
    const sockets = session.targets.get(target)
    session.targets.delete(target)
    for (const socket of sockets ?? []) socket.close(1000, 'target closed')
    await this.channel.requestBackground({ kind: 'closeTarget', session: session.id, target }, { timeoutMs: 5_000 }).catch(() => undefined)
  }

  private forgetAll() {
    for (const session of this.sessions.values()) {
      for (const sockets of session.targets.values()) for (const socket of sockets) socket.close(1001, 'the desktop app disconnected')
    }
    this.sessions.clear()
  }

  private require(id: string): CloneSession {
    const session = this.sessions.get(id)
    if (!session) throw new Error('Unknown browser session')
    return session
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export type WebCloneHttpDeps = {
  browsers: WebCloneBrowsers
  upgrade: (data: WebCloneSocketData) => boolean
}

export async function handleWebCloneHttp(request: Request, url: URL, deps: WebCloneHttpDeps): Promise<Response | undefined> {
  const owner = deps.browsers.ownerOf(bearerToken(request))
  if (!owner) return unauthorizedResponse()
  const segments = url.pathname.slice(WEB_CLONE_BROWSER_PATH.length).split('/').filter(Boolean)
  const [id, area, kind, target] = segments
  const endpoint = (sessionId: string) => `${url.origin}${WEB_CLONE_BROWSER_PATH}/${sessionId}`
  try {
    if (id === undefined) {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
      const created = await deps.browsers.create(owner)
      return json({ id: created, endpoint: endpoint(created) })
    }
    if (!deps.browsers.has(id, owner)) return json({ error: 'Unknown browser session' }, 404)
    if (area === undefined) {
      if (request.method !== 'DELETE') return json({ error: 'Method not allowed' }, 405)
      await deps.browsers.destroy(id)
      return json({ ok: true })
    }
    if (area === 'json' && kind === 'new') {
      if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405)
      const created = await deps.browsers.createTarget(id)
      return json({
        id: created,
        type: 'page',
        url: 'about:blank',
        webSocketDebuggerUrl: `${endpoint(id).replace(/^http/, 'ws')}/devtools/page/${created}`,
      })
    }
    if (area === 'json' && kind === 'close' && target) {
      const closed = await deps.browsers.closeTarget(id, target)
      return closed ? new Response('Target is closing') : json({ error: 'Unknown target' }, 404)
    }
    if (area === 'devtools' && kind === 'page' && target) {
      if (!deps.browsers.hasTarget(id, target)) return json({ error: 'Unknown target' }, 404)
      if (deps.upgrade({ channel: 'web-clone', browserSession: id, target, owner })) return undefined
      return new Response('WebSocket upgrade failed', { status: 400 })
    }
    return json({ error: 'Not found' }, 404)
  } catch (error) {
    return json({ error: describe(error) }, 502)
  }
}

export type WebCloneRouteContext = { clientAddress: string | null; origin: string | null }

export async function handleWebCloneRoute(
  request: Request,
  url: URL,
  context: WebCloneRouteContext,
  deps: WebCloneHttpDeps,
): Promise<Response | undefined> {
  if (!isLocalNonBrowserRequest(context.clientAddress, context.origin)) {
    return new Response('Forbidden', { status: 403 })
  }
  return handleWebCloneHttp(request, url, deps)
}
