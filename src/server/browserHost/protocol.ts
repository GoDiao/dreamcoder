export const BROWSER_HOST_PATH = '/browser-host'
export const BROWSER_HOST_PROTOCOL_VERSION = 1
export const BROWSER_HOST_HELLO_TIMEOUT_MS = 3_000
export const BROWSER_HOST_CLOSE_UNAUTHORIZED = 4401
export const BROWSER_HOST_CLOSE_REPLACED = 4409
export const BROWSER_COMMAND_TIMEOUT_MS = 60_000

export type BrowserViewInfo = {
  sessionId: string
  tabId: string
  webContentsId: number
  url: string
  title: string
  generation: number
  shown: boolean
  active: boolean
  foreground: boolean
}

export type BrowserRefusalReason = 'scheme' | 'noProject' | 'outsideProject' | 'notFound' | 'notHtml'

export type BrowserHostCommand =
  | { kind: 'resolve'; input: string; projectRoot: string | null }
  | { kind: 'inspect' }
  | { kind: 'openTab'; sessionId: string; url: string | null }
  | { kind: 'activate' }
  | { kind: 'navigate'; url: string }
  | { kind: 'history'; direction: 'back' }
  | { kind: 'cdp'; method: string; params?: Record<string, unknown> }
  | { kind: 'events'; channel: 'console' | 'network'; since: number; limit: number }
  | { kind: 'release' }

export type BrowserGrantDecision = 'deny' | 'once' | 'session'

export const BROWSER_GRANT_DECISIONS: readonly BrowserGrantDecision[] = ['deny', 'once', 'session']

export type BrowserTrustOp = 'list' | 'add' | 'remove'

export const BROWSER_TRUST_OPS: readonly BrowserTrustOp[] = ['list', 'add', 'remove']

export type BrowserTrustResult =
  | { type: 'trust_result'; id: string; ok: true; origins: string[] }
  | { type: 'trust_result'; id: string; ok: false; error: { code: string; message: string } }

export const BROWSER_TRUST_TIMEOUT_MS = 10_000
export const BROWSER_PICK_TIMEOUT_MS = 20_000
export const BROWSER_MARKS_TIMEOUT_MS = 10_000

export type BrowserPickScreenshot = {
  data: string
  mimeType: string
}

export type BrowserPickReact = {
  components: string[]
  props?: unknown
}

export type BrowserPickValue = {
  ref: string
  url: string
  title: string
  tag: string
  label: string
  selector: string
  sensitive: boolean
  truncated: boolean
  role?: string
  name?: string
  text?: string
  href?: string
  styles?: Record<string, string>
  react?: BrowserPickReact
  html?: string
  prev?: string
  next?: string
  screenshot?: BrowserPickScreenshot
}

export type BrowserPickRequest = { type: 'pick'; id: string; tabId: string; generation: number; backendNodeId: number; expiresAt: number }

export type BrowserMarksRequest = { type: 'marks'; id: string; tabId: string; generation: number; refs: string[]; expiresAt: number }

export type BrowserPickResult =
  | { type: 'pick_result'; id: string; ok: true; value: BrowserPickValue }
  | { type: 'pick_result'; id: string; ok: false; error: { code: string; message: string } }

export type BrowserMarksResult =
  | { type: 'marks_result'; id: string; ok: true; alive: string[] }
  | { type: 'marks_result'; id: string; ok: false; error: { code: string; message: string } }

export type BrowserHostMessage =
  | { type: 'ready' }
  | { type: 'command'; id: string; tabId: string | null; expectGeneration?: number; command: BrowserHostCommand }
  | { type: 'cancel'; id: string }
  | BrowserTrustResult
  | BrowserPickResult
  | BrowserMarksResult

export type BrowserHostErrorCode =
  | 'no_view'
  | 'not_shown'
  | 'attach_failed'
  | 'stale_document'
  | 'refused_url'
  | 'unsupported_method'
  | 'cdp_error'
  | 'timeout'
  | 'cancelled'
  | 'view_closed'
  | 'stopped'
  | 'user_picking'
  | 'internal'

export type BrowserDialogRecord = {
  kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  message: string
  handledAs: 'accepted' | 'dismissed'
}

export type BrowserConsoleEntry = {
  seq: number
  at: number
  level: string
  text: string
  url?: string
  line?: number
}

export type BrowserNetworkEntry = {
  seq: number
  at: number
  requestId: string
  method: string
  url: string
  status?: number
  mimeType?: string
  failed?: string
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
}

export type BrowserResolveValue =
  | { ok: true; url: string; origin: string; local: boolean }
  | { ok: false; reason: BrowserRefusalReason }

export type BrowserInspectValue = {
  url: string
  origin: string | null
  local: boolean
  frames: string[]
  title: string
  generation: number
  loading: boolean
  shown: boolean
  active: boolean
  foreground: boolean
}

export type BrowserHostValueByKind = {
  resolve: BrowserResolveValue
  inspect: BrowserInspectValue
  openTab: { tabId: string }
  activate: { shown: boolean }
  navigate: { url: string; generation: number; loading: boolean }
  history: { url: string; generation: number }
  cdp: { result: unknown }
  events: { entries: BrowserConsoleEntry[] | BrowserNetworkEntry[]; dropped: number; next: number; since: number }
  release: Record<string, never>
}

export type BrowserHostResult =
  | { type: 'result'; id: string; ok: true; value: unknown; dialogs?: BrowserDialogRecord[] }
  | { type: 'result'; id: string; ok: false; error: { code: BrowserHostErrorCode; message: string }; dialogs?: BrowserDialogRecord[] }

export type BrowserHostEvent =
  | { type: 'hello'; token: string; protocol: number }
  | { type: 'views'; views: BrowserViewInfo[] }
  | { type: 'stop'; sessionId: string }
  | { type: 'grant_reply'; requestId: string; decision: BrowserGrantDecision }
  | { type: 'trust'; id: string; op: BrowserTrustOp; origin?: string }
  | BrowserPickRequest
  | BrowserMarksRequest

export const CDP_INPUT_METHODS: readonly string[] = ['Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText']

export type BrowserHostInbound = BrowserHostResult | BrowserHostEvent

export const CDP_METHOD_ALLOWLIST: readonly string[] = [
  'Runtime.evaluate',
  'Runtime.callFunctionOn',
  'Runtime.releaseObject',
  'Page.createIsolatedWorld',
  'Page.getFrameTree',
  'Page.getLayoutMetrics',
  'Page.captureScreenshot',
  'Page.bringToFront',
  'DOM.getDocument',
  'DOM.resolveNode',
  'DOM.describeNode',
  'DOM.getBoxModel',
  'DOM.scrollIntoViewIfNeeded',
  'DOM.focus',
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Emulation.setDeviceMetricsOverride',
  'Emulation.clearDeviceMetricsOverride',
  'Emulation.setEmulatedMedia',
]
