import type { BrowserPickReact, BrowserPickValue } from '../protocol.js'

export type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>

export type SnapshotOptions = {
  delta: boolean
  baseline: string | null
  region: number | null
  find: string | null
  textFrom: number
  maxItems: number
  mainChars: number
  maxChars: number
}

export type SnapshotItem = {
  id: number
  role: string
  name: string
  offscreen: boolean
}

export type SnapshotResult = {
  text: string
  baseline: string
  full: boolean
  items: SnapshotItem[]
  itemsDropped: number
  mainCharsDropped: number
  unreadFrames: number
}

export type LocateFailure = 'unknown_id' | 'gone' | 'hidden' | 'disabled' | 'covered'

export type LocateResult =
  | { ok: true; x: number; y: number; role: string; name: string }
  | { ok: false; reason: LocateFailure; detail: string }

export type FocusFailure = 'unknown_id' | 'gone' | 'disabled' | 'not_editable'

export type FocusResult = { ok: true } | { ok: false; reason: FocusFailure; detail: string }

export type ScrollDirection = 'up' | 'down' | 'top' | 'bottom'

export type ScrollArgs = { direction: ScrollDirection; amount: number | null }

export type ScrollResult =
  | { ok: true; moved: number; position: number; maxPosition: number; total: number; area: string | null }
  | { ok: false; reason: 'not_scrollable'; detail: string }

export type ElementLookupFailure = 'unknown_id' | 'gone'

export type ElementLookupResult = { ok: true } | { ok: false; reason: ElementLookupFailure; detail: string }

export type ElementObjectResult = { ok: true; objectId: string } | { ok: false; reason: ElementLookupFailure; detail: string }

export type StylesResult =
  | {
      ok: true
      tag: string
      role: string
      name: string
      box: { x: number; y: number; width: number; height: number }
      values: Array<{ name: string; value: string }>
      unknown: string[]
    }
  | { ok: false; reason: ElementLookupFailure; detail: string }

export type PickRect = {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  scrollX: number
  scrollY: number
  devicePixelRatio: number
}

export type PickDescription = Omit<BrowserPickValue, 'screenshot' | 'react'> & { rect?: PickRect }

export type ReactInfo = { react: BrowserPickReact; truncated: boolean }

export type Snapshotter = {
  snapshot(options: SnapshotOptions): Promise<SnapshotResult>
  scroll(args: ScrollArgs): Promise<ScrollResult>
  locate(id: number): Promise<LocateResult>
  focus(id: number, clear: boolean): Promise<FocusResult>
  hasText(text: string): Promise<boolean>
  styles(id: number, properties: string[] | null): Promise<StylesResult>
  elementObject(id: number): Promise<ElementObjectResult>
  pick(backendNodeId: number): Promise<PickDescription>
  reactInfo(backendNodeId: number): Promise<ReactInfo | null>
  marks(ids: number[]): Promise<number[]>
  setMarksHidden(hidden: boolean): Promise<void>
  waitForPaint(): Promise<void>
}

export const DEFAULT_SNAPSHOT_LIMITS = {
  maxItems: 150,
  mainChars: 8_000,
  maxChars: 16_000,
} as const
