import { evaluateInPage } from './evaluate.js'
import { BrowserHostError, NO_HOST_MESSAGE, type BrowserHostChannel, type BrowserHostResponse } from './hostChannel.js'
import { KeyedQueue } from './keyedQueue.js'
import { parseKeyChord } from './keys.js'
import type {
  BrowserConsoleEntry,
  BrowserDialogRecord,
  BrowserHostCommand,
  BrowserInspectValue,
  BrowserNetworkEntry,
  BrowserPickValue,
  BrowserViewInfo,
} from './protocol.js'
import {
  DEFAULT_SNAPSHOT_LIMITS,
  type CdpSend,
  type FocusResult,
  type LocateResult,
  type PickRect,
  type ScrollDirection,
  type ScrollResult,
  type Snapshotter,
} from './snapshot/types.js'
import { wrapUntrusted } from './untrusted.js'

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

export type ToolResult = { content: ToolContent[]; isError?: boolean }

export type BrowserGrantRequest = {
  sessionId: string
  origin: string
  action: string
  onceOnly?: boolean
}

export type BrowserGrants = {
  ensureOperation(request: BrowserGrantRequest, signal: AbortSignal | undefined): Promise<void>
  cancelSession(sessionId: string): void
  endSession(sessionId: string): void
}

export class BrowserToolError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BrowserToolError'
    this.code = code
  }
}

export type BrowserServiceDeps = {
  channel: BrowserHostChannel
  grants: BrowserGrants
  getProjectRoot: (sessionId: string) => string | null
  createSnapshotter: (cdp: CdpSend) => Snapshotter
  queue?: KeyedQueue
  settleMs?: number
  pollMs?: number
}

type TabState = {
  snapshotter: Snapshotter | null
  generation: number | null
  snapshotGeneration: number | null
  consoleSince: number
  networkSince: number
  cdp: CdpSend
  dialogs: BrowserDialogRecord[]
  emulation: EmulationState | null
}

type ColorScheme = 'light' | 'dark'
type ReducedMotion = 'reduce' | 'no-preference'

type EmulationState = {
  viewport: { width: number; height: number; mobile: boolean; deviceScaleFactor: number } | null
  colorScheme: ColorScheme | null
  reducedMotion: ReducedMotion | null
}

type EmulateArgs = {
  width?: number
  height?: number
  mobile?: boolean
  deviceScaleFactor?: number
  colorScheme?: ColorScheme | 'auto'
  reducedMotion?: ReducedMotion | 'auto'
  reset?: boolean
  tabId?: string
}

type EmulationPlan =
  | { reset: true }
  | {
      reset: false
      viewport: NonNullable<EmulationState['viewport']> | null
      media: Partial<Pick<EmulationState, 'colorScheme' | 'reducedMotion'>> | null
    }

type OperationContext = {
  view: BrowserViewInfo
  inspect: BrowserInspectValue
  state: TabState
  signal: AbortSignal | undefined
  request: <K extends BrowserHostCommand['kind']>(
    command: Extract<BrowserHostCommand, { kind: K }>,
  ) => Promise<BrowserHostResponse<K>>
  cdp: CdpSend
  snapshotter: () => Snapshotter
  rebind: () => Promise<void>
}

type OperationOptions = {
  tabId?: string
  action: string
  needsGrant: boolean
}

export type BrowserActivityListener = (sessionId: string, tabId: string, active: boolean) => void

const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|proxy-authorization)$|token|secret|api[-_]?key/i
const DEFAULT_SETTLE_MS = 150
const DEFAULT_POLL_MS = 150
const WAIT_DEFAULT_MS = 10_000
const WAIT_MIN_MS = 100
const WAIT_MAX_MS = 30_000
const WAIT_TEXT_LIMIT = 200
const EVALUATE_RESULT_LIMIT = 10_000
const EVALUATE_ERROR_LIMIT = 1_500
const EVALUATE_ACTION_LIMIT = 200
const OPEN_TAB_VIEW_WAIT_MS = 2_000
const EMULATION_RESET_TIMEOUT_MS = 5_000
const CONSOLE_TEXT_LIMIT = 500
const URL_LIMIT = 300
const PICK_SCREENSHOT_PADDING = 20
const PICK_SCREENSHOT_MAX_SIDE = 2_048
const PICK_SCREENSHOT_QUALITY = 80

const CODE_HINTS: Record<string, string> = {
  stale_document:
    'The page navigated while the action was running. Take a new snapshot before continuing.',
  attach_failed:
    'Could not attach to the page. Another debugger, such as developer tools opened on this page, may be using it.',
  stopped: 'The user stopped browser control. Do not retry until the user sends another message.',
  view_closed: 'The browser tab was closed. Call navigate with a URL to open a new one.',
  no_view: 'No browser tab is available for this session.',
  refused_url:
    'Only https pages, http pages on localhost or 127.0.0.1, and html files inside the project are supported.',
  user_picking:
    'The user is picking an element on this page, so clicks and typing are paused. Wait a few seconds and repeat the call; read-only tools such as snapshot still work.',
}

export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    result[name] = SENSITIVE_HEADER.test(name) ? '[redacted]' : value
  }
  return result
}

function clip(text: string, limit: number) {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

function text(textContent: string): ToolResult {
  return { content: [{ type: 'text', text: textContent }] }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function describeDialogs(dialogs: BrowserDialogRecord[]) {
  if (dialogs.length === 0) return ''
  const lines = dialogs.map(
    (dialog) =>
      `- ${dialog.kind} ${JSON.stringify(clip(dialog.message, 200))} was ${dialog.handledAs} automatically`,
  )
  return `\n\nJavaScript dialogs that opened during this call (message text comes from the page):\n${wrapUntrusted(lines.join('\n'))}`
}

function describeAddress(url: string) {
  return `\nAddress (comes from the page):\n${wrapUntrusted(clip(url, URL_LIMIT))}`
}

function describeElement(role: string, name: string) {
  return `\nElement (role and name come from the page):\n${wrapUntrusted(`${role} ${JSON.stringify(name)}`)}`
}

function grantTargetsFor(inspect: BrowserInspectValue): { origin: string; onceOnly?: true }[] {
  if (!inspect.local) return inspect.origin === null ? [] : [{ origin: inspect.origin }]
  return inspect.frames.map((origin) => ({ origin, onceOnly: true }))
}

function describeScroll(direction: ScrollDirection, result: Extract<ScrollResult, { ok: true }>) {
  const where = result.area === null ? 'the page' : `the scrollable area ${result.area}`
  const upward = direction === 'up' || direction === 'top'
  const offset = `${result.position} of ${result.maxPosition}`
  if (result.moved === 0) {
    const atEdge = upward ? result.position <= 0 : result.position >= result.maxPosition
    return atEdge
      ? `Did not move: already at the ${upward ? 'top' : 'bottom'} of ${where} (position ${offset}).`
      : `Did not move: ${where} did not scroll (position ${offset}).`
  }
  const percent = result.maxPosition > 0 ? Math.round((result.position / result.maxPosition) * 100) : 100
  const moved =
    direction === 'top' || direction === 'bottom'
      ? `Scrolled to the ${direction} of ${where} (${upward ? 'up' : 'down'} ${result.moved}px).`
      : `Scrolled ${direction} ${result.moved}px in ${where}.`
  return `${moved} Now at ${percent}% of ${where} (scrolled ${offset}px, content height ${result.total}px). The visible elements changed: take a snapshot to see them. Element ids from earlier snapshots stay valid.`
}

function planEmulation(args: EmulateArgs): EmulationPlan {
  const invalid = (message: string) => new BrowserToolError('invalid_arguments', `[browser.invalid_arguments] ${message}`)
  const hasViewport = args.width !== undefined || args.height !== undefined
  const hasViewportOptions = args.mobile !== undefined || args.deviceScaleFactor !== undefined
  const hasMedia = args.colorScheme !== undefined || args.reducedMotion !== undefined
  if (args.reset === true) {
    if (hasViewport || hasViewportOptions || hasMedia) {
      throw invalid('reset cannot be combined with other parameters. Call emulate with reset alone to clear every emulation.')
    }
    return { reset: true }
  }
  if (!hasViewport && !hasViewportOptions && !hasMedia) {
    throw invalid('Pass width and height, colorScheme, reducedMotion, or reset: emulate needs at least one of them.')
  }
  if (hasViewport && (args.width === undefined || args.height === undefined)) {
    throw invalid('Pass width and height together.')
  }
  if (!hasViewport && hasViewportOptions) {
    throw invalid('mobile and deviceScaleFactor belong to the viewport: pass them together with width and height.')
  }
  const viewport =
    args.width !== undefined && args.height !== undefined
      ? { width: args.width, height: args.height, mobile: args.mobile === true, deviceScaleFactor: args.deviceScaleFactor ?? 1 }
      : null
  const media = {
    ...(args.colorScheme === undefined ? {} : { colorScheme: args.colorScheme === 'auto' ? null : args.colorScheme }),
    ...(args.reducedMotion === undefined ? {} : { reducedMotion: args.reducedMotion === 'auto' ? null : args.reducedMotion }),
  }
  return { reset: false, viewport, media: Object.keys(media).length > 0 ? media : null }
}

function emulatedMediaParams(state: Pick<EmulationState, 'colorScheme' | 'reducedMotion'>) {
  return {
    media: '',
    features: [
      { name: 'prefers-color-scheme', value: state.colorScheme ?? '' },
      { name: 'prefers-reduced-motion', value: state.reducedMotion ?? '' },
    ],
  }
}

async function clearEmulation(cdp: CdpSend) {
  await cdp('Emulation.clearDeviceMetricsOverride')
  await cdp('Emulation.setEmulatedMedia', emulatedMediaParams({ colorScheme: null, reducedMotion: null }))
}

function emulationOrNull(state: EmulationState): EmulationState | null {
  return state.viewport || state.colorScheme || state.reducedMotion ? state : null
}

function describeEmulation(state: EmulationState) {
  const parts: string[] = []
  if (state.viewport) {
    const { width, height, mobile, deviceScaleFactor } = state.viewport
    parts.push(`${width}x${height} (${mobile ? 'mobile' : 'desktop'}${deviceScaleFactor === 1 ? '' : `, scale ${deviceScaleFactor}`})`)
  }
  if (state.colorScheme) parts.push(`color scheme ${state.colorScheme}`)
  if (state.reducedMotion) parts.push(`reduced motion ${state.reducedMotion}`)
  return `Emulation active: ${parts.join(', ')}. Call emulate with reset to restore the normal view.`
}

export class BrowserService {
  private readonly channel: BrowserHostChannel
  private readonly grants: BrowserGrants
  private readonly getProjectRoot: (sessionId: string) => string | null
  private readonly createSnapshotter: (cdp: CdpSend) => Snapshotter
  private readonly queue: KeyedQueue
  private readonly settleMs: number
  private readonly pollMs: number
  private readonly tabs = new Map<string, TabState>()
  private readonly stopped = new Set<string>()
  private readonly sessionControllers = new Map<string, AbortController>()
  private readonly activeCalls = new Map<string, number>()
  private readonly activityListeners = new Set<BrowserActivityListener>()

  constructor(deps: BrowserServiceDeps) {
    this.channel = deps.channel
    this.grants = deps.grants
    this.getProjectRoot = deps.getProjectRoot
    this.createSnapshotter = deps.createSnapshotter
    this.queue = deps.queue ?? new KeyedQueue()
    this.settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS
    this.channel.onStop((sessionId) => {
      this.stop(sessionId)
      this.forgetEmulation(sessionId)
    })
    this.channel.onViews(() => this.dropClosedTabs())
  }

  onActivity(listener: BrowserActivityListener) {
    this.activityListeners.add(listener)
    return () => {
      this.activityListeners.delete(listener)
    }
  }

  stop(sessionId: string) {
    this.stopped.add(sessionId)
    this.sessionControllers.get(sessionId)?.abort()
    this.sessionControllers.delete(sessionId)
    this.grants.cancelSession(sessionId)
  }

  resume(sessionId: string) {
    this.stopped.delete(sessionId)
  }

  isStopped(sessionId: string) {
    return this.stopped.has(sessionId)
  }

  async releaseSession(sessionId: string) {
    this.sessionControllers.get(sessionId)?.abort()
    this.sessionControllers.delete(sessionId)
    this.grants.endSession(sessionId)
    this.stopped.delete(sessionId)
    for (const view of this.channel.listViews(sessionId)) {
      this.tabs.delete(view.tabId)
      await this.channel.request({ kind: 'release' }, { tabId: view.tabId, timeoutMs: 5_000 }).catch(() => undefined)
    }
  }

  async resetEmulation(sessionId: string) {
    for (const view of this.channel.listViews(sessionId)) {
      if (!this.tabs.get(view.tabId)?.emulation) continue
      try {
        await this.queue.run(view.tabId, async () => {
          const state = this.tabs.get(view.tabId)
          if (!state?.emulation) return
          await clearEmulation(async (method, params) => {
            const response = await this.channel.request(
              { kind: 'cdp', method, ...(params ? { params } : {}) },
              { tabId: view.tabId, timeoutMs: EMULATION_RESET_TIMEOUT_MS },
            )
            return response.value.result
          })
          state.emulation = null
        })
      } catch (error) {
        console.warn(`[browser] could not clear the emulation of tab ${view.tabId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private forgetEmulation(sessionId: string) {
    for (const view of this.channel.listViews(sessionId)) {
      const state = this.tabs.get(view.tabId)
      if (state) state.emulation = null
    }
  }

  async navigate(sessionId: string, args: { url: string; tabId?: string }, signal?: AbortSignal): Promise<ToolResult> {
    return this.guard(async () => {
      this.assertNotStopped(sessionId)
      this.assertHost()
      const resolved = (
        await this.channel.request(
          { kind: 'resolve', input: args.url, projectRoot: this.getProjectRoot(sessionId) },
          { tabId: null, signal },
        )
      ).value
      if (!resolved.ok) {
        throw new BrowserHostError(
          'refused_url',
          `[browser.refused_url] ${CODE_HINTS.refused_url} Refused: ${clip(args.url, URL_LIMIT)} (${resolved.reason}).`,
        )
      }
      if (!args.tabId) {
        const opened = await this.queue.run(`open:${sessionId}`, async () => {
          if (this.channel.listViews(sessionId).length > 0) return null
          await this.ensureDestinationGrant(sessionId, resolved, `Open ${resolved.url}`, signal)
          const response = await this.channel.request(
            { kind: 'openTab', sessionId, url: resolved.url },
            { tabId: null, signal },
          )
          await this.waitForView(response.value.tabId)
          return response
        })
        if (opened) {
          return text(
            `Opened a browser tab at ${clip(resolved.url, URL_LIMIT)}. Take a snapshot to see the page.${describeDialogs(opened.dialogs)}`,
          )
        }
      }
      return this.execute(sessionId, signal, { tabId: args.tabId, action: `Navigate to ${resolved.url}`, needsGrant: false }, async (ctx) => {
        await this.ensureDestinationGrant(sessionId, resolved, `Navigate to ${resolved.url}`, signal)
        const moved = await ctx.request({ kind: 'navigate', url: resolved.url })
        return text(
          `Navigated to the address below. The page is ${moved.value.loading ? 'still loading' : 'loaded'}. Take a snapshot to see it.${describeAddress(moved.value.url)}`,
        )
      })
    })
  }

  async back(sessionId: string, args: { tabId?: string }, signal?: AbortSignal): Promise<ToolResult> {
    return this.guard(() =>
      this.execute(sessionId, signal, { tabId: args.tabId, action: 'Go back', needsGrant: true }, async (ctx) => {
        const moved = await ctx.request({ kind: 'history', direction: 'back' })
        const note = await this.afterAction(ctx)
        return text(
          note
            ? `Went back to the address below.${note}`
            : `Went back to the address below. Take a snapshot to see the page.${describeAddress(moved.value.url)}`,
        )
      }),
    )
  }

  async snapshot(
    sessionId: string,
    args: { tabId?: string; delta?: boolean; baseline?: string; region?: number; find?: string; textFrom?: number },
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    return this.guard(() =>
      this.execute(sessionId, signal, { tabId: args.tabId, action: 'Read the page', needsGrant: false }, async (ctx) => {
        const find = args.find === undefined ? null : args.find.trim()
        if (find === '') {
          throw new BrowserToolError('invalid_arguments', '[browser.invalid_arguments] find must contain some text to search for.')
        }
        if (find !== null && args.textFrom !== undefined) {
          throw new BrowserToolError(
            'invalid_arguments',
            '[browser.invalid_arguments] Pass either find or textFrom, not both. find lists the matching text; textFrom continues reading the page text.',
          )
        }
        const result = await ctx.snapshotter().snapshot({
          delta: args.delta === true,
          baseline: args.baseline ?? null,
          region: args.region ?? null,
          find,
          textFrom: args.textFrom ?? 0,
          ...DEFAULT_SNAPSHOT_LIMITS,
        })
        ctx.state.snapshotGeneration = ctx.inspect.generation
        const emulation = ctx.state.emulation ? `\n${describeEmulation(ctx.state.emulation)}` : ''
        return text(`Tab ${ctx.view.tabId}${emulation}\n${wrapUntrusted(result.text)}`)
      }),
    )
  }

  async scroll(
    sessionId: string,
    args: { direction: ScrollDirection; amount?: number; tabId?: string },
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    return this.guard(() =>
      this.execute(sessionId, signal, { tabId: args.tabId, action: `Scroll ${args.direction}`, needsGrant: false }, async (ctx) => {
        const result = await ctx.snapshotter().scroll({ direction: args.direction, amount: args.amount ?? null })
        if (!result.ok) {
          throw new BrowserToolError('not_scrollable', `[browser.not_scrollable] ${result.detail}`)
        }
        const note = await this.afterAction(ctx)
        return text(`${describeScroll(args.direction, result)}${note}`)
      }),
    )
  }

  async pick(tabId: string, generation: number, backendNodeId: number, expiresAt: number): Promise<BrowserPickValue> {
    return this.runForUser(tabId, generation, expiresAt, async ({ snapshotter, cdp, state }) => {
      const { rect, ...description } = await snapshotter.pick(backendNodeId)
      state.snapshotGeneration = generation
      if (description.sensitive) return description
      const react = await snapshotter.reactInfo(backendNodeId).catch((error: unknown) => {
        console.warn(`[browser] could not read the React info of a picked element: ${error instanceof Error ? error.message : String(error)}`)
        return null
      })
      const screenshot = rect
        ? await this.captureElement(snapshotter, cdp, rect).catch((error: unknown) => {
            console.warn(`[browser] could not capture the picked element: ${error instanceof Error ? error.message : String(error)}`)
            return undefined
          })
        : undefined
      return {
        ...description,
        truncated: description.truncated || react?.truncated === true,
        ...(react ? { react: react.react } : {}),
        ...(screenshot ? { screenshot } : {}),
      }
    })
  }

  async marks(tabId: string, generation: number, refs: string[], expiresAt: number): Promise<string[]> {
    const ids = refs.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    return this.runForUser(tabId, generation, expiresAt, async ({ snapshotter }) => (await snapshotter.marks(ids)).map(String))
  }

  private async runForUser<T>(
    tabId: string,
    generation: number,
    expiresAt: number,
    body: (ctx: { snapshotter: Snapshotter; cdp: CdpSend; state: TabState }) => Promise<T>,
  ): Promise<T> {
    if (!this.channel.getView(tabId)) throw new BrowserHostError('no_view', `[browser.no_view] ${CODE_HINTS.no_view}`)
    return this.queue.run(tabId, async () => {
      if (Date.now() > expiresAt) {
        throw new BrowserHostError('expired', '[browser.expired] The request timed out in the queue before it started, so nothing was done.')
      }
      const state = this.tabState(tabId)
      const cdp: CdpSend = async (method, params) =>
        (
          await this.channel.request(
            { kind: 'cdp', method, ...(params ? { params } : {}) },
            { tabId, expectGeneration: generation },
          )
        ).value.result
      state.cdp = cdp
      return body({ snapshotter: this.snapshotterFor(state, generation), cdp, state })
    })
  }

  private async captureElement(snapshotter: Snapshotter, cdp: CdpSend, rect: PickRect) {
    const left = Math.max(0, rect.x - PICK_SCREENSHOT_PADDING)
    const top = Math.max(0, rect.y - PICK_SCREENSHOT_PADDING)
    const width = Math.min(rect.viewportWidth, rect.x + rect.width + PICK_SCREENSHOT_PADDING) - left
    const height = Math.min(rect.viewportHeight, rect.y + rect.height + PICK_SCREENSHOT_PADDING) - top
    if (width < 1 || height < 1) return undefined
    const scale = Math.min(1, PICK_SCREENSHOT_MAX_SIDE / (Math.max(width, height) * rect.devicePixelRatio))
    await snapshotter.setMarksHidden(true)
    try {
      await snapshotter.waitForPaint()
      const shot = (await cdp('Page.captureScreenshot', {
        format: 'webp',
        quality: PICK_SCREENSHOT_QUALITY,
        clip: { x: left + rect.scrollX, y: top + rect.scrollY, width, height, scale },
      })) as { data?: unknown }
      if (typeof shot.data !== 'string') throw new Error('the browser returned no screenshot data')
      return { data: shot.data, mimeType: 'image/webp' }
    } finally {
      await snapshotter.setMarksHidden(false).catch((error: unknown) => {
        console.warn(`[browser] could not show the element marks again: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }

  async emulate(sessionId: string, args: EmulateArgs, signal?: AbortSignal): Promise<ToolResult> {
    return this.guard(async () => {
      const plan = planEmulation(args)
      return this.execute(sessionId, signal, { tabId: args.tabId, action: 'Change the emulated view', needsGrant: false }, async (ctx) => {
        if (plan.reset) {
          await clearEmulation(ctx.cdp)
          ctx.state.emulation = null
        } else {
          let next: EmulationState = ctx.state.emulation ?? { viewport: null, colorScheme: null, reducedMotion: null }
          if (plan.viewport) {
            const { width, height, mobile, deviceScaleFactor } = plan.viewport
            await ctx.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile })
            next = { ...next, viewport: plan.viewport }
            ctx.state.emulation = emulationOrNull(next)
          }
          if (plan.media) {
            const withMedia = { ...next, ...plan.media }
            await ctx.cdp('Emulation.setEmulatedMedia', emulatedMediaParams(withMedia))
            next = withMedia
            ctx.state.emulation = emulationOrNull(next)
          }
        }
        const note = await this.afterAction(ctx)
        const state = ctx.state.emulation
        return text(
          state
            ? `${describeEmulation(state)} The layout and visible elements may have changed: take a snapshot to see them.${note}`
            : `Emulation cleared. The page is back to its normal view: take a snapshot to see it.${note}`,
        )
      })
    })
  }

  async waitFor(
    sessionId: string,
    args: { text?: string; textGone?: string; timeoutMs?: number; tabId?: string },
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    return this.guard(async () => {
      const appear = args.text?.trim()
      const vanish = args.textGone?.trim()
      if ((appear === undefined) === (vanish === undefined) || appear === '' || vanish === '') {
        throw new BrowserToolError(
          'invalid_arguments',
          '[browser.invalid_arguments] Pass exactly one non-empty text: text to wait for it to appear, or textGone to wait for it to disappear.',
        )
      }
      const needle = (appear ?? vanish) as string
      const wantPresent = appear !== undefined
      const timeoutMs = Math.min(Math.max(Math.round(args.timeoutMs ?? WAIT_DEFAULT_MS), WAIT_MIN_MS), WAIT_MAX_MS)
      return this.execute(sessionId, signal, { tabId: args.tabId, action: 'Wait for text', needsGrant: false }, async (ctx) => {
        const started = Date.now()
        const deadline = started + timeoutMs
        try {
          for (;;) {
            const present = await this.pollText(ctx, needle)
            if (present === wantPresent) {
              const note = await this.navigationNote(ctx)
              return text(`Text ${wantPresent ? 'appeared' : 'disappeared'} after ${Date.now() - started}ms.${note}`)
            }
            const remaining = deadline - Date.now()
            if (remaining <= 0) break
            await this.pause(Math.min(this.pollMs, remaining), ctx.signal)
          }
        } catch (error) {
          if (this.stopped.has(sessionId) && error instanceof BrowserHostError && error.code === 'cancelled') {
            throw this.stoppedError()
          }
          throw error
        }
        const note = await this.navigationNote(ctx)
        throw new BrowserToolError(
          'timeout',
          `[browser.timeout] ${JSON.stringify(clip(needle, WAIT_TEXT_LIMIT))} did not ${wantPresent ? 'appear' : 'disappear'} within ${timeoutMs}ms. Take a snapshot to see the page.${note}`,
        )
      })
    })
  }

  async styles(
    sessionId: string,
    args: { id: number; properties?: string[]; tabId?: string },
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    return this.guard(() =>
      this.execute(sessionId, signal, { tabId: args.tabId, action: `Read the styles of element [${args.id}]`, needsGrant: false }, async (ctx) => {
        this.assertIdsFromThisPage(ctx)
        const result = await ctx.snapshotter().styles(args.id, args.properties ?? null)
        if (!result.ok) {
          throw this.elementFailure(result.reason, args.id, result.detail, 'cannot be used', 'Take a new snapshot and choose an element from it.')
        }
        const { x, y, width, height } = result.box
        const lines = [
          `[${args.id}] <${result.tag}> role=${result.role} name=${JSON.stringify(result.name)} box: x=${x} y=${y} width=${width} height=${height} (CSS px, relative to the viewport)`,
          ...result.values.map((entry) => `${entry.name}: ${entry.value}`),
          ...(result.unknown.length > 0 ? [`Unknown properties, not reported: ${result.unknown.join(', ')}`] : []),
        ]
        return text(`Tab ${ctx.view.tabId}\n${wrapUntrusted(lines.join('\n'))}`)
      }),
    )
  }

  async evaluate(
    sessionId: string,
    args: { expression: string; id?: number; tabId?: string },
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const summary = clip(args.expression.replace(/\s+/g, ' ').trim(), EVALUATE_ACTION_LIMIT)
    const action = `Run JavaScript${args.id === undefined ? '' : ` on element [${args.id}]`}: ${summary}`
    return this.guard(() =>
      this.execute(sessionId, signal, { tabId: args.tabId, action, needsGrant: true }, async (ctx) => {
        let elementObjectId: string | null = null
        if (args.id !== undefined) {
          this.assertIdsFromThisPage(ctx)
          const element = await ctx.snapshotter().elementObject(args.id)
          if (!element.ok) {
            throw this.elementFailure(element.reason, args.id, element.detail, 'cannot be used', 'Take a new snapshot and choose an element from it.')
          }
          elementObjectId = element.objectId
        }
        const outcome = await evaluateInPage(ctx.cdp, args.expression, elementObjectId)
        const note = await this.afterAction(ctx)
        if (!outcome.ok) {
          const lead = {
            exception: '[browser.eval_exception] The expression threw an exception. The message and stack below come from the page.',
            not_serializable: '[browser.eval_not_serializable]',
            timeout: '[browser.eval_timeout]',
          }[outcome.reason]
          const detail = outcome.reason === 'exception' ? `\n${wrapUntrusted(clip(outcome.detail, EVALUATE_ERROR_LIMIT))}` : ` ${outcome.detail}`
          return { content: [{ type: 'text', text: `${lead}${detail}${note}` }], isError: true }
        }
        const shown = outcome.json.slice(0, EVALUATE_RESULT_LIMIT)
        const cut =
          outcome.json.length > EVALUATE_RESULT_LIMIT
            ? `\n(result cut at ${EVALUATE_RESULT_LIMIT} characters: ${outcome.json.length - EVALUATE_RESULT_LIMIT} more not shown; return a smaller value)`
            : ''
        return text(`Result of the expression (page data):\n${wrapUntrusted(shown)}${cut}${note}`)
      }),
    )
  }

  async click(sessionId: string, args: { id: number; tabId?: string }, signal?: AbortSignal): Promise<ToolResult> {
    return this.guard(() =>
      this.execute(sessionId, signal, { tabId: args.tabId, action: `Click element [${args.id}]`, needsGrant: true }, async (ctx) => {
        const point = await this.locate(ctx, args.id)
        await this.mouseClick(ctx, point.x, point.y)
        const note = await this.afterAction(ctx)
        return text(`Clicked [${args.id}].${note}${describeElement(point.role, point.name)}`)
      }),
    )
  }

  async type(
    sessionId: string,
    args: { id: number; text: string; clear?: boolean; submit?: boolean; tabId?: string },
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    return this.guard(() =>
      this.execute(
        sessionId,
        signal,
        { tabId: args.tabId, action: `Type ${args.text.length} characters into element [${args.id}]`, needsGrant: true },
        async (ctx) => {
          const point = await this.locate(ctx, args.id)
          await this.mouseClick(ctx, point.x, point.y)
          const focused = await ctx.snapshotter().focus(args.id, args.clear !== false)
          this.assertFocused(focused, args.id)
          await ctx.cdp('Input.insertText', { text: args.text })
          if (args.submit === true) await this.pressChord(ctx, 'Enter')
          const note = await this.afterAction(ctx)
          return text(
            `Typed ${args.text.length} characters into [${args.id}].${args.submit === true ? ' Pressed Enter.' : ''}${note}${describeElement(point.role, point.name)}`,
          )
        },
      ),
    )
  }

  async pressKey(
    sessionId: string,
    args: { key: string; id?: number; tabId?: string },
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    return this.guard(() =>
      this.execute(sessionId, signal, { tabId: args.tabId, action: `Press ${args.key}`, needsGrant: true }, async (ctx) => {
        if (!parseKeyChord(args.key)) {
          throw new BrowserToolError(
            'invalid_key',
            `[browser.invalid_key] Unknown key ${JSON.stringify(clip(args.key, 40))}. Use a name such as Enter, Tab, Escape, ArrowDown, a single letter or digit, or a chord such as Control+A or Shift+Tab.`,
          )
        }
        if (args.id !== undefined) {
          this.assertIdsFromThisPage(ctx)
          const focused = await ctx.snapshotter().focus(args.id, false)
          this.assertFocused(focused, args.id)
        }
        await this.pressChord(ctx, args.key)
        const note = await this.afterAction(ctx)
        return text(`Pressed ${args.key}.${note}`)
      }),
    )
  }

  async screenshot(sessionId: string, args: { tabId?: string }, signal?: AbortSignal): Promise<ToolResult> {
    return this.guard(() =>
      this.execute(sessionId, signal, { tabId: args.tabId, action: 'Take a screenshot', needsGrant: false }, async (ctx) => {
        const shot = (await ctx.cdp('Page.captureScreenshot', { format: 'jpeg', quality: 70 })) as { data?: unknown }
        if (typeof shot.data !== 'string') {
          throw new BrowserToolError('internal', '[browser.internal] The browser returned no screenshot data.')
        }
        return {
          content: [
            {
              type: 'text',
              text: `Screenshot of tab ${ctx.view.tabId}. The image shows page content, which is untrusted data.${ctx.state.emulation ? ` ${describeEmulation(ctx.state.emulation)}` : ''}${describeAddress(ctx.inspect.url)}`,
            },
            { type: 'image', data: shot.data, mimeType: 'image/jpeg' },
          ],
        }
      }),
    )
  }

  async console(
    sessionId: string,
    args: { tabId?: string; level?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    return this.guard(() =>
      this.execute(sessionId, signal, { tabId: args.tabId, action: 'Read the console', needsGrant: false }, async (ctx) => {
        const limit = Math.min(Math.max(args.limit ?? 50, 1), 200)
        const result = await ctx.request({ kind: 'events', channel: 'console', since: ctx.state.consoleSince, limit })
        ctx.state.consoleSince = result.value.next
        const entries = (result.value.entries as BrowserConsoleEntry[]).filter(
          (entry) => !args.level || entry.level === args.level,
        )
        return text(this.formatEvents('console', entries.map(formatConsoleEntry), result.value.dropped, result.value.since === 0))
      }),
    )
  }

  async network(
    sessionId: string,
    args: { tabId?: string; urlContains?: string; includeHeaders?: boolean; limit?: number },
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    return this.guard(() =>
      this.execute(sessionId, signal, { tabId: args.tabId, action: 'Read network activity', needsGrant: false }, async (ctx) => {
        const limit = Math.min(Math.max(args.limit ?? 50, 1), 200)
        const result = await ctx.request({ kind: 'events', channel: 'network', since: ctx.state.networkSince, limit })
        ctx.state.networkSince = result.value.next
        const entries = (result.value.entries as BrowserNetworkEntry[]).filter(
          (entry) => !args.urlContains || entry.url.includes(args.urlContains),
        )
        return text(
          this.formatEvents(
            'network',
            entries.map((entry) => formatNetworkEntry(entry, args.includeHeaders === true)),
            result.value.dropped,
            result.value.since === 0,
          ),
        )
      }),
    )
  }

  private formatEvents(kind: string, lines: string[], dropped: number, first: boolean) {
    const header = first
      ? `Recording of ${kind} output started with the first browser call of this session; earlier output was not recorded.`
      : `New ${kind} output since your last ${kind} call.`
    const notes = dropped > 0 ? `\n(${dropped} older entries were dropped from the buffer)` : ''
    const body = lines.length === 0 ? '(no entries)' : lines.join('\n')
    return `${header}${notes}\n${wrapUntrusted(body)}`
  }

  private async guard(run: () => Promise<ToolResult>): Promise<ToolResult> {
    try {
      return await run()
    } catch (error) {
      return this.failure(error)
    }
  }

  private failure(error: unknown): ToolResult {
    if (error instanceof BrowserHostError) {
      const prefixed = error.message.startsWith('[') ? error.message : `[browser.${error.code}] ${error.message}`
      const hint = CODE_HINTS[error.code]
      const body = hint && !error.message.includes(hint) ? `${prefixed} ${hint}` : prefixed
      return { content: [{ type: 'text', text: `${body}${describeDialogs(error.dialogs)}` }], isError: true }
    }
    if (error instanceof BrowserToolError) return { content: [{ type: 'text', text: error.message }], isError: true }
    const message = error instanceof Error ? error.message : String(error)
    return { content: [{ type: 'text', text: `[browser.internal] ${message}` }], isError: true }
  }

  private assertHost() {
    if (!this.channel.isConnected()) throw new BrowserHostError('no_host', NO_HOST_MESSAGE)
  }

  private stoppedError() {
    return new BrowserHostError('stopped', '[browser.stopped] The user stopped browser control for this session.')
  }

  private assertNotStopped(sessionId: string) {
    if (this.stopped.has(sessionId)) throw this.stoppedError()
  }

  private pause(ms: number, signal: AbortSignal | undefined) {
    return new Promise<void>((resolve, reject) => {
      const cancelled = () =>
        new BrowserHostError('cancelled', '[browser.cancelled] The browser call was cancelled. Inspect the page before repeating the action.')
      if (signal?.aborted) {
        reject(cancelled())
        return
      }
      const onAbort = () => {
        clearTimeout(timer)
        reject(cancelled())
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private async pollText(ctx: OperationContext, needle: string): Promise<boolean | null> {
    try {
      return await ctx.snapshotter().hasText(needle)
    } catch (error) {
      if (!(error instanceof BrowserHostError && error.code === 'stale_document')) throw error
      await ctx.rebind()
      return null
    }
  }

  private sessionSignal(sessionId: string, signal: AbortSignal | undefined) {
    let controller = this.sessionControllers.get(sessionId)
    if (!controller) {
      controller = new AbortController()
      this.sessionControllers.set(sessionId, controller)
    }
    return signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  }

  private setActivity(sessionId: string, tabId: string, delta: 1 | -1) {
    const next = (this.activeCalls.get(sessionId) ?? 0) + delta
    if (next <= 0) this.activeCalls.delete(sessionId)
    else this.activeCalls.set(sessionId, next)
    if ((delta === 1 && next === 1) || (delta === -1 && next <= 0)) {
      this.activityListeners.forEach((listener) => listener(sessionId, tabId, next > 0))
    }
  }

  private dropClosedTabs() {
    for (const tabId of this.tabs.keys()) {
      if (!this.channel.getView(tabId)) this.tabs.delete(tabId)
    }
  }

  private tabState(tabId: string): TabState {
    let state = this.tabs.get(tabId)
    if (!state) {
      state = {
        snapshotter: null,
        generation: null,
        snapshotGeneration: null,
        consoleSince: 0,
        networkSince: 0,
        cdp: () => Promise.reject(new Error('browser operation is not running')),
        dialogs: [],
        emulation: null,
      }
      this.tabs.set(tabId, state)
    }
    return state
  }

  private snapshotterFor(state: TabState, generation: number): Snapshotter {
    if (!state.snapshotter || state.generation !== generation) {
      state.snapshotter = this.createSnapshotter((method, params) => state.cdp(method, params))
      state.generation = generation
      state.snapshotGeneration = null
    }
    return state.snapshotter
  }

  private async waitForView(tabId: string): Promise<BrowserViewInfo> {
    const existing = this.channel.getView(tabId)
    if (existing) return existing
    return new Promise<BrowserViewInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new BrowserHostError('no_view', '[browser.no_view] The browser tab did not become available in time.'))
      }, OPEN_TAB_VIEW_WAIT_MS)
      const off = this.channel.onViews(() => {
        const view = this.channel.getView(tabId)
        if (!view) return
        clearTimeout(timer)
        off()
        resolve(view)
      })
    })
  }

  private async pickView(sessionId: string, tabId: string | undefined) {
    this.assertHost()
    const views = this.channel.listViews(sessionId)
    if (tabId) {
      const view = views.find((candidate) => candidate.tabId === tabId)
      if (!view) {
        throw new BrowserToolError(
          'tab_unavailable',
          `[browser.tab_unavailable] Tab ${JSON.stringify(clip(tabId, 80))} is closed or does not belong to this session. Omit tabId to use the active tab.`,
        )
      }
      return view
    }
    const chosen = views.find((candidate) => candidate.active) ?? views[0]
    if (chosen) return chosen
    throw new BrowserToolError(
      'no_tab',
      '[browser.no_tab] This session has no browser tab. Call navigate with a URL first.',
    )
  }

  private async ensureDestinationGrant(
    sessionId: string,
    resolved: { origin: string; local: boolean },
    action: string,
    signal: AbortSignal | undefined,
  ) {
    if (resolved.local) return
    await this.grants.ensureOperation({ sessionId, origin: resolved.origin, action }, signal)
  }

  private async execute(
    sessionId: string,
    signal: AbortSignal | undefined,
    options: OperationOptions,
    body: (ctx: OperationContext) => Promise<ToolResult>,
  ): Promise<ToolResult> {
    this.assertNotStopped(sessionId)
    const view = await this.pickView(sessionId, options.tabId)
    return this.queue.run(view.tabId, async () => {
      this.assertNotStopped(sessionId)
      const operationSignal = this.sessionSignal(sessionId, signal)
      const state = this.tabState(view.tabId)
      state.dialogs = []
      this.setActivity(sessionId, view.tabId, 1)
      try {
        const collect = <T extends { dialogs: BrowserDialogRecord[] }>(response: T) => {
          state.dialogs.push(...response.dialogs)
          return response
        }
        const inspectNow = async () =>
          collect(await this.channel.request({ kind: 'inspect' }, { tabId: view.tabId, signal: operationSignal })).value
        let inspect = await inspectNow()
        if (!inspect.shown) inspect = await this.reveal(view, inspect, operationSignal, collect, inspectNow)
        const grantTargets = options.needsGrant ? grantTargetsFor(inspect) : []
        if (grantTargets.length > 0) {
          for (const target of grantTargets) {
            await this.grants.ensureOperation({ sessionId, ...target, action: options.action }, operationSignal)
          }
          const again = await inspectNow()
          if (
            again.generation !== inspect.generation ||
            again.origin !== inspect.origin ||
            (inspect.local &&
              (again.frames.length !== inspect.frames.length ||
                again.frames.some((origin, index) => origin !== inspect.frames[index])))
          ) {
            throw new BrowserToolError(
              'target_changed',
              '[browser.target_changed] The page changed while waiting for permission, so the action was not run. Take a new snapshot and ask again.',
            )
          }
          inspect = again
        }
        const cdpFor = (generation: number): CdpSend => async (method, params) =>
          collect(
            await this.channel.request(
              { kind: 'cdp', method, ...(params ? { params } : {}) },
              { tabId: view.tabId, expectGeneration: generation, signal: operationSignal },
            ),
          ).value.result
        state.cdp = cdpFor(inspect.generation)
        let current = inspect
        const ctx: OperationContext = {
          view,
          inspect: current,
          state,
          signal: operationSignal,
          request: async <K extends BrowserHostCommand['kind']>(
            command: Extract<BrowserHostCommand, { kind: K }>,
          ): Promise<BrowserHostResponse<K>> =>
            collect(await this.channel.request(command, { tabId: view.tabId, signal: operationSignal })),
          cdp: (method, params) => state.cdp(method, params),
          rebind: async () => {
            current = await inspectNow()
            state.cdp = cdpFor(current.generation)
          },
          snapshotter: () => this.snapshotterFor(state, current.generation),
        }
        const result = await body(ctx)
        const dialogNote = describeDialogs(state.dialogs)
        if (dialogNote) {
          const first = result.content[0]
          if (first && first.type === 'text') first.text += dialogNote
        }
        return result
      } finally {
        this.setActivity(sessionId, view.tabId, -1)
      }
    })
  }

  private async reveal(
    view: BrowserViewInfo,
    inspect: BrowserInspectValue,
    signal: AbortSignal,
    collect: <T extends { dialogs: BrowserDialogRecord[] }>(response: T) => T,
    inspectNow: () => Promise<BrowserInspectValue>,
  ) {
    if (!inspect.foreground) {
      throw new BrowserToolError(
        'not_shown',
        '[browser.not_shown] This session is not in the foreground, so its browser tab cannot be shown to the user. Browser actions need the user to see the page. Try again when the user is looking at this session.',
      )
    }
    const shown = collect(await this.channel.request({ kind: 'activate' }, { tabId: view.tabId, signal })).value.shown
    if (!shown) {
      throw new BrowserToolError(
        'not_shown',
        '[browser.not_shown] The browser tab could not be shown. Ask the user to open the browser panel for this session.',
      )
    }
    return inspectNow()
  }

  private assertIdsFromThisPage(ctx: OperationContext) {
    if (ctx.state.snapshotGeneration !== ctx.inspect.generation) {
      throw new BrowserToolError(
        'stale_snapshot',
        '[browser.stale_snapshot] The page navigated since your last snapshot, so earlier element ids are gone. Take a new snapshot and use the ids it returns.',
      )
    }
  }

  private async locate(ctx: OperationContext, id: number) {
    this.assertIdsFromThisPage(ctx)
    const located: LocateResult = await ctx.snapshotter().locate(id)
    if (!located.ok) {
      throw this.elementFailure(located.reason, id, located.detail, 'cannot be used', 'Take a new snapshot and choose an element from it.')
    }
    return located
  }

  private assertFocused(result: FocusResult, id: number) {
    if (!result.ok) {
      throw this.elementFailure(result.reason, id, result.detail, 'cannot take text input', 'Take a new snapshot and choose a text field.')
    }
  }

  private elementFailure(reason: string, id: number, detail: string, problem: string, advice: string) {
    const message = reason === 'gone' ? detail : `Element [${id}] ${problem}: ${detail} ${advice}`
    return new BrowserToolError(`element_${reason}`, `[browser.element_${reason}] ${message}`)
  }

  private async mouseClick(ctx: OperationContext, x: number, y: number) {
    await ctx.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await ctx.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await ctx.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  }

  private async pressChord(ctx: OperationContext, input: string) {
    const chord = parseKeyChord(input)
    if (!chord) return
    const base = {
      modifiers: chord.modifiers,
      key: chord.spec.key,
      code: chord.spec.code,
      windowsVirtualKeyCode: chord.spec.windowsVirtualKeyCode,
    }
    await ctx.cdp('Input.dispatchKeyEvent', {
      type: chord.spec.text === undefined ? 'rawKeyDown' : 'keyDown',
      ...base,
      ...(chord.spec.text === undefined ? {} : { text: chord.spec.text }),
    })
    await ctx.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  private async navigationNote(ctx: OperationContext) {
    const after = (await ctx.request({ kind: 'inspect' })).value
    if (after.generation !== ctx.inspect.generation) {
      return ` Page navigated. Element ids from before are gone; take a new snapshot.${describeAddress(after.url)}`
    }
    if (after.url !== ctx.inspect.url) {
      return ` The address changed without a page load; element ids are still valid.${describeAddress(after.url)}`
    }
    return ''
  }

  private async afterAction(ctx: OperationContext) {
    await sleep(this.settleMs)
    return this.navigationNote(ctx)
  }
}

function formatConsoleEntry(entry: BrowserConsoleEntry) {
  const where = entry.url ? ` (${clip(entry.url, URL_LIMIT)}${entry.line === undefined ? '' : `:${entry.line}`})` : ''
  return `#${entry.seq} [${entry.level}] ${clip(entry.text, CONSOLE_TEXT_LIMIT)}${where}`
}

function formatNetworkEntry(entry: BrowserNetworkEntry, includeHeaders: boolean) {
  const status = entry.failed ? `failed: ${entry.failed}` : String(entry.status ?? 'pending')
  const head = `#${entry.seq} ${entry.method} ${status} ${entry.mimeType ?? ''} ${clip(entry.url, URL_LIMIT)}`.trimEnd()
  if (!includeHeaders) return head
  const lines = [head]
  const requestHeaders = redactHeaders(entry.requestHeaders)
  const responseHeaders = redactHeaders(entry.responseHeaders)
  if (requestHeaders) lines.push(`  request headers: ${JSON.stringify(requestHeaders)}`)
  if (responseHeaders) lines.push(`  response headers: ${JSON.stringify(responseHeaders)}`)
  return lines.join('\n')
}
