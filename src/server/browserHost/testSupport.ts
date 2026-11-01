import type { ServerWebSocket } from 'bun'
import { BrowserHostChannel, createBrowserHostSocketData, type BrowserHostSocketData } from './hostChannel.js'
import {
  BROWSER_HOST_PROTOCOL_VERSION,
  type BrowserDialogRecord,
  type BrowserGrantDecision,
  type BrowserHostCommand,
  type BrowserHostErrorCode,
  type BrowserInspectValue,
  type BrowserMarksResult,
  type BrowserPickResult,
  type BrowserTrustOp,
  type BrowserTrustResult,
  type BrowserViewInfo,
} from './protocol.js'
import type { BrowserGrantRequest, BrowserGrants } from './service.js'
import type {
  ElementObjectResult,
  FocusResult,
  LocateResult,
  PickDescription,
  ReactInfo,
  ScrollArgs,
  ScrollResult,
  SnapshotOptions,
  SnapshotResult,
  Snapshotter,
  StylesResult,
} from './snapshot/types.js'

export type FakeCommand = {
  id: string
  tabId: string | null
  expectGeneration?: number
  command: BrowserHostCommand
}

export type FakeFailure = { fail: { code: BrowserHostErrorCode; message: string }; dialogs?: BrowserDialogRecord[] }

export type FakeHandler = (message: FakeCommand) => unknown | Promise<unknown> | FakeFailure

export type FakeWithDialogs = { withDialogs: BrowserDialogRecord[]; value: unknown }

export function withDialogs(value: unknown, dialogs: BrowserDialogRecord[]): FakeWithDialogs {
  return { withDialogs: dialogs, value }
}

export const TOKEN = 'a'.repeat(64)

export function fail(code: BrowserHostErrorCode, message: string, dialogs?: BrowserDialogRecord[]): FakeFailure {
  return { fail: { code, message }, dialogs }
}

export function makeView(overrides: Partial<BrowserViewInfo> = {}): BrowserViewInfo {
  return {
    sessionId: 's1',
    tabId: 't1',
    webContentsId: 1,
    url: 'https://example.com/',
    title: 'Example',
    generation: 1,
    shown: true,
    active: true,
    foreground: true,
    ...overrides,
  }
}

export function makeInspect(overrides: Partial<BrowserInspectValue> = {}): BrowserInspectValue {
  return {
    url: 'https://example.com/',
    origin: 'https://example.com',
    local: false,
    frames: [],
    title: 'Example',
    generation: 1,
    loading: false,
    shown: true,
    active: true,
    foreground: true,
    ...overrides,
  }
}

export class FakeDesktop {
  readonly commands: FakeCommand[] = []
  readonly cancelled: string[] = []
  readonly trustResults: BrowserTrustResult[] = []
  readonly pickResults: BrowserPickResult[] = []
  readonly marksResults: BrowserMarksResult[] = []
  private readonly handlers = new Map<BrowserHostCommand['kind'], FakeHandler>()
  private readonly socket: ServerWebSocket<BrowserHostSocketData>

  constructor(readonly channel: BrowserHostChannel) {
    const self = this
    const socket = {
      data: createBrowserHostSocketData(),
      readyState: 1,
      send(payload: string) {
        self.receive(JSON.parse(payload) as Record<string, unknown>)
        return payload.length
      },
      close() {
        this.readyState = 3
      },
    }
    this.socket = socket as unknown as ServerWebSocket<BrowserHostSocketData>
    channel.setToken(TOKEN)
    channel.open(this.socket)
    channel.message(this.socket, JSON.stringify({ type: 'hello', token: TOKEN, protocol: BROWSER_HOST_PROTOCOL_VERSION }))
  }

  on(kind: BrowserHostCommand['kind'], handler: FakeHandler) {
    this.handlers.set(kind, handler)
    return this
  }

  setViews(views: BrowserViewInfo[]) {
    this.channel.message(this.socket, JSON.stringify({ type: 'views', views }))
  }

  sendStop(sessionId: string) {
    this.channel.message(this.socket, JSON.stringify({ type: 'stop', sessionId }))
  }

  sendGrantReply(requestId: string, decision: BrowserGrantDecision) {
    this.channel.message(this.socket, JSON.stringify({ type: 'grant_reply', requestId, decision }))
  }

  sendTrust(id: string, op: BrowserTrustOp, origin?: string) {
    this.channel.message(this.socket, JSON.stringify({ type: 'trust', id, op, ...(origin === undefined ? {} : { origin }) }))
  }

  sendPick(id: string, tabId: string, generation: number, backendNodeId: number, expiresAt = Date.now() + 20_000) {
    this.channel.message(this.socket, JSON.stringify({ type: 'pick', id, tabId, generation, backendNodeId, expiresAt }))
  }

  sendMarks(id: string, tabId: string, generation: number, refs: string[], expiresAt = Date.now() + 10_000) {
    this.channel.message(this.socket, JSON.stringify({ type: 'marks', id, tabId, generation, refs, expiresAt }))
  }

  disconnect() {
    this.channel.close(this.socket)
  }

  of(kind: BrowserHostCommand['kind']) {
    return this.commands.filter((entry) => entry.command.kind === kind)
  }

  cdpMethods() {
    return this.commands
      .filter((entry) => entry.command.kind === 'cdp')
      .map((entry) => (entry.command as Extract<BrowserHostCommand, { kind: 'cdp' }>).method)
  }

  private receive(message: Record<string, unknown>) {
    if (message.type === 'cancel') {
      this.cancelled.push(String(message.id))
      return
    }
    if (message.type === 'trust_result') {
      this.trustResults.push(message as unknown as BrowserTrustResult)
      return
    }
    if (message.type === 'pick_result') {
      this.pickResults.push(message as unknown as BrowserPickResult)
      return
    }
    if (message.type === 'marks_result') {
      this.marksResults.push(message as unknown as BrowserMarksResult)
      return
    }
    if (message.type !== 'command') return
    const entry = message as unknown as FakeCommand
    this.commands.push(entry)
    void this.answer(entry)
  }

  private async answer(entry: FakeCommand) {
    const handler = this.handlers.get(entry.command.kind)
    let outcome: unknown = {}
    try {
      outcome = handler ? await handler(entry) : {}
    } catch (error) {
      outcome = fail('internal', error instanceof Error ? error.message : String(error))
    }
    const reply =
      typeof outcome === 'object' && outcome !== null && 'withDialogs' in outcome
        ? {
            type: 'result',
            id: entry.id,
            ok: true,
            value: (outcome as FakeWithDialogs).value,
            dialogs: (outcome as FakeWithDialogs).withDialogs,
          }
        : typeof outcome === 'object' && outcome !== null && 'fail' in outcome
        ? {
            type: 'result',
            id: entry.id,
            ok: false,
            error: (outcome as FakeFailure).fail,
            dialogs: (outcome as FakeFailure).dialogs,
          }
        : { type: 'result', id: entry.id, ok: true, value: outcome }
    this.channel.message(this.socket, JSON.stringify(reply))
  }
}

export function allowAllGrants(): BrowserGrants & {
  requests: BrowserGrantRequest[]
  cancelled: string[]
  ended: string[]
} {
  const requests: BrowserGrantRequest[] = []
  const cancelled: string[] = []
  const ended: string[] = []
  return {
    requests,
    cancelled,
    ended,
    async ensureOperation(request) {
      requests.push(request)
    },
    cancelSession(sessionId) {
      cancelled.push(sessionId)
    },
    endSession(sessionId) {
      ended.push(sessionId)
    },
  }
}

export class FakeSnapshotter implements Snapshotter {
  readonly snapshotCalls: SnapshotOptions[] = []
  readonly locateCalls: number[] = []
  readonly focusCalls: Array<{ id: number; clear: boolean }> = []
  readonly scrollCalls: ScrollArgs[] = []
  readonly hasTextCalls: string[] = []
  readonly stylesCalls: Array<{ id: number; properties: string[] | null }> = []
  readonly elementObjectCalls: number[] = []
  readonly pickCalls: number[] = []
  readonly reactCalls: number[] = []
  readonly marksCalls: number[][] = []
  readonly hiddenCalls: boolean[] = []
  paintCalls = 0
  pickResult: PickDescription = {
    ref: '7',
    url: 'https://example.com/',
    title: 'Example',
    tag: 'button',
    label: 'button.buy',
    selector: 'main > button.buy',
    sensitive: false,
    truncated: false,
    role: 'button',
    name: 'Buy',
    text: 'Buy',
    styles: { display: 'inline-block' },
    html: '<button class="buy">Buy</button>',
    rect: { x: 100, y: 200, width: 80, height: 30, viewportWidth: 800, viewportHeight: 600, scrollX: 0, scrollY: 0, devicePixelRatio: 2 },
  }
  reactResult: ReactInfo | null = null
  marksAlive: (ids: number[]) => number[] = (ids) => ids
  snapshotResult: SnapshotResult = {
    text: 'URL: https://example.com/\nTitle: Example\nSnapshot: b1 full\n## Page text\nHello\n## Interactive elements\n[1] button "Go"',
    baseline: 'b1',
    full: true,
    items: [{ id: 1, role: 'button', name: 'Go', offscreen: false }],
    itemsDropped: 0,
    mainCharsDropped: 0,
    unreadFrames: 0,
  }
  locateResult: LocateResult = { ok: true, x: 10, y: 20, role: 'button', name: 'Go' }
  focusResult: FocusResult = { ok: true }
  scrollResult: ScrollResult = { ok: true, moved: 720, position: 1440, maxPosition: 3000, total: 3800, area: null }
  hasTextAnswer: (call: number) => boolean | Promise<boolean> = () => true
  stylesResult: StylesResult = {
    ok: true,
    tag: 'button',
    role: 'button',
    name: 'Go',
    box: { x: 10, y: 20, width: 80, height: 32 },
    values: [
      { name: 'display', value: 'inline-block' },
      { name: 'color', value: 'rgb(0, 0, 0)' },
    ],
    unknown: [],
  }
  elementObjectResult: ElementObjectResult = { ok: true, objectId: 'isolated-1' }

  async snapshot(options: SnapshotOptions) {
    this.snapshotCalls.push(options)
    return this.snapshotResult
  }

  async locate(id: number) {
    this.locateCalls.push(id)
    return this.locateResult
  }

  async scroll(args: ScrollArgs) {
    this.scrollCalls.push(args)
    return this.scrollResult
  }

  async focus(id: number, clear: boolean) {
    this.focusCalls.push({ id, clear })
    return this.focusResult
  }

  async hasText(text: string) {
    this.hasTextCalls.push(text)
    return this.hasTextAnswer(this.hasTextCalls.length)
  }

  async styles(id: number, properties: string[] | null) {
    this.stylesCalls.push({ id, properties })
    return this.stylesResult
  }

  async pick(backendNodeId: number) {
    this.pickCalls.push(backendNodeId)
    return this.pickResult
  }

  async reactInfo(backendNodeId: number) {
    this.reactCalls.push(backendNodeId)
    return this.reactResult
  }

  async marks(ids: number[]) {
    this.marksCalls.push(ids)
    return this.marksAlive(ids)
  }

  async setMarksHidden(hidden: boolean) {
    this.hiddenCalls.push(hidden)
  }

  async waitForPaint() {
    this.paintCalls += 1
  }

  async elementObject(id: number) {
    this.elementObjectCalls.push(id)
    return this.elementObjectResult
  }
}
