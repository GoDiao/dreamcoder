import type {
  ElementLookupResult,
  FocusResult,
  LocateResult,
  PickDescription,
  ScrollArgs,
  ScrollResult,
  SnapshotOptions,
  SnapshotResult,
  StylesResult,
} from './types.js'

export type PageProgramOp =
  | 'snapshot'
  | 'locate'
  | 'focus'
  | 'scroll'
  | 'hasText'
  | 'styles'
  | 'lookup'
  | 'element'
  | 'pick'
  | 'marks'
  | 'marksHidden'
export type PageLocateArgs = { id: number }
export type PagePickArgs = Record<string, never>
export type PageMarksArgs = { ids: number[] }
export type PageMarksHiddenArgs = { hidden: boolean }
export type PageMarksResult = { alive: number[] }
export type PageMarksHiddenResult = { ok: true }
export type PageFocusArgs = { id: number; clear: boolean }
export type PageTextArgs = { text: string }
export type PageStylesArgs = { id: number; properties: string[] | null }
export type PageProgramArgs =
  | SnapshotOptions
  | PageLocateArgs
  | PageFocusArgs
  | ScrollArgs
  | PageTextArgs
  | PageStylesArgs
  | PagePickArgs
  | PageMarksArgs
  | PageMarksHiddenArgs
export type PageSnapshotResult = SnapshotResult | { error: 'unknown_id' | 'gone' }
export type PageTextResult = { present: boolean }
export type PageProgramResult =
  | PageSnapshotResult
  | LocateResult
  | FocusResult
  | ScrollResult
  | PageTextResult
  | StylesResult
  | ElementLookupResult
  | PickDescription
  | PageMarksResult
  | PageMarksHiddenResult
  | Element
  | null

export function pageProgram(op: 'snapshot', args: SnapshotOptions): PageSnapshotResult
export function pageProgram(op: 'locate', args: PageLocateArgs): LocateResult
export function pageProgram(op: 'focus', args: PageFocusArgs): FocusResult
export function pageProgram(op: 'scroll', args: ScrollArgs): ScrollResult
export function pageProgram(op: 'hasText', args: PageTextArgs): PageTextResult
export function pageProgram(op: 'styles', args: PageStylesArgs): StylesResult
export function pageProgram(op: 'lookup', args: PageLocateArgs): ElementLookupResult
export function pageProgram(op: 'element', args: PageLocateArgs): Element | null
export function pageProgram(op: 'pick', args: PagePickArgs, target: Element): PickDescription
export function pageProgram(op: 'marks', args: PageMarksArgs): PageMarksResult
export function pageProgram(op: 'marksHidden', args: PageMarksHiddenArgs): PageMarksHiddenResult
export function pageProgram(op: PageProgramOp, args: PageProgramArgs, target?: Element): PageProgramResult {
  type Box = { l: number; t: number; r: number; b: number }
  type Placement = { x: number; y: number; sx: number; sy: number }
  type Style = {
    display: string
    visibility: string
    opacity: string
    overflowX: string
    overflowY: string
    position: string
  }
  type Info = { blocked: boolean; dialog: boolean }
  type State = {
    next: number
    ids: WeakMap<Element, number>
    refs: Map<number, WeakRef<Element>>
    baseline: string | null
    lastLines: Map<number, string>
    lastText: string
    lastRegion: number | null
    marks?: Marks | null
  }
  type MarkBox = { el: Element; box: HTMLElement; chip: HTMLElement }
  type Marks = { host: HTMLElement; entries: Map<number, MarkBox>; stop: () => void }
  type Entry = { id: number; line: string; role: string; name: string; offscreen: boolean; win: Window }
  type Ranked = { el: Element; index: number; dialog: boolean; visible: boolean; rank: number }
  type TextPiece = { owner: Element; value: string }
  type Match = { text: string; at: number; block: Element }
  type TreeRoot = Document | ShadowRoot

  const STATE_KEY = '__dreamcoderSnapshotState'
  const MAX_EXAMINED = 5000
  const MAX_FRAME_DEPTH = 6
  const NAME_MAX = 80
  const VALUE_MAX = 60
  const MASK = '••••'
  const FIND_MAX_MATCHES = 20
  const FIND_MAX_ELEMENTS = 8
  const FIND_MAX_EXTRA_IDS = 30
  const FIND_BLOCK_CHARS = 600
  const FIND_FOLLOW_CHARS = 600
  const FIND_FOLLOW_TOTAL = 6000
  const SKIPPED_TEXT_TAGS = ['script', 'style', 'noscript', 'template']
  const SCROLL_ROOM_MIN = 1
  const SCROLL_DEFAULT_FRACTION = 0.8
  const STYLE_VALUE_MAX = 200
  const PICK_TEXT_MAX = 160
  const PICK_HTML_MAX = 2000
  const PICK_SIBLING_MAX = 300
  const PICK_LABEL_MAX = 60
  const PICK_SCAN_MAX = 20000
  const PICK_STYLE_PROPERTIES = [
    'display',
    'position',
    'flex-direction',
    'justify-content',
    'align-items',
    'width',
    'height',
    'padding',
    'margin',
    'background-color',
    'color',
    'font-size',
    'font-weight',
    'border-radius',
    'border-width',
    'border-style',
    'border-color',
  ]
  const MARK_COLOR = '#f97316'
  const MARK_REFRESH_MS = 100
  const MARK_PAD = 2
  const MARK_CHIP_HEIGHT = 18
  const DEFAULT_STYLE_PROPERTIES = [
    'display',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'z-index',
    'width',
    'height',
    'box-sizing',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'border-top-style',
    'border-top-color',
    'border-top-left-radius',
    'overflow-x',
    'overflow-y',
    'visibility',
    'opacity',
    'color',
    'background-color',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'line-height',
    'text-align',
    'text-decoration-line',
    'flex-direction',
    'flex-wrap',
    'justify-content',
    'align-items',
    'grid-template-columns',
    'grid-template-rows',
    'row-gap',
    'column-gap',
    'cursor',
    'pointer-events',
  ]
  const WIDGET_ROLES = [
    'button',
    'link',
    'checkbox',
    'radio',
    'tab',
    'menuitem',
    'switch',
    'combobox',
    'option',
    'textbox',
    'slider',
  ]
  const CANDIDATE_SELECTOR = [
    'a[href]',
    'button',
    'input:not([type=hidden])',
    'select',
    'textarea',
    'summary',
    ...WIDGET_ROLES.map((role) => '[role=' + role + ']'),
    '[contenteditable=""]',
    '[contenteditable=true]',
    '[contenteditable=plaintext-only]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')
  const DIALOG_SELECTOR = '[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open]'
  const BUTTON_INPUTS = ['button', 'submit', 'reset', 'image', 'file', 'color']
  const NON_TEXT_INPUTS = ['checkbox', 'radio', 'range', 'hidden', ...BUTTON_INPUTS]
  const NO_VALUE_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file']
  const INFINITE: Box = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity }
  const viewport: Box = { l: 0, t: 0, r: window.innerWidth, b: window.innerHeight }

  const host = globalThis as unknown as Record<string, State | undefined>
  const stateOf = (): State => {
    let existing = host[STATE_KEY]
    if (!existing) {
      existing = {
        next: 1,
        ids: new WeakMap(),
        refs: new Map(),
        baseline: null,
        lastLines: new Map(),
        lastText: '',
        lastRegion: null,
      }
      host[STATE_KEY] = existing
    }
    return existing
  }
  const state = stateOf()

  const caches = {
    styles: new Map<Element, Style>(),
    infos: new Map<Element, Info>(),
    clips: new Map<Element, Box>(),
    placements: new Map<Window, Placement>(),
    hidden: new Map<Element, boolean>(),
    blocks: new Map<Element, Element>(),
  }
  const resetCaches = () => {
    caches.styles.clear()
    caches.infos.clear()
    caches.clips.clear()
    caches.placements.clear()
    caches.hidden.clear()
    caches.blocks.clear()
  }

  const clean = (text: string, max: number): string => text.replace(/\s+/g, ' ').trim().slice(0, max)
  const textOf = (el: Element): string => {
    const text = (el as HTMLElement).innerText
    return typeof text === 'string' ? text : el.textContent || ''
  }
  const winOf = (node: Element): Window => node.ownerDocument.defaultView as Window
  const inputType = (el: Element): string => ((el as HTMLInputElement).type || 'text').toLowerCase()

  const parentOf = (node: Element): Element | null => {
    const slot = node.assignedSlot
    if (slot) return slot
    const parent = node.parentNode
    if (!parent) return null
    if (parent.nodeType === 1) return parent as Element
    if (parent.nodeType === 11) return (parent as ShadowRoot).host || null
    if (parent.nodeType === 9) {
      const view = (parent as Document).defaultView
      return view ? view.frameElement : null
    }
    return null
  }
  const isAncestorOrSelf = (ancestor: Element, node: Element): boolean => {
    let current: Element | null = node
    while (current) {
      if (current === ancestor) return true
      current = parentOf(current)
    }
    return false
  }
  const climb = <T>(memo: Map<Element, T>, node: Element, combine: (n: Element, parentValue: T | undefined) => T): T => {
    const chain: Element[] = []
    let current: Element | null = node
    while (current && !memo.has(current)) {
      chain.push(current)
      current = parentOf(current)
    }
    let value = current ? memo.get(current) : undefined
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const link = chain[i] as Element
      value = combine(link, value)
      memo.set(link, value)
    }
    return value as T
  }

  const styleOf = (node: Element): Style => {
    let cached = caches.styles.get(node)
    if (!cached) {
      const computed = winOf(node).getComputedStyle(node)
      cached = {
        display: computed.display || '',
        visibility: computed.visibility || '',
        opacity: computed.opacity || '',
        overflowX: computed.overflowX || computed.overflow || '',
        overflowY: computed.overflowY || computed.overflow || '',
        position: computed.position || '',
      }
      caches.styles.set(node, cached)
    }
    return cached
  }
  const infoAt = (node: Element): Info =>
    climb(caches.infos, node, (n, parentInfo) => {
      const style = styleOf(n)
      const own =
        n.getAttribute('aria-hidden') === 'true' ||
        n.hasAttribute('inert') ||
        style.display === 'none' ||
        Number.parseFloat(style.opacity) === 0
      return {
        blocked: Boolean(parentInfo && parentInfo.blocked) || own,
        dialog: Boolean(parentInfo && parentInfo.dialog) || n.matches(DIALOG_SELECTOR),
      }
    })

  const placementOf = (win: Window): Placement => {
    const cached = caches.placements.get(win)
    if (cached) return cached
    const frame = win.frameElement
    let placement: Placement = { x: 0, y: 0, sx: 1, sy: 1 }
    if (frame) {
      const outer = placementOf(winOf(frame))
      const rect = frame.getBoundingClientRect()
      const layoutWidth = (frame as HTMLElement).offsetWidth
      const layoutHeight = (frame as HTMLElement).offsetHeight
      const scaleX = layoutWidth > 0 && rect.width > 0 ? rect.width / layoutWidth : 1
      const scaleY = layoutHeight > 0 && rect.height > 0 ? rect.height / layoutHeight : 1
      placement = {
        x: outer.x + outer.sx * (rect.left + frame.clientLeft * scaleX),
        y: outer.y + outer.sy * (rect.top + frame.clientTop * scaleY),
        sx: outer.sx * scaleX,
        sy: outer.sy * scaleY,
      }
    }
    caches.placements.set(win, placement)
    return placement
  }
  const toTop = (win: Window, rect: { left: number; top: number; right: number; bottom: number }): Box => {
    const at = placementOf(win)
    return {
      l: at.x + rect.left * at.sx,
      t: at.y + rect.top * at.sy,
      r: at.x + rect.right * at.sx,
      b: at.y + rect.bottom * at.sy,
    }
  }
  const topRect = (el: Element): Box => toTop(winOf(el), el.getBoundingClientRect())
  const intersect = (a: Box, b: Box): Box => ({
    l: Math.max(a.l, b.l),
    t: Math.max(a.t, b.t),
    r: Math.min(a.r, b.r),
    b: Math.min(a.b, b.b),
  })
  const isClipper = (node: Element): boolean => {
    if (node.localName === 'iframe' || node.localName === 'frame') return true
    if (node.localName === 'html' || node.localName === 'body') return false
    const style = styleOf(node)
    const clips = (value: string) => value !== '' && value !== 'visible'
    return clips(style.overflowX) || clips(style.overflowY)
  }
  const clipAt = (node: Element): Box =>
    climb(caches.clips, node, (n, parentBox) => {
      const base = parentBox || INFINITE
      return isClipper(n) ? intersect(base, topRect(n)) : base
    })
  const limitOf = (el: Element): Box => {
    const parent = parentOf(el)
    let box = INFINITE
    if (styleOf(el).position === 'fixed') {
      const frame = winOf(el).frameElement
      box = frame ? clipAt(frame) : INFINITE
    } else if (parent) {
      box = clipAt(parent)
    }
    return intersect(box, viewport)
  }
  const inView = (el: Element): boolean => {
    const rect = topRect(el)
    const limit = limitOf(el)
    return rect.r > limit.l && rect.l < limit.r && rect.b > limit.t && rect.t < limit.b
  }
  const isShown = (el: Element): boolean => {
    if (el.getClientRects().length === 0) return false
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    if (infoAt(el).blocked) return false
    const visibility = styleOf(el).visibility
    return visibility !== 'hidden' && visibility !== 'collapse'
  }

  const explicitRole = (el: Element): string => {
    const value = (el.getAttribute('role') || '').trim().toLowerCase()
    return value.split(/\s+/)[0] || ''
  }
  const isEditableHost = (el: Element): boolean => {
    const value = el.getAttribute('contenteditable')
    return value === '' || value === 'true' || value === 'plaintext-only'
  }
  const roleOf = (el: Element): string => {
    const explicit = explicitRole(el)
    if (explicit) return explicit
    const tag = el.localName
    if (tag === 'a') return 'link'
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      const type = inputType(el)
      if (type === 'checkbox' || type === 'radio') return type
      if (type === 'range') return 'slider'
      if (BUTTON_INPUTS.includes(type)) return 'button'
      return 'textbox'
    }
    if (isEditableHost(el)) return 'textbox'
    return 'generic'
  }
  const isSensitive = (el: Element): boolean => {
    const tag = el.localName
    if (tag === 'input' && inputType(el) === 'password') return true
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false
    return /(^|\s)cc-/i.test(el.getAttribute('autocomplete') || '')
  }
  const isDisabled = (el: Element): boolean =>
    el.hasAttribute('disabled') || el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true'
  const selectedText = (el: Element): string => {
    const select = el as HTMLSelectElement
    const option = select.options[select.selectedIndex]
    return option ? clean(option.text, NAME_MAX) : ''
  }

  const nameOf = (el: Element, readText: (node: Element) => string = textOf): string => {
    const labelledby = el.getAttribute('aria-labelledby')
    if (labelledby) {
      const root = el.getRootNode() as TreeRoot
      const parts = labelledby
        .trim()
        .split(/\s+/)
        .map((refId) => {
          const ref = root.getElementById(refId)
          return ref ? ref.getAttribute('aria-label') || textOf(ref) : ''
        })
      const joined = clean(parts.join(' '), NAME_MAX)
      if (joined) return joined
    }
    const aria = clean(el.getAttribute('aria-label') || '', NAME_MAX)
    if (aria) return aria
    const labels = (el as HTMLInputElement).labels
    if (labels && labels.length > 0) {
      const labelText = clean(Array.from(labels, (label) => textOf(label)).join(' '), NAME_MAX)
      if (labelText) return labelText
    }
    const alt = clean(el.getAttribute('alt') || '', NAME_MAX)
    if (alt) return alt
    const placeholder = clean(el.getAttribute('placeholder') || '', NAME_MAX)
    if (placeholder) return placeholder
    const tag = el.localName
    const isField = tag === 'input' || tag === 'textarea' || tag === 'select'
    if (tag === 'select' && !isSensitive(el)) {
      const option = selectedText(el)
      if (option) return option
    }
    if (tag === 'input') {
      const type = inputType(el)
      if (type === 'button' || type === 'submit' || type === 'reset') {
        const value = clean((el as HTMLInputElement).value, NAME_MAX)
        if (value) return value
      }
    }
    if (!isField) {
      const text = clean(readText(el), NAME_MAX)
      if (text) return text
      const image = el.querySelector('img[alt]')
      const imageAlt = image ? clean(image.getAttribute('alt') || '', NAME_MAX) : ''
      if (imageAlt) return imageAlt
    }
    return clean(el.getAttribute('title') || '', NAME_MAX)
  }

  const valueOf = (el: Element, name: string): string => {
    const tag = el.localName
    let raw = ''
    if (tag === 'textarea') raw = (el as HTMLTextAreaElement).value
    else if (tag === 'input' && !NO_VALUE_INPUTS.includes(inputType(el))) raw = (el as HTMLInputElement).value
    else if (tag === 'select') raw = selectedText(el)
    if (!raw) return ''
    if (isSensitive(el)) return MASK
    const value = clean(raw, VALUE_MAX)
    return tag === 'select' && value === name ? '' : value
  }
  const flagsOf = (el: Element): string[] => {
    const flags: string[] = []
    const tag = el.localName
    const type = tag === 'input' ? inputType(el) : ''
    const checkable = type === 'checkbox' || type === 'radio'
    if (checkable ? (el as HTMLInputElement).checked : el.getAttribute('aria-checked') === 'true') flags.push('checked')
    if (isDisabled(el)) flags.push('disabled')
    const detailsOpen = tag === 'summary' && Boolean(el.parentElement && el.parentElement.hasAttribute('open'))
    if (el.getAttribute('aria-expanded') === 'true' || detailsOpen) flags.push('expanded')
    if (el.getAttribute('aria-selected') === 'true' || (tag === 'option' && (el as HTMLOptionElement).selected)) {
      flags.push('selected')
    }
    if (el.hasAttribute('required') || el.getAttribute('aria-required') === 'true') flags.push('required')
    return flags
  }

  const idFor = (el: Element): number => {
    let id = state.ids.get(el)
    if (id === undefined) {
      id = state.next
      state.next += 1
      state.ids.set(el, id)
    }
    if (!state.refs.has(id)) state.refs.set(id, new WeakRef(el))
    return id
  }
  const lookup = (id: number): { kind: 'unknown' } | { kind: 'gone' } | { kind: 'ok'; el: Element } => {
    if (!Number.isInteger(id) || id < 1 || id >= state.next) return { kind: 'unknown' }
    const ref = state.refs.get(id)
    const el = ref ? ref.deref() : undefined
    if (!el || !el.isConnected) return { kind: 'gone' }
    return { kind: 'ok', el }
  }
  const lookupFailure = (id: number, kind: 'unknown' | 'gone') =>
    kind === 'unknown'
      ? { ok: false as const, reason: 'unknown_id' as const, detail: 'No element has this id. Take a new snapshot to get current ids.' }
      : { ok: false as const, reason: 'gone' as const, detail: 'Element ' + id + ' is no longer on the page. Take a new snapshot.' }
  const describe = (el: Element): string => {
    const role = roleOf(el)
    const label = role === 'generic' ? el.localName : role
    const name = clean(nameOf(el) || textOf(el), NAME_MAX)
    return name ? label + ' ' + JSON.stringify(name) : label
  }

  const textHidden = (el: Element): boolean => {
    const inherited = climb(caches.hidden, el, (n, parentHidden) => Boolean(parentHidden) || styleOf(n).display === 'none')
    if (inherited) return true
    const visibility = styleOf(el).visibility
    return visibility === 'hidden' || visibility === 'collapse'
  }
  const isBlockElement = (el: Element): boolean => {
    const display = styleOf(el).display
    return display !== '' && display !== 'contents' && !display.startsWith('inline')
  }
  const blockOf = (el: Element): Element =>
    climb(caches.blocks, el, (n, parentBlock) => (isBlockElement(n) || !parentBlock ? n : parentBlock))
  const collectPieces = (root: Node, pieces: TextPiece[]): void => {
    const own = (root as Element).shadowRoot
    if (own) collectPieces(own, pieces)
    const walker = (root.ownerDocument || (root as Document)).createTreeWalker(root, 5)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 3) {
        const parent = node.parentNode as Node
        const owner = parent.nodeType === 1 ? (parent as Element) : parent.nodeType === 11 ? (parent as ShadowRoot).host : null
        if (owner) pieces.push({ owner, value: node.nodeValue || '' })
      } else {
        const el = node as Element
        if (el.localName === 'br' && el.parentElement) pieces.push({ owner: el.parentElement, value: ' ' })
        if (el.shadowRoot) collectPieces(el.shadowRoot, pieces)
      }
    }
  }
  const visibleGroups = (root: Element, extraSkipped: string[] = []): Map<Element, string[]> => {
    const pieces: TextPiece[] = []
    collectPieces(root, pieces)
    const groups = new Map<Element, string[]>()
    for (const piece of pieces) {
      if (SKIPPED_TEXT_TAGS.includes(piece.owner.localName) || extraSkipped.includes(piece.owner.localName)) continue
      if (textHidden(piece.owner)) continue
      const block = blockOf(piece.owner)
      const group = groups.get(block)
      if (group) group.push(piece.value)
      else groups.set(block, [piece.value])
    }
    return groups
  }
  const findMatches = (root: Element, needle: string): { matches: Match[]; total: number } => {
    const matches: Match[] = []
    let total = 0
    for (const [block, parts] of visibleGroups(root)) {
      const text = clean(parts.join(''), Infinity)
      const at = text.toLowerCase().indexOf(needle)
      if (at < 0) continue
      total += 1
      if (matches.length < FIND_MAX_MATCHES) matches.push({ text, at, block })
    }
    return { matches, total }
  }
  const excerpt = (match: Match, length: number): string => {
    if (match.text.length <= FIND_BLOCK_CHARS) return match.text
    const centred = match.at - Math.floor((FIND_BLOCK_CHARS - length) / 2)
    const start = Math.max(0, Math.min(centred, match.text.length - FIND_BLOCK_CHARS))
    const end = start + FIND_BLOCK_CHARS
    return (start > 0 ? '…' : '') + match.text.slice(start, end) + (end < match.text.length ? '…' : '')
  }

  const runSnapshot = (options: SnapshotOptions): PageSnapshotResult => {
    for (const [id, ref] of state.refs) {
      const known = ref.deref()
      if (!known || !known.isConnected) state.refs.delete(id)
    }

    let regionEl: Element | null = null
    if (options.region !== null) {
      const found = lookup(options.region)
      if (found.kind !== 'ok') return { error: found.kind === 'unknown' ? 'unknown_id' : 'gone' }
      regionEl = found.el
    }

    const candidates: Element[] = []
    const dialogs: Element[] = []
    let examined = 0
    let capped = false
    let unreadFrames = 0

    const scan = (root: Document | ShadowRoot | Element, depth: number): void => {
      const candidateSet = new Set<Element>(root.querySelectorAll(CANDIDATE_SELECTOR))
      const dialogSet = new Set<Element>(root.querySelectorAll(DIALOG_SELECTOR))
      const all: Element[] = Array.from(root.querySelectorAll('*'))
      if (root.nodeType === 1) {
        const self = root as Element
        all.unshift(self)
        if (self.matches(CANDIDATE_SELECTOR)) candidateSet.add(self)
        if (self.matches(DIALOG_SELECTOR)) dialogSet.add(self)
      }
      for (const el of all) {
        if (capped) return
        if (candidateSet.has(el)) {
          if (examined >= MAX_EXAMINED) {
            capped = true
            return
          }
          examined += 1
          if (isShown(el)) candidates.push(el)
        }
        if (dialogSet.has(el) && isShown(el)) dialogs.push(el)
        if (el.shadowRoot) scan(el.shadowRoot, depth)
        if (el.localName === 'iframe' || el.localName === 'frame') {
          const frameDoc = (el as HTMLIFrameElement).contentDocument
          if (frameDoc && frameDoc.documentElement && depth < MAX_FRAME_DEPTH) scan(frameDoc, depth + 1)
          else if (!frameDoc && el.getClientRects().length > 0) unreadFrames += 1
        }
      }
    }
    scan(regionEl || document, 0)

    const ranked: Ranked[] = candidates
      .map((el, index) => {
        const dialog = infoAt(el).dialog
        const visible = inView(el)
        return { el, index, dialog, visible, rank: dialog ? 0 : visible ? 1 : 2 }
      })
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
    const frameOrder: Window[] = []
    const byFrame = new Map<Window, Ranked[]>()
    for (const el of candidates) {
      const win = winOf(el)
      if (!byFrame.has(win)) {
        byFrame.set(win, [])
        frameOrder.push(win)
      }
    }
    for (const entry of ranked) (byFrame.get(winOf(entry.el)) as Ranked[]).push(entry)
    const selected = new Set<Ranked>()
    let room = Math.max(0, options.maxItems)
    for (const rank of [0, 1, 2]) {
      const pools = frameOrder.map((win) => (byFrame.get(win) as Ranked[]).filter((entry) => entry.rank === rank))
      const taken = pools.map(() => 0)
      let open = pools.map((_, index) => index).filter((index) => (pools[index] as Ranked[]).length > 0)
      while (room > 0 && open.length > 0) {
        const each = Math.floor(room / open.length)
        const grants = each > 0 ? each : 1
        const still: number[] = []
        for (const index of open) {
          if (room <= 0) break
          const give = Math.min(grants, (pools[index] as Ranked[]).length - (taken[index] as number), room)
          taken[index] = (taken[index] as number) + give
          room -= give
          if ((taken[index] as number) < (pools[index] as Ranked[]).length) still.push(index)
        }
        open = each > 0 ? still : []
      }
      pools.forEach((pool, index) => {
        for (const entry of pool.slice(0, taken[index])) selected.add(entry)
      })
    }
    const kept = ranked.filter((entry) => selected.has(entry))

    const query = options.find === null ? null : clean(options.find, Infinity)
    const needle = query === null ? null : query.toLowerCase()
    const readFrom = needle === null ? Math.max(0, Math.floor(options.textFrom)) : 0
    const special = needle !== null || readFrom > 0

    const regionFrameDoc =
      regionEl && (regionEl.localName === 'iframe' || regionEl.localName === 'frame')
        ? (regionEl as HTMLIFrameElement).contentDocument
        : null
    const textRoot = regionFrameDoc
      ? regionFrameDoc.querySelector('main,[role=main]') || regionFrameDoc.body
      : regionEl || document.querySelector('main,[role=main]') || document.body
    const rawText = textRoot ? clean(textOf(textRoot), Infinity) : ''
    const found =
      needle !== null && textRoot && rawText.toLowerCase().includes(needle)
        ? findMatches(textRoot, needle)
        : { matches: [] as Match[], total: 0 }

    const keptSet = new Set(kept.map((entry) => entry.el))
    const rankedBy = new Map(ranked.map((entry) => [entry.el, entry]))
    const shownCandidates = new Set(candidates)
    const extra: Ranked[] = []
    let unlisted = 0
    const matchElements = found.matches.map(({ block }) => {
      const inside = candidates.filter((el) => isAncestorOrSelf(block, el))
      let outer = parentOf(block)
      while (outer && !shownCandidates.has(outer)) outer = parentOf(outer)
      const all = outer ? [outer, ...inside] : inside
      unlisted += Math.max(0, all.length - FIND_MAX_ELEMENTS)
      return all.slice(0, FIND_MAX_ELEMENTS).filter((el) => {
        if (keptSet.has(el)) return true
        if (extra.length >= FIND_MAX_EXTRA_IDS) {
          unlisted += 1
          return false
        }
        extra.push(rankedBy.get(el) as Ranked)
        keptSet.add(el)
        return true
      })
    })
    const shown = [...kept, ...extra]
    const itemsDropped = ranked.length - shown.length

    const entries: Entry[] = shown.map(({ el, visible }) => {
      const id = idFor(el)
      const role = roleOf(el)
      const name = nameOf(el)
      const value = valueOf(el, name)
      const flags = flagsOf(el)
      if (!visible) flags.push('offscreen')
      const line =
        '[' +
        id +
        '] ' +
        role +
        ' ' +
        JSON.stringify(name) +
        (value ? ' value=' + JSON.stringify(value) : '') +
        (flags.length > 0 ? ' ' + flags.join(' ') : '')
      return { id, line, role, name, offscreen: !visible, win: winOf(el) }
    })

    const framed = frameOrder.some((win) => win.frameElement)
    const omittedIn = (win: Window): number =>
      (byFrame.get(win) as Ranked[]).length - entries.filter((entry) => entry.win === win).length
    const originOf = (frameEl: Element, win: Window): string => {
      const url = win.document.URL
      if (url === 'about:srcdoc' || frameEl.hasAttribute('srcdoc')) return 'srcdoc'
      const scheme = url.slice(0, Math.max(0, url.indexOf(':')))
      if (scheme === 'data' || scheme === 'blob') return scheme
      if (scheme === 'about') return url
      const origin = win.location.origin
      return origin && origin !== 'null' ? origin : scheme
    }
    const frameHeader = (win: Window): string => {
      const frameEl = win.frameElement as Element
      const owner = winOf(frameEl)
      const title = clean(frameEl.getAttribute('title') || frameEl.getAttribute('name') || '', NAME_MAX)
      return (
        '--- iframe [' +
        idFor(frameEl) +
        ']' +
        (title ? ' ' + JSON.stringify(title) : '') +
        ' | inside ' +
        (owner.frameElement ? 'iframe [' + idFor(owner.frameElement) + ']' : 'page') +
        ' | origin ' +
        originOf(frameEl, win) +
        ' ---'
      )
    }
    const listEntries = (list: Entry[], withOmitted: boolean): string[] => {
      if (!framed) return list.map((entry) => entry.line)
      const lines: string[] = []
      for (const win of frameOrder) {
        const own = list.filter((entry) => entry.win === win)
        const omitted = withOmitted ? omittedIn(win) : 0
        if (own.length === 0 && omitted === 0) continue
        if (win.frameElement) lines.push(frameHeader(win))
        for (const entry of own) lines.push(entry.line)
        if (omitted > 0) {
          lines.push(
            win.frameElement
              ? '(+' + omitted + ' more interactive elements in this frame not shown; pass region=' + idFor(win.frameElement) + ' to read only this frame)'
              : '(+' + omitted + ' more interactive elements in the page itself not shown)',
          )
        }
      }
      return lines
    }

    let mainText = rawText
    const dialog = regionEl ? undefined : dialogs[dialogs.length - 1]
    const dialogText = dialog ? clean(textOf(dialog), Infinity) : ''
    let detachedDialog: Element | null = null
    if (dialogText) {
      const at = mainText.indexOf(dialogText)
      if (at >= 0) {
        mainText = clean(mainText.slice(0, at) + ' ' + mainText.slice(at + dialogText.length), Infinity)
        detachedDialog = dialog as Element
      }
    }
    let budget = Math.max(0, options.mainChars)
    const from = Math.min(readFrom, mainText.length)
    const dialogShown = from > 0 ? '' : dialogText.slice(0, budget)
    budget -= dialogShown.length
    const mainShown = mainText.slice(from, from + budget)
    const next = from + mainShown.length
    const dialogDropped = from > 0 ? 0 : dialogText.length - dialogShown.length
    const mainCharsDropped = needle !== null ? 0 : dialogDropped + (mainText.length - next)
    const skipNote =
      readFrom === 0 || needle !== null
        ? []
        : [
            readFrom > mainText.length
              ? '(textFrom ' + readFrom + ' is past the end of the page text, which has ' + mainText.length + ' characters)'
              : '(the first ' + readFrom + ' of ' + mainText.length + ' characters of page text were skipped)',
          ]
    const pageLines = [...skipNote, ...(dialogShown ? ['Dialog: ' + dialogShown] : []), ...(mainShown ? [mainShown] : [])]
    const pageText = pageLines.join('\n')

    const baseline = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8)
    const full = !(
      options.delta &&
      !special &&
      state.baseline !== null &&
      options.baseline === state.baseline &&
      state.lastRegion === options.region
    )
    const header = [
      'URL: ' + location.href,
      'Title: ' + document.title,
      'Snapshot: ' + baseline + (full ? ' full' : ' delta'),
      ...(options.region !== null ? ['Region: [' + options.region + ']'] : []),
    ]
    const shownText = pageLines.length > 0 ? pageLines : ['(empty)']
    let cursor = 0
    let followLeft = FIND_FOLLOW_TOTAL
    let followWithheld = 0
    const placements = found.matches.map((match) => {
      if (detachedDialog && isAncestorOrSelf(detachedDialog, match.block)) return { at: -1, follow: '' }
      const at = mainText.indexOf(match.text, cursor)
      if (at < 0) return { at, follow: '' }
      const end = at + match.text.length
      cursor = end
      const start = mainText.charAt(end) === ' ' ? end + 1 : end
      const rest = mainText.slice(start, start + FIND_FOLLOW_CHARS + 1)
      const follow = rest.length > FIND_FOLLOW_CHARS ? rest.slice(0, FIND_FOLLOW_CHARS - 1) + '…' : rest
      if (follow.length > followLeft) {
        followWithheld += 1
        return { at, follow: '' }
      }
      followLeft -= follow.length
      return { at, follow }
    })
    const matchSection =
      query === null
        ? []
        : [
            '## Matches for "' + query + '" (' + found.total + ')',
            ...(found.total === 0
              ? [
                  'No match within a single paragraph, heading or list item. The page text has ' +
                    mainText.length +
                    ' characters.',
                ]
              : found.matches.flatMap((match, index) => {
                  const ids = (matchElements[index] as Element[]).map((el) => '[' + state.ids.get(el) + ']')
                  const placement = placements[index] as { at: number; follow: string }
                  return [
                    index +
                      1 +
                      '. ' +
                      excerpt(match, query.length) +
                      (placement.at >= 0
                        ? ' (page text from character ' + placement.at + ': pass textFrom=' + placement.at + ' to read on)'
                        : ''),
                    ...(placement.follow ? ['   then: ' + placement.follow] : []),
                    ...(ids.length > 0 ? ['   elements: ' + ids.join(' ')] : []),
                  ]
                })),
          ]
    let body: string[]
    if (full) {
      body = [
        ...header,
        ...(query === null
          ? ['## Page text' + (readFrom > 0 ? ' (from character ' + readFrom + ')' : ''), ...shownText]
          : matchSection),
        '## Interactive elements',
        ...(entries.length > 0 || (framed && ranked.length > 0) ? listEntries(entries, true) : ['(none)']),
      ]
    } else {
      const current = new Set(entries.map((entry) => entry.id))
      const changed = entries.filter((entry) => state.lastLines.get(entry.id) !== entry.line)
      const removed = Array.from(state.lastLines.keys()).filter((id) => !current.has(id))
      const textChanged = pageText !== state.lastText
      body = [
        ...header,
        'Changes: ' +
          changed.length +
          ' interactive elements changed or new, ' +
          removed.length +
          ' removed, page text ' +
          (textChanged ? 'changed' : 'unchanged'),
        ...(textChanged ? ['## Page text', ...shownText] : []),
        ...(changed.length > 0 ? ['## Interactive elements (changed or new)', ...listEntries(changed, false)] : []),
        ...(removed.length > 0 ? ['removed: ' + removed.join(',')] : []),
      ]
    }

    if (!special) {
      state.baseline = baseline
      state.lastLines = new Map(entries.map((entry) => [entry.id, entry.line]))
      state.lastText = pageText
      state.lastRegion = options.region
    }

    const notices = [
      ...(itemsDropped > 0 ? ['(+' + itemsDropped + ' more interactive elements not shown)'] : []),
      ...(mainCharsDropped > 0
        ? [
            '(page text cut: ' +
              mainCharsDropped +
              ' characters not shown' +
              (mainShown.length > 0 && mainText.length > next ? '; pass textFrom=' + next + ' to continue' : '') +
              ')',
          ]
        : []),
      ...(found.total > found.matches.length ? ['(showing the first ' + found.matches.length + ' of ' + found.total + ' matches)'] : []),
      ...(followWithheld > 0
        ? ['(text after ' + followWithheld + ' matches not shown: excerpts are limited to ' + FIND_FOLLOW_TOTAL + ' characters in all)']
        : []),
      ...(unlisted > 0 ? ['(' + unlisted + ' more interactive elements inside the matches are not listed)'] : []),
      ...(unreadFrames > 0 ? ['(' + unreadFrames + ' frames not read: cross-origin)'] : []),
      ...(capped ? ['(scan stopped after ' + MAX_EXAMINED + ' candidate elements; later elements were not examined)'] : []),
    ]
    const maxChars = Math.max(0, options.maxChars)
    let text = [...body, ...notices].join('\n')
    if (text.length > maxChars) {
      const tail = notices.join('\n')
      let used = tail.length + 80
      const keptLines: string[] = []
      for (const line of body) {
        if (used + line.length + 1 > maxChars) break
        used += line.length + 1
        keptLines.push(line)
      }
      const hidden = body.length - keptLines.length
      text = [...keptLines, '(output cut at ' + maxChars + ' characters: ' + hidden + ' lines not shown)', ...notices].join('\n')
    }

    return {
      text,
      baseline,
      full,
      items: entries.map((entry) => ({ id: entry.id, role: entry.role, name: entry.name, offscreen: entry.offscreen })),
      itemsDropped,
      mainCharsDropped,
      unreadFrames,
    }
  }

  const findCoverage = (el: Element, x: number, y: number): { covered: boolean; by: string } => {
    let current: Element = el
    for (;;) {
      const win = winOf(current)
      const at = placementOf(win)
      const localX = (x - at.x) / at.sx
      const localY = (y - at.y) / at.sy
      const root = current.getRootNode() as TreeRoot
      let hit = root.elementFromPoint(localX, localY)
      if (!hit && root.nodeType === 11) hit = current.ownerDocument.elementFromPoint(localX, localY)
      if (!hit) return { covered: true, by: 'nothing receives clicks at this point' }
      if (!isAncestorOrSelf(hit, current) && !isAncestorOrSelf(current, hit)) {
        return { covered: true, by: describe(hit) }
      }
      const frame = win.frameElement
      if (!frame) return { covered: false, by: '' }
      current = frame
    }
  }

  const runLocate = (id: number): LocateResult => {
    const found = lookup(id)
    if (found.kind !== 'ok') return lookupFailure(id, found.kind)
    const el = found.el
    if (!isShown(el)) {
      return {
        ok: false,
        reason: 'hidden',
        detail: 'The element is not visible (hidden, zero size or inside a hidden container). Take a new snapshot.',
      }
    }
    if (isDisabled(el)) {
      return { ok: false, reason: 'disabled', detail: 'The element is disabled and cannot be clicked.' }
    }
    el.scrollIntoView({ block: 'center', inline: 'center' })
    resetCaches()
    const first = Array.from<DOMRect>(el.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0)
    const own: Box = first ? toTop(winOf(el), first) : topRect(el)
    const area = intersect(own, limitOf(el))
    if (area.r <= area.l || area.b <= area.t) {
      return {
        ok: false,
        reason: 'hidden',
        detail: 'The element could not be scrolled into view; it is clipped by a container. Take a new snapshot.',
      }
    }
    const x = Math.round(((area.l + area.r) / 2) * 10) / 10
    const y = Math.round(((area.t + area.b) / 2) * 10) / 10
    const coverage = findCoverage(el, x, y)
    if (coverage.covered) {
      return {
        ok: false,
        reason: 'covered',
        detail: 'Another element covers the click point: ' + coverage.by + '. Dismiss it or scroll, then take a new snapshot.',
      }
    }
    return { ok: true, x, y, role: roleOf(el), name: nameOf(el) }
  }

  const runFocus = (focusArgs: PageFocusArgs): FocusResult => {
    const found = lookup(focusArgs.id)
    if (found.kind !== 'ok') return lookupFailure(focusArgs.id, found.kind)
    const el = found.el
    if (isDisabled(el)) return { ok: false, reason: 'disabled', detail: 'The element is disabled.' }
    const tag = el.localName
    const isField = tag === 'textarea' || (tag === 'input' && !NON_TEXT_INPUTS.includes(inputType(el)))
    const isRich = !isField && (isEditableHost(el) || (el as HTMLElement).isContentEditable === true)
    if (!isField && !isRich) {
      return { ok: false, reason: 'not_editable', detail: 'The element is not a text field or editable content.' }
    }
    if (isField && (el as HTMLInputElement).readOnly) {
      return { ok: false, reason: 'not_editable', detail: 'The field is read-only.' }
    }
    const target = el as HTMLInputElement
    target.focus()
    if (focusArgs.clear) {
      if (isField) {
        target.select()
      } else {
        const doc = el.ownerDocument
        const selection = winOf(el).getSelection()
        const range = doc.createRange()
        range.selectNodeContents(el)
        if (selection) {
          selection.removeAllRanges()
          selection.addRange(range)
        }
      }
    }
    return { ok: true }
  }

  const runScroll = (scrollArgs: ScrollArgs): ScrollResult => {
    const view = window.innerHeight
    const html = document.documentElement
    const root = document.scrollingElement || html
    const rootOverflow = styleOf(html).overflowY
    const rootDefers = rootOverflow === 'visible' || rootOverflow === ''
    const viewportOverflow = rootDefers && document.body ? styleOf(document.body).overflowY : rootOverflow
    const pageLocked = viewportOverflow === 'hidden' || viewportOverflow === 'clip'
    let scroller: Element | null = !pageLocked && root.scrollHeight - root.clientHeight > SCROLL_ROOM_MIN ? root : null
    const isPage = scroller !== null
    if (!scroller) {
      const centreX = window.innerWidth / 2
      const centreY = view / 2
      let largest = 0
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (el === html || el === document.body || el.scrollHeight - el.clientHeight <= SCROLL_ROOM_MIN) continue
        const rect = el.getBoundingClientRect()
        if (centreX < rect.left || centreX > rect.right || centreY < rect.top || centreY > rect.bottom) continue
        const overflow = styleOf(el).overflowY
        if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') continue
        const area = rect.width * rect.height
        if (area > largest) {
          largest = area
          scroller = el
        }
      }
    }
    if (!scroller) {
      return {
        ok: false,
        reason: 'not_scrollable',
        detail: 'Nothing on this page can scroll vertically: the page fits the window and no scrollable area covers its centre.',
      }
    }
    const target: Element = scroller
    const positionOf = (): number => (isPage ? window.scrollY : target.scrollTop)
    const room = Math.max(0, target.scrollHeight - target.clientHeight)
    const before = positionOf()
    const visible = isPage ? view : Math.min(target.clientHeight, view)
    const step = scrollArgs.amount === null ? Math.round(visible * SCROLL_DEFAULT_FRACTION) : scrollArgs.amount
    const goal =
      scrollArgs.direction === 'top'
        ? 0
        : scrollArgs.direction === 'bottom'
          ? room
          : scrollArgs.direction === 'up'
            ? before - step
            : before + step
    const top = Math.max(0, Math.min(room, goal))
    if (isPage) window.scrollTo({ top, behavior: 'instant' })
    else target.scrollTo({ top, behavior: 'instant' })
    const after = positionOf()
    return {
      ok: true,
      moved: Math.round(Math.abs(after - before)),
      position: Math.round(after),
      maxPosition: Math.round(room),
      total: Math.round(target.scrollHeight),
      area: isPage ? null : describe(target),
    }
  }

  const runHasText = (textArgs: PageTextArgs): PageTextResult => {
    const needle = clean(textArgs.text, Infinity).toLowerCase()
    const root = document.body
    if (!root || needle === '') return { present: false }
    const blocks = Array.from(visibleGroups(root).values(), (parts) => parts.join(''))
    return { present: clean(blocks.join(' '), Infinity).toLowerCase().includes(needle) }
  }

  const runStyles = (stylesArgs: PageStylesArgs): StylesResult => {
    const found = lookup(stylesArgs.id)
    if (found.kind !== 'ok') return lookupFailure(stylesArgs.id, found.kind)
    const el = found.el
    const computed = winOf(el).getComputedStyle(el)
    const enumerated = new Set<string>()
    for (let i = 0; i < computed.length; i += 1) enumerated.add(computed.item(i))
    const css = (globalThis as unknown as { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS
    const supported = (name: string): boolean => Boolean(css && css.supports && css.supports(name, 'initial'))
    const values: Array<{ name: string; value: string }> = []
    const unknown: string[] = []
    for (const name of stylesArgs.properties || DEFAULT_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(name)
      if (value === '' && !enumerated.has(name) && !supported(name)) unknown.push(name)
      else values.push({ name, value: value === '' ? '(empty)' : value.slice(0, STYLE_VALUE_MAX) })
    }
    const rect = topRect(el)
    const round = (n: number): number => Math.round(n * 10) / 10
    return {
      ok: true,
      tag: el.localName,
      role: roleOf(el),
      name: nameOf(el),
      box: { x: round(rect.l), y: round(rect.t), width: round(rect.r - rect.l), height: round(rect.b - rect.t) },
      values,
      unknown,
    }
  }

  const runLookup = (id: number): ElementLookupResult => {
    const found = lookup(id)
    return found.kind === 'ok' ? { ok: true } : lookupFailure(id, found.kind)
  }

  const runElement = (id: number): Element | null => {
    const found = lookup(id)
    return found.kind === 'ok' ? found.el : null
  }

  const labelOf = (el: Element): string => {
    const tag = el.localName
    const firstClass = (el.getAttribute('class') || '').trim().split(/\s+/)[0]
    if (firstClass) return (tag + '.' + firstClass).slice(0, PICK_LABEL_MAX)
    const elementId = el.getAttribute('id')
    if (elementId) return (tag + '#' + elementId).slice(0, PICK_LABEL_MAX)
    const role = roleOf(el)
    return role === 'generic' ? tag : role
  }
  const escapeIdent = (value: string): string =>
    value.replace(/[^\w-]/g, (character) => '\\' + character).replace(/^(\d)/, '\\3$1 ')
  const isUnique = (root: ParentNode, selector: string): boolean => {
    try {
      return root.querySelectorAll(selector).length === 1
    } catch (error) {
      return false
    }
  }
  const segmentOf = (el: Element): string => {
    const classes = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    let segment = el.localName + classes.map((name) => '.' + escapeIdent(name)).join('')
    const parent = el.parentElement
    if (parent) {
      const same = Array.from(parent.children).filter((sibling) => sibling.localName === el.localName)
      if (same.length > 1) segment += ':nth-of-type(' + (same.indexOf(el) + 1) + ')'
    }
    return segment
  }
  const selectorWithin = (el: Element): string => {
    const root = el.getRootNode() as TreeRoot
    const segments: string[] = []
    for (let current: Element | null = el; current; current = current.parentElement) {
      const own = current.getAttribute('id')
      const anchor = own ? '#' + escapeIdent(own) : ''
      if (anchor && isUnique(root, anchor)) {
        segments.unshift(anchor)
        break
      }
      segments.unshift(segmentOf(current))
      const candidate = segments.join(' > ')
      if (isUnique(root, candidate)) return candidate
    }
    return segments.join(' > ')
  }
  const selectorOf = (el: Element): string => {
    const root = el.getRootNode()
    const own = selectorWithin(el)
    return root.nodeType === 11 ? selectorOf((root as ShadowRoot).host) + ' >>> ' + own : own
  }
  const containsSensitive = (root: Element): boolean => {
    if (isSensitive(root)) return true
    let budget = PICK_SCAN_MAX
    const visit = (scope: ParentNode): boolean => {
      for (const field of Array.from(scope.querySelectorAll('input,textarea,select'))) {
        if (isSensitive(field)) return true
      }
      for (const inner of Array.from(scope.querySelectorAll('*'))) {
        budget -= 1
        if (budget < 0) return true
        if (inner.shadowRoot && visit(inner.shadowRoot)) return true
      }
      return false
    }
    return visit(root) || Boolean(root.shadowRoot && visit(root.shadowRoot))
  }
  const sanitizedHtml = (node: Element): string => {
    const copy = node.cloneNode(true) as Element
    const scrub = (target: Element): void => {
      if (target.localName === 'input') target.removeAttribute('value')
      else if (target.localName === 'textarea') target.textContent = ''
      else if (target.localName === 'option' && target.hasAttribute('selected')) target.textContent = MASK
    }
    scrub(copy)
    for (const inner of Array.from(copy.querySelectorAll('input,textarea,option'))) scrub(inner)
    return copy.outerHTML
  }

  const textWithoutFields = (node: Element): string =>
    Array.from(visibleGroups(node, ['textarea']).values(), (parts) => parts.join('')).join(' ')

  const runPick = (picked: Element): PickDescription => {
    const ref = String(idFor(picked))
    const tag = picked.localName
    const label = labelOf(picked)
    const selector = selectorOf(picked)
    if (containsSensitive(picked)) {
      return { ref, url: location.href, title: document.title, tag, label, selector, sensitive: true, truncated: false }
    }
    let truncated = false
    const cut = (value: string, max: number): string => {
      if (value.length <= max) return value
      truncated = true
      return value.slice(0, max)
    }
    const computed = winOf(picked).getComputedStyle(picked)
    const styles: Record<string, string> = {}
    for (const property of PICK_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property)
      if (value !== '') styles[property] = value.slice(0, STYLE_VALUE_MAX)
    }
    const rect = topRect(picked)
    const previous = picked.previousElementSibling
    const following = picked.nextElementSibling
    const href = picked.getAttribute('href') !== null ? (picked as HTMLAnchorElement).href : ''
    return {
      ref,
      url: location.href,
      title: document.title,
      tag,
      label,
      selector,
      sensitive: false,
      role: roleOf(picked),
      name: nameOf(picked, textWithoutFields),
      text: cut(clean(textWithoutFields(picked), Infinity), PICK_TEXT_MAX),
      ...(href ? { href } : {}),
      styles,
      html: cut(sanitizedHtml(picked), PICK_HTML_MAX),
      ...(previous ? { prev: cut(sanitizedHtml(previous), PICK_SIBLING_MAX) } : {}),
      ...(following ? { next: cut(sanitizedHtml(following), PICK_SIBLING_MAX) } : {}),
      truncated,
      rect: {
        x: rect.l,
        y: rect.t,
        width: rect.r - rect.l,
        height: rect.b - rect.t,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
    }
  }

  const runMarks = (marksArgs: PageMarksArgs): PageMarksResult => {
    if (state.marks) state.marks.stop()
    const root = document.documentElement
    const found: Array<{ id: number; el: Element }> = []
    for (const id of marksArgs.ids) {
      const hit = lookup(id)
      if (hit.kind === 'ok') found.push({ id, el: hit.el })
    }
    if (!root || found.length === 0) return { alive: [] }
    const host = document.createElement('div')
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none;'
    const shadow = host.attachShadow({ mode: 'closed' })
    const entries = new Map<number, MarkBox>()
    for (const { id, el } of found) {
      const box = document.createElement('div')
      box.style.cssText =
        'position:fixed;box-sizing:border-box;border:2px solid ' + MARK_COLOR + ';border-radius:6px;pointer-events:none;display:none;'
      const chip = document.createElement('div')
      chip.textContent = labelOf(el)
      chip.style.cssText =
        'position:fixed;box-sizing:border-box;height:' +
        MARK_CHIP_HEIGHT +
        'px;padding:0 6px;border-radius:4px;background:' +
        MARK_COLOR +
        ';color:#fff;font:600 11px/' +
        MARK_CHIP_HEIGHT +
        'px system-ui,-apple-system,sans-serif;white-space:nowrap;pointer-events:none;display:none;'
      shadow.appendChild(box)
      shadow.appendChild(chip)
      entries.set(id, { el, box, chip })
    }
    root.appendChild(host)

    let frame = 0
    let last = 0
    let stopped = false
    const refresh = (): void => {
      if (stopped) return
      resetCaches()
      for (const [id, mark] of entries) {
        if (!mark.el.isConnected) {
          mark.box.remove()
          mark.chip.remove()
          entries.delete(id)
          continue
        }
        const rect = topRect(mark.el)
        const visible = rect.r > rect.l && rect.b > rect.t && inView(mark.el)
        const display = visible ? 'block' : 'none'
        mark.box.style.display = display
        mark.chip.style.display = display
        if (!visible) continue
        mark.box.style.left = rect.l - MARK_PAD + 'px'
        mark.box.style.top = rect.t - MARK_PAD + 'px'
        mark.box.style.width = rect.r - rect.l + MARK_PAD * 2 + 'px'
        mark.box.style.height = rect.b - rect.t + MARK_PAD * 2 + 'px'
        const above = rect.t - MARK_PAD - MARK_CHIP_HEIGHT
        mark.chip.style.top = (above >= 0 ? above : rect.t + MARK_PAD + 2) + 'px'
        mark.chip.style.left = Math.max(0, rect.l - MARK_PAD) + 'px'
      }
      if (entries.size === 0) stop()
    }
    const tick = (time: number): void => {
      if (stopped) return
      if (time - last >= MARK_REFRESH_MS) {
        last = time
        refresh()
      }
      if (!stopped) frame = window.requestAnimationFrame(tick)
    }
    const stop = (): void => {
      if (stopped) return
      stopped = true
      window.removeEventListener('scroll', refresh, true)
      window.removeEventListener('resize', refresh)
      if (frame) window.cancelAnimationFrame(frame)
      host.remove()
      if (state.marks && state.marks.host === host) state.marks = null
    }
    state.marks = { host, entries, stop }
    window.addEventListener('scroll', refresh, true)
    window.addEventListener('resize', refresh)
    if (typeof window.requestAnimationFrame === 'function') frame = window.requestAnimationFrame(tick)
    refresh()
    return { alive: Array.from(entries.keys()) }
  }

  const runMarksHidden = (hiddenArgs: PageMarksHiddenArgs): PageMarksHiddenResult => {
    if (state.marks) state.marks.host.style.visibility = hiddenArgs.hidden ? 'hidden' : 'visible'
    return { ok: true }
  }

  if (op === 'snapshot') return runSnapshot(args as SnapshotOptions)
  if (op === 'pick') return runPick(target as Element)
  if (op === 'marks') return runMarks(args as PageMarksArgs)
  if (op === 'marksHidden') return runMarksHidden(args as PageMarksHiddenArgs)
  if (op === 'locate') return runLocate((args as PageLocateArgs).id)
  if (op === 'scroll') return runScroll(args as ScrollArgs)
  if (op === 'hasText') return runHasText(args as PageTextArgs)
  if (op === 'styles') return runStyles(args as PageStylesArgs)
  if (op === 'lookup') return runLookup((args as PageLocateArgs).id)
  if (op === 'element') return runElement((args as PageLocateArgs).id)
  return runFocus(args as PageFocusArgs)
}
