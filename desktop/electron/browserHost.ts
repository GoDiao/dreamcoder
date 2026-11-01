import { randomUUID } from 'node:crypto'
import {
  BROWSER_HOST_CLOSE_REPLACED,
  BROWSER_HOST_CLOSE_UNAUTHORIZED,
  BROWSER_HOST_HELLO_TIMEOUT_MS,
  BROWSER_HOST_PROTOCOL_VERSION,
  BROWSER_MARKS_TIMEOUT_MS,
  BROWSER_PICK_TIMEOUT_MS,
  BROWSER_TRUST_TIMEOUT_MS,
  CDP_INPUT_METHODS,
  CDP_METHOD_ALLOWLIST,
  type BrowserConsoleEntry,
  type BrowserDialogRecord,
  type BrowserGrantDecision,
  type BrowserHostCommand,
  type BrowserHostErrorCode,
  type BrowserHostEvent,
  type BrowserHostMessage,
  type BrowserHostResult,
  type BrowserInspectValue,
  type BrowserMarksResult,
  type BrowserNetworkEntry,
  type BrowserPickResult,
  type BrowserPickValue,
  type BrowserResolveValue,
  type BrowserTrustOp,
  type BrowserTrustResult,
  type BrowserViewInfo,
} from '../../src/server/browserHost/protocol'
import type { BrowserResolveResult } from '../src/lib/shell/electronBridge'
import { LOOPBACK_HOSTS, PROJECT_SCHEME } from './browser'

const MAX_BUFFER_ENTRIES = 500
const MAX_BUFFER_BYTES = 1_000_000
const MAX_TEXT_LENGTH = 4_000
const MAX_URL_LENGTH = 2_000
const MAX_HEADER_VALUE_LENGTH = 1_000
const MAX_DIALOG_MESSAGE_LENGTH = 500
const VIEWS_DEBOUNCE_MS = 50
const RECONNECT_INITIAL_MS = 500
const RECONNECT_MAX_MS = 5_000
const OPEN_TAB_TIMEOUT_MS = 10_000
const ACTIVATE_TIMEOUT_MS = 3_000
const NAVIGATE_TIMEOUT_MS = 15_000
const HISTORY_TIMEOUT_MS = 5_000
const CDP_VERSION = '1.3'
const CDP_DOMAINS = ['Page', 'Runtime', 'Network', 'Log']
const LOG_PREFIX = '[browser-host]'
const TIMED_OUT = Symbol('timed out')
const SIDECAR_NOT_CONNECTED = 'the sidecar is not connected'
const HOVER_FILL = { r: 249, g: 115, b: 22, a: 0.14 }
const HOVER_OUTLINE = { r: 249, g: 115, b: 22, a: 1 }

type PickPoint = { x: number; y: number }
type GuestMouse = { type: string; x: number; y: number; button?: string }
type PreventableEvent = { preventDefault(): void }

type Listener = (...args: unknown[]) => void
type CommandMessage = Extract<BrowserHostMessage, { type: 'command' }>

export type EmitterLike = {
  on(event: string, listener: Listener): unknown
  removeListener(event: string, listener: Listener): unknown
}

export type DebuggerLike = EmitterLike & {
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>
}

export type WebContentsLike = EmitterLike & {
  id: number
  hostWebContents: unknown
  session: unknown
  debugger: DebuggerLike
  isDestroyed(): boolean
  isLoading(): boolean
  getURL(): string
  getTitle(): string
  loadURL(url: string): Promise<void>
  navigationHistory: { canGoBack(): boolean; goBack(): void }
  mainFrame: { framesInSubtree: { url: string }[] }
}

export type SocketListener = {
  onOpen(): void
  onMessage(data: unknown): void
  onClose(code: number): void
}

export type SocketHandle = {
  send(data: string): void
  close(): void
}

export type BrowserHostDeps = {
  getMainWebContents(): unknown
  fromId(webContentsId: number): WebContentsLike | undefined
  browserSession: unknown
  emitToRenderer(event: string, payload: unknown): void
  resolveInput(input: string, projectRoot: string | null): Promise<BrowserResolveResult>
  classify(url: string): 'allow' | 'external' | 'refuse'
  createSocket?(url: string, listener: SocketListener): SocketHandle
}

export type MarkRequest = { ref: string; generation: number }

export type ViewRegistration = { sessionId: string; tabId: string; webContentsId: number }
export type ViewUpdate = { tabId: string; shown: boolean; active: boolean; foreground: boolean }

class HostError extends Error {
  constructor(readonly code: BrowserHostErrorCode, message: string) {
    super(message)
  }
}

type NetworkRecord = BrowserNetworkEntry
type RequestMeta = { type: string | null; loaderId: string | null }

class EntryBuffer<T extends { seq: number }> {
  private items: { entry: T; size: number }[] = []
  private bytes = 0
  private counter = 0
  private lost = 0

  constructor(private readonly onDrop?: (entry: T) => void) {}

  get dropped() {
    return this.lost
  }

  get lastSeq() {
    return this.counter
  }

  add(build: (seq: number) => T): T {
    const entry = build(++this.counter)
    this.append(entry)
    return entry
  }

  touch(entry: T) {
    const index = this.items.findIndex((item) => item.entry === entry)
    const found = this.items[index]
    if (!found) return
    this.bytes -= found.size
    this.items.splice(index, 1)
    entry.seq = ++this.counter
    this.append(entry)
  }

  read(since: number, limit: number): T[] {
    return this.items
      .filter((item) => item.entry.seq > since)
      .slice(0, limit)
      .map((item) => ({ ...item.entry }))
  }

  clear() {
    this.items = []
    this.bytes = 0
  }

  keep(predicate: (entry: T) => boolean) {
    this.items = this.items.filter((item) => predicate(item.entry))
    this.bytes = this.items.reduce((total, item) => total + item.size, 0)
  }

  private append(entry: T) {
    const size = JSON.stringify(entry).length
    this.items.push({ entry, size })
    this.bytes += size
    while (this.items.length > MAX_BUFFER_ENTRIES || this.bytes > MAX_BUFFER_BYTES) {
      const dropped = this.items.shift()
      if (!dropped) break
      this.bytes -= dropped.size
      this.lost += 1
      this.onDrop?.(dropped.entry)
    }
  }
}

type View = {
  sessionId: string
  tabId: string
  webContentsId: number
  contents: WebContentsLike
  dbg: DebuggerLike
  url: string
  title: string
  generation: number
  shown: boolean
  active: boolean
  foreground: boolean
  attached: boolean
  attaching: Promise<void> | null
  crashed: boolean
  pickActive: boolean
  pickEpoch: number
  inspecting: boolean
  hoverNext: PickPoint | null
  hoverDraw: Promise<void> | null
  hoverNode: number | null
  pixelRatio: number
  consoleEntries: EntryBuffer<BrowserConsoleEntry>
  networkEntries: EntryBuffer<NetworkRecord>
  networkById: Map<string, NetworkRecord>
  requestMeta: WeakMap<NetworkRecord, RequestMeta>
  committedLoaderId: string | null
  dialogs: BrowserDialogRecord[]
  disposers: (() => void)[]
}

type Inflight = {
  controller: AbortController
  tabId: string | null
  sessionId: string | null
  view: View | null
}

type ViewWaiter = { tabId: string; resolve: (view: View) => void }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function truncate(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function abortError(signal: AbortSignal): HostError {
  return signal.reason instanceof HostError ? signal.reason : new HostError('cancelled', 'command cancelled')
}

function describeUrl(raw: string): { origin: string | null; local: boolean } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { origin: null, local: false }
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return { origin: url.origin, local: url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) }
  }
  if (url.protocol === `${PROJECT_SCHEME}:`) return { origin: `${PROJECT_SCHEME}://${url.hostname}`, local: true }
  return { origin: null, local: false }
}

function raceTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(abortError(signal))
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve(TIMED_OUT)
    }, timeoutMs)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function waitForEvent(target: EmitterLike, events: string[], timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      for (const event of events) target.removeListener(event, onEvent)
      signal.removeEventListener('abort', onAbort)
    }
    const onEvent = () => {
      cleanup()
      resolve(true)
    }
    const onAbort = () => {
      cleanup()
      reject(abortError(signal))
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)
    for (const event of events) target.on(event, onEvent)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isAbortedLoad(error: unknown) {
  return error instanceof Error && error.message.includes('ERR_ABORTED')
}

function remoteObjectText(arg: unknown): string {
  if (!isRecord(arg)) return String(arg)
  if ('value' in arg) {
    const value = arg.value
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
  }
  if (typeof arg.unserializableValue === 'string') return arg.unserializableValue
  if (typeof arg.description === 'string') return arg.description
  return typeof arg.type === 'string' ? arg.type : ''
}

function consoleEntry(seq: number, level: string, text: string, url?: unknown, lineNumber?: unknown): BrowserConsoleEntry {
  const entry: BrowserConsoleEntry = { seq, at: Date.now(), level, text: truncate(text, MAX_TEXT_LENGTH) }
  if (typeof url === 'string' && url) entry.url = truncate(url, MAX_URL_LENGTH)
  if (typeof lineNumber === 'number') entry.line = lineNumber + 1
  return entry
}

function headerRecord(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!isRecord(value)) return headers
  for (const [name, header] of Object.entries(value)) headers[name] = truncate(String(header), MAX_HEADER_VALUE_LENGTH)
  return headers
}

function applyResponse(entry: NetworkRecord, response: unknown) {
  if (!isRecord(response)) return
  if (typeof response.status === 'number') entry.status = response.status
  if (typeof response.mimeType === 'string') entry.mimeType = response.mimeType
  entry.responseHeaders = headerRecord(response.headers)
}

function parseFailure(parsed: Record<string, unknown>): { code: string; message: string } | null {
  if (parsed.ok !== false || !isRecord(parsed.error)) return null
  const { code, message } = parsed.error
  return typeof code === 'string' && typeof message === 'string' ? { code, message } : null
}

function parseMessage(data: string): BrowserHostMessage | null {
  const parsed: unknown = JSON.parse(data)
  if (!isRecord(parsed)) return null
  if (parsed.type === 'ready') return { type: 'ready' }
  if (parsed.type === 'cancel' && typeof parsed.id === 'string') return { type: 'cancel', id: parsed.id }
  if (parsed.type === 'trust_result' && typeof parsed.id === 'string') {
    if (parsed.ok === true && Array.isArray(parsed.origins) && parsed.origins.every((origin) => typeof origin === 'string')) {
      return { type: 'trust_result', id: parsed.id, ok: true, origins: parsed.origins as string[] }
    }
    const error = parseFailure(parsed)
    if (error) return { type: 'trust_result', id: parsed.id, ok: false, error }
  }
  if (parsed.type === 'pick_result' && typeof parsed.id === 'string') {
    if (parsed.ok === true && isRecord(parsed.value)) {
      return { type: 'pick_result', id: parsed.id, ok: true, value: parsed.value as BrowserPickValue }
    }
    const error = parseFailure(parsed)
    if (error) return { type: 'pick_result', id: parsed.id, ok: false, error }
  }
  if (parsed.type === 'marks_result' && typeof parsed.id === 'string') {
    if (parsed.ok === true && Array.isArray(parsed.alive) && parsed.alive.every((ref) => typeof ref === 'string')) {
      return { type: 'marks_result', id: parsed.id, ok: true, alive: parsed.alive as string[] }
    }
    const error = parseFailure(parsed)
    if (error) return { type: 'marks_result', id: parsed.id, ok: false, error }
  }
  if (
    parsed.type === 'command' &&
    typeof parsed.id === 'string' &&
    (parsed.tabId === null || typeof parsed.tabId === 'string') &&
    isRecord(parsed.command) &&
    typeof parsed.command.kind === 'string'
  ) {
    return {
      type: 'command',
      id: parsed.id,
      tabId: parsed.tabId,
      expectGeneration: typeof parsed.expectGeneration === 'number' ? parsed.expectGeneration : undefined,
      command: parsed.command as BrowserHostCommand,
    }
  }
  return null
}

function createWebSocket(url: string, listener: SocketListener): SocketHandle {
  const socket = new WebSocket(url)
  socket.addEventListener('open', () => listener.onOpen())
  socket.addEventListener('message', (event) => listener.onMessage(event.data))
  socket.addEventListener('close', (event) => listener.onClose(event.code))
  return { send: (data) => socket.send(data), close: () => socket.close() }
}

function toInfo(view: View): BrowserViewInfo {
  return {
    sessionId: view.sessionId,
    tabId: view.tabId,
    webContentsId: view.webContentsId,
    url: view.url,
    title: view.title,
    generation: view.generation,
    shown: view.shown,
    active: view.active,
    foreground: view.foreground,
  }
}

function takeDialogs(view: View): BrowserDialogRecord[] {
  const dialogs = view.dialogs
  view.dialogs = []
  return dialogs
}

function clearBuffers(view: View) {
  view.consoleEntries.clear()
  view.networkEntries.clear()
  view.networkById.clear()
}

function retainCommittedDocument(view: View) {
  const loaderId = view.committedLoaderId
  view.committedLoaderId = null
  const keep = (entry: NetworkRecord) => {
    const meta = view.requestMeta.get(entry)
    return loaderId !== null && meta?.loaderId === loaderId && meta.type === 'Document'
  }
  view.networkEntries.keep(keep)
  for (const [requestId, entry] of view.networkById) {
    if (!keep(entry)) view.networkById.delete(requestId)
  }
}

function embeddedOrigins(contents: WebContentsLike, topOrigin: string | null): string[] {
  const origins = new Set<string>()
  let frames: { url: string }[]
  try {
    frames = contents.mainFrame.framesInSubtree
  } catch {
    return []
  }
  for (const frame of frames) {
    let url: string
    try {
      url = frame.url
    } catch {
      continue
    }
    const { origin, local } = describeUrl(url)
    if (origin !== null && !local && origin !== topOrigin) origins.add(origin)
  }
  return [...origins]
}

type SidecarRequest = Extract<BrowserHostEvent, { type: 'trust' | 'pick' | 'marks' }>
type SidecarAnswer = BrowserTrustResult | BrowserPickResult | BrowserMarksResult
type SidecarWaiter = {
  resolve: (answer: SidecarAnswer) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class BrowserHost {
  private readonly views = new Map<string, View>()
  private readonly inflight = new Map<string, Inflight>()
  private readonly pending = new Map<string, (value: unknown) => void>()
  private readonly viewWaiters = new Set<ViewWaiter>()
  private readonly sidecarWaiters = new Map<string, SidecarWaiter>()
  private readonly createSocket: (url: string, listener: SocketListener) => SocketHandle
  private config: { url: string; token: string } | null = null
  private socket: SocketHandle | null = null
  private connectionId = 0
  private connectionCounter = 0
  private ready = false
  private terminal = false
  private disposed = false
  private failureLogged = false
  private reconnectDelay = RECONNECT_INITIAL_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private helloTimer: ReturnType<typeof setTimeout> | null = null
  private viewsTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: BrowserHostDeps) {
    this.createSocket = deps.createSocket ?? createWebSocket
  }

  connect(config: { url: string; token: string }) {
    new URL(config.url)
    if (this.disposed) throw new Error('browser host is disposed')
    this.clearReconnectTimer()
    this.teardownSocket()
    this.config = config
    this.terminal = false
    this.failureLogged = false
    this.reconnectDelay = RECONNECT_INITIAL_MS
    this.open()
  }

  registerView(input: ViewRegistration) {
    const existing = this.views.get(input.tabId)
    if (existing && existing.webContentsId === input.webContentsId && existing.sessionId === input.sessionId) return
    const contents = this.deps.fromId(input.webContentsId)
    if (!contents || contents.isDestroyed()) throw new Error(`web contents ${input.webContentsId} does not exist`)
    const main = this.deps.getMainWebContents()
    if (!main || contents.hostWebContents !== main) {
      throw new Error(`web contents ${input.webContentsId} is not a guest of the main window`)
    }
    if (contents.session !== this.deps.browserSession) {
      throw new Error(`web contents ${input.webContentsId} does not use the browser partition`)
    }
    for (const other of this.views.values()) {
      if (other.webContentsId === input.webContentsId && other.tabId !== input.tabId) {
        throw new Error(`web contents ${input.webContentsId} is already registered for tab ${other.tabId}`)
      }
    }
    if (existing) this.unregisterView(input.tabId)
    const networkById = new Map<string, NetworkRecord>()
    const view: View = {
      sessionId: input.sessionId,
      tabId: input.tabId,
      webContentsId: input.webContentsId,
      contents,
      dbg: contents.debugger,
      url: contents.getURL(),
      title: contents.getTitle(),
      generation: 0,
      shown: false,
      active: false,
      foreground: false,
      attached: false,
      attaching: null,
      crashed: false,
      pickActive: false,
      pickEpoch: 0,
      inspecting: false,
      hoverNext: null,
      hoverDraw: null,
      hoverNode: null,
      pixelRatio: 1,
      consoleEntries: new EntryBuffer<BrowserConsoleEntry>(),
      networkEntries: new EntryBuffer<NetworkRecord>((entry) => {
        if (networkById.get(entry.requestId) === entry) networkById.delete(entry.requestId)
      }),
      networkById,
      requestMeta: new WeakMap(),
      committedLoaderId: null,
      dialogs: [],
      disposers: [],
    }
    this.watchView(view)
    this.views.set(view.tabId, view)
    for (const waiter of [...this.viewWaiters]) {
      if (waiter.tabId === view.tabId) waiter.resolve(view)
    }
    this.scheduleViews()
  }

  updateView(input: ViewUpdate) {
    const view = this.views.get(input.tabId)
    if (!view) throw new Error(`no browser view for tab ${input.tabId}`)
    if (view.shown === input.shown && view.active === input.active && view.foreground === input.foreground) return
    view.shown = input.shown
    view.active = input.active
    view.foreground = input.foreground
    if (!input.shown) this.endPick(view)
    this.scheduleViews()
  }

  unregisterView(tabId: string) {
    const view = this.views.get(tabId)
    if (!view) return
    this.views.delete(tabId)
    for (const dispose of view.disposers) dispose()
    this.endPick(view, false)
    this.detach(view)
    clearBuffers(view)
    this.failInflight(tabId, new HostError('view_closed', `browser tab ${tabId} was closed`))
    this.scheduleViews()
  }

  resolveOpenTab(requestId: string, tabId: string) {
    return this.settlePending(requestId, tabId)
  }

  resolveActivate(requestId: string, shown: boolean) {
    return this.settlePending(requestId, shown)
  }

  stopSession(sessionId: string) {
    const stopped = new HostError('stopped', 'the user stopped browser control for this session')
    for (const view of this.views.values()) {
      if (view.sessionId === sessionId) this.detach(view)
    }
    for (const entry of this.inflight.values()) {
      if (entry.sessionId === sessionId) entry.controller.abort(stopped)
    }
    this.send({ type: 'stop', sessionId })
  }

  replyGrant(requestId: string, decision: BrowserGrantDecision) {
    this.assertConnected()
    this.send({ type: 'grant_reply', requestId, decision })
  }

  async trust(op: BrowserTrustOp, origin?: string): Promise<string[]> {
    const answer = await this.askSidecar(
      { type: 'trust', id: randomUUID(), op, ...(origin === undefined ? {} : { origin }) },
      BROWSER_TRUST_TIMEOUT_MS,
      'the sidecar did not answer the trusted-site request in time',
    )
    if (answer.type !== 'trust_result') throw new Error('unexpected answer from the sidecar')
    if (!answer.ok) throw new Error(answer.error.code)
    return answer.origins
  }

  async setPickMode(tabId: string, active: boolean) {
    const view = this.views.get(tabId)
    if (!view) throw new Error(`no browser view for tab ${tabId}`)
    if (!active) {
      this.endPick(view)
      return
    }
    if (view.pickActive) return
    if (!view.shown) throw new Error(`browser tab ${tabId} is not shown`)
    view.pickActive = true
    const epoch = ++view.pickEpoch
    try {
      await this.ensureAttached(view)
      await this.armPick(view, true)
    } catch (error) {
      if (view.pickEpoch === epoch) this.endPick(view, false)
      throw error
    }
    if (view.pickEpoch === epoch) this.emitPickState(view)
    else if (view.attached && !view.contents.isDestroyed()) void this.disarmPick(view)
  }

  async syncMarks(tabId: string, requests: MarkRequest[]): Promise<string[]> {
    const view = this.views.get(tabId)
    if (!view) throw new Error(`no browser view for tab ${tabId}`)
    const { generation } = view
    const refs = requests.filter((request) => request.generation === generation).map((request) => request.ref)
    const answer = await this.askSidecar(
      { type: 'marks', id: randomUUID(), tabId, generation, refs, expiresAt: Date.now() + BROWSER_MARKS_TIMEOUT_MS },
      BROWSER_MARKS_TIMEOUT_MS,
      'the sidecar did not answer the element marks request in time',
    )
    if (answer.type !== 'marks_result') throw new Error('unexpected answer from the sidecar')
    if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`)
    return answer.alive
  }

  dispose() {
    this.disposed = true
    this.clearReconnectTimer()
    if (this.viewsTimer) clearTimeout(this.viewsTimer)
    this.viewsTimer = null
    this.teardownSocket()
    for (const tabId of [...this.views.keys()]) this.unregisterView(tabId)
    this.viewWaiters.clear()
  }

  private open() {
    const config = this.config
    if (!config || this.disposed || this.terminal) return
    this.reconnectTimer = null
    const id = ++this.connectionCounter
    this.connectionId = id
    this.ready = false
    const listener: SocketListener = {
      onOpen: () => this.onSocketOpen(id),
      onMessage: (data) => this.onSocketMessage(id, data),
      onClose: (code) => this.onSocketClose(id, code),
    }
    try {
      this.socket = this.createSocket(config.url, listener)
    } catch (error) {
      this.connectionId = 0
      console.error(`${LOG_PREFIX} could not open the sidecar channel: ${errorMessage(error)}`)
      this.scheduleReconnect()
      return
    }
    this.helloTimer = setTimeout(() => {
      this.helloTimer = null
      if (this.connectionId !== id) return
      console.error(`${LOG_PREFIX} the sidecar did not answer the handshake within ${BROWSER_HOST_HELLO_TIMEOUT_MS} ms`)
      this.handleClosed(1006)
    }, BROWSER_HOST_HELLO_TIMEOUT_MS)
  }

  private onSocketOpen(id: number) {
    if (id !== this.connectionId || !this.config || !this.socket) return
    const hello: BrowserHostEvent = { type: 'hello', token: this.config.token, protocol: BROWSER_HOST_PROTOCOL_VERSION }
    this.socket.send(JSON.stringify(hello))
  }

  private onSocketMessage(id: number, data: unknown) {
    if (id !== this.connectionId) return
    if (typeof data !== 'string') {
      console.error(`${LOG_PREFIX} ignoring a non-text message from the sidecar`)
      return
    }
    let message: BrowserHostMessage | null
    try {
      message = parseMessage(data)
    } catch (error) {
      console.error(`${LOG_PREFIX} ignoring an invalid message from the sidecar: ${errorMessage(error)}`)
      return
    }
    if (!message) {
      console.error(`${LOG_PREFIX} ignoring an unrecognised message from the sidecar`)
      return
    }
    if (message.type === 'ready') {
      this.onReady()
      return
    }
    if (!this.ready) return
    if (message.type === 'trust_result' || message.type === 'pick_result' || message.type === 'marks_result') {
      this.settleSidecar(message)
      return
    }
    if (message.type === 'cancel') {
      this.inflight.get(message.id)?.controller.abort(new HostError('cancelled', 'command cancelled by the sidecar'))
      return
    }
    void this.runCommand(id, message)
  }

  private onSocketClose(id: number, code: number) {
    if (id !== this.connectionId) return
    this.handleClosed(code)
  }

  private onReady() {
    if (this.ready) return
    this.ready = true
    if (this.helloTimer) clearTimeout(this.helloTimer)
    this.helloTimer = null
    this.reconnectDelay = RECONNECT_INITIAL_MS
    this.failureLogged = false
    this.sendViews()
  }

  private handleClosed(code: number) {
    this.teardownSocket()
    if (code === BROWSER_HOST_CLOSE_UNAUTHORIZED || code === BROWSER_HOST_CLOSE_REPLACED) {
      this.terminal = true
      console.error(`${LOG_PREFIX} the sidecar closed the channel with code ${code}; not reconnecting`)
      return
    }
    this.scheduleReconnect()
  }

  private teardownSocket() {
    if (this.helloTimer) clearTimeout(this.helloTimer)
    this.helloTimer = null
    const socket = this.socket
    this.socket = null
    this.connectionId = 0
    this.ready = false
    this.abortAll(new HostError('cancelled', 'the connection to the sidecar closed'))
    this.failSidecar(new Error('the connection to the sidecar closed'))
    if (!socket) return
    try {
      socket.close()
    } catch (error) {
      console.error(`${LOG_PREFIX} closing the sidecar channel failed: ${errorMessage(error)}`)
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.terminal || this.reconnectTimer) return
    if (!this.failureLogged) {
      this.failureLogged = true
      console.error(`${LOG_PREFIX} the sidecar channel is down; retrying`)
    }
    const delay = this.reconnectDelay
    this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS)
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private isConnected() {
    return this.socket !== null && this.ready
  }

  private assertConnected() {
    if (!this.isConnected()) throw new Error(SIDECAR_NOT_CONNECTED)
  }

  private askSidecar(request: SidecarRequest, timeoutMs: number, timeoutMessage: string): Promise<SidecarAnswer> {
    if (!this.isConnected()) return Promise.reject(new Error(SIDECAR_NOT_CONNECTED))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.sidecarWaiters.delete(request.id)
        reject(new Error(timeoutMessage))
      }, timeoutMs)
      this.sidecarWaiters.set(request.id, { resolve, reject, timer })
      this.send(request)
    })
  }

  private settleSidecar(answer: SidecarAnswer) {
    const waiter = this.sidecarWaiters.get(answer.id)
    if (!waiter) return
    clearTimeout(waiter.timer)
    this.sidecarWaiters.delete(answer.id)
    waiter.resolve(answer)
  }

  private failSidecar(error: Error) {
    for (const waiter of this.sidecarWaiters.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.sidecarWaiters.clear()
  }

  private send(message: BrowserHostEvent | BrowserHostResult) {
    if (!this.socket || !this.ready) return
    try {
      this.socket.send(JSON.stringify(message))
    } catch (error) {
      console.error(`${LOG_PREFIX} sending a ${message.type} message failed: ${errorMessage(error)}`)
    }
  }

  private scheduleViews() {
    if (!this.ready || this.viewsTimer) return
    this.viewsTimer = setTimeout(() => {
      this.viewsTimer = null
      this.sendViews()
    }, VIEWS_DEBOUNCE_MS)
  }

  private sendViews() {
    if (this.viewsTimer) clearTimeout(this.viewsTimer)
    this.viewsTimer = null
    this.send({ type: 'views', views: [...this.views.values()].map(toInfo) })
  }

  private watchView(view: View) {
    const { contents, dbg } = view
    const listen = <A extends unknown[]>(target: EmitterLike, event: string, handler: (...args: A) => void) => {
      const listener = handler as Listener
      target.on(event, listener)
      view.disposers.push(() => target.removeListener(event, listener))
    }
    listen(contents, 'did-navigate', (_event: unknown, url: string) => {
      view.generation += 1
      view.url = url
      view.crashed = false
      view.consoleEntries.clear()
      retainCommittedDocument(view)
      this.endPick(view)
      this.scheduleViews()
    })
    listen(contents, 'before-input-event', (_event: unknown, input: { type: string; key: string }) => {
      if (view.pickActive && input.type === 'keyDown' && input.key === 'Escape') this.endPick(view)
    })
    listen(contents, 'before-mouse-event', (event: PreventableEvent, mouse: GuestMouse) => {
      this.onGuestMouse(view, event, mouse)
    })
    listen(contents, 'did-navigate-in-page', (_event: unknown, url: string, isMainFrame: boolean) => {
      if (!isMainFrame) return
      view.url = url
      this.scheduleViews()
    })
    listen(contents, 'page-title-updated', (_event: unknown, title: string) => {
      view.title = title
      this.scheduleViews()
    })
    listen(contents, 'destroyed', () => this.unregisterView(view.tabId))
    listen(contents, 'render-process-gone', () => this.suspendView(view))
    listen(dbg, 'message', (_event: unknown, method: string, params: unknown) => this.onCdpEvent(view, method, params))
    listen(dbg, 'detach', (_event: unknown, reason: string) => this.onDebuggerDetached(view, reason))
  }

  private suspendView(view: View) {
    view.crashed = true
    view.generation += 1
    view.inspecting = false
    view.hoverNext = null
    view.hoverNode = null
    this.endPick(view, false)
    this.detach(view)
    clearBuffers(view)
    this.failInflight(view.tabId, new HostError('view_closed', `browser tab ${view.tabId} stopped: its page crashed`))
    this.scheduleViews()
  }

  private onDebuggerDetached(view: View, reason: string) {
    if (!view.attached) return
    view.attached = false
    this.endPick(view, false)
    const destroyed = view.contents.isDestroyed()
    const error = destroyed
      ? new HostError('view_closed', `browser tab ${view.tabId} was closed`)
      : new HostError('cdp_error', `the debugger was detached from the page (${reason}); the next call attaches again`)
    this.failInflight(view.tabId, error)
  }

  private detach(view: View) {
    if (!view.attached) return
    this.endPick(view, false)
    view.attached = false
    if (view.contents.isDestroyed()) return
    try {
      view.dbg.detach()
    } catch (error) {
      console.error(`${LOG_PREFIX} detaching the debugger from tab ${view.tabId} failed: ${errorMessage(error)}`)
    }
  }

  private ensureAttached(view: View): Promise<void> {
    if (view.crashed) return Promise.reject(new HostError('cdp_error', 'the page crashed; reload or navigate it first'))
    if (view.attaching) return view.attaching
    if (view.attached) return Promise.resolve()
    const attaching = this.attach(view).finally(() => {
      view.attaching = null
    })
    view.attaching = attaching
    return attaching
  }

  private async attach(view: View) {
    try {
      view.dbg.attach(CDP_VERSION)
    } catch (error) {
      throw new HostError('attach_failed', errorMessage(error))
    }
    view.attached = true
    try {
      for (const domain of CDP_DOMAINS) await view.dbg.sendCommand(`${domain}.enable`)
    } catch (error) {
      this.detach(view)
      throw new HostError('attach_failed', `could not enable the page domains: ${errorMessage(error)}`)
    }
    clearBuffers(view)
  }

  private onCdpEvent(view: View, method: string, params: unknown) {
    if (!isRecord(params)) return
    switch (method) {
      case 'Runtime.consoleAPICalled': {
        const args = Array.isArray(params.args) ? params.args : []
        const frame = isRecord(params.stackTrace) && Array.isArray(params.stackTrace.callFrames) ? params.stackTrace.callFrames[0] : undefined
        const location = isRecord(frame) ? frame : {}
        const level = typeof params.type === 'string' ? params.type : 'log'
        view.consoleEntries.add((seq) => consoleEntry(seq, level, args.map(remoteObjectText).join(' '), location.url, location.lineNumber))
        return
      }
      case 'Runtime.exceptionThrown': {
        const details = isRecord(params.exceptionDetails) ? params.exceptionDetails : {}
        const exception = isRecord(details.exception) ? details.exception : {}
        const text = typeof exception.description === 'string' ? exception.description : String(details.text ?? 'exception')
        view.consoleEntries.add((seq) => consoleEntry(seq, 'error', text, details.url, details.lineNumber))
        return
      }
      case 'Log.entryAdded': {
        const entry = isRecord(params.entry) ? params.entry : {}
        const level = entry.level === 'verbose' ? 'debug' : typeof entry.level === 'string' ? entry.level : 'info'
        view.consoleEntries.add((seq) => consoleEntry(seq, level, String(entry.text ?? ''), entry.url, entry.lineNumber))
        return
      }
      case 'Network.requestWillBeSent':
        this.onRequestSent(view, params)
        return
      case 'Page.frameNavigated': {
        const frame = isRecord(params.frame) ? params.frame : {}
        if (frame.parentId === undefined && typeof frame.loaderId === 'string') view.committedLoaderId = frame.loaderId
        return
      }
      case 'Network.responseReceived': {
        const entry = typeof params.requestId === 'string' ? view.networkById.get(params.requestId) : undefined
        if (!entry) return
        applyResponse(entry, params.response)
        view.networkEntries.touch(entry)
        return
      }
      case 'Network.loadingFailed': {
        const entry = typeof params.requestId === 'string' ? view.networkById.get(params.requestId) : undefined
        if (!entry) return
        entry.failed = typeof params.errorText === 'string' ? params.errorText : 'failed'
        view.networkEntries.touch(entry)
        return
      }
      case 'Page.javascriptDialogOpening':
        void this.handleDialog(view, params)
        return
    }
  }

  private emitPickState(view: View) {
    this.deps.emitToRenderer('browser-pick-state', { tabId: view.tabId, active: view.pickActive })
  }

  private async armPick(view: View, enableDomains = false) {
    if (enableDomains) {
      await view.dbg.sendCommand('DOM.enable')
      await view.dbg.sendCommand('Overlay.enable')
    }
    const ratio = await view.dbg.sendCommand('Runtime.evaluate', { expression: 'window.devicePixelRatio', returnByValue: true })
    const value = isRecord(ratio) && isRecord(ratio.result) ? ratio.result.value : undefined
    view.pixelRatio = typeof value === 'number' && value > 0 ? value : 1
    view.hoverNode = null
    view.inspecting = true
  }

  private onGuestMouse(view: View, event: PreventableEvent, mouse: GuestMouse) {
    if (!view.pickActive || mouse.type === 'mouseWheel') return
    event.preventDefault()
    if (!view.inspecting || !Number.isFinite(mouse.x) || !Number.isFinite(mouse.y)) return
    const point = { x: Math.round(mouse.x), y: Math.round(mouse.y) }
    if (mouse.type === 'mouseMove') {
      view.hoverNext = point
      if (!view.hoverDraw) view.hoverDraw = this.drawHover(view).finally(() => { view.hoverDraw = null })
    } else if (mouse.type === 'mouseLeave') {
      view.hoverNext = null
      void this.hideHover(view)
    } else if (mouse.type === 'mouseDown' && mouse.button === 'left') {
      void this.pickAt(view, point)
    }
  }

  private async nodeAt(view: View, point: PickPoint) {
    try {
      const metrics = await view.dbg.sendCommand('Page.getLayoutMetrics')
      const viewport = isRecord(metrics) && isRecord(metrics.cssLayoutViewport) ? metrics.cssLayoutViewport : {}
      const scrollX = typeof viewport.pageX === 'number' ? viewport.pageX : 0
      const scrollY = typeof viewport.pageY === 'number' ? viewport.pageY : 0
      const hit = await view.dbg.sendCommand('DOM.getNodeForLocation', { x: point.x + scrollX, y: point.y + scrollY })
      const id = isRecord(hit) ? hit.backendNodeId : undefined
      return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
    } catch (error) {
      if (!/no node|find node/i.test(errorMessage(error))) {
        console.error(`${LOG_PREFIX} finding the element under the pointer in tab ${view.tabId} failed: ${errorMessage(error)}`)
      }
      return null
    }
  }

  private async drawHover(view: View) {
    while (view.hoverNext !== null) {
      const point = view.hoverNext
      view.hoverNext = null
      if (!view.inspecting) return
      const backendNodeId = await this.nodeAt(view, point)
      if (backendNodeId === null || backendNodeId === view.hoverNode || !view.inspecting) continue
      try {
        const box = await view.dbg.sendCommand('DOM.getBoxModel', { backendNodeId })
        const border = isRecord(box) && isRecord(box.model) ? box.model.border : undefined
        if (!Array.isArray(border) || border.length !== 8 || !border.every((n) => typeof n === 'number')) continue
        if (!view.inspecting) return
        await view.dbg.sendCommand('Overlay.highlightQuad', {
          quad: border.map((n: number) => n / view.pixelRatio),
          color: HOVER_FILL,
          outlineColor: HOVER_OUTLINE,
        })
        view.hoverNode = backendNodeId
      } catch (error) {
        if (!/box model|find node/i.test(errorMessage(error))) {
          console.error(`${LOG_PREFIX} drawing the pick outline in tab ${view.tabId} failed: ${errorMessage(error)}`)
        }
      }
    }
  }

  private async clearHover(view: View) {
    view.inspecting = false
    view.hoverNext = null
    await this.hideHover(view)
  }

  private async hideHover(view: View) {
    await view.hoverDraw
    view.hoverNode = null
    try {
      await view.dbg.sendCommand('Overlay.hideHighlight')
    } catch (error) {
      console.error(`${LOG_PREFIX} clearing the pick outline in tab ${view.tabId} failed: ${errorMessage(error)}`)
    }
  }

  private endPick(view: View, disarm = true) {
    view.pickEpoch += 1
    if (!view.pickActive) return
    view.pickActive = false
    if (disarm && view.attached && !view.contents.isDestroyed()) void this.disarmPick(view)
    this.emitPickState(view)
  }

  private async disarmPick(view: View) {
    view.inspecting = false
    view.hoverNext = null
    view.hoverNode = null
    try {
      await view.dbg.sendCommand('Overlay.hideHighlight')
      await view.dbg.sendCommand('Overlay.disable')
      await view.dbg.sendCommand('DOM.disable')
    } catch (error) {
      console.error(`${LOG_PREFIX} leaving pick mode in tab ${view.tabId} failed: ${errorMessage(error)}`)
    }
  }

  private async pickAt(view: View, point: PickPoint) {
    view.inspecting = false
    view.hoverNext = null
    const backendNodeId = await this.nodeAt(view, point)
    if (backendNodeId === null) {
      if (view.pickActive) view.inspecting = true
      return
    }
    if (!view.pickActive) return
    const pickId = randomUUID()
    this.deps.emitToRenderer('browser-pick-started', { tabId: view.tabId, sessionId: view.sessionId, pickId })
    void this.completePick(view, view.pickEpoch, pickId, backendNodeId)
  }

  private async completePick(view: View, epoch: number, pickId: string, backendNodeId: number) {
    const base = { tabId: view.tabId, sessionId: view.sessionId, pickId }
    const generation = view.generation
    try {
      await this.clearHover(view)
      const answer = await this.askSidecar(
        { type: 'pick', id: randomUUID(), tabId: view.tabId, generation, backendNodeId, expiresAt: Date.now() + BROWSER_PICK_TIMEOUT_MS },
        BROWSER_PICK_TIMEOUT_MS,
        'the sidecar did not describe the picked element in time',
      )
      if (answer.type !== 'pick_result') throw new Error('unexpected answer from the sidecar')
      if (view.pickEpoch !== epoch) {
        this.deps.emitToRenderer('browser-pick-done', { ...base, ok: false, cancelled: true })
      } else if (answer.ok) {
        this.deps.emitToRenderer('browser-pick-done', { ...base, ok: true, generation, value: answer.value })
      } else {
        console.error(`${LOG_PREFIX} describing the picked element failed: ${answer.error.code}: ${answer.error.message}`)
        this.deps.emitToRenderer('browser-pick-done', { ...base, ok: false, cancelled: false, error: answer.error.message })
      }
    } catch (error) {
      const cancelled = view.pickEpoch !== epoch
      if (!cancelled) console.error(`${LOG_PREFIX} describing the picked element failed: ${errorMessage(error)}`)
      this.deps.emitToRenderer('browser-pick-done', { ...base, ok: false, cancelled, ...(cancelled ? {} : { error: errorMessage(error) }) })
    }
    if (view.pickEpoch !== epoch || !view.pickActive) return
    try {
      await this.armPick(view)
    } catch (error) {
      console.error(`${LOG_PREFIX} re-arming pick mode in tab ${view.tabId} failed: ${errorMessage(error)}`)
      this.endPick(view, false)
    }
  }

  private onRequestSent(view: View, params: Record<string, unknown>) {
    const { requestId, request } = params
    if (typeof requestId !== 'string' || !isRecord(request)) return
    const previous = view.networkById.get(requestId)
    if (previous && isRecord(params.redirectResponse)) {
      applyResponse(previous, params.redirectResponse)
      view.networkEntries.touch(previous)
    }
    const entry = view.networkEntries.add((seq) => ({
      seq,
      at: Date.now(),
      requestId,
      method: typeof request.method === 'string' ? request.method : 'GET',
      url: truncate(String(request.url ?? ''), MAX_URL_LENGTH),
      requestHeaders: headerRecord(request.headers),
    }))
    view.networkById.set(requestId, entry)
    view.requestMeta.set(entry, {
      type: typeof params.type === 'string' ? params.type : null,
      loaderId: typeof params.loaderId === 'string' ? params.loaderId : null,
    })
  }

  private async handleDialog(view: View, params: Record<string, unknown>) {
    const kind = params.type
    if (kind !== 'alert' && kind !== 'confirm' && kind !== 'prompt' && kind !== 'beforeunload') return
    const accept = kind === 'alert' || kind === 'beforeunload'
    const record: BrowserDialogRecord = {
      kind,
      message: truncate(String(params.message ?? ''), MAX_DIALOG_MESSAGE_LENGTH),
      handledAs: accept ? 'accepted' : 'dismissed',
    }
    view.dialogs.push(record)
    try {
      await view.dbg.sendCommand('Page.handleJavaScriptDialog', { accept })
    } catch (error) {
      view.dialogs = view.dialogs.filter((item) => item !== record)
      console.error(`${LOG_PREFIX} could not handle a ${kind} dialog in tab ${view.tabId}: ${errorMessage(error)}`)
    }
  }

  private async runCommand(connection: number, message: CommandMessage) {
    const { id } = message
    if (this.inflight.has(id)) {
      this.reply(connection, {
        type: 'result',
        id,
        ok: false,
        error: { code: 'internal', message: `command ${id} is already running` },
      })
      return
    }
    const controller = new AbortController()
    const entry: Inflight = { controller, tabId: message.tabId, sessionId: null, view: null }
    this.inflight.set(id, entry)
    const { signal } = controller
    const aborted = new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(abortError(signal)), { once: true })
    })
    let result: BrowserHostResult
    try {
      const value = await Promise.race([this.dispatch(message, entry, signal), aborted])
      result = { type: 'result', id, ok: true, value }
    } catch (error) {
      const failure = error instanceof HostError ? error : new HostError('internal', errorMessage(error))
      result = { type: 'result', id, ok: false, error: { code: failure.code, message: failure.message } }
    } finally {
      this.inflight.delete(id)
    }
    const dialogs = entry.view ? takeDialogs(entry.view) : []
    if (dialogs.length > 0) result = { ...result, dialogs }
    this.reply(connection, result)
  }

  private reply(connection: number, result: BrowserHostResult) {
    if (connection !== this.connectionId) return
    this.send(result)
  }

  private targetView(message: CommandMessage, checkGeneration: boolean): View {
    const view = message.tabId === null ? undefined : this.views.get(message.tabId)
    if (!view) throw new HostError('no_view', `there is no browser tab ${message.tabId ?? '(none)'}`)
    if (checkGeneration && message.expectGeneration !== undefined && message.expectGeneration !== view.generation) {
      throw new HostError('stale_document', `the page changed: expected document ${message.expectGeneration}, now ${view.generation}`)
    }
    return view
  }

  private async dispatch(message: CommandMessage, entry: Inflight, signal: AbortSignal): Promise<unknown> {
    const { command } = message
    if (command.kind === 'resolve') return this.resolve(command)
    if (command.kind === 'openTab') {
      entry.sessionId = command.sessionId
      return this.openTab(command, signal)
    }
    const view = this.targetView(message, command.kind !== 'inspect')
    entry.view = view
    entry.sessionId = view.sessionId
    switch (command.kind) {
      case 'inspect':
        return this.inspect(view)
      case 'activate':
        return this.activate(view, signal)
      case 'navigate':
        return this.navigate(view, command.url, signal)
      case 'history':
        return this.goBack(view, signal)
      case 'cdp':
        return this.cdp(view, command.method, command.params)
      case 'events':
        return this.events(view, command)
      case 'release':
        this.detach(view)
        clearBuffers(view)
        return {}
      default:
        throw new HostError('internal', 'unknown command kind')
    }
  }

  private async resolve(command: { input: string; projectRoot: string | null }): Promise<BrowserResolveValue> {
    const result = await this.deps.resolveInput(command.input, command.projectRoot)
    if (!result.ok) return { ok: false, reason: result.reason }
    const { origin, local } = describeUrl(result.url)
    if (origin === null) throw new HostError('internal', `resolved address has no origin: ${result.url}`)
    return { ok: true, url: result.url, origin, local }
  }

  private inspect(view: View): BrowserInspectValue {
    const url = view.contents.getURL()
    const { origin, local } = describeUrl(url)
    return {
      url,
      origin,
      local,
      frames: embeddedOrigins(view.contents, origin),
      title: view.contents.getTitle(),
      generation: view.generation,
      loading: view.contents.isLoading(),
      shown: view.shown,
      active: view.active,
      foreground: view.foreground,
    }
  }

  private async openTab(command: { sessionId: string; url: string | null }, signal: AbortSignal) {
    const deadline = Date.now() + OPEN_TAB_TIMEOUT_MS
    const reply = await this.requestRenderer(
      'browser-open-tab-request',
      { sessionId: command.sessionId, url: command.url },
      OPEN_TAB_TIMEOUT_MS,
      signal,
    )
    if (typeof reply !== 'string') throw new HostError('no_view', 'the browser tab did not open in time')
    const view = await raceTimeout(this.waitForView(reply), Math.max(0, deadline - Date.now()), signal)
    if (view === TIMED_OUT) throw new HostError('no_view', 'the browser tab did not open in time')
    if (view.sessionId !== command.sessionId) throw new HostError('no_view', `browser tab ${reply} belongs to another session`)
    return { tabId: view.tabId }
  }

  private waitForView(tabId: string): Promise<View> {
    const existing = this.views.get(tabId)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve) => {
      const waiter: ViewWaiter = {
        tabId,
        resolve: (view) => {
          this.viewWaiters.delete(waiter)
          resolve(view)
        },
      }
      this.viewWaiters.add(waiter)
    })
  }

  private async activate(view: View, signal: AbortSignal) {
    const reply = await this.requestRenderer('browser-activate-request', { tabId: view.tabId }, ACTIVATE_TIMEOUT_MS, signal)
    if (typeof reply !== 'boolean') throw new HostError('timeout', 'the browser tab was not activated in time')
    return { shown: reply }
  }

  private requestRenderer(event: string, payload: Record<string, unknown>, timeoutMs: number, signal: AbortSignal): Promise<unknown> {
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.pending.delete(requestId)
        signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        cleanup()
        reject(abortError(signal))
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve(TIMED_OUT)
      }, timeoutMs)
      this.pending.set(requestId, (value) => {
        cleanup()
        resolve(value)
      })
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        this.deps.emitToRenderer(event, { requestId, ...payload })
      } catch (error) {
        cleanup()
        reject(new HostError('internal', `could not reach the window: ${errorMessage(error)}`))
      }
    })
  }

  private settlePending(requestId: string, value: unknown) {
    const settle = this.pending.get(requestId)
    if (!settle) return false
    settle(value)
    return true
  }

  private async navigate(view: View, url: string, signal: AbortSignal) {
    if (this.deps.classify(url) !== 'allow') throw new HostError('refused_url', `the address is not allowed: ${truncate(url, MAX_URL_LENGTH)}`)
    const { contents } = view
    const started = Date.now()
    const load = contents.loadURL(url).then(
      () => ({ failure: null as string | null, aborted: false }),
      (error: unknown) => ({ failure: errorMessage(error), aborted: isAbortedLoad(error) }),
    )
    const outcome = await raceTimeout(load, NAVIGATE_TIMEOUT_MS, signal)
    if (outcome !== TIMED_OUT) {
      if (outcome.failure !== null && !outcome.aborted) throw new HostError('internal', `navigation failed: ${outcome.failure}`)
      if (outcome.aborted && contents.isLoading()) {
        await waitForEvent(contents, ['did-stop-loading'], Math.max(0, NAVIGATE_TIMEOUT_MS - (Date.now() - started)), signal)
      }
    }
    return { url: contents.getURL(), generation: view.generation, loading: contents.isLoading() }
  }

  private async goBack(view: View, signal: AbortSignal) {
    const { contents } = view
    if (!contents.navigationHistory.canGoBack()) throw new HostError('internal', 'no history entry to go back to')
    const navigated = waitForEvent(contents, ['did-navigate', 'did-navigate-in-page'], HISTORY_TIMEOUT_MS, signal)
    contents.navigationHistory.goBack()
    await navigated
    return { url: contents.getURL(), generation: view.generation }
  }

  private async cdp(view: View, method: string, params: Record<string, unknown> | undefined) {
    if (!CDP_METHOD_ALLOWLIST.includes(method)) throw new HostError('unsupported_method', `${method} is not available`)
    if (view.pickActive && CDP_INPUT_METHODS.includes(method)) {
      throw new HostError('user_picking', 'the user is picking an element on this page')
    }
    await this.ensureAttached(view)
    try {
      return { result: await view.dbg.sendCommand(method, params) }
    } catch (error) {
      throw new HostError('cdp_error', errorMessage(error))
    }
  }

  private async events(view: View, command: { channel: 'console' | 'network'; since: number; limit: number }) {
    await this.ensureAttached(view)
    const buffer = command.channel === 'console' ? view.consoleEntries : view.networkEntries
    const entries = buffer.read(command.since, Math.max(0, Math.floor(command.limit)))
    const last = entries[entries.length - 1]
    return { entries, dropped: buffer.dropped, next: last ? last.seq : buffer.lastSeq, since: command.since }
  }

  private failInflight(tabId: string, error: HostError) {
    for (const entry of this.inflight.values()) {
      if (entry.tabId === tabId) entry.controller.abort(error)
    }
  }

  private abortAll(error: HostError) {
    for (const entry of this.inflight.values()) entry.controller.abort(error)
  }
}

export function createBrowserHost(deps: BrowserHostDeps) {
  return new BrowserHost(deps)
}

export type BrowserHostHandle = ReturnType<typeof createBrowserHost>
