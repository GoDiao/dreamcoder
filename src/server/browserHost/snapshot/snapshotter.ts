import type { BrowserPickReact } from '../protocol.js'
import { pageProgram } from './pageProgram.js'
import type { PageProgramArgs, PageProgramOp } from './pageProgram.js'
import { reactProgram } from './reactProgram.js'
import type {
  CdpSend,
  ElementLookupFailure,
  ElementLookupResult,
  ElementObjectResult,
  FocusFailure,
  FocusResult,
  LocateFailure,
  LocateResult,
  PickDescription,
  PickRect,
  ReactInfo,
  ScrollArgs,
  ScrollResult,
  SnapshotItem,
  SnapshotOptions,
  SnapshotResult,
  Snapshotter,
  StylesResult,
} from './types.js'

const WORLD_NAME = 'dreamcoder-snapshot'
const CONTEXT_GONE = /Cannot find context|Execution context was destroyed/i
const LOCATE_FAILURES: readonly string[] = ['unknown_id', 'gone', 'hidden', 'disabled', 'covered'] satisfies LocateFailure[]
const FOCUS_FAILURES: readonly string[] = ['unknown_id', 'gone', 'disabled', 'not_editable'] satisfies FocusFailure[]
const LOOKUP_FAILURES: readonly string[] = ['unknown_id', 'gone'] satisfies ElementLookupFailure[]

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function malformed(what: string): Error {
  return new Error(`Browser snapshot: unexpected ${what} from the page`)
}

function readFrameId(tree: unknown): string {
  if (isRecord(tree) && isRecord(tree.frameTree) && isRecord(tree.frameTree.frame)) {
    const id = tree.frameTree.frame.id
    if (typeof id === 'string' && id) return id
  }
  throw malformed('frame tree')
}

function readContextId(created: unknown): number {
  if (isRecord(created) && typeof created.executionContextId === 'number') return created.executionContextId
  throw malformed('isolated world response')
}

function readRemote(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) throw malformed('evaluate response')
  const details = raw.exceptionDetails
  if (isRecord(details)) {
    const exception = isRecord(details.exception) ? details.exception : null
    const description = exception && typeof exception.description === 'string' ? exception.description : null
    const text = typeof details.text === 'string' ? details.text : 'script failed'
    throw new Error(description || text)
  }
  if (!isRecord(raw.result)) throw malformed('evaluate response')
  return raw.result
}

function readEvaluated(raw: unknown): unknown {
  const remote = readRemote(raw)
  if (!('value' in remote)) throw malformed('evaluate response')
  return remote.value
}

function readItem(value: unknown): SnapshotItem {
  if (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.role === 'string' &&
    typeof value.name === 'string' &&
    typeof value.offscreen === 'boolean'
  ) {
    return { id: value.id, role: value.role, name: value.name, offscreen: value.offscreen }
  }
  throw malformed('snapshot item')
}

function readSnapshot(value: unknown, region: number | null): SnapshotResult {
  if (isRecord(value) && value.error === 'unknown_id') {
    throw new Error(`Unknown element id${region === null ? '' : ` ${region}`}. Take a new snapshot to get current ids.`)
  }
  if (isRecord(value) && value.error === 'gone') {
    throw new Error(`Element ${region} is no longer on the page. Take a new snapshot.`)
  }
  if (
    isRecord(value) &&
    typeof value.text === 'string' &&
    typeof value.baseline === 'string' &&
    typeof value.full === 'boolean' &&
    Array.isArray(value.items) &&
    typeof value.itemsDropped === 'number' &&
    typeof value.mainCharsDropped === 'number' &&
    typeof value.unreadFrames === 'number'
  ) {
    return {
      text: value.text,
      baseline: value.baseline,
      full: value.full,
      items: value.items.map(readItem),
      itemsDropped: value.itemsDropped,
      mainCharsDropped: value.mainCharsDropped,
      unreadFrames: value.unreadFrames,
    }
  }
  throw malformed('snapshot result')
}

function readLocate(value: unknown): LocateResult {
  if (isRecord(value) && value.ok === true) {
    if (
      typeof value.x === 'number' &&
      typeof value.y === 'number' &&
      typeof value.role === 'string' &&
      typeof value.name === 'string'
    ) {
      return { ok: true, x: value.x, y: value.y, role: value.role, name: value.name }
    }
  } else if (
    isRecord(value) &&
    value.ok === false &&
    typeof value.reason === 'string' &&
    LOCATE_FAILURES.includes(value.reason) &&
    typeof value.detail === 'string'
  ) {
    return { ok: false, reason: value.reason as LocateFailure, detail: value.detail }
  }
  throw malformed('locate result')
}

function readFocus(value: unknown): FocusResult {
  if (isRecord(value) && value.ok === true) return { ok: true }
  if (
    isRecord(value) &&
    value.ok === false &&
    typeof value.reason === 'string' &&
    FOCUS_FAILURES.includes(value.reason) &&
    typeof value.detail === 'string'
  ) {
    return { ok: false, reason: value.reason as FocusFailure, detail: value.detail }
  }
  throw malformed('focus result')
}

function readScroll(value: unknown): ScrollResult {
  if (isRecord(value) && value.ok === true) {
    if (
      typeof value.moved === 'number' &&
      typeof value.position === 'number' &&
      typeof value.maxPosition === 'number' &&
      typeof value.total === 'number' &&
      (value.area === null || typeof value.area === 'string')
    ) {
      return {
        ok: true,
        moved: value.moved,
        position: value.position,
        maxPosition: value.maxPosition,
        total: value.total,
        area: value.area,
      }
    }
  } else if (
    isRecord(value) &&
    value.ok === false &&
    value.reason === 'not_scrollable' &&
    typeof value.detail === 'string'
  ) {
    return { ok: false, reason: 'not_scrollable', detail: value.detail }
  }
  throw malformed('scroll result')
}

function readStyles(value: unknown): StylesResult {
  if (isRecord(value) && value.ok === true) {
    const box = value.box
    if (
      typeof value.tag === 'string' &&
      typeof value.role === 'string' &&
      typeof value.name === 'string' &&
      isRecord(box) &&
      typeof box.x === 'number' &&
      typeof box.y === 'number' &&
      typeof box.width === 'number' &&
      typeof box.height === 'number' &&
      Array.isArray(value.values) &&
      value.values.every((entry) => isRecord(entry) && typeof entry.name === 'string' && typeof entry.value === 'string') &&
      Array.isArray(value.unknown) &&
      value.unknown.every((name) => typeof name === 'string')
    ) {
      return {
        ok: true,
        tag: value.tag,
        role: value.role,
        name: value.name,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        values: (value.values as Array<{ name: string; value: string }>).map((entry) => ({ name: entry.name, value: entry.value })),
        unknown: value.unknown as string[],
      }
    }
  } else {
    const failure = readLookupFailure(value)
    if (failure) return failure
  }
  throw malformed('styles result')
}

function readLookupFailure(value: unknown): Extract<ElementLookupResult, { ok: false }> | null {
  if (
    isRecord(value) &&
    value.ok === false &&
    typeof value.reason === 'string' &&
    LOOKUP_FAILURES.includes(value.reason) &&
    typeof value.detail === 'string'
  ) {
    return { ok: false, reason: value.reason as ElementLookupFailure, detail: value.detail }
  }
  return null
}

function readLookup(value: unknown): ElementLookupResult {
  if (isRecord(value) && value.ok === true) return { ok: true }
  const failure = readLookupFailure(value)
  if (failure) return failure
  throw malformed('lookup result')
}

const MAX_PICK_TEXT = 4_000
const MAX_COMPONENT_NAME = 80
const MAX_COMPONENTS = 5
const PAINT_EXPRESSION =
  'new Promise((resolve) => { const done = () => resolve(true); setTimeout(done, 200); requestAnimationFrame(() => requestAnimationFrame(done)) })'

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, max) : undefined
}

function readRect(value: unknown): PickRect | undefined {
  if (!isRecord(value)) return undefined
  const numbers = [
    value.x,
    value.y,
    value.width,
    value.height,
    value.viewportWidth,
    value.viewportHeight,
    value.scrollX,
    value.scrollY,
    value.devicePixelRatio,
  ]
  if (!numbers.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return undefined
  return {
    x: value.x as number,
    y: value.y as number,
    width: value.width as number,
    height: value.height as number,
    viewportWidth: value.viewportWidth as number,
    viewportHeight: value.viewportHeight as number,
    scrollX: value.scrollX as number,
    scrollY: value.scrollY as number,
    devicePixelRatio: value.devicePixelRatio as number,
  }
}

function readStyleRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const styles: Record<string, string> = {}
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry === 'string') styles[name] = entry
  }
  return styles
}

function readPick(value: unknown): PickDescription {
  if (
    isRecord(value) &&
    typeof value.ref === 'string' &&
    typeof value.url === 'string' &&
    typeof value.title === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.label === 'string' &&
    typeof value.selector === 'string' &&
    typeof value.sensitive === 'boolean' &&
    typeof value.truncated === 'boolean'
  ) {
    const base = {
      ref: value.ref,
      url: value.url,
      title: value.title,
      tag: value.tag,
      label: value.label,
      selector: value.selector,
      sensitive: value.sensitive,
      truncated: value.truncated,
    }
    if (value.sensitive) return { ...base, truncated: false }
    const role = optionalString(value.role, MAX_PICK_TEXT)
    const name = optionalString(value.name, MAX_PICK_TEXT)
    const text = optionalString(value.text, MAX_PICK_TEXT)
    const href = optionalString(value.href, MAX_PICK_TEXT)
    const styles = readStyleRecord(value.styles)
    const html = optionalString(value.html, MAX_PICK_TEXT)
    const prev = optionalString(value.prev, MAX_PICK_TEXT)
    const next = optionalString(value.next, MAX_PICK_TEXT)
    const rect = readRect(value.rect)
    return {
      ...base,
      ...(role === undefined ? {} : { role }),
      ...(name === undefined ? {} : { name }),
      ...(text === undefined ? {} : { text }),
      ...(href ? { href } : {}),
      ...(styles ? { styles } : {}),
      ...(html === undefined ? {} : { html }),
      ...(prev === undefined ? {} : { prev }),
      ...(next === undefined ? {} : { next }),
      ...(rect ? { rect } : {}),
    }
  }
  throw malformed('pick result')
}

function readReact(value: unknown): ReactInfo | null {
  if (value === null) return null
  if (isRecord(value) && Array.isArray(value.components) && typeof value.truncated === 'boolean') {
    const components = value.components
      .filter((name): name is string => typeof name === 'string' && name !== '')
      .slice(0, MAX_COMPONENTS)
      .map((name) => name.slice(0, MAX_COMPONENT_NAME))
    if (components.length === 0) return null
    const react: BrowserPickReact = value.props === null || value.props === undefined ? { components } : { components, props: value.props }
    return { react, truncated: value.truncated }
  }
  throw malformed('react result')
}

function readMarks(value: unknown): number[] {
  if (isRecord(value) && Array.isArray(value.alive) && value.alive.every((id) => typeof id === 'number')) {
    return value.alive as number[]
  }
  throw malformed('marks result')
}

function readPresent(value: unknown): boolean {
  if (isRecord(value) && typeof value.present === 'boolean') return value.present
  throw malformed('text result')
}

export function createSnapshotter(cdp: CdpSend): Snapshotter {
  let world: Promise<number> | null = null

  const createWorld = async (): Promise<number> => {
    const frameId = readFrameId(await cdp('Page.getFrameTree'))
    return readContextId(await cdp('Page.createIsolatedWorld', { frameId, worldName: WORLD_NAME }))
  }

  const ensureWorld = (): Promise<number> => {
    if (!world) {
      const pending = createWorld()
      world = pending
      pending.catch(() => {
        if (world === pending) world = null
      })
    }
    return world
  }

  const evaluateOnce = async (op: PageProgramOp, args: PageProgramArgs, byValue: boolean): Promise<unknown> => {
    const contextId = await ensureWorld()
    const expression = `(${pageProgram.toString()})(${JSON.stringify(op)}, ${JSON.stringify(args)})`
    return cdp('Runtime.evaluate', { expression, contextId, returnByValue: byValue })
  }

  const send = async (op: PageProgramOp, args: PageProgramArgs, byValue: boolean): Promise<unknown> => {
    const attempt = async () => {
      const raw = await evaluateOnce(op, args, byValue)
      readRemote(raw)
      return raw
    }
    try {
      return await attempt()
    } catch (error) {
      if (!(error instanceof Error) || !CONTEXT_GONE.test(error.message)) throw error
      world = null
      return attempt()
    }
  }

  const run = async (op: PageProgramOp, args: PageProgramArgs): Promise<unknown> =>
    readEvaluated(await send(op, args, true))

  const callOnNode = async (backendNodeId: number, inIsolatedWorld: boolean, functionDeclaration: string): Promise<unknown> => {
    const attempt = async () => {
      const resolved = await cdp('DOM.resolveNode', {
        backendNodeId,
        ...(inIsolatedWorld ? { executionContextId: await ensureWorld() } : {}),
      })
      const object = isRecord(resolved) && isRecord(resolved.object) ? resolved.object : null
      if (!object || typeof object.objectId !== 'string') throw malformed('node resolution')
      const objectId = object.objectId
      try {
        return readEvaluated(await cdp('Runtime.callFunctionOn', { objectId, functionDeclaration, returnByValue: true }))
      } finally {
        await cdp('Runtime.releaseObject', { objectId }).catch(() => undefined)
      }
    }
    try {
      return await attempt()
    } catch (error) {
      if (!inIsolatedWorld || !(error instanceof Error) || !CONTEXT_GONE.test(error.message)) throw error
      world = null
      return attempt()
    }
  }

  return {
    async snapshot(options: SnapshotOptions) {
      return readSnapshot(await run('snapshot', options), options.region)
    },
    async scroll(args: ScrollArgs) {
      return readScroll(await run('scroll', args))
    },
    async locate(id: number) {
      return readLocate(await run('locate', { id }))
    },
    async focus(id: number, clear: boolean) {
      return readFocus(await run('focus', { id, clear }))
    },
    async hasText(text: string) {
      return readPresent(await run('hasText', { text }))
    },
    async styles(id: number, properties: string[] | null) {
      return readStyles(await run('styles', { id, properties }))
    },
    async pick(backendNodeId: number) {
      const declaration = `function () { return (${pageProgram.toString()})("pick", {}, this) }`
      return readPick(await callOnNode(backendNodeId, true, declaration))
    },
    async reactInfo(backendNodeId: number) {
      return readReact(await callOnNode(backendNodeId, false, reactProgram.toString()))
    },
    async marks(ids: number[]) {
      return readMarks(await run('marks', { ids }))
    },
    async setMarksHidden(hidden: boolean) {
      await run('marksHidden', { hidden })
    },
    async waitForPaint() {
      const contextId = await ensureWorld()
      await cdp('Runtime.evaluate', { expression: PAINT_EXPRESSION, contextId, awaitPromise: true, returnByValue: true })
    },
    async elementObject(id: number): Promise<ElementObjectResult> {
      const remote = readRemote(await send('element', { id }, false))
      if (remote.subtype === 'node' && typeof remote.objectId === 'string') return { ok: true, objectId: remote.objectId }
      const lookup = readLookup(await run('lookup', { id }))
      if (!lookup.ok) return lookup
      return { ok: false, reason: 'gone', detail: `Element ${id} is no longer on the page. Take a new snapshot.` }
    },
  }
}
