import { timingSafeEqual } from 'node:crypto'
import type { ServerWebSocket } from 'bun'
import {
  BROWSER_COMMAND_TIMEOUT_MS,
  BROWSER_GRANT_DECISIONS,
  BROWSER_TRUST_OPS,
  BROWSER_HOST_CLOSE_REPLACED,
  BROWSER_HOST_CLOSE_UNAUTHORIZED,
  BROWSER_HOST_HELLO_TIMEOUT_MS,
  BROWSER_HOST_PROTOCOL_VERSION,
  type BrowserDialogRecord,
  type BrowserGrantDecision,
  type BrowserHostCommand,
  type BrowserHostErrorCode,
  type BrowserHostInbound,
  type BrowserHostMessage,
  type BrowserHostValueByKind,
  type BrowserMarksRequest,
  type BrowserPickRequest,
  type BrowserPickValue,
  type BrowserTrustOp,
  type BrowserViewInfo,
} from './protocol.js'

export type BrowserHostSocketData = {
  channel: 'browser-host'
  authed: boolean
  helloTimer: ReturnType<typeof setTimeout> | null
}

export type BrowserHostFailureCode = BrowserHostErrorCode | 'disconnected' | 'no_host' | 'expired'

export class BrowserHostError extends Error {
  readonly code: BrowserHostFailureCode
  readonly dialogs: BrowserDialogRecord[]

  constructor(code: BrowserHostFailureCode, message: string, dialogs: BrowserDialogRecord[] = []) {
    super(message)
    this.name = 'BrowserHostError'
    this.code = code
    this.dialogs = dialogs
  }
}

export const NO_HOST_MESSAGE =
  '[browser.no_host] This session has no desktop browser. The browser tools only work in the DreamCoder desktop app; repeating the call will not help.'

export const DISCONNECTED_MESSAGE =
  '[browser.disconnected] The desktop browser connection closed and the action may already have run. Inspect the page with snapshot before repeating a click, typing or navigation.'

export type BrowserHostRequestOptions = {
  tabId: string | null
  expectGeneration?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export type BrowserHostResponse<K extends BrowserHostCommand['kind']> = {
  value: BrowserHostValueByKind[K]
  dialogs: BrowserDialogRecord[]
}

type Pending = {
  resolve: (response: { value: unknown; dialogs: BrowserDialogRecord[] }) => void
  reject: (error: Error) => void
}

type HostSocket = ServerWebSocket<BrowserHostSocketData>

export type BrowserGrantReply = { requestId: string; decision: BrowserGrantDecision }

export type BrowserTrustRequest = { op: BrowserTrustOp; origin?: string }

export type BrowserTrustHandler = (request: BrowserTrustRequest) => Promise<string[]>

export type BrowserPickHandler = (request: Pick<BrowserPickRequest, 'tabId' | 'generation' | 'backendNodeId' | 'expiresAt'>) => Promise<BrowserPickValue>

export type BrowserMarksHandler = (request: Pick<BrowserMarksRequest, 'tabId' | 'generation' | 'refs' | 'expiresAt'>) => Promise<string[]>

const MAX_ID_LENGTH = 200
const MAX_ORIGIN_LENGTH = 2_048
const MAX_MARK_REFS = 200
const MAX_REF_LENGTH = 20

const OPEN = 1

export function createBrowserHostSocketData(): BrowserHostSocketData {
  return { channel: 'browser-host', authed: false, helloTimer: null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isViewInfo(value: unknown): value is BrowserViewInfo {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.tabId === 'string' &&
    typeof value.webContentsId === 'number' &&
    typeof value.url === 'string' &&
    typeof value.title === 'string' &&
    typeof value.generation === 'number' &&
    typeof value.shown === 'boolean' &&
    typeof value.active === 'boolean' &&
    typeof value.foreground === 'boolean'
  )
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isDialogRecords(value: unknown): value is BrowserDialogRecord[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.kind === 'string' &&
        typeof item.message === 'string' &&
        (item.handledAs === 'accepted' || item.handledAs === 'dismissed'),
    )
  )
}

export function parseBrowserHostInbound(raw: string): BrowserHostInbound | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  if (value.type === 'hello' && typeof value.token === 'string' && typeof value.protocol === 'number') {
    return { type: 'hello', token: value.token, protocol: value.protocol }
  }
  if (value.type === 'views' && Array.isArray(value.views) && value.views.every(isViewInfo)) {
    return { type: 'views', views: value.views }
  }
  if (value.type === 'stop' && typeof value.sessionId === 'string') {
    return { type: 'stop', sessionId: value.sessionId }
  }
  if (
    value.type === 'grant_reply' &&
    isBoundedString(value.requestId, MAX_ID_LENGTH) &&
    (BROWSER_GRANT_DECISIONS as readonly unknown[]).includes(value.decision)
  ) {
    return { type: 'grant_reply', requestId: value.requestId, decision: value.decision as BrowserGrantDecision }
  }
  if (
    value.type === 'trust' &&
    isBoundedString(value.id, MAX_ID_LENGTH) &&
    (BROWSER_TRUST_OPS as readonly unknown[]).includes(value.op)
  ) {
    const op = value.op as BrowserTrustOp
    if (op === 'list') return value.origin === undefined ? { type: 'trust', id: value.id, op } : null
    return isBoundedString(value.origin, MAX_ORIGIN_LENGTH) ? { type: 'trust', id: value.id, op, origin: value.origin } : null
  }
  if (
    value.type === 'pick' &&
    isBoundedString(value.id, MAX_ID_LENGTH) &&
    isBoundedString(value.tabId, MAX_ID_LENGTH) &&
    isCount(value.generation) &&
    isCount(value.backendNodeId) &&
    isCount(value.expiresAt)
  ) {
    return {
      type: 'pick',
      id: value.id,
      tabId: value.tabId,
      generation: value.generation,
      backendNodeId: value.backendNodeId,
      expiresAt: value.expiresAt,
    }
  }
  if (
    value.type === 'marks' &&
    isBoundedString(value.id, MAX_ID_LENGTH) &&
    isBoundedString(value.tabId, MAX_ID_LENGTH) &&
    isCount(value.generation) &&
    isCount(value.expiresAt) &&
    Array.isArray(value.refs) &&
    value.refs.length <= MAX_MARK_REFS &&
    value.refs.every((ref) => isBoundedString(ref, MAX_REF_LENGTH))
  ) {
    return {
      type: 'marks',
      id: value.id,
      tabId: value.tabId,
      generation: value.generation,
      refs: value.refs as string[],
      expiresAt: value.expiresAt,
    }
  }
  if (value.type === 'result' && typeof value.id === 'string') {
    const dialogs = isDialogRecords(value.dialogs) ? value.dialogs : undefined
    if (value.ok === true) return { type: 'result', id: value.id, ok: true, value: value.value, dialogs }
    if (
      value.ok === false &&
      isRecord(value.error) &&
      typeof value.error.code === 'string' &&
      typeof value.error.message === 'string'
    ) {
      return {
        type: 'result',
        id: value.id,
        ok: false,
        error: { code: value.error.code as BrowserHostErrorCode, message: value.error.message },
        dialogs,
      }
    }
  }
  return null
}

function describeFailure(error: unknown): { code: string; message: string } {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'internal'
  return { code, message: error instanceof Error ? error.message : String(error) }
}

function tokensMatch(expected: string | null, actual: string) {
  if (expected === null) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(actual)
  return left.length === right.length && timingSafeEqual(left, right)
}

export class BrowserHostChannel {
  private token: string | null = null
  private socket: HostSocket | null = null
  private views: BrowserViewInfo[] = []
  private readonly pending = new Map<string, Pending>()
  private readonly viewListeners = new Set<() => void>()
  private readonly stopListeners = new Set<(sessionId: string) => void>()
  private readonly grantReplyListeners = new Set<(reply: BrowserGrantReply) => void>()
  private trustHandler: BrowserTrustHandler | null = null
  private pickHandler: BrowserPickHandler | null = null
  private marksHandler: BrowserMarksHandler | null = null

  setToken(token: string | null) {
    this.token = token
  }

  isConnected() {
    return this.socket !== null && this.socket.readyState === OPEN
  }

  listViews(sessionId: string): BrowserViewInfo[] {
    return this.views.filter((view) => view.sessionId === sessionId)
  }

  getView(tabId: string): BrowserViewInfo | undefined {
    return this.views.find((view) => view.tabId === tabId)
  }

  onViews(listener: () => void) {
    this.viewListeners.add(listener)
    return () => {
      this.viewListeners.delete(listener)
    }
  }

  onStop(listener: (sessionId: string) => void) {
    this.stopListeners.add(listener)
    return () => {
      this.stopListeners.delete(listener)
    }
  }

  onGrantReply(listener: (reply: BrowserGrantReply) => void) {
    this.grantReplyListeners.add(listener)
    return () => {
      this.grantReplyListeners.delete(listener)
    }
  }

  setTrustHandler(handler: BrowserTrustHandler | null) {
    this.trustHandler = handler
  }

  setPickHandler(handler: BrowserPickHandler | null) {
    this.pickHandler = handler
  }

  setMarksHandler(handler: BrowserMarksHandler | null) {
    this.marksHandler = handler
  }

  open(ws: HostSocket) {
    ws.data.helloTimer = setTimeout(() => {
      if (!ws.data.authed) ws.close(BROWSER_HOST_CLOSE_UNAUTHORIZED, 'hello timeout')
    }, BROWSER_HOST_HELLO_TIMEOUT_MS)
  }

  message(ws: HostSocket, raw: string | Buffer) {
    const message = parseBrowserHostInbound(typeof raw === 'string' ? raw : raw.toString('utf8'))
    if (!message) {
      if (!ws.data.authed) ws.close(BROWSER_HOST_CLOSE_UNAUTHORIZED, 'unauthorized')
      return
    }
    if (!ws.data.authed) {
      this.authenticate(ws, message)
      return
    }
    if (message.type === 'views') {
      this.views = message.views
      this.viewListeners.forEach((listener) => listener())
    } else if (message.type === 'stop') {
      this.stopListeners.forEach((listener) => listener(message.sessionId))
    } else if (message.type === 'grant_reply') {
      this.grantReplyListeners.forEach((listener) => listener({ requestId: message.requestId, decision: message.decision }))
    } else if (message.type === 'trust') {
      void this.answerTrust(message)
    } else if (message.type === 'pick') {
      void this.answerPick(message)
    } else if (message.type === 'marks') {
      void this.answerMarks(message)
    } else if (message.type === 'result') {
      this.settle(message)
    }
  }

  close(ws: HostSocket) {
    if (ws.data.helloTimer) clearTimeout(ws.data.helloTimer)
    if (this.socket !== ws) return
    this.socket = null
    this.views = []
    this.viewListeners.forEach((listener) => listener())
    const pending = Array.from(this.pending.values())
    this.pending.clear()
    for (const entry of pending) entry.reject(new BrowserHostError('disconnected', DISCONNECTED_MESSAGE))
  }

  request<K extends BrowserHostCommand['kind']>(
    command: Extract<BrowserHostCommand, { kind: K }>,
    options: BrowserHostRequestOptions,
  ): Promise<BrowserHostResponse<K>> {
    if (!this.isConnected()) return Promise.reject(new BrowserHostError('no_host', NO_HOST_MESSAGE))
    if (options.signal?.aborted) {
      return Promise.reject(new BrowserHostError('cancelled', '[browser.cancelled] The browser call was cancelled before it started.'))
    }
    const id = crypto.randomUUID()
    const timeoutMs = options.timeoutMs ?? BROWSER_COMMAND_TIMEOUT_MS
    return new Promise<BrowserHostResponse<K>>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        this.pending.delete(id)
      }
      const abandon = (error: BrowserHostError) => {
        finish()
        this.send({ type: 'cancel', id })
        reject(error)
      }
      const onAbort = () =>
        abandon(
          new BrowserHostError(
            'cancelled',
            '[browser.cancelled] The browser call was cancelled. Inspect the page before repeating the action; cancelling does not undo what already happened.',
          ),
        )
      const timer = setTimeout(
        () =>
          abandon(
            new BrowserHostError(
              'timeout',
              `[browser.timeout] The browser call did not finish within ${Math.round(timeoutMs / 1000)} seconds and its outcome is unknown. Inspect the page with snapshot before repeating it.`,
            ),
          ),
        timeoutMs,
      )
      options.signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        resolve: (response) => {
          finish()
          resolve(response as BrowserHostResponse<K>)
        },
        reject: (error) => {
          finish()
          reject(error)
        },
      })
      this.send({
        type: 'command',
        id,
        tabId: options.tabId,
        ...(options.expectGeneration === undefined ? {} : { expectGeneration: options.expectGeneration }),
        command,
      })
    })
  }

  private authenticate(ws: HostSocket, message: BrowserHostInbound) {
    if (ws.data.helloTimer) clearTimeout(ws.data.helloTimer)
    ws.data.helloTimer = null
    if (
      message.type !== 'hello' ||
      message.protocol !== BROWSER_HOST_PROTOCOL_VERSION ||
      !tokensMatch(this.token, message.token)
    ) {
      ws.close(BROWSER_HOST_CLOSE_UNAUTHORIZED, 'unauthorized')
      return
    }
    if (this.socket && this.socket !== ws && this.socket.readyState === OPEN) {
      ws.close(BROWSER_HOST_CLOSE_REPLACED, 'another desktop is connected')
      return
    }
    ws.data.authed = true
    this.socket = ws
    this.send({ type: 'ready' })
  }

  private async answerTrust(message: Extract<BrowserHostInbound, { type: 'trust' }>) {
    const handler = this.trustHandler
    if (!handler) {
      this.send({ type: 'trust_result', id: message.id, ok: false, error: { code: 'unavailable', message: 'The trusted-site list is not available.' } })
      return
    }
    try {
      const origins = await handler({ op: message.op, ...(message.origin === undefined ? {} : { origin: message.origin }) })
      this.send({ type: 'trust_result', id: message.id, ok: true, origins })
    } catch (error) {
      this.send({ type: 'trust_result', id: message.id, ok: false, error: describeFailure(error) })
    }
  }

  private async answerPick(message: BrowserPickRequest) {
    const handler = this.pickHandler
    if (!handler) {
      this.send({ type: 'pick_result', id: message.id, ok: false, error: { code: 'unavailable', message: 'Picking elements is not available.' } })
      return
    }
    try {
      const value = await handler({
        tabId: message.tabId,
        generation: message.generation,
        backendNodeId: message.backendNodeId,
        expiresAt: message.expiresAt,
      })
      this.send({ type: 'pick_result', id: message.id, ok: true, value })
    } catch (error) {
      this.send({ type: 'pick_result', id: message.id, ok: false, error: describeFailure(error) })
    }
  }

  private async answerMarks(message: BrowserMarksRequest) {
    const handler = this.marksHandler
    if (!handler) {
      this.send({ type: 'marks_result', id: message.id, ok: false, error: { code: 'unavailable', message: 'Element marks are not available.' } })
      return
    }
    try {
      const alive = await handler({
        tabId: message.tabId,
        generation: message.generation,
        refs: message.refs,
        expiresAt: message.expiresAt,
      })
      this.send({ type: 'marks_result', id: message.id, ok: true, alive })
    } catch (error) {
      this.send({ type: 'marks_result', id: message.id, ok: false, error: describeFailure(error) })
    }
  }

  private settle(message: Extract<BrowserHostInbound, { type: 'result' }>) {
    const pending = this.pending.get(message.id)
    if (!pending) return
    if (message.ok) {
      pending.resolve({ value: message.value, dialogs: message.dialogs ?? [] })
      return
    }
    pending.reject(new BrowserHostError(message.error.code, message.error.message, message.dialogs ?? []))
  }

  private send(message: BrowserHostMessage) {
    if (this.socket && this.socket.readyState === OPEN) this.socket.send(JSON.stringify(message))
  }
}

export const browserHostChannel = new BrowserHostChannel()
