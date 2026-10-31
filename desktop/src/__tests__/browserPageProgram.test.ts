import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { pageProgram } from '../../../src/server/browserHost/snapshot/pageProgram'
import type {
  ElementLookupResult,
  FocusResult,
  LocateResult,
  ScrollDirection,
  ScrollResult,
  SnapshotOptions,
  SnapshotResult,
  StylesResult,
} from '../../../src/server/browserHost/snapshot/types'

type JsdomWindow = Window & typeof globalThis & { eval(source: string): unknown }
type Fn = ReturnType<typeof vi.fn>
type Placed = Element & { scrollIntoView: Fn }
type Registry = { refs: Map<number, unknown>; next: number }

const STATE_KEY = '__dreamcoderSnapshotState'
const DEFAULTS: SnapshotOptions = {
  delta: false,
  baseline: null,
  region: null,
  find: null,
  textFrom: 0,
  maxItems: 150,
  mainChars: 8000,
  maxChars: 16000,
}

function jsdomWindow(): JsdomWindow {
  return (globalThis as unknown as { jsdom: { window: JsdomWindow } }).jsdom.window
}

function programSource(): string {
  return pageProgram.toString()
}

function run<T>(op: string, args: unknown): T {
  const expression = `JSON.stringify((${programSource()})(${JSON.stringify(op)}, ${JSON.stringify(args)}))`
  return JSON.parse(String(jsdomWindow().eval(expression))) as T
}

function snap(overrides: Partial<SnapshotOptions> = {}): SnapshotResult {
  return run<SnapshotResult>('snapshot', { ...DEFAULTS, ...overrides })
}

function locate(id: number): LocateResult {
  return run<LocateResult>('locate', { id })
}

function focus(id: number, clear = false): FocusResult {
  return run<FocusResult>('focus', { id, clear })
}

function scroll(direction: ScrollDirection, amount: number | null = null): ScrollResult {
  return run<ScrollResult>('scroll', { direction, amount })
}

function hasText(text: string): boolean {
  return run<{ present: boolean }>('hasText', { text }).present
}

function styles(id: number, properties: string[] | null = null): StylesResult {
  return run<StylesResult>('styles', { id, properties })
}

function lookup(id: number): ElementLookupResult {
  return run<ElementLookupResult>('lookup', { id })
}

function elementOf(id: number): unknown {
  return jsdomWindow().eval(`(${programSource()})("element", {"id":${id}})`)
}

function rectFor(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function place(el: Element, left: number, top: number, width: number, height: number): Placed {
  const rect = rectFor(left, top, width, height)
  const visible = width > 0 && height > 0
  Object.defineProperty(el, 'getBoundingClientRect', { value: () => rect, configurable: true })
  Object.defineProperty(el, 'getClientRects', { value: () => (visible ? [rect] : []), configurable: true })
  const placed = el as Placed
  placed.scrollIntoView = vi.fn()
  return placed
}

function hitTest(root: Document | ShadowRoot): (x: number, y: number) => Element | null {
  return (x, y) => {
    const boxes = Array.from(root.querySelectorAll('[data-box]'))
    for (let i = boxes.length - 1; i >= 0; i -= 1) {
      const box = boxes[i] as Element
      const rect = box.getBoundingClientRect()
      if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) return box
    }
    return null
  }
}

function layout(root: Document | ShadowRoot | Element): void {
  const scope = root as ParentNode
  const all: Element[] = Array.from(scope.querySelectorAll('*'))
  if ('nodeType' in root && root.nodeType === 1) all.unshift(root as Element)
  for (const el of all) {
    const spec = el.getAttribute('data-box')
    if (spec) {
      const [left = 0, top = 0, width = 0, height = 0] = spec.split(',').map(Number)
      place(el, left, top, width, height)
    }
    if (el.shadowRoot) {
      layout(el.shadowRoot)
      ;(el.shadowRoot as unknown as { elementFromPoint: unknown }).elementFromPoint = hitTest(el.shadowRoot)
    }
    if (el.localName === 'iframe') {
      const doc = (el as HTMLIFrameElement).contentDocument
      if (doc) {
        layout(doc)
        ;(doc as unknown as { elementFromPoint: unknown }).elementFromPoint = hitTest(doc)
      }
    }
  }
}

function load(html: string, title = 'Test page'): void {
  document.title = title
  document.body.innerHTML = html
  layout(document)
  ;(document as unknown as { elementFromPoint: unknown }).elementFromPoint = hitTest(document)
}

function sizeFrame(frame: HTMLIFrameElement, layoutWidth: number, layoutHeight: number, border = 0): void {
  Object.defineProperty(frame, 'offsetWidth', { value: layoutWidth, configurable: true })
  Object.defineProperty(frame, 'offsetHeight', { value: layoutHeight, configurable: true })
  Object.defineProperty(frame, 'clientLeft', { value: border, configurable: true })
  Object.defineProperty(frame, 'clientTop', { value: border, configurable: true })
}

function fillFrame(frame: HTMLIFrameElement, html: string): void {
  const doc = frame.contentDocument as Document
  doc.body.innerHTML = html
  layout(doc)
  ;(doc as unknown as { elementFromPoint: unknown }).elementFromPoint = hitTest(doc)
}

function el<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector(selector)
  if (!found) throw new Error(`missing ${selector}`)
  return found as T
}

function lines(result: SnapshotResult): string[] {
  return result.text.split('\n')
}

function itemLines(result: SnapshotResult): string[] {
  return lines(result).filter((line) => /^\[\d+\]/.test(line))
}

function idOf(result: SnapshotResult, name: string): number {
  const item = result.items.find((candidate) => candidate.name === name)
  if (!item) throw new Error(`no item named ${name}`)
  return item.id
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.title = ''
})

afterEach(() => {
  document.body.innerHTML = ''
  delete (jsdomWindow() as unknown as Record<string, unknown>)[STATE_KEY]
  delete (globalThis as unknown as Record<string, unknown>)[STATE_KEY]
})

describe('page program: self-containedness', () => {
  test('source references nothing outside its own body and has no compiler helpers', () => {
    const source = programSource()
    expect(source.startsWith('function')).toBe(true)
    expect(source).not.toMatch(/__name|__publicField|__spread|__rest|_define_property|__defProp|__async/)
    expect(source).not.toMatch(/\bimport\b|\brequire\b/)
  })

  test('runs in a fresh function scope that cannot see this module', () => {
    load('<button data-box="0,0,80,20">Go</button>')
    const isolated = new Function('op', 'args', `return (${programSource()})(op, args)`)
    const result = isolated('snapshot', DEFAULTS) as SnapshotResult
    expect(result.items.map((item) => item.name)).toEqual(['Go'])
  })

  test('runs inside the jsdom window, where none of this module exists', () => {
    load('<button data-box="0,0,80,20">Go</button>')
    expect(snap().items).toEqual([{ id: 1, role: 'button', name: 'Go', offscreen: false }])
  })
})

describe('page program: output format', () => {
  test('prints header, page text, items and notices', () => {
    load(
      `<main data-box="0,0,400,300">Welcome to the shop
        <button data-box="0,0,80,20" disabled>Submit</button>
        <input type="text" aria-label="Email" data-box="0,30,200,20">
        <button data-box="0,5000,80,20">Far away</button>
      </main>`,
      'Shop',
    )
    const input = el<HTMLInputElement>('input')
    input.value = 'ada@example.com'
    const result = snap({ maxItems: 3 })
    expect(result.text).toBe(
      [
        'URL: http://localhost:3000/',
        'Title: Shop',
        `Snapshot: ${result.baseline} full`,
        '## Page text',
        'Welcome to the shop Submit Far away',
        '## Interactive elements',
        '[1] button "Submit" disabled',
        '[2] textbox "Email" value="ada@example.com"',
        '[3] button "Far away" offscreen',
      ].join('\n'),
    )
    expect(result.full).toBe(true)
    expect(result.baseline).toMatch(/^[a-z0-9]{6,}$/)
  })

  test('says when there are no interactive elements and no text', () => {
    load('')
    const result = snap()
    expect(lines(result).slice(3)).toEqual(['## Page text', '(empty)', '## Interactive elements', '(none)'])
    expect(result.items).toEqual([])
  })

  test('every snapshot gets a new baseline', () => {
    load('<button data-box="0,0,80,20">Go</button>')
    const first = snap()
    const second = snap()
    expect(second.baseline).not.toBe(first.baseline)
  })
})

describe('page program: roles and names', () => {
  test('maps native elements and the widget vocabulary to roles', () => {
    load(`
      <a href="/home" data-box="0,0,50,20">Home</a>
      <button data-box="0,0,50,20">Save</button>
      <input type="text" aria-label="Text field" data-box="0,0,50,20">
      <input type="search" aria-label="Search field" data-box="0,0,50,20">
      <input type="checkbox" aria-label="Agree" data-box="0,0,50,20">
      <input type="radio" aria-label="Pick" data-box="0,0,50,20">
      <input type="range" aria-label="Volume" data-box="0,0,50,20">
      <input type="submit" value="Send" data-box="0,0,50,20">
      <select aria-label="Country" data-box="0,0,50,20"><option>FR</option></select>
      <textarea aria-label="Notes" data-box="0,0,50,20"></textarea>
      <div contenteditable="true" aria-label="Editor" data-box="0,0,50,20">hello</div>
      <details><summary data-box="0,0,50,20">More</summary></details>
      <div role="tab" data-box="0,0,50,20">Tab one</div>
      <div role="menuitem" data-box="0,0,50,20">Open</div>
      <div role="switch" data-box="0,0,50,20">Dark</div>
      <div role="slider" data-box="0,0,50,20">Level</div>
      <div role="option" data-box="0,0,50,20">Choice</div>
      <div role="textbox" data-box="0,0,50,20">Free text</div>
      <div role="combobox" data-box="0,0,50,20">Pick one</div>
      <div role="button" data-box="0,0,50,20">Clicky</div>
      <div role="link" data-box="0,0,50,20">Fake link</div>
      <div role="checkbox" data-box="0,0,50,20">Fake check</div>
      <div role="radio" data-box="0,0,50,20">Fake radio</div>
      <div tabindex="0" data-box="0,0,50,20">Focusable</div>
    `)
    const pairs = snap().items.map((item) => `${item.role}:${item.name}`)
    expect(pairs).toEqual([
      'link:Home',
      'button:Save',
      'textbox:Text field',
      'textbox:Search field',
      'checkbox:Agree',
      'radio:Pick',
      'slider:Volume',
      'button:Send',
      'combobox:Country',
      'textbox:Notes',
      'textbox:Editor',
      'button:More',
      'tab:Tab one',
      'menuitem:Open',
      'switch:Dark',
      'slider:Level',
      'option:Choice',
      'textbox:Free text',
      'combobox:Pick one',
      'button:Clicky',
      'link:Fake link',
      'checkbox:Fake check',
      'radio:Fake radio',
      'generic:Focusable',
    ])
  })

  test('an explicit role wins over the native one', () => {
    load('<a href="/x" role="button" data-box="0,0,50,20">Act</a>')
    expect(snap().items[0]?.role).toBe('button')
  })

  test('skips tabindex -1, hidden inputs and plain elements', () => {
    load(`
      <div tabindex="-1" data-box="0,0,50,20">Not tabbable</div>
      <input type="hidden" value="x" data-box="0,0,50,20">
      <div data-box="0,0,50,20">Plain</div>
      <a data-box="0,0,50,20">No href</a>
    `)
    expect(snap().items).toEqual([])
  })

  test('names follow aria-labelledby, aria-label, label, alt, placeholder, then text, then title', () => {
    load(`
      <span id="l1">Billing</span><span id="l2">address</span>
      <input id="a" aria-labelledby="l1 l2" aria-label="ignored" placeholder="p" data-box="0,0,50,20">
      <input id="b" aria-label="Aria wins" placeholder="p" data-box="0,0,50,20">
      <label for="c">Label text</label><input id="c" placeholder="p" title="t" data-box="0,0,50,20">
      <input id="d" type="image" alt="Alt text" title="t" data-box="0,0,50,20">
      <input id="e" placeholder="Placeholder text" title="t" data-box="0,0,50,20">
      <input id="f" title="Title only" data-box="0,0,50,20">
      <button id="g" title="Button title" data-box="0,0,50,20">Visible text</button>
      <button id="h" title="Icon button" data-box="0,0,50,20"></button>
      <a id="i" href="/" data-box="0,0,50,20"><img alt="Logo image"></a>
      <label>Wrapped <input id="j" data-box="0,0,50,20"></label>
    `)
    const names = snap().items.map((item) => item.name)
    expect(names).toEqual([
      'Billing address',
      'Aria wins',
      'Label text',
      'Alt text',
      'Placeholder text',
      'Title only',
      'Visible text',
      'Icon button',
      'Logo image',
      'Wrapped',
    ])
  })

  test('collapses whitespace and cuts names at 80 characters', () => {
    load(`<button data-box="0,0,50,20">  Lots   of
        space </button>
      <button data-box="0,0,50,20">${'word '.repeat(40)}</button>`)
    const [first, second] = snap().items
    expect(first?.name).toBe('Lots of space')
    expect(second?.name).toHaveLength(80)
  })

  test('select uses the selected option as its name only when nothing else names it', () => {
    load(`
      <select data-box="0,0,50,20"><option>Red</option><option selected>Green</option></select>
      <label for="s">Size</label>
      <select id="s" data-box="0,0,50,20"><option>S</option><option selected>M</option></select>
    `)
    const result = snap()
    expect(itemLines(result)).toEqual(['[1] combobox "Green"', '[2] combobox "Size" value="M"'])
  })

  test('button-like inputs are named by their value', () => {
    load('<input type="button" value="Reset all" data-box="0,0,50,20"><input type="reset" value="Clear" data-box="0,0,50,20">')
    expect(snap().items.map((item) => item.name)).toEqual(['Reset all', 'Clear'])
  })
})

describe('page program: values and state', () => {
  test('shows the current value of inputs and textareas and cuts it at 60 characters', () => {
    load(`
      <input type="text" aria-label="Email" data-box="0,0,50,20">
      <textarea aria-label="Bio" data-box="0,0,50,20"></textarea>
      <input type="text" aria-label="Long" data-box="0,0,50,20">
      <input type="text" aria-label="Empty" data-box="0,0,50,20">
    `)
    const inputs = document.querySelectorAll('input')
    ;(inputs[0] as HTMLInputElement).value = 'ada@example.com'
    ;(inputs[1] as HTMLInputElement).value = 'x'.repeat(100)
    el<HTMLTextAreaElement>('textarea').value = 'line one\nline two'
    const result = snap()
    expect(itemLines(result)).toEqual([
      '[1] textbox "Email" value="ada@example.com"',
      '[2] textbox "Bio" value="line one line two"',
      `[3] textbox "Long" value="${'x'.repeat(60)}"`,
      '[4] textbox "Empty"',
    ])
  })

  test('escapes quotes in values', () => {
    load('<input type="text" aria-label="Q" data-box="0,0,50,20">')
    el<HTMLInputElement>('input').value = 'say "hi"'
    expect(itemLines(snap())).toEqual(['[1] textbox "Q" value="say \\"hi\\""'])
  })

  test('masks password fields and cc-* autocomplete fields', () => {
    load(`
      <input type="password" aria-label="Secret" data-box="0,0,50,20">
      <input type="text" autocomplete="cc-number" aria-label="Card" data-box="0,0,50,20">
      <input type="text" autocomplete="section-pay cc-csc" aria-label="Code" data-box="0,0,50,20">
      <input type="password" aria-label="Blank password" data-box="0,0,50,20">
      <input type="text" name="password" aria-label="Password hint" data-box="0,0,50,20">
      <input type="text" autocomplete="name" aria-label="Full name" data-box="0,0,50,20">
      <select autocomplete="cc-exp-month" data-box="0,0,50,20"><option>05</option></select>
    `)
    const inputs = document.querySelectorAll('input')
    ;(inputs[0] as HTMLInputElement).value = 'hunter2'
    ;(inputs[1] as HTMLInputElement).value = '4111111111111111'
    ;(inputs[2] as HTMLInputElement).value = '123'
    ;(inputs[4] as HTMLInputElement).value = 'my dog'
    ;(inputs[5] as HTMLInputElement).value = 'Ada Lovelace'
    const result = snap()
    expect(itemLines(result)).toEqual([
      '[1] textbox "Secret" value="••••"',
      '[2] textbox "Card" value="••••"',
      '[3] textbox "Code" value="••••"',
      '[4] textbox "Blank password"',
      '[5] textbox "Password hint" value="my dog"',
      '[6] textbox "Full name" value="Ada Lovelace"',
      '[7] combobox "" value="••••"',
    ])
    for (const secret of ['hunter2', '4111111111111111', '123']) {
      expect(result.text).not.toContain(secret)
    }
  })

  test('shows checked, disabled, expanded, selected and required', () => {
    load(`
      <input type="checkbox" aria-label="Opt in" checked data-box="0,0,50,20">
      <input type="checkbox" aria-label="Opt out" data-box="0,0,50,20">
      <div role="switch" aria-checked="true" data-box="0,0,50,20">Dark mode</div>
      <button disabled data-box="0,0,50,20">Locked</button>
      <div role="button" aria-disabled="true" data-box="0,0,50,20">Soft locked</div>
      <fieldset disabled><input type="text" aria-label="In fieldset" data-box="0,0,50,20"></fieldset>
      <button aria-expanded="true" data-box="0,0,50,20">Menu</button>
      <button aria-expanded="false" data-box="0,0,50,20">Closed menu</button>
      <details open><summary data-box="0,0,50,20">Open details</summary></details>
      <div role="tab" aria-selected="true" data-box="0,0,50,20">Active tab</div>
      <input type="text" aria-label="Must" required data-box="0,0,50,20">
      <input type="text" aria-label="Also must" aria-required="true" data-box="0,0,50,20">
    `)
    expect(itemLines(snap())).toEqual([
      '[1] checkbox "Opt in" checked',
      '[2] checkbox "Opt out"',
      '[3] switch "Dark mode" checked',
      '[4] button "Locked" disabled',
      '[5] button "Soft locked" disabled',
      '[6] textbox "In fieldset" disabled',
      '[7] button "Menu" expanded',
      '[8] button "Closed menu"',
      '[9] button "Open details" expanded',
      '[10] tab "Active tab" selected',
      '[11] textbox "Must" required',
      '[12] textbox "Also must" required',
    ])
  })
})

describe('page program: visibility', () => {
  test('skips hidden elements and keeps visible ones', () => {
    load(`
      <button data-box="0,0,50,20">Visible</button>
      <button style="display:none" data-box="0,0,50,20">Display none</button>
      <button style="visibility:hidden" data-box="0,0,50,20">Visibility hidden</button>
      <div style="visibility:hidden"><button style="visibility:visible" data-box="0,0,50,20">Visible child</button></div>
      <div style="visibility:hidden"><button data-box="0,0,50,20">Inherited hidden</button></div>
      <div aria-hidden="true"><button data-box="0,0,50,20">Aria hidden ancestor</button></div>
      <button aria-hidden="true" data-box="0,0,50,20">Aria hidden self</button>
      <div inert><button data-box="0,0,50,20">Inert ancestor</button></div>
      <div style="opacity:0"><button data-box="0,0,50,20">Transparent ancestor</button></div>
      <button style="opacity:0" data-box="0,0,50,20">Transparent self</button>
      <div style="display:none"><button data-box="0,0,50,20">In display none</button></div>
      <button data-box="0,0,0,0">Zero rect</button>
      <button data-box="0,0,0,20">Zero width</button>
      <button>No layout</button>
    `)
    expect(snap().items.map((item) => item.name)).toEqual(['Visible', 'Visible child'])
  })

  test('hidden elements do not count as dropped', () => {
    load(`<button data-box="0,0,50,20">A</button><button style="display:none" data-box="0,0,50,20">B</button>`)
    const result = snap({ maxItems: 5 })
    expect(result.itemsDropped).toBe(0)
    expect(result.text).not.toContain('more interactive elements')
  })

  test('marks elements outside the viewport as offscreen', () => {
    load(`
      <button data-box="0,0,50,20">Top</button>
      <button data-box="0,900,50,20">Below</button>
      <button data-box="2000,0,50,20">Right</button>
      <button data-box="0,-100,50,20">Above</button>
      <button data-box="0,740,50,40">Straddling</button>
    `)
    const flags = itemLines(snap())
    expect(flags).toEqual([
      '[1] button "Top"',
      '[2] button "Straddling"',
      '[3] button "Below" offscreen',
      '[4] button "Right" offscreen',
      '[5] button "Above" offscreen',
    ])
  })

  test('treats elements clipped by a scrolling ancestor as offscreen', () => {
    load(`
      <div style="overflow:auto" data-box="0,0,200,100">
        <button data-box="0,10,50,20">Inside box</button>
        <button data-box="0,300,50,20">Scrolled away</button>
      </div>
      <div style="overflow:visible" data-box="0,200,200,100">
        <button data-box="0,500,50,20">Overflowing but visible</button>
      </div>
    `)
    expect(itemLines(snap())).toEqual([
      '[1] button "Inside box"',
      '[2] button "Overflowing but visible"',
      '[3] button "Scrolled away" offscreen',
    ])
  })

  test('a fixed element is not clipped by a scrolling ancestor', () => {
    load(`
      <div style="overflow:hidden" data-box="0,0,100,50">
        <button style="position:fixed" data-box="300,300,50,20">Fixed</button>
      </div>
    `)
    expect(itemLines(snap())).toEqual(['[1] button "Fixed"'])
  })
})

describe('page program: order and budget', () => {
  test('lists dialog elements first, then viewport elements, then the rest', () => {
    load(`
      <button data-box="0,2000,50,20">Far first</button>
      <button data-box="0,0,50,20">Page button</button>
      <div role="dialog" data-box="0,0,300,300">
        <button data-box="0,0,50,20">Dialog button</button>
        <button data-box="0,3000,50,20">Dialog far</button>
      </div>
      <button data-box="0,30,50,20">Another page button</button>
    `)
    expect(snap().items.map((item) => item.name)).toEqual([
      'Dialog button',
      'Dialog far',
      'Page button',
      'Another page button',
      'Far first',
    ])
  })

  test('recognises aria-modal and the dialog element', () => {
    load(`
      <button data-box="0,0,50,20">Behind</button>
      <div aria-modal="true" data-box="0,0,300,300"><button data-box="0,0,50,20">Modal</button></div>
      <dialog open data-box="0,0,300,300"><button data-box="0,0,50,20">Native</button></dialog>
    `)
    expect(snap().items.map((item) => item.name)).toEqual(['Modal', 'Native', 'Behind'])
  })

  test('elements behind an inert background are skipped', () => {
    load(`
      <div inert><button data-box="0,0,50,20">Behind</button></div>
      <div role="dialog" data-box="0,0,300,300"><button data-box="0,0,50,20">Accept cookies</button></div>
    `)
    expect(snap().items.map((item) => item.name)).toEqual(['Accept cookies'])
  })

  test('keeps at most maxItems and reports what was dropped', () => {
    load(Array.from({ length: 10 }, (_, i) => `<button data-box="0,${i * 25},50,20">B${i}</button>`).join(''))
    const result = snap({ maxItems: 4 })
    expect(result.items.map((item) => item.name)).toEqual(['B0', 'B1', 'B2', 'B3'])
    expect(result.itemsDropped).toBe(6)
    expect(lines(result)).toContain('(+6 more interactive elements not shown)')
  })

  test('drops offscreen elements before viewport and dialog elements', () => {
    load(`
      <button data-box="0,2000,50,20">Offscreen</button>
      <button data-box="0,0,50,20">In view</button>
      <div role="dialog" data-box="0,0,300,300"><button data-box="0,0,50,20">In dialog</button></div>
    `)
    const result = snap({ maxItems: 2 })
    expect(result.items.map((item) => item.name)).toEqual(['In dialog', 'In view'])
    expect(result.itemsDropped).toBe(1)
  })

  test('cuts the output at a line boundary and still reports the notices', () => {
    load(Array.from({ length: 30 }, (_, i) => `<button data-box="0,${i * 5},50,20">Button number ${i}</button>`).join(''))
    const result = snap({ maxItems: 20, maxChars: 400, mainChars: 40 })
    expect(result.text.length).toBeLessThanOrEqual(400)
    const all = lines(result)
    expect(all.some((line) => /^\(output cut at 400 characters: \d+ lines not shown\)$/.test(line))).toBe(true)
    expect(all).toContain('(+10 more interactive elements not shown)')
    expect(all.filter((line) => line.startsWith('[')).every((line) => /^\[\d+\] button "Button number \d+"$/.test(line))).toBe(true)
  })

  test('stops examining candidates after 5000 and says so', () => {
    load(Array.from({ length: 5100 }, () => `<button data-box="0,0,50,20">B</button>`).join(''))
    const result = snap({ maxItems: 10 })
    expect(result.itemsDropped).toBe(4990)
    expect(lines(result)).toContain(
      '(scan stopped after 5000 candidate elements; later elements were not examined)',
    )
  }, 30_000)
})

describe('page program: shadow DOM and frames', () => {
  test('reads open shadow roots in document order', () => {
    load(`
      <button data-box="0,0,50,20">Before</button>
      <div id="host"></div>
      <button data-box="0,60,50,20">After</button>
    `)
    const host = el('#host')
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<button data-box="0,30,50,20">Inside shadow</button><input aria-label="Shadow input" data-box="0,40,50,20">'
    layout(shadow)
    ;(shadow as unknown as { elementFromPoint: unknown }).elementFromPoint = hitTest(shadow)
    expect(snap().items.map((item) => item.name)).toEqual(['Before', 'Inside shadow', 'Shadow input', 'After'])
  })

  test('reads same-origin iframes and finds the labels inside them', () => {
    load('<button data-box="0,0,50,20">Outer</button><iframe data-box="100,100,300,200"></iframe>')
    const frame = el<HTMLIFrameElement>('iframe')
    fillFrame(frame, '<label for="n">Frame name</label><input id="n" data-box="10,10,100,20"><button data-box="10,40,80,20">Inner</button>')
    const result = snap()
    expect(result.items.map((item) => `${item.role}:${item.name}`)).toEqual([
      'button:Outer',
      'textbox:Frame name',
      'button:Inner',
    ])
    expect(result.unreadFrames).toBe(0)
    expect(result.text).not.toContain('frames not read')
  })

  test('counts a cross-origin iframe as not read', () => {
    load('<button data-box="0,0,50,20">Outer</button><iframe data-box="0,100,300,200"></iframe><iframe data-box="0,400,300,200"></iframe>')
    for (const frame of Array.from(document.querySelectorAll('iframe'))) {
      Object.defineProperty(frame, 'contentDocument', { value: null, configurable: true })
    }
    const result = snap()
    expect(result.unreadFrames).toBe(2)
    expect(lines(result)).toContain('(2 frames not read: cross-origin)')
  })

  test('does not count an invisible cross-origin frame', () => {
    load('<iframe style="display:none"></iframe><iframe data-box="0,0,0,0"></iframe>')
    for (const frame of Array.from(document.querySelectorAll('iframe'))) {
      Object.defineProperty(frame, 'contentDocument', { value: null, configurable: true })
    }
    expect(snap().unreadFrames).toBe(0)
  })

  test('an element inside a frame that is below the fold is offscreen', () => {
    load('<iframe data-box="0,700,300,500"></iframe>')
    fillFrame(el<HTMLIFrameElement>('iframe'), '<button data-box="0,200,80,20">Deep</button><button data-box="0,10,80,20">Near</button>')
    expect(itemLines(snap())).toEqual(['[1] button "Near"', '[2] button "Deep" offscreen'])
  })
})

describe('page program: frame sections', () => {
  function frameWith(html: string, box = '0,0,300,200', attributes = ''): HTMLIFrameElement {
    const frame = document.createElement('iframe')
    frame.setAttribute('data-box', box)
    for (const part of attributes.split(' ').filter(Boolean)) {
      const [name = '', value = ''] = part.split('=')
      frame.setAttribute(name, value)
    }
    document.body.appendChild(frame)
    layout(document)
    fillFrame(frame, html)
    return frame
  }

  function buttons(count: number, prefix: string): string {
    return Array.from({ length: count }, (_, i) => `<button data-box="0,${i * 22},50,20">${prefix}${i}</button>`).join('')
  }

  test('a page without iframes prints no section headers', () => {
    load('<button data-box="0,0,50,20">Go</button>')
    expect(snap().text).not.toContain('---')
  })

  test('puts each iframe in its own section with its id, title, parent and origin', () => {
    load('<button data-box="0,0,50,20">Top</button>')
    frameWith('<button data-box="0,0,50,20">Left</button>', '0,100,300,200', 'title=Left_board')
    frameWith('<button data-box="0,0,50,20">Right</button>', '400,100,300,200', 'name=right')
    const result = snap()
    const all = lines(result)
    const left = all.findIndex((line) => line.startsWith('--- iframe') && line.includes('"Left_board"'))
    const right = all.findIndex((line) => line.startsWith('--- iframe') && line.includes('"right"'))
    expect(all[left - 1]).toBe('[1] button "Top"')
    expect(all[left]).toMatch(/^--- iframe \[\d+\] "Left_board" \| inside page \| origin about:blank ---$/)
    expect(all[left + 1]).toBe('[2] button "Left"')
    expect(all[right + 1]).toBe('[3] button "Right"')
    expect(result.items.map((item) => item.id)).toEqual([1, 2, 3])
  })

  test('names srcdoc and data frames instead of printing an origin that is not one', () => {
    load('')
    frameWith('<button data-box="0,0,50,20">A</button>', '0,0,300,200', 'srcdoc=x')
    const text = snap().text
    expect(text).toMatch(/--- iframe \[\d+\] \| inside page \| origin srcdoc ---/)
  })

  test('says which iframe an iframe sits in', () => {
    load('')
    const outer = frameWith('', '0,0,400,300')
    const inner = document.createElement('iframe')
    inner.setAttribute('data-box', '0,0,200,100')
    ;(outer.contentDocument as Document).body.appendChild(inner)
    layout(outer.contentDocument as Document)
    fillFrame(inner, '<button data-box="0,0,50,20">Deep</button>')
    const headers = lines(snap()).filter((line) => line.startsWith('--- iframe'))
    expect(headers).toHaveLength(1)
    expect(headers[0]).toMatch(/^--- iframe \[(\d+)\] \| inside iframe \[\d+\] \|/)
  })

  test('keeps element numbers global and unchanged by sections', () => {
    load('<button data-box="0,0,50,20">Top</button>')
    frameWith('<button data-box="0,0,50,20">Inner</button>', '0,100,300,200')
    const first = snap()
    const second = snap()
    expect(first.items.map((item) => [item.id, item.name])).toEqual([
      [1, 'Top'],
      [2, 'Inner'],
    ])
    expect(second.items.map((item) => item.id)).toEqual([1, 2])
  })

  test('a delta lists changed elements under their section header', () => {
    load('<button data-box="0,0,50,20">Top</button>')
    const frame = frameWith('<button data-box="0,0,50,20">Inner</button>', '0,100,300,200')
    const first = snap({ delta: true })
    ;((frame.contentDocument as Document).querySelector('button') as Element).setAttribute('disabled', '')
    const second = snap({ delta: true, baseline: first.baseline })
    const all = lines(second)
    const at = all.findIndex((line) => line.startsWith('--- iframe'))
    expect(second.full).toBe(false)
    expect(all[at + 1]).toBe('[2] button "Inner" disabled')
    expect(all).not.toContain('[1] button "Top"')
  })

  test('gives every frame a share of the budget and hands unused shares to the others', () => {
    load(buttons(1, 'Page'))
    frameWith(buttons(10, 'A'), '0,100,300,300')
    frameWith(buttons(2, 'B'), '400,100,300,300')
    const result = snap({ maxItems: 8 })
    const names = result.items.map((item) => item.name)
    expect(names.filter((name) => name.startsWith('Page'))).toHaveLength(1)
    expect(names.filter((name) => name.startsWith('B'))).toHaveLength(2)
    expect(names.filter((name) => name.startsWith('A'))).toEqual(['A0', 'A1', 'A2', 'A3', 'A4'])
    expect(result.itemsDropped).toBe(5)
  })

  test('every one of twenty frames keeps elements when the budget is short', () => {
    load('')
    const compact = (prefix: string) =>
      Array.from({ length: 10 }, (_, i) => `<button data-box="0,${i * 12},50,10">${prefix}${i}</button>`).join('')
    for (let i = 0; i < 20; i += 1) frameWith(compact(`F${i}_`), `${(i % 5) * 200},${Math.floor(i / 5) * 160},190,150`)
    const result = snap({ maxItems: 150 })
    const perFrame = new Map<string, number>()
    for (const item of result.items) {
      const key = item.name.split('_')[0] as string
      perFrame.set(key, (perFrame.get(key) ?? 0) + 1)
    }
    expect(perFrame.size).toBe(20)
    expect(result.items).toHaveLength(150)
    expect(Math.min(...perFrame.values())).toBe(7)
    expect(Math.max(...perFrame.values())).toBe(8)
    expect(result.itemsDropped).toBe(50)
  })

  test('shows the viewport elements of every frame before offscreen ones', () => {
    load('<button data-box="0,5000,50,20">Page far</button>')
    frameWith('<button data-box="0,0,50,20">Frame near</button><button data-box="0,5000,50,20">Frame far</button>', '0,100,300,200')
    const result = snap({ maxItems: 2 })
    expect(result.items.map((item) => item.name).sort()).toEqual(['Frame near', 'Page far'].sort())
  })

  test('says in each section how many elements it left out', () => {
    load(buttons(1, 'Page'))
    frameWith(buttons(10, 'A'), '0,100,300,300')
    const result = snap({ maxItems: 4 })
    const all = lines(result)
    const header = all.findIndex((line) => line.startsWith('--- iframe'))
    const id = (all[header] as string).match(/\[(\d+)\]/)?.[1]
    expect(all[header + 1]).toBe('[2] button "A0"')
    expect(all[header + 3]).toBe('[4] button "A2"')
    expect(all[header + 4]).toBe(`(+7 more interactive elements in this frame not shown; pass region=${id} to read only this frame)`)
    expect(all).toContain('(+7 more interactive elements not shown)')
  })

  test('says in the page section how many elements it left out', () => {
    load(buttons(6, 'Page'))
    frameWith(buttons(1, 'A'), '400,0,300,300')
    const all = lines(snap({ maxItems: 3 }))
    expect(all).toContain('(+4 more interactive elements in the page itself not shown)')
  })

  test('a frame with no room left still gets a header and a count', () => {
    load('')
    for (let i = 0; i < 3; i += 1) frameWith(buttons(2, `F${i}_`), `${i * 310},0,300,200`)
    const all = lines(snap({ maxItems: 2 }))
    expect(all.filter((line) => line.startsWith('--- iframe'))).toHaveLength(3)
    expect(all.filter((line) => line.includes('more interactive elements in this frame not shown'))).toHaveLength(3)
  })

  test('reads just one iframe when the region is the id from its header', () => {
    load(buttons(1, 'Page'))
    frameWith(buttons(3, 'A'), '0,100,300,300', 'title=First')
    frameWith(buttons(3, 'B'), '400,100,300,300', 'title=Second')
    const full = snap()
    const headers = lines(full).filter((line) => line.startsWith('--- iframe'))
    const secondId = Number((headers[1] as string).match(/\[(\d+)\]/)?.[1])
    const result = snap({ region: secondId })
    expect(result.items.map((item) => item.name)).toEqual(['B0', 'B1', 'B2'])
    expect(result.text).toContain(`Region: [${secondId}]`)
    expect(lines(result).filter((line) => line.startsWith('--- iframe'))).toHaveLength(1)
  })

  test('reads the page text of the iframe the region points at', () => {
    load('<p data-box="0,0,100,20">Outer words</p>')
    const frame = frameWith('<p data-box="0,0,100,20">Frame words</p><button data-box="0,30,50,20">Go</button>', '0,100,300,200')
    const full = snap()
    const id = Number((lines(full).find((line) => line.startsWith('--- iframe')) as string).match(/\[(\d+)\]/)?.[1])
    expect(frame.isConnected).toBe(true)
    const result = snap({ region: id })
    expect(result.text).toContain('Frame words')
    expect(result.text).not.toContain('Outer words')
  })
})

describe('page program: page text', () => {
  test('uses main when present and collapses whitespace', () => {
    load(`
      <nav data-box="0,0,10,10">Navigation noise</nav>
      <main data-box="0,0,400,300"><h1>Title   here</h1>
        <p>Paragraph
          text</p></main>
    `)
    const all = lines(snap())
    expect(all[all.indexOf('## Page text') + 1]).toBe('Title here Paragraph text')
  })

  test('falls back to the body text', () => {
    load('<p>Just a body</p>')
    expect(lines(snap())).toContain('Just a body')
  })

  test('cuts the text at mainChars and reports how much was not shown', () => {
    load(`<main>${'a'.repeat(30)} ${'b'.repeat(30)}</main>`)
    const result = snap({ mainChars: 20 })
    expect(result.mainCharsDropped).toBe(41)
    expect(lines(result)).toContain('a'.repeat(20))
    expect(lines(result)).toContain('(page text cut: 41 characters not shown; pass textFrom=20 to continue)')
  })

  test('puts the text of an open dialog first without repeating it', () => {
    load(`
      <main>Background article text
        <div role="dialog" data-box="0,0,300,200">We use cookies <button data-box="0,0,50,20">Accept</button></div>
        More background
      </main>
    `)
    const result = snap()
    const text = lines(result)
    const start = text.indexOf('## Page text')
    expect(text[start + 1]).toBe('Dialog: We use cookies Accept')
    expect(text[start + 2]).toBe('Background article text More background')
    expect(result.text.match(/We use cookies/g)).toHaveLength(1)
  })

  test('a hidden dialog does not take over the page text', () => {
    load('<main>Plain page<div role="dialog" style="display:none" data-box="0,0,10,10">Hidden dialog</div></main>')
    expect(snap().text).not.toContain('Dialog:')
  })

  test('the dialog text counts against mainChars', () => {
    load(`<main>Rest of the page<div role="dialog" data-box="0,0,300,200">Dialog words here</div></main>`)
    const result = snap({ mainChars: 10 })
    expect(lines(result)).toContain('Dialog: Dialog wor')
    expect(result.mainCharsDropped).toBe('Dialog words here'.length - 10 + 'Rest of the page'.length)
  })
})

describe('page program: ids', () => {
  test('ids are small integers that stay the same across snapshots', () => {
    load('<button data-box="0,0,50,20">One</button><button data-box="0,30,50,20">Two</button>')
    const first = snap()
    const second = snap()
    expect(first.items.map((item) => item.id)).toEqual([1, 2])
    expect(second.items.map((item) => item.id)).toEqual([1, 2])
  })

  test('new elements get new ids and removed ids are never reused', () => {
    load('<button id="a" data-box="0,0,50,20">One</button><button id="b" data-box="0,30,50,20">Two</button>')
    snap()
    el('#a').remove()
    const added = document.createElement('button')
    added.textContent = 'Three'
    document.body.appendChild(added)
    place(added, 0, 60, 50, 20)
    const result = snap()
    expect(result.items.map((item) => `${item.id}:${item.name}`)).toEqual(['2:Two', '3:Three'])
  })

  test('an element keeps its id when it moves in the document', () => {
    load('<div id="x"><button data-box="0,0,50,20">Mover</button></div><div id="y"></div>')
    const first = snap()
    el('#y').appendChild(el('button'))
    expect(snap().items[0]?.id).toBe(first.items[0]?.id)
  })

  test('a node keeps its id while other nodes come and go and the ranking changes', () => {
    load(`
      <button id="a" data-box="0,0,50,20">Alpha</button>
      <button id="b" data-box="0,30,50,20">Beta</button>
      <button id="c" data-box="0,60,50,20">Gamma</button>
    `)
    const first = snap()
    expect(first.items.map((item) => `${item.id}:${item.name}`)).toEqual(['1:Alpha', '2:Beta', '3:Gamma'])
    el('#b').remove()
    const added = document.createElement('button')
    added.textContent = 'Delta'
    document.body.insertBefore(added, el('#a'))
    place(added, 0, 90, 50, 20)
    place(el('#a'), 0, 5000, 50, 20)
    const second = snap()
    expect(second.items.map((item) => `${item.id}:${item.name}:${item.offscreen}`)).toEqual([
      '4:Delta:false',
      '3:Gamma:false',
      '1:Alpha:true',
    ])
  })

  test('an id is never handed to another node, even the highest one after its node was removed', () => {
    load('<button id="a" data-box="0,0,50,20">One</button><button id="b" data-box="0,30,50,20">Two</button>')
    snap()
    el('#b').remove()
    const added = document.createElement('button')
    added.textContent = 'Three'
    document.body.appendChild(added)
    place(added, 0, 60, 50, 20)
    const result = snap()
    expect(result.items.map((item) => `${item.id}:${item.name}`)).toEqual(['1:One', '3:Three'])
    expect(locate(2)).toMatchObject({ ok: false, reason: 'gone' })
  })

  test('an id of a removed node is reported as gone and a never issued id as unknown', () => {
    load('<button id="a" data-box="0,0,50,20">One</button><input id="b" aria-label="Two" data-box="0,30,50,20">')
    snap()
    el('#a').remove()
    el('#b').remove()
    const gone = (id: number) => ({ ok: false, reason: 'gone', detail: `Element ${id} is no longer on the page. Take a new snapshot.` })
    expect(locate(1)).toEqual(gone(1))
    expect(focus(2)).toEqual(gone(2))
    expect(locate(3)).toEqual({ ok: false, reason: 'unknown_id', detail: 'No element has this id. Take a new snapshot to get current ids.' })
    snap()
    expect(locate(1)).toEqual(gone(1))
    expect(run('snapshot', { ...DEFAULTS, region: 2 })).toEqual({ error: 'gone' })
    expect(run('snapshot', { ...DEFAULTS, region: 3 })).toEqual({ error: 'unknown_id' })
  })

  test('an element inside a removed iframe is gone', () => {
    load('<iframe data-box="0,0,200,100"></iframe>')
    fillFrame(el<HTMLIFrameElement>('iframe'), '<button data-box="0,0,50,20">Inner</button>')
    const id = idOf(snap(), 'Inner')
    el('iframe').remove()
    expect(locate(id)).toMatchObject({ ok: false, reason: 'gone' })
  })

  test('the registry drops entries of removed nodes at each snapshot', () => {
    load(`
      <button id="a" data-box="0,0,50,20">One</button>
      <button id="b" data-box="0,30,50,20">Two</button>
      <button id="c" data-box="0,60,50,20">Three</button>
    `)
    const registry = () => (jsdomWindow() as unknown as Record<string, Registry>)[STATE_KEY] as Registry
    snap()
    expect(Array.from(registry().refs.keys())).toEqual([1, 2, 3])
    el('#a').remove()
    el('#c').remove()
    expect(Array.from(registry().refs.keys())).toEqual([1, 2, 3])
    snap()
    expect(Array.from(registry().refs.keys())).toEqual([2])
    expect(registry().next).toBe(4)
  })

  test('a node that was removed and put back keeps its original id', () => {
    load('<button id="a" data-box="0,0,50,20">One</button><button id="b" data-box="0,30,50,20">Two</button>')
    const first = snap()
    const detached = el('#a')
    detached.remove()
    snap()
    expect(locate(idOf(first, 'One'))).toMatchObject({ ok: false, reason: 'gone' })
    document.body.appendChild(detached)
    const again = snap()
    expect(idOf(again, 'One')).toBe(idOf(first, 'One'))
    expect(locate(idOf(first, 'One'))).toMatchObject({ ok: true })
  })

  test('writes nothing into the page DOM', () => {
    load(`
      <button data-box="0,0,50,20">Go</button>
      <input type="text" aria-label="Name" data-box="0,30,50,20">
      <iframe data-box="0,100,200,100"></iframe>
    `)
    fillFrame(el<HTMLIFrameElement>('iframe'), '<button data-box="0,0,50,20">Inner</button>')
    const host = el('iframe')
    const shadowHost = document.createElement('div')
    document.body.appendChild(shadowHost)
    shadowHost.attachShadow({ mode: 'open' }).innerHTML = '<button>Shadow</button>'
    const before = document.documentElement.outerHTML
    const innerBefore = (host as HTMLIFrameElement).contentDocument?.documentElement.outerHTML
    const result = snap()
    locate(idOf(result, 'Go'))
    focus(idOf(result, 'Name'))
    expect(document.documentElement.outerHTML).toBe(before)
    expect((host as HTMLIFrameElement).contentDocument?.documentElement.outerHTML).toBe(innerBefore)
    expect(shadowHost.shadowRoot?.innerHTML).toBe('<button>Shadow</button>')
  })

  test('keeps its registry on the global of the window it runs in, under one property', () => {
    load('<button data-box="0,0,50,20">Go</button>')
    const before = new Set(Object.keys(jsdomWindow()))
    snap()
    const added = Object.keys(jsdomWindow()).filter((key) => !before.has(key))
    expect(added).toEqual([STATE_KEY])
  })
})

describe('page program: delta', () => {
  function pageWithThree() {
    load(`
      <main data-box="0,0,400,300">Stock list
        <button id="a" data-box="0,0,50,20">Alpha</button>
        <button id="b" data-box="0,30,50,20">Beta</button>
        <button id="c" data-box="0,60,50,20">Gamma</button>
      </main>
    `)
  }

  test('with a matching baseline and nothing changed it returns only the header', () => {
    pageWithThree()
    const first = snap()
    const second = snap({ delta: true, baseline: first.baseline })
    expect(second.full).toBe(false)
    expect(second.baseline).not.toBe(first.baseline)
    expect(lines(second)).toEqual([
      'URL: http://localhost:3000/',
      'Title: Test page',
      `Snapshot: ${second.baseline} delta`,
      'Changes: 0 interactive elements changed or new, 0 removed, page text unchanged',
    ])
    expect(second.items).toHaveLength(3)
  })

  test('returns changed and new items and a removed line', () => {
    pageWithThree()
    const first = snap()
    el<HTMLButtonElement>('#b').disabled = true
    el('#c').remove()
    const added = document.createElement('button')
    added.textContent = 'Delta'
    el('main').appendChild(added)
    place(added, 0, 90, 50, 20)
    const second = snap({ delta: true, baseline: first.baseline })
    expect(second.full).toBe(false)
    expect(lines(second).slice(3)).toEqual([
      'Changes: 2 interactive elements changed or new, 1 removed, page text changed',
      '## Page text',
      'Stock list Alpha Beta Delta',
      '## Interactive elements (changed or new)',
      '[2] button "Beta" disabled',
      '[4] button "Delta"',
      'removed: 3',
    ])
  })

  test('includes the page text only when it changed', () => {
    pageWithThree()
    const first = snap()
    el('main').firstChild!.textContent = 'Stock list updated '
    const second = snap({ delta: true, baseline: first.baseline })
    expect(second.text).toContain('page text changed')
    expect(second.text).toContain('Stock list updated Alpha Beta Gamma')
    expect(second.text).not.toContain('## Interactive elements')
    const third = snap({ delta: true, baseline: second.baseline })
    expect(third.text).toContain('page text unchanged')
    expect(third.text).not.toContain('## Page text')
  })

  test('compares by node, so reordering the DOM changes nothing but replacing a node does', () => {
    pageWithThree()
    const first = snap()
    const main = el('main')
    main.appendChild(el('#a'))
    place(el('#a'), 0, 90, 50, 20)
    const reordered = snap({ delta: true, baseline: first.baseline })
    expect(lines(reordered)).toContain('Changes: 0 interactive elements changed or new, 0 removed, page text changed')
    expect(itemLines(reordered)).toEqual([])
    const replaced = el('#b').cloneNode(true) as HTMLElement
    el('#b').replaceWith(replaced)
    place(replaced, 0, 30, 50, 20)
    const second = snap({ delta: true, baseline: reordered.baseline })
    expect(lines(second)).toContain('Changes: 1 interactive elements changed or new, 1 removed, page text unchanged')
    expect(itemLines(second)).toEqual(['[4] button "Beta"'])
    expect(lines(second)).toContain('removed: 2')
  })

  test('reports scrolling as changed offscreen flags', () => {
    pageWithThree()
    const first = snap()
    place(el('#c'), 0, 5000, 50, 20)
    const second = snap({ delta: true, baseline: first.baseline })
    expect(lines(second)).toContain('[3] button "Gamma" offscreen')
    expect(itemLines(second)).toHaveLength(1)
  })

  test('a mismatching baseline falls back to a full snapshot', () => {
    pageWithThree()
    const first = snap()
    const second = snap({ delta: true, baseline: 'not-the-baseline' })
    expect(second.full).toBe(true)
    expect(second.text).toContain('## Interactive elements')
    expect(itemLines(second)).toHaveLength(3)
    const stale = snap({ delta: true, baseline: first.baseline })
    expect(stale.full).toBe(true)
  })

  test('a null baseline, delta off, or a first snapshot are all full', () => {
    pageWithThree()
    expect(snap({ delta: true, baseline: null }).full).toBe(true)
    const next = snap()
    expect(snap({ delta: false, baseline: next.baseline }).full).toBe(true)
  })

  test('the baseline of a snapshot in a fresh document matches nothing', () => {
    pageWithThree()
    const first = snap()
    delete (jsdomWindow() as unknown as Record<string, unknown>)[STATE_KEY]
    expect(snap({ delta: true, baseline: first.baseline }).full).toBe(true)
  })

  test('a different region than the previous snapshot falls back to full', () => {
    load('<div tabindex="0" aria-label="Panel" data-box="0,0,300,200"><button data-box="0,0,50,20">Inner</button></div>')
    const first = snap()
    const second = snap({ delta: true, baseline: first.baseline, region: idOf(first, 'Panel') })
    expect(second.full).toBe(true)
  })
})

describe('page program: region', () => {
  test('restricts page text and items to the subtree of the element', () => {
    load(`
      <main data-box="0,0,400,400">Outside text
        <button data-box="0,0,50,20">Outside button</button>
        <div tabindex="0" aria-label="Panel" data-box="0,100,300,200">Panel text
          <button data-box="0,110,50,20">Inside button</button>
          <input aria-label="Inside input" data-box="0,140,50,20">
        </div>
      </main>
    `)
    const full = snap()
    const result = snap({ region: idOf(full, 'Panel') })
    expect(result.items.map((item) => item.name)).toEqual(['Panel', 'Inside button', 'Inside input'])
    expect(result.text).toContain('Region: [2]')
    expect(result.text).toContain('Panel text Inside button')
    expect(result.text).not.toContain('Outside')
  })

  test('reads shadow roots and frames inside the region', () => {
    load('<div tabindex="0" aria-label="Panel" data-box="0,0,300,300"><div id="host"></div></div>')
    const shadow = el('#host').attachShadow({ mode: 'open' })
    shadow.innerHTML = '<button data-box="0,10,50,20">In shadow</button>'
    layout(shadow)
    const full = snap()
    expect(full.items.map((item) => item.name)).toEqual(['Panel', 'In shadow'])
    expect(snap({ region: idOf(full, 'Panel') }).items.map((item) => item.name)).toEqual(['Panel', 'In shadow'])
  })

  test('an unknown id returns an error object', () => {
    load('<button data-box="0,0,50,20">Go</button>')
    snap()
    expect(run('snapshot', { ...DEFAULTS, region: 99 })).toEqual({ error: 'unknown_id' })
  })

  test('an id of a removed element is reported as gone, not unknown, as a region', () => {
    load('<div tabindex="0" aria-label="Panel" data-box="0,0,300,300"></div>')
    const first = snap()
    el('div').remove()
    expect(run('snapshot', { ...DEFAULTS, region: idOf(first, 'Panel') })).toEqual({ error: 'gone' })
  })

  test('an id from an earlier snapshot still selects the region after other snapshots', () => {
    load(`
      <main data-box="0,0,400,400">Outside text
        <div tabindex="0" aria-label="Panel" data-box="0,100,300,200">Panel text
          <button data-box="0,110,50,20">Inside button</button>
        </div>
      </main>
    `)
    const first = snap()
    const added = document.createElement('button')
    added.textContent = 'Late arrival'
    el('main').appendChild(added)
    place(added, 0, 350, 50, 20)
    snap()
    const result = snap({ region: idOf(first, 'Panel') })
    expect(result.items.map((item) => item.name)).toEqual(['Panel', 'Inside button'])
  })
})

describe('page program: locate', () => {
  test('scrolls the element to the center and returns its center point', () => {
    load('<button data-box="100,200,60,20">Go</button>')
    const result = snap()
    const button = el<HTMLButtonElement>('button') as unknown as Placed
    const found = locate(idOf(result, 'Go'))
    expect(found).toEqual({ ok: true, x: 130, y: 210, role: 'button', name: 'Go' })
    expect(button.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'center' })
  })

  test('adds the offsets of every iframe the element sits in', () => {
    load('<iframe data-box="100,50,400,300"></iframe>')
    const outer = el<HTMLIFrameElement>('iframe')
    fillFrame(outer, '<iframe data-box="20,30,300,200"></iframe>')
    const inner = (outer.contentDocument as Document).querySelector('iframe') as HTMLIFrameElement
    fillFrame(inner, '<button data-box="10,20,40,20">Deep</button>')
    const found = locate(idOf(snap(), 'Deep'))
    expect(found).toEqual({ ok: true, x: 100 + 20 + 10 + 20, y: 50 + 30 + 20 + 10, role: 'button', name: 'Deep' })
  })

  test('scales the coordinates inside an iframe that is drawn smaller than its layout size', () => {
    load('<iframe data-box="100,50,200,150"></iframe>')
    const frame = el<HTMLIFrameElement>('iframe')
    sizeFrame(frame, 400, 300)
    fillFrame(frame, '<button data-box="10,20,40,20">Go</button>')
    expect(locate(idOf(snap(), 'Go'))).toEqual({ ok: true, x: 115, y: 65, role: 'button', name: 'Go' })
  })

  test('scales the frame border and uses each axis separately', () => {
    load('<iframe data-box="100,50,200,300"></iframe>')
    const frame = el<HTMLIFrameElement>('iframe')
    sizeFrame(frame, 400, 300, 4)
    fillFrame(frame, '<button data-box="10,20,40,20">Go</button>')
    expect(locate(idOf(snap(), 'Go'))).toEqual({ ok: true, x: 100 + 2 + 15, y: 50 + 4 + 30, role: 'button', name: 'Go' })
  })

  test('multiplies the scale of nested iframes', () => {
    load('<iframe data-box="100,50,200,150"></iframe>')
    const outer = el<HTMLIFrameElement>('iframe')
    sizeFrame(outer, 400, 300)
    fillFrame(outer, '<iframe data-box="20,30,300,200"></iframe>')
    const inner = (outer.contentDocument as Document).querySelector('iframe') as HTMLIFrameElement
    sizeFrame(inner, 600, 400)
    fillFrame(inner, '<button data-box="10,20,40,20">Deep</button>')
    expect(locate(idOf(snap(), 'Deep'))).toEqual({ ok: true, x: 117.5, y: 72.5, role: 'button', name: 'Deep' })
  })

  test('treats a frame without a layout size as unscaled', () => {
    load('<iframe data-box="100,50,200,150"></iframe>')
    const frame = el<HTMLIFrameElement>('iframe')
    sizeFrame(frame, 0, 0)
    fillFrame(frame, '<button data-box="10,20,40,20">Go</button>')
    expect(locate(idOf(snap(), 'Go'))).toEqual({ ok: true, x: 130, y: 80, role: 'button', name: 'Go' })
  })

  test('reports the box of an element in a scaled iframe in page coordinates', () => {
    load('<iframe data-box="100,50,200,150"></iframe>')
    const frame = el<HTMLIFrameElement>('iframe')
    sizeFrame(frame, 400, 300)
    fillFrame(frame, '<button data-box="10,20,40,20">Go</button>')
    const result = styles(idOf(snap(), 'Go'), ['display'])
    expect(result).toMatchObject({ ok: true, box: { x: 105, y: 60, width: 20, height: 10 } })
  })

  test('finds an element of the page that covers the scaled click point', () => {
    load('<iframe data-box="100,50,200,150"></iframe><div data-box="125,50,10,150">Over</div>')
    const frame = el<HTMLIFrameElement>('iframe')
    sizeFrame(frame, 400, 300)
    fillFrame(frame, '<button data-box="10,20,100,20">Wide</button>')
    expect(locate(idOf(snap(), 'Wide'))).toMatchObject({ ok: false, reason: 'covered' })
  })

  test('works for an element in a shadow root', () => {
    load('<div id="host"></div>')
    const shadow = el('#host').attachShadow({ mode: 'open' })
    shadow.innerHTML = '<button data-box="10,10,50,20">Shadow</button>'
    layout(shadow)
    ;(shadow as unknown as { elementFromPoint: unknown }).elementFromPoint = hitTest(shadow)
    expect(locate(idOf(snap(), 'Shadow'))).toEqual({ ok: true, x: 35, y: 20, role: 'button', name: 'Shadow' })
  })

  test('uses the first line box of a wrapped inline element', () => {
    load('<a href="/x">Long link</a>')
    const link = el('a')
    const first = rectFor(10, 10, 100, 20)
    const second = rectFor(0, 30, 40, 20)
    const union = rectFor(0, 10, 110, 40)
    Object.defineProperty(link, 'getBoundingClientRect', { value: () => union })
    Object.defineProperty(link, 'getClientRects', { value: () => [first, second] })
    ;(link as unknown as Placed).scrollIntoView = vi.fn()
    ;(document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => link
    snap()
    expect(locate(1)).toMatchObject({ ok: true, x: 60, y: 20 })
  })

  test('unknown_id for ids that were never handed out', () => {
    expect(locate(1)).toMatchObject({ ok: false, reason: 'unknown_id' })
    load('<button data-box="0,0,50,20">Go</button>')
    snap()
    expect(locate(2)).toMatchObject({ ok: false, reason: 'unknown_id' })
    expect(locate(0)).toMatchObject({ ok: false, reason: 'unknown_id' })
    expect(locate(1.5)).toMatchObject({ ok: false, reason: 'unknown_id' })
  })

  test('gone when the element was removed', () => {
    load('<button data-box="0,0,50,20">Go</button>')
    const id = idOf(snap(), 'Go')
    el('button').remove()
    const result = locate(id)
    expect(result).toEqual({ ok: false, reason: 'gone', detail: `Element ${id} is no longer on the page. Take a new snapshot.` })
  })

  test('hidden when the element stopped being visible', () => {
    load('<button data-box="0,0,50,20">Go</button><button data-box="0,30,50,20">Other</button><button data-box="0,60,50,20">Third</button>')
    const result = snap()
    el('button').style.display = 'none'
    expect(locate(idOf(result, 'Go'))).toMatchObject({ ok: false, reason: 'hidden' })
    el<HTMLElement>('button:nth-of-type(2)').setAttribute('aria-hidden', 'true')
    expect(locate(idOf(result, 'Other'))).toMatchObject({ ok: false, reason: 'hidden' })
    place(el('button:nth-of-type(3)'), 0, 60, 0, 0)
    expect(locate(idOf(result, 'Third'))).toMatchObject({ ok: false, reason: 'hidden' })
  })

  test('hidden when the element is clipped away even after scrolling', () => {
    load('<div style="overflow:hidden" data-box="0,0,100,50"><button data-box="0,300,50,20">Cut off</button></div>')
    expect(locate(idOf(snap(), 'Cut off'))).toMatchObject({ ok: false, reason: 'hidden' })
  })

  test('disabled by the attribute or by aria-disabled', () => {
    load('<button disabled data-box="0,0,50,20">Off</button><div role="button" aria-disabled="true" data-box="0,30,50,20">Soft off</div>')
    const result = snap()
    expect(locate(idOf(result, 'Off'))).toMatchObject({ ok: false, reason: 'disabled' })
    expect(locate(idOf(result, 'Soft off'))).toMatchObject({ ok: false, reason: 'disabled' })
  })

  test('covered by another element, named by role and name', () => {
    load(`
      <button data-box="100,100,100,40">Buy</button>
      <div role="dialog" aria-label="Cookie banner" data-box="0,0,800,700"></div>
    `)
    const result = locate(idOf(snap(), 'Buy'))
    expect(result).toMatchObject({ ok: false, reason: 'covered' })
    expect((result as { detail: string }).detail).toContain('dialog "Cookie banner"')
  })

  test('covered by a plain element is described by its tag and text', () => {
    load('<button data-box="100,100,100,40">Buy</button><div data-box="0,0,800,700">Loading overlay</div>')
    const result = locate(idOf(snap(), 'Buy'))
    expect((result as { detail: string }).detail).toContain('div "Loading overlay"')
  })

  test('a child or a parent at the click point is not covering', () => {
    load(`
      <button data-box="0,0,100,40"><span data-box="10,10,80,20">Label</span></button>
      <div role="button" tabindex="0" data-box="0,100,100,40">Outer<span data-box="0,100,100,40">x</span></div>
    `)
    const result = snap()
    expect(locate(idOf(result, 'Label'))).toMatchObject({ ok: true })
    const outer = result.items.find((item) => item.name === 'Outerx')
    expect(outer).toBeDefined()
    expect(locate((outer as { id: number }).id)).toMatchObject({ ok: true })
  })

  test('an element in a frame covered by something in the parent page', () => {
    load('<iframe data-box="100,100,300,200"></iframe><div data-box="0,0,800,700">Overlay</div>')
    fillFrame(el<HTMLIFrameElement>('iframe'), '<button data-box="10,10,80,20">Inner</button>')
    const result = locate(idOf(snap(), 'Inner'))
    expect(result).toMatchObject({ ok: false, reason: 'covered' })
    expect((result as { detail: string }).detail).toContain('Overlay')
  })

  test('covered when nothing receives clicks at the point', () => {
    load('<button data-box="0,0,50,20">Go</button>')
    const id = idOf(snap(), 'Go')
    ;(document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => null
    expect(locate(id)).toMatchObject({ ok: false, reason: 'covered' })
  })

  test('a shadow root that reports nothing falls back to the document hit test', () => {
    load('<div id="host" data-box="0,0,200,100"></div><div data-box="0,0,200,100">Overlay</div>')
    const host = el('#host')
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<button data-box="10,10,50,20">Under</button>'
    layout(shadow)
    ;(shadow as unknown as { elementFromPoint: unknown }).elementFromPoint = () => null
    expect(locate(idOf(snap(), 'Under'))).toMatchObject({ ok: false, reason: 'covered' })
    ;(document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => host
    expect(locate(1)).toMatchObject({ ok: true })
  })
})

describe('page program: focus', () => {
  test('focuses a text input', () => {
    load('<input type="text" aria-label="Name" data-box="0,0,100,20">')
    const id = idOf(snap(), 'Name')
    expect(focus(id)).toEqual({ ok: true })
    expect(document.activeElement).toBe(el('input'))
  })

  test('clear selects the whole content of an input and a textarea', () => {
    load('<input type="text" aria-label="Name" data-box="0,0,100,20"><textarea aria-label="Bio" data-box="0,30,100,20"></textarea>')
    el<HTMLInputElement>('input').value = 'old value'
    el<HTMLTextAreaElement>('textarea').value = 'some old bio'
    const result = snap()
    expect(focus(idOf(result, 'Name'), true)).toEqual({ ok: true })
    const input = el<HTMLInputElement>('input')
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 9])
    expect(focus(idOf(result, 'Bio'), true)).toEqual({ ok: true })
    const area = el<HTMLTextAreaElement>('textarea')
    expect([area.selectionStart, area.selectionEnd]).toEqual([0, 12])
  })

  test('without clear the existing selection is left alone', () => {
    load('<input type="text" aria-label="Name" data-box="0,0,100,20">')
    const input = el<HTMLInputElement>('input')
    input.value = 'keep me'
    input.setSelectionRange(2, 2)
    focus(idOf(snap(), 'Name'), false)
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2])
  })

  test('clear selects the content of a contenteditable', () => {
    load('<div contenteditable="true" aria-label="Editor" data-box="0,0,100,20">old <b>rich</b> text</div>')
    const id = idOf(snap(), 'Editor')
    expect(focus(id, true)).toEqual({ ok: true })
    expect(document.getSelection()?.toString()).toBe('old rich text')
  })

  test('a contenteditable inside an iframe is selected in the frame own selection', () => {
    load('<iframe data-box="0,0,300,100"></iframe>')
    const frame = el<HTMLIFrameElement>('iframe')
    fillFrame(frame, '<div contenteditable="true" aria-label="Framed" data-box="0,0,100,20">framed text</div>')
    expect(focus(idOf(snap(), 'Framed'), true)).toEqual({ ok: true })
    expect(frame.contentDocument?.getSelection()?.toString()).toBe('framed text')
  })

  test('not_editable for buttons, checkboxes, links and plain widgets', () => {
    load(`
      <button data-box="0,0,50,20">Btn</button>
      <input type="checkbox" aria-label="Check" data-box="0,0,50,20">
      <input type="submit" value="Submit" data-box="0,0,50,20">
      <a href="/" data-box="0,0,50,20">Link</a>
      <select aria-label="Choice" data-box="0,0,50,20"></select>
      <div role="textbox" data-box="0,0,50,20">Fake</div>
    `)
    const result = snap()
    for (const item of result.items) {
      expect(focus(item.id)).toMatchObject({ ok: false, reason: 'not_editable' })
    }
  })

  test('not_editable for a read-only field', () => {
    load('<input type="text" readonly aria-label="Fixed" data-box="0,0,50,20">')
    expect(focus(idOf(snap(), 'Fixed'))).toMatchObject({ ok: false, reason: 'not_editable' })
  })

  test('disabled, gone and unknown_id', () => {
    load('<input type="text" aria-label="Off" disabled data-box="0,0,50,20"><input type="text" aria-label="On" data-box="0,30,50,20">')
    const result = snap()
    expect(focus(idOf(result, 'Off'))).toMatchObject({ ok: false, reason: 'disabled' })
    el('input:not([disabled])').remove()
    expect(focus(idOf(result, 'On'))).toEqual({
      ok: false,
      reason: 'gone',
      detail: `Element ${idOf(result, 'On')} is no longer on the page. Take a new snapshot.`,
    })
    expect(focus(77)).toMatchObject({ ok: false, reason: 'unknown_id' })
  })
})

type ReleaseOptions = { count?: number; breaking?: number[] }

function releasesPage({ count = 6, breaking = [1, 4] }: ReleaseOptions = {}): string {
  const releases = Array.from({ length: count }, (_, index) => {
    const version = `v1.${count - index}.0`
    const top = 100 + index * 1000
    const notes = Array.from(
      { length: 8 },
      (_, note) => `<li>Change ${note} in ${version}: ${'refined the sidebar behaviour '.repeat(7)}</li>`,
    ).join('')
    const breakingSection = breaking.includes(index)
      ? `<h3>Breaking changes</h3>
         <ul><li>Removed the legacy session API <a href="/pull/${900 + index}" data-box="40,${top + 500},60,20">#${900 + index}</a></li></ul>`
      : ''
    return `<section>
      <h2><a href="/releases/tag/${version}" data-box="20,${top},120,24">${version}</a></h2>
      <p>What is new in ${version}</p>
      <ul>${notes}</ul>
      ${breakingSection}
      <h3>Assets <span>3</span></h3>
      <ul>
        <li><a href="/dl/${version}.dmg" data-box="40,${top + 600},200,20">dreamcoder-${version}-mac.dmg</a></li>
        <li><a href="/dl/${version}.zip" data-box="40,${top + 640},200,20">Source code (zip)</a></li>
      </ul>
    </section>`
  }).join('')
  return `<main data-box="0,0,900,${count * 1000}"><h1>Releases</h1>${releases}</main>`
}

function pageTextOf(result: SnapshotResult): string[] {
  const all = lines(result)
  const start = all.findIndex((line) => line.startsWith('## Page text'))
  const end = all.indexOf('## Interactive elements')
  return all.slice(start + 1, end)
}

function withoutPosition(line: string): string {
  return line.replace(/ \(page text from character \d+: pass textFrom=\d+ to read on\)$/, '')
}

function positionOf(line: string): number | null {
  const found = /\(page text from character (\d+): pass textFrom=(\d+) to read on\)$/.exec(line)
  if (!found) return null
  expect(found[2]).toBe(found[1])
  return Number(found[1])
}

function blockInnerText(): void {
  const main = el('main')
  const blocks = Array.from(main.querySelectorAll('h1,h2,h3,p,li'))
  Object.defineProperty(main, 'innerText', { value: blocks.map((block) => block.textContent).join('\n'), configurable: true })
}

function notesPage(): string {
  const notes = (version: string) =>
    Array.from({ length: 12 }, (_, note) => `<li>${version} note ${note}: ${'tightened the workspace layout '.repeat(5)}</li>`).join('')
  return `<main>
    <h1>Releases</h1>
    <section><h2>DreamCoder v0.7.0</h2><ul>${notes('v0.7.0')}</ul></section>
    <section><h2>DreamCoder v0.6.0</h2><p>Release notes for the stable line</p><ul>${notes('v0.6.0')}</ul></section>
    <aside><h2>DreamCoder v0.6.0</h2><p>Pinned as the recommended download</p></aside>
    <section><h2>DreamCoder v0.5.0</h2><ul>${notes('v0.5.0')}</ul></section>
  </main>`
}

describe('page program: find', () => {
  test('reports the position of each match in the page text and the text that follows it', () => {
    load(notesPage(), 'Releases')
    blockInnerText()
    const result = snap({ find: 'DreamCoder v0.6.0' })
    const all = lines(result)
    const headers = all.filter((line) => /^\d+\. /.test(line))
    expect(headers).toHaveLength(2)
    const full = snap({ mainChars: 100000, textFrom: 0 })
    const pageText = pageTextOf(full).join('')
    const first = positionOf(headers[0] as string) as number
    expect(pageText.startsWith('DreamCoder v0.6.0', first)).toBe(true)
    expect(first).toBe(pageText.indexOf('DreamCoder v0.6.0'))
    const second = positionOf(headers[1] as string) as number
    expect(second).toBe(pageText.indexOf('DreamCoder v0.6.0', first + 1))
    expect(second).toBeGreaterThan(first)
    const thens = all.filter((line) => line.startsWith('   then: '))
    expect(thens[0]).toMatch(/^ {3}then: Release notes for the stable line v0\.6\.0 note 0: tightened the workspace layout/)
    expect(thens[0]?.endsWith('…')).toBe(true)
    expect((thens[0] as string).length).toBeLessThanOrEqual('   then: '.length + 600)
    expect(thens[1]).toMatch(/^ {3}then: Pinned as the recommended download DreamCoder v0\.5\.0 /)
  })

  test('a snapshot from the reported position starts with the matched block, also for a repeated heading', () => {
    load(notesPage(), 'Releases')
    blockInnerText()
    const headers = lines(snap({ find: 'DreamCoder v0.6.0' })).filter((line) => /^\d+\. /.test(line))
    const positions = headers.map((line) => positionOf(line) as number)
    expect(new Set(positions).size).toBe(2)
    for (const position of positions) {
      const read = snap({ textFrom: position, mainChars: 400 })
      const text = pageTextOf(read)
      expect(lines(read)).toContain(`## Page text (from character ${position})`)
      expect(text[0]).toMatch(/^\(the first \d+ of \d+ characters of page text were skipped\)$/)
      expect(text[1]?.startsWith('DreamCoder v0.6.0 ')).toBe(true)
    }
    const afterFirst = pageTextOf(snap({ textFrom: positions[0] as number, mainChars: 400 }))[1] as string
    expect(afterFirst.startsWith('DreamCoder v0.6.0 Release notes for the stable line')).toBe(true)
    const afterSecond = pageTextOf(snap({ textFrom: positions[1] as number, mainChars: 400 }))[1] as string
    expect(afterSecond.startsWith('DreamCoder v0.6.0 Pinned as the recommended download')).toBe(true)
  })

  test('prints no position for a match inside a dialog and counts the others in the page text without the dialog', () => {
    load(`<main>
      <div role="dialog" data-box="0,0,300,300"><p>needle in the dialog</p></div>
      <p>intro</p><p>needle in the page</p><p>outro text</p>
    </main>`)
    blockInnerText()
    const result = snap({ find: 'needle' })
    const headers = lines(result).filter((line) => /^\d+\. /.test(line))
    expect(headers).toHaveLength(2)
    expect(headers[0]).toBe('1. needle in the dialog')
    const position = positionOf(headers[1] as string) as number
    const read = pageTextOf(snap({ textFrom: position }))
    expect(read[1]).toBe('needle in the page outro text')
    expect(lines(result).filter((line) => line.startsWith('   then:'))).toEqual(['   then: outro text'])
  })

  test('prints no position or excerpt for a block whose text is not one run of the page text', () => {
    load('<main><div>before <div>inner</div> needle after</div><p>needle tail</p></main>')
    Object.defineProperty(el('main'), 'innerText', { value: 'before\ninner\nneedle after\nneedle tail' })
    const result = snap({ find: 'needle' })
    const headers = lines(result).filter((line) => /^\d+\. /.test(line))
    expect(headers[0]).toBe('1. before needle after')
    expect(positionOf(headers[1] as string)).not.toBeNull()
    expect(lines(result).filter((line) => line.startsWith('   then:'))).toHaveLength(0)
  })

  test('shows no excerpt when nothing follows the match', () => {
    load('<main><p>intro</p><p>the last needle</p></main>')
    blockInnerText()
    const result = snap({ find: 'last needle' })
    expect(lines(result).some((line) => line.startsWith('   then:'))).toBe(false)
    expect(lines(result)).toContain('1. the last needle (page text from character 6: pass textFrom=6 to read on)')
  })

  test('limits the excerpts to 6000 characters in all and says so', () => {
    const filler = 'lorem ipsum dolor sit amet '.repeat(30)
    load(`<main>${Array.from({ length: 14 }, (_, i) => `<p>needle ${i}</p><p>${filler}</p>`).join('')}</main>`)
    blockInnerText()
    const result = snap({ find: 'needle' })
    const all = lines(result)
    const thens = all.filter((line) => line.startsWith('   then: '))
    expect(thens).toHaveLength(10)
    expect(thens.every((line) => line.length === '   then: '.length + 600)).toBe(true)
    expect(all.filter((line) => /^\d+\. needle \d+ \(page text from character/.test(line))).toHaveLength(14)
    expect(all).toContain('(text after 4 matches not shown: excerpts are limited to 6000 characters in all)')
    expect(all[all.indexOf('## Matches for "needle" (14)') + 1]).toMatch(/^1\. needle 0 /)
  })

  test('lists the matching blocks in document order with the ids of the elements inside them', () => {
    load(releasesPage(), 'Releases')
    const result = snap({ find: 'breaking changes', maxItems: 150 })
    const all = lines(result)
    const start = all.indexOf('## Matches for "breaking changes" (2)')
    expect(start).toBe(3)
    expect(all[start]).toBe('## Matches for "breaking changes" (2)')
    expect(all[start + 1]).toMatch(/^1\. Breaking changes \(page text from character \d+: pass textFrom=\d+ to read on\)$/)
    expect(all[start + 2]).toMatch(/^ {3}then: Removed the legacy session API #901 Assets 3 /)
    expect(all.filter((line) => /^\d+\. /.test(line))).toHaveLength(2)
    expect(all.find((line) => line.startsWith('2. '))).toMatch(/^2\. Breaking changes /)
    expect(all).toContain('## Interactive elements')
    expect(result.text).not.toContain('## Page text')
    expect(result.full).toBe(true)
  })

  test('shows the text of the nearest block and the ids of the links inside it', () => {
    load(releasesPage(), 'Releases')
    const result = snap({ find: 'legacy session api' })
    const all = lines(result)
    const first = all.findIndex((line) => line.startsWith('1. Removed the legacy session API'))
    expect(withoutPosition(all[first] as string)).toBe('1. Removed the legacy session API #901')
    const pull = result.items.find((item) => item.name === '#901')
    expect(all[first + 2]).toBe(`   elements: [${pull?.id}]`)
    expect(itemLines(result)).toContain(`[${pull?.id}] link "#901" offscreen`)
  })

  test('is literal and case-insensitive', () => {
    load(releasesPage({ count: 2, breaking: [0] }), 'Releases')
    expect(snap({ find: 'SOURCE CODE (ZIP)' }).text).toContain('## Matches for "SOURCE CODE (ZIP)" (2)')
    expect(snap({ find: 'v1.*0' }).text).toContain('## Matches for "v1.*0" (0)')
    load('<main><p>version 1x2</p><p>version 1.2</p></main>')
    expect(snap({ find: 'VERSION 1.2' }).text).toContain('## Matches for "VERSION 1.2" (1)')
  })

  test('collapses whitespace in the search text and the page the same way', () => {
    load('<main><p>Fixed   a crash\n   on startup</p></main>')
    expect(snap({ find: '  fixed a   CRASH ' }).text).toContain('1. Fixed a crash on startup')
  })

  test('matches text split by inline elements and line breaks', () => {
    load('<main><p>Release <b>v2</b> is <i>out</i></p><p>first line<br>second line</p></main>')
    Object.defineProperty(el('main'), 'innerText', { value: 'Release v2 is out\nfirst line\nsecond line' })
    expect(snap({ find: 'release v2 is out' }).text).toContain('(1)')
    expect(snap({ find: 'first line second line' }).text).toContain('(1)')
  })

  test('does not match across two blocks', () => {
    load('<main><p>alpha</p> <p>beta</p></main>')
    const result = snap({ find: 'alpha beta' })
    expect(result.text).toContain('## Matches for "alpha beta" (0)')
    expect(result.text).toContain('No match within a single paragraph, heading or list item. The page text has 10 characters.')
  })

  test('says so and gives the length of the page text when nothing matches', () => {
    load(releasesPage({ count: 2 }), 'Releases')
    const full = snap({ mainChars: 100000 })
    const length = pageTextOf(full).join('').length
    const result = snap({ find: 'nonexistent phrase' })
    expect(lines(result)).toContain('## Matches for "nonexistent phrase" (0)')
    expect(lines(result)).toContain(
      `No match within a single paragraph, heading or list item. The page text has ${length} characters.`,
    )
    expect(result.mainCharsDropped).toBe(0)
  })

  test('ignores text that is not displayed', () => {
    load(`<main>
      <p style="display:none">hidden needle one</p>
      <div style="display:none"><p>hidden needle two</p></div>
      <p style="visibility:hidden">hidden needle three</p>
      <script>var needle = 1</script>
      <p>visible needle</p>
    </main>`)
    const result = snap({ find: 'needle' })
    expect(result.text).toContain('## Matches for "needle" (1)')
    expect(result.text).toContain('1. visible needle')
    expect(result.text).not.toContain('hidden needle')
  })

  test('cuts a long block around the match and keeps the match in it', () => {
    const filler = 'lorem ipsum dolor sit amet '.repeat(100)
    load(`<main><p>${filler} the needle is here ${filler}</p></main>`)
    const result = snap({ find: 'the needle is here' })
    const match = lines(result).find((line) => line.startsWith('1. ')) as string
    const block = withoutPosition(match)
    expect(block.length).toBeLessThan(620)
    expect(block).toContain('the needle is here')
    expect(block.startsWith('1. …')).toBe(true)
    expect(block.endsWith('…')).toBe(true)
  })

  test('does not add an ellipsis at the end the block does not continue past', () => {
    const filler = 'lorem ipsum dolor sit amet '.repeat(100)
    load(`<main><p>${filler} the needle</p></main>`)
    const match = lines(snap({ find: 'the needle' })).find((line) => line.startsWith('1. ')) as string
    const block = withoutPosition(match)
    expect(block.startsWith('1. …')).toBe(true)
    expect(block.endsWith('the needle')).toBe(true)
  })

  test('numbers the elements of a matched block even when they fall outside maxItems', () => {
    load(releasesPage(), 'Releases')
    const plain = snap({ maxItems: 2 })
    expect(plain.items).toHaveLength(2)
    delete (jsdomWindow() as unknown as Record<string, unknown>)[STATE_KEY]
    const result = snap({ maxItems: 2, find: 'legacy session api' })
    const names = result.items.map((item) => item.name)
    expect(names).toEqual(['v1.6.0', 'dreamcoder-v1.6.0-mac.dmg', '#901', '#904'])
    expect(result.itemsDropped).toBe(plain.itemsDropped - 2)
    const all = lines(result)
    expect(all).toContain(`   elements: [${idOf(result, '#901')}]`)
    expect(all).toContain(`   elements: [${idOf(result, '#904')}]`)
    expect(itemLines(result).map((line) => line.replace(/^\[\d+\] /, ''))).toEqual([
      'link "v1.6.0"',
      'link "dreamcoder-v1.6.0-mac.dmg"',
      'link "#901" offscreen',
      'link "#904" offscreen',
    ])
  })

  test('the ids it hands out can be used to locate the element', () => {
    load('<main><p>needle <a href="/go" data-box="100,200,60,20">Go</a></p></main>')
    const result = snap({ find: 'needle', maxItems: 0 })
    expect(locate(idOf(result, 'Go'))).toMatchObject({ ok: true, role: 'link', name: 'Go' })
  })

  test('lists a link that wraps the matched block', () => {
    load('<main><a href="/card" data-box="0,0,300,100"><div><h3>Card title</h3></div></a></main>')
    const result = snap({ find: 'card title', maxItems: 0 })
    expect(result.items.map((item) => item.name)).toEqual(['Card title'])
    expect(lines(result)).toContain('   elements: [1]')
  })

  test('shows at most 20 matches and 30 extra ids, and says what was left out', () => {
    load(
      `<main>${Array.from(
        { length: 25 },
        (_, i) =>
          `<p>needle ${i} <a href="/a${i}" data-box="0,${i * 30},50,20">first ${i}</a> <a href="/b${i}" data-box="60,${i * 30},50,20">second ${i}</a></p>`,
      ).join('')}</main>`,
    )
    const result = snap({ find: 'needle', maxItems: 0 })
    const all = lines(result)
    expect(all).toContain('## Matches for "needle" (25)')
    expect(all.filter((line) => /^\d+\. needle/.test(line))).toHaveLength(20)
    expect(result.items).toHaveLength(30)
    expect(all).toContain('(showing the first 20 of 25 matches)')
    expect(all).toContain('(10 more interactive elements inside the matches are not listed)')
    expect(all).toContain('(+20 more interactive elements not shown)')
  })

  test('lists at most 8 elements per match', () => {
    load(
      `<main><p>needle ${Array.from({ length: 12 }, (_, i) => `<a href="/l${i}" data-box="0,${i * 30},50,20">link ${i}</a>`).join(' ')}</p></main>`,
    )
    const result = snap({ find: 'needle' })
    const elements = lines(result).find((line) => line.startsWith('   elements:')) as string
    expect(elements.match(/\[\d+\]/g)).toHaveLength(8)
    expect(lines(result)).toContain('(4 more interactive elements inside the matches are not listed)')
  })

  test('reads open shadow roots', () => {
    load('<main><div id="host"></div></main>')
    const shadow = el('#host').attachShadow({ mode: 'open' })
    shadow.innerHTML = '<p>needle in shadow</p>'
    Object.defineProperty(el('main'), 'innerText', { value: 'needle in shadow' })
    expect(snap({ find: 'needle' }).text).toContain('1. needle in shadow')
  })

  test('is limited to the region when one is given', () => {
    load(`<main>
      <p>needle outside</p>
      <div tabindex="0" aria-label="Panel" data-box="0,0,300,200"><p>needle inside</p></div>
    </main>`)
    const full = snap()
    const result = snap({ find: 'needle', region: idOf(full, 'Panel') })
    expect(result.text).toContain('## Matches for "needle" (1)')
    expect(result.text).toContain('1. needle inside')
    expect(result.text).not.toContain('needle outside')
  })

  test('always returns a full snapshot, even when delta is requested', () => {
    load(releasesPage({ count: 2 }), 'Releases')
    const first = snap()
    const result = snap({ delta: true, baseline: first.baseline, find: 'assets' })
    expect(result.full).toBe(true)
    expect(lines(result)[2]).toBe(`Snapshot: ${result.baseline} full`)
    expect(result.text).toContain('## Interactive elements')
    expect(result.text).not.toContain('Changes:')
  })

  test('does not replace the baseline that a later delta compares against', () => {
    load(releasesPage({ count: 2 }), 'Releases')
    const first = snap()
    const found = snap({ find: 'assets' })
    const later = snap({ delta: true, baseline: first.baseline })
    expect(later.full).toBe(false)
    expect(later.text).toContain('page text unchanged')
    const against = snap({ delta: true, baseline: found.baseline })
    expect(against.full).toBe(true)
  })
})

describe('page program: textFrom', () => {
  test('names the next offset in the cut notice', () => {
    load(`<main>${'a'.repeat(30)} ${'b'.repeat(30)}</main>`)
    const result = snap({ mainChars: 25 })
    expect(lines(result)).toContain('(page text cut: 36 characters not shown; pass textFrom=25 to continue)')
  })

  test('starts the page text at the offset and says that earlier text was skipped', () => {
    load(`<main>${'a'.repeat(30)} ${'b'.repeat(30)}</main>`)
    const result = snap({ mainChars: 25, textFrom: 25 })
    expect(lines(result).slice(3)).toEqual([
      '## Page text (from character 25)',
      '(the first 25 of 61 characters of page text were skipped)',
      `${'a'.repeat(5)} ${'b'.repeat(19)}`,
      '## Interactive elements',
      '(none)',
      '(page text cut: 11 characters not shown; pass textFrom=50 to continue)',
    ])
    expect(result.mainCharsDropped).toBe(11)
  })

  test('has no cut notice once the end of the text was reached', () => {
    load(`<main>${'a'.repeat(30)} ${'b'.repeat(30)}</main>`)
    const result = snap({ mainChars: 25, textFrom: 50 })
    expect(result.text).not.toContain('page text cut')
    expect(result.mainCharsDropped).toBe(0)
    expect(pageTextOf(result)).toEqual(['(the first 50 of 61 characters of page text were skipped)', 'b'.repeat(11)])
  })

  test('says when the offset is past the end of the text', () => {
    load('<main>short text</main>')
    const result = snap({ textFrom: 500 })
    expect(lines(result)).toContain('## Page text (from character 500)')
    expect(lines(result)).toContain('(textFrom 500 is past the end of the page text, which has 10 characters)')
    expect(result.text).not.toContain('(empty)')
  })

  test('reading on from each notice reproduces the whole page text of a long page', () => {
    load(releasesPage(), 'Releases')
    const whole = pageTextOf(snap({ mainChars: 1_000_000 })).join('')
    expect(whole.length).toBeGreaterThan(8000)
    let collected = ''
    let from = 0
    for (let step = 0; step < 10; step += 1) {
      const result = snap({ textFrom: from })
      const shown = pageTextOf(result).filter((line) => !line.startsWith('(the first'))
      collected += shown.join('')
      const next = /pass textFrom=(\d+) to continue/.exec(result.text)
      if (!next) break
      from = Number(next[1])
    }
    expect(collected).toBe(whole)
    expect(from).toBeGreaterThan(0)
  })

  test('does not repeat the dialog text when reading on', () => {
    load(`
      <main>Background article text and more background words
        <div role="dialog" data-box="0,0,300,200">We use cookies <button data-box="0,0,50,20">Accept</button></div>
      </main>
    `)
    const first = snap({ mainChars: 40 })
    expect(first.text).toContain('Dialog: We use cookies Accept')
    const second = snap({ mainChars: 40, textFrom: 10 })
    expect(second.text).not.toContain('Dialog:')
    expect(second.text).toContain('[1] button "Accept"')
  })

  test('applies to the text of a region', () => {
    load(`<main>Outside text
      <div tabindex="0" aria-label="Panel" data-box="0,0,300,200">Panel words and more panel words</div>
    </main>`)
    const full = snap()
    const result = snap({ region: idOf(full, 'Panel'), textFrom: 6 })
    expect(pageTextOf(result).at(-1)).toBe('words and more panel words')
  })

  test('always returns a full snapshot, even when delta is requested', () => {
    load('<main>Some words here <button data-box="0,0,50,20">Go</button></main>')
    const first = snap()
    const result = snap({ delta: true, baseline: first.baseline, textFrom: 5 })
    expect(result.full).toBe(true)
    expect(result.text).toContain('## Interactive elements')
    expect(result.text).not.toContain('Changes:')
  })

  test('does not replace the baseline that a later delta compares against', () => {
    load('<main>Some words here <button data-box="0,0,50,20">Go</button></main>')
    const first = snap()
    snap({ textFrom: 5 })
    const later = snap({ delta: true, baseline: first.baseline })
    expect(later.full).toBe(false)
    expect(later.text).toContain('page text unchanged')
  })
})

type Scroller = { y: number; scrollTo: Fn }

describe('page program: scroll', () => {
  const restores: Array<() => void> = []

  function override(target: object, key: string, descriptor: PropertyDescriptor): void {
    const previous = Object.getOwnPropertyDescriptor(target, key)
    Object.defineProperty(target, key, { configurable: true, ...descriptor })
    restores.push(() => {
      if (previous) Object.defineProperty(target, key, previous)
      else delete (target as Record<string, unknown>)[key]
    })
  }

  function stubPage(options: { scrollHeight: number; clientHeight: number; innerHeight?: number; y?: number }): Scroller {
    const win = jsdomWindow()
    const root = document.documentElement
    const scroller: Scroller = { y: options.y ?? 0, scrollTo: vi.fn() }
    scroller.scrollTo.mockImplementation((arg: { top: number }) => {
      scroller.y = arg.top
    })
    override(win, 'innerHeight', { value: options.innerHeight ?? options.clientHeight, writable: true })
    override(win, 'scrollY', { get: () => scroller.y })
    override(win, 'scrollTo', { value: scroller.scrollTo, writable: true })
    override(root, 'scrollHeight', { value: options.scrollHeight })
    override(root, 'clientHeight', { value: options.clientHeight })
    return scroller
  }

  function stubArea(element: Element, options: { scrollHeight: number; clientHeight: number; y?: number }): Scroller {
    const scroller: Scroller = { y: options.y ?? 0, scrollTo: vi.fn() }
    scroller.scrollTo.mockImplementation((arg: { top: number }) => {
      scroller.y = arg.top
    })
    override(element, 'scrollHeight', { value: options.scrollHeight })
    override(element, 'clientHeight', { value: options.clientHeight })
    override(element, 'scrollTop', { get: () => scroller.y, set: (value: number) => (scroller.y = value) })
    override(element, 'scrollTo', { value: scroller.scrollTo, writable: true })
    return scroller
  }

  afterEach(() => {
    while (restores.length > 0) (restores.pop() as () => void)()
    document.body.removeAttribute('style')
  })

  test('scrolls the page down by 80 percent of the window height by default', () => {
    load('<p>text</p>')
    const page = stubPage({ scrollHeight: 4000, clientHeight: 1000 })
    expect(scroll('down')).toEqual({ ok: true, moved: 800, position: 800, maxPosition: 3000, total: 4000, area: null })
    expect(page.scrollTo).toHaveBeenCalledWith({ top: 800, behavior: 'instant' })
  })

  test('scrolls by the given amount and stops at the end of the page', () => {
    load('<p>text</p>')
    const page = stubPage({ scrollHeight: 4000, clientHeight: 1000, y: 2500 })
    expect(scroll('down', 300)).toMatchObject({ ok: true, moved: 300, position: 2800 })
    expect(scroll('down', 5000)).toMatchObject({ ok: true, moved: 200, position: 3000 })
    expect(page.y).toBe(3000)
  })

  test('scrolls up and stops at the top', () => {
    load('<p>text</p>')
    const page = stubPage({ scrollHeight: 4000, clientHeight: 1000, y: 500 })
    expect(scroll('up', 200)).toMatchObject({ moved: 200, position: 300 })
    expect(scroll('up', 900)).toMatchObject({ moved: 300, position: 0 })
    expect(page.y).toBe(0)
  })

  test('top and bottom ignore the amount', () => {
    load('<p>text</p>')
    stubPage({ scrollHeight: 4000, clientHeight: 1000, y: 1200 })
    expect(scroll('bottom', 10)).toMatchObject({ moved: 1800, position: 3000, maxPosition: 3000 })
    expect(scroll('top', 10)).toMatchObject({ moved: 3000, position: 0 })
  })

  test('reports no movement at the edge', () => {
    load('<p>text</p>')
    stubPage({ scrollHeight: 4000, clientHeight: 1000, y: 3000 })
    expect(scroll('down')).toMatchObject({ ok: true, moved: 0, position: 3000 })
  })

  test('uses the window height, not the page height, for the default step', () => {
    load('<p>text</p>')
    stubPage({ scrollHeight: 9000, clientHeight: 700, innerHeight: 700 })
    expect(scroll('down')).toMatchObject({ moved: 560 })
  })

  test('scrolls the largest scrollable element covering the window centre when the page does not scroll', () => {
    load(`
      <div id="side" style="overflow-y:auto" data-box="0,0,200,2000"></div>
      <div id="small" style="overflow-y:auto" data-box="450,330,140,100"></div>
      <div id="big" aria-label="Comments" style="overflow-y:auto" data-box="0,0,1000,700"></div>
      <div id="clipped" style="overflow-y:hidden" data-box="0,0,1000,760"></div>
    `)
    stubPage({ scrollHeight: 768, clientHeight: 768, innerHeight: 768 })
    const side = stubArea(el('#side'), { scrollHeight: 5000, clientHeight: 700 })
    const small = stubArea(el('#small'), { scrollHeight: 900, clientHeight: 100 })
    const big = stubArea(el('#big'), { scrollHeight: 3000, clientHeight: 700 })
    const clipped = stubArea(el('#clipped'), { scrollHeight: 9000, clientHeight: 760 })
    const result = scroll('down', 400)
    expect(result).toEqual({ ok: true, moved: 400, position: 400, maxPosition: 2300, total: 3000, area: 'div "Comments"' })
    expect(big.scrollTo).toHaveBeenCalledWith({ top: 400, behavior: 'instant' })
    expect([side.scrollTo, small.scrollTo, clipped.scrollTo].some((fn) => fn.mock.calls.length > 0)).toBe(false)
  })

  test('the default step of an area is 80 percent of its own height', () => {
    load('<div id="pane" style="overflow-y:auto" data-box="0,0,1000,400"></div>')
    stubPage({ scrollHeight: 768, clientHeight: 768, innerHeight: 768 })
    stubArea(el('#pane'), { scrollHeight: 3000, clientHeight: 400 })
    expect(scroll('down')).toMatchObject({ moved: 320 })
  })

  test('prefers the page over an area when the page can scroll', () => {
    load('<div id="pane" style="overflow-y:auto" data-box="0,0,1000,700"></div>')
    const page = stubPage({ scrollHeight: 4000, clientHeight: 768 })
    const pane = stubArea(el('#pane'), { scrollHeight: 3000, clientHeight: 700 })
    expect(scroll('down', 100)).toMatchObject({ area: null, position: 100 })
    expect(page.scrollTo).toHaveBeenCalled()
    expect(pane.scrollTo).not.toHaveBeenCalled()
  })

  test('scrolls an area when the page scroll is locked, as under a modal', () => {
    load('<div id="pane" style="overflow-y:auto" data-box="0,0,1000,700"></div>')
    document.body.style.overflow = 'hidden'
    const page = stubPage({ scrollHeight: 4000, clientHeight: 768 })
    stubArea(el('#pane'), { scrollHeight: 3000, clientHeight: 700 })
    expect(scroll('down', 100)).toMatchObject({ ok: true, position: 100, area: expect.stringContaining('div') })
    expect(page.scrollTo).not.toHaveBeenCalled()
  })

  test('says so when nothing can scroll', () => {
    load('<div id="pane" style="overflow-y:auto" data-box="0,0,1000,700"></div><div id="off" style="overflow-y:auto" data-box="0,0,10,10"></div>')
    stubPage({ scrollHeight: 768, clientHeight: 768 })
    stubArea(el('#pane'), { scrollHeight: 700, clientHeight: 700 })
    stubArea(el('#off'), { scrollHeight: 900, clientHeight: 10 })
    const result = scroll('down')
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'not_scrollable' })
    expect((result as { detail: string }).detail).toContain('Nothing on this page can scroll')
  })

  test('leaves element ids and the delta baseline alone', () => {
    load('<main>Words <button data-box="0,0,50,20">Go</button></main>')
    stubPage({ scrollHeight: 4000, clientHeight: 1000 })
    const first = snap()
    const id = idOf(first, 'Go')
    scroll('down')
    expect(locate(id).ok).toBe(true)
    const second = snap({ delta: true, baseline: first.baseline })
    expect(second.full).toBe(false)
    expect(idOf(second, 'Go')).toBe(id)
  })
})

describe('page program: hasText', () => {
  test('finds text literally and without regard to case or spacing', () => {
    load('<main><p>Saved   your\n changes</p><p>version 1x2</p><p>version 1.2</p></main>')
    expect(hasText('saved your changes')).toBe(true)
    expect(hasText('  SAVED   YOUR CHANGES ')).toBe(true)
    expect(hasText('VERSION 1.2')).toBe(true)
    expect(hasText('v.*2')).toBe(false)
    expect(hasText('deleted')).toBe(false)
  })

  test('matches text split by inline elements and across neighbouring blocks', () => {
    load('<main><p>Release <b>v2</b> is <i>out</i></p><p>second</p></main>')
    expect(hasText('release v2 is out')).toBe(true)
    expect(hasText('out second')).toBe(true)
  })

  test('does not count hidden text', () => {
    load(`<main>
      <p style="display:none">hidden one</p>
      <div style="display:none"><p>hidden two</p></div>
      <p style="visibility:hidden">hidden three</p>
      <script>var hidden_four = 1</script>
      <style>.hidden_five { color: red }</style>
      <p>shown</p>
    </main>`)
    for (const text of ['hidden one', 'hidden two', 'hidden three', 'hidden_four', 'hidden_five']) {
      expect(hasText(text)).toBe(false)
    }
    expect(hasText('shown')).toBe(true)
  })

  test('sees the page change between two calls', () => {
    load('<main><p id="status">Loading</p></main>')
    expect(hasText('Saved')).toBe(false)
    el('#status').textContent = 'Saved'
    expect(hasText('Saved')).toBe(true)
    expect(hasText('Loading')).toBe(false)
    el('#status').style.display = 'none'
    expect(hasText('Saved')).toBe(false)
  })

  test('reads the whole visible body, including text outside the main content', () => {
    load('<header>Site menu</header><main>Article text</main><div role="status">Saved</div><footer>Legal</footer>')
    expect(hasText('Article text')).toBe(true)
    expect(hasText('Site menu')).toBe(true)
    expect(hasText('Saved')).toBe(true)
    expect(hasText('Legal')).toBe(true)
    load('<header>Site menu</header><p>No main here</p>')
    expect(hasText('Site menu')).toBe(true)
    expect(hasText('No main here')).toBe(true)
  })

  test('reads text inside open shadow roots', () => {
    load('<main><div id="host"></div></main>')
    const root = el('#host').attachShadow({ mode: 'open' })
    root.innerHTML = '<p>inside shadow</p>'
    expect(hasText('inside shadow')).toBe(true)
  })

  test('an empty page and an empty needle are never present', () => {
    load('')
    expect(hasText('anything')).toBe(false)
    load('<main>text</main>')
    expect(hasText('   ')).toBe(false)
    expect(hasText('')).toBe(false)
  })

  test('does not assign ids or change the snapshot baseline', () => {
    load('<main>Words <button data-box="0,0,50,20">Go</button></main>')
    expect(hasText('Words')).toBe(true)
    const first = snap()
    expect(idOf(first, 'Go')).toBe(1)
    hasText('Words')
    const second = snap({ delta: true, baseline: first.baseline })
    expect(second.full).toBe(false)
    expect(idOf(second, 'Go')).toBe(1)
  })
})

describe('page program: styles', () => {
  const restores: Array<() => void> = []

  function stubComputed(values: Record<string, string>, enumerated: string[] = Object.keys(values)): void {
    const win = document.defaultView as Window
    const previous = Object.getOwnPropertyDescriptor(win, 'getComputedStyle')
    Object.defineProperty(win, 'getComputedStyle', {
      configurable: true,
      writable: true,
      value: () => ({
        length: enumerated.length,
        item: (index: number) => enumerated[index] ?? '',
        getPropertyValue: (name: string) => values[name] ?? '',
      }),
    })
    restores.push(() => {
      if (previous) Object.defineProperty(win, 'getComputedStyle', previous)
      else delete (win as unknown as Record<string, unknown>).getComputedStyle
    })
  }

  afterEach(() => {
    while (restores.length > 0) (restores.pop() as () => void)()
  })

  function idOfGo(): number {
    load('<main><button data-box="12,34,80,30">Save</button></main>')
    return idOf(snap(), 'Save')
  }

  function ok(result: StylesResult): Extract<StylesResult, { ok: true }> {
    if (!result.ok) throw new Error(`expected styles, got ${result.reason}`)
    return result
  }

  test('describes the element and reads the default properties in a fixed order', () => {
    const id = idOfGo()
    const everything: Record<string, string> = {}
    stubComputed(new Proxy(everything, { get: () => 'value' }) as Record<string, string>, [])
    const result = ok(styles(id))
    expect(result).toMatchObject({
      tag: 'button',
      role: 'button',
      name: 'Save',
      box: { x: 12, y: 34, width: 80, height: 30 },
    })
    const names = result.values.map((entry) => entry.name)
    expect(names.length).toBeGreaterThanOrEqual(40)
    expect(names.length).toBeLessThanOrEqual(55)
    expect(new Set(names).size).toBe(names.length)
    for (const expected of [
      'display',
      'position',
      'top',
      'left',
      'z-index',
      'width',
      'height',
      'box-sizing',
      'margin-top',
      'padding-left',
      'border-top-width',
      'border-top-style',
      'border-top-color',
      'border-top-left-radius',
      'overflow-x',
      'visibility',
      'opacity',
      'color',
      'background-color',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'text-align',
      'flex-direction',
      'row-gap',
      'cursor',
      'pointer-events',
    ]) {
      expect(names).toContain(expected)
    }
    expect(result.unknown).toEqual([])
  })

  test('reads the computed values of the properties asked for, case and order kept', () => {
    const id = idOfGo()
    stubComputed({ 'margin-top': '8px', '--accent': 'rebeccapurple', display: 'flex' })
    const result = ok(styles(id, ['margin-top', '--accent', 'display']))
    expect(result.values).toEqual([
      { name: 'margin-top', value: '8px' },
      { name: '--accent', value: 'rebeccapurple' },
      { name: 'display', value: 'flex' },
    ])
    expect(result.unknown).toEqual([])
  })

  test('reports names the browser does not know instead of dropping them', () => {
    const id = idOfGo()
    stubComputed({ color: 'red' })
    const result = ok(styles(id, ['colour', 'color', 'margin-topp']))
    expect(result.values).toEqual([{ name: 'color', value: 'red' }])
    expect(result.unknown).toEqual(['colour', 'margin-topp'])
  })

  test('keeps a known property whose computed value is empty, as empty', () => {
    const id = idOfGo()
    stubComputed({}, ['border'])
    const result = ok(styles(id, ['border']))
    expect(result.values).toEqual([{ name: 'border', value: '(empty)' }])
    expect(result.unknown).toEqual([])
  })

  test('asks the browser whether an empty property is supported when it can', () => {
    const id = idOfGo()
    stubComputed({})
    const win = jsdomWindow() as unknown as Record<string, unknown>
    win.CSS = { supports: (name: string) => name === 'border' }
    try {
      const result = ok(styles(id, ['border', 'colour']))
      expect(result.values).toEqual([{ name: 'border', value: '(empty)' }])
      expect(result.unknown).toEqual(['colour'])
    } finally {
      delete win.CSS
    }
  })

  test('clips long values at 200 characters', () => {
    const id = idOfGo()
    stubComputed({ 'font-family': 'a'.repeat(500) })
    const result = ok(styles(id, ['font-family']))
    expect(result.values[0]?.value).toBe('a'.repeat(200))
  })

  test('works with the real computed style of the page', () => {
    load('<main><a href="#x" style="display:block" data-box="5,6,70,40">Link</a></main>')
    const result = ok(styles(idOf(snap(), 'Link'), ['display', 'colour']))
    expect(result.values).toEqual([{ name: 'display', value: 'block' }])
    expect(result.unknown).toEqual(['colour'])
    expect(result.box).toEqual({ x: 5, y: 6, width: 70, height: 40 })
  })

  test('says so when the id is unknown or the element left the page', () => {
    const id = idOfGo()
    expect(styles(99)).toEqual({
      ok: false,
      reason: 'unknown_id',
      detail: 'No element has this id. Take a new snapshot to get current ids.',
    })
    el('button').remove()
    expect(styles(id)).toEqual({
      ok: false,
      reason: 'gone',
      detail: `Element ${id} is no longer on the page. Take a new snapshot.`,
    })
  })
})

describe('page program: element lookup', () => {
  test('lookup tells found, unknown and removed elements apart', () => {
    load('<main><button data-box="0,0,50,20">Go</button></main>')
    const id = idOf(snap(), 'Go')
    expect(lookup(id)).toEqual({ ok: true })
    expect(lookup(77)).toMatchObject({ ok: false, reason: 'unknown_id' })
    el('button').remove()
    expect(lookup(id)).toMatchObject({ ok: false, reason: 'gone', detail: `Element ${id} is no longer on the page. Take a new snapshot.` })
  })

  test('element hands back the element itself, or null when it is gone or unknown', () => {
    load('<main><button data-box="0,0,50,20">Go</button></main>')
    const id = idOf(snap(), 'Go')
    expect(elementOf(id)).toBe(el('button'))
    expect(elementOf(77)).toBeNull()
    el('button').remove()
    expect(elementOf(id)).toBeNull()
  })
})

type PickResult = {
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
  html?: string
  prev?: string
  next?: string
  rect?: { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number; scrollX: number; scrollY: number; devicePixelRatio: number }
}

function pick(target: Element): PickResult {
  const win = jsdomWindow() as unknown as Record<string, unknown>
  win.__pickTarget = target
  try {
    const expression = `JSON.stringify((${programSource()})("pick", {}, window.__pickTarget))`
    return JSON.parse(String(jsdomWindow().eval(expression))) as PickResult
  } finally {
    delete win.__pickTarget
  }
}

describe('page program: pick', () => {
  test('describes the element with the fields a chat reference needs', () => {
    load(
      `<main data-box="0,0,400,300"><p>Intro</p>
        <a class="cta primary" id="go" href="/buy?x=1" data-box="10,20,120,40">Buy now</a>
        <p>After</p></main>`,
      'Shop',
    )
    const result = pick(el('a'))
    expect(result).toMatchObject({
      url: 'http://localhost:3000/',
      title: 'Shop',
      tag: 'a',
      label: 'a.cta',
      role: 'link',
      name: 'Buy now',
      text: 'Buy now',
      href: 'http://localhost:3000/buy?x=1',
      html: '<a class="cta primary" id="go" href="/buy?x=1" data-box="10,20,120,40">Buy now</a>',
      prev: '<p>Intro</p>',
      next: '<p>After</p>',
      sensitive: false,
      truncated: false,
    })
    expect(result.selector).toBe('#go')
    expect(result.rect).toEqual({ x: 10, y: 20, width: 120, height: 40, viewportWidth: 1024, viewportHeight: 768, scrollX: 0, scrollY: 0, devicePixelRatio: 1 })
  })

  test('reports how far the page is scrolled, so the caller can clip in page coordinates', () => {
    load('<button data-box="10,20,80,30">Go</button>')
    const win = jsdomWindow() as unknown as { scrollX: number; scrollY: number }
    const originalX = Object.getOwnPropertyDescriptor(win, 'scrollX')
    const originalY = Object.getOwnPropertyDescriptor(win, 'scrollY')
    Object.defineProperty(win, 'scrollX', { configurable: true, value: 7 })
    Object.defineProperty(win, 'scrollY', { configurable: true, value: 1300 })
    try {
      expect(pick(el('button')).rect).toMatchObject({ scrollX: 7, scrollY: 1300 })
    } finally {
      if (originalX) Object.defineProperty(win, 'scrollX', originalX)
      else delete (win as unknown as Record<string, unknown>).scrollX
      if (originalY) Object.defineProperty(win, 'scrollY', originalY)
      else delete (win as unknown as Record<string, unknown>).scrollY
    }
  })

  test('registers the element under the id the snapshot uses for it', () => {
    load('<main><button data-box="0,0,80,20">Go</button><button data-box="0,30,80,20">Stop</button></main>')
    const picked = pick(el('button:nth-of-type(2)'))
    expect(picked.ref).toBe('1')
    expect(pick(el('button:nth-of-type(2)')).ref).toBe('1')
    const result = snap()
    expect(idOf(result, 'Stop')).toBe(1)
    expect(idOf(result, 'Go')).toBe(2)
    expect(lookup(1)).toEqual({ ok: true })
    expect(elementOf(1)).toBe(el('button:nth-of-type(2)'))
  })

  test('registers elements the snapshot never lists', () => {
    load('<main><section id="plain" data-box="0,0,200,100"><p>Hello</p></section></main>')
    const picked = pick(el('#plain'))
    expect(snap().items).toEqual([])
    expect(lookup(Number(picked.ref))).toEqual({ ok: true })
  })

  test('labels with the tag and first class, then tag#id, then the role, then the tag', () => {
    load(`
      <div class="card big" id="a"></div>
      <div id="b"></div>
      <button></button>
      <section></section>
      <span class="  spaced "></span>
    `)
    expect(pick(el('#a')).label).toBe('div.card')
    expect(pick(el('#b')).label).toBe('div#b')
    expect(pick(el('button')).label).toBe('button')
    expect(pick(el('section')).label).toBe('section')
    expect(pick(el('span')).label).toBe('span.spaced')
  })

  test('uses the role for a labelled generic that has neither class nor id', () => {
    load('<div role="dialog"></div>')
    expect(pick(el('div')).label).toBe('dialog')
  })

  test('cuts the text at 160 characters on one line and flags the truncation', () => {
    load(`<p data-box="0,0,300,40">${'word '.repeat(60)}\n\n  more</p>`)
    const result = pick(el('p'))
    expect(result.text).toHaveLength(160)
    expect(result.text).not.toContain('\n')
    expect(result.truncated).toBe(true)
  })

  test('cuts the element html at 2000 characters and each sibling at 300, and flags the truncation', () => {
    load(`<ul><li>${'a'.repeat(400)}</li><li id="mid">${'b'.repeat(2500)}</li><li>${'c'.repeat(400)}</li></ul>`)
    const result = pick(el('#mid'))
    expect(result.html).toHaveLength(2000)
    expect(result.prev).toHaveLength(300)
    expect(result.next).toHaveLength(300)
    expect(result.truncated).toBe(true)
  })

  test('is not truncated when everything fits', () => {
    load('<ul><li>a</li><li id="mid">b</li><li>c</li></ul>')
    expect(pick(el('#mid')).truncated).toBe(false)
  })

  test('leaves out href, prev and next when there are none', () => {
    load('<div id="only">x</div>')
    const result = pick(el('#only'))
    expect('href' in result).toBe(false)
    expect('prev' in result).toBe(false)
    expect('next' in result).toBe(false)
  })

  test('reads only the fixed list of computed styles and skips empty ones', () => {
    load('<div id="box" data-box="0,0,10,10"></div>')
    const requested: string[] = []
    const win = document.defaultView as Window
    const previous = Object.getOwnPropertyDescriptor(win, 'getComputedStyle')
    Object.defineProperty(win, 'getComputedStyle', {
      configurable: true,
      writable: true,
      value: () => ({
        length: 0,
        item: () => '',
        getPropertyValue: (name: string) => {
          requested.push(name)
          return name === 'margin' ? '' : `v:${name}`
        },
      }),
    })
    try {
      const result = pick(el('#box'))
      expect(requested).toEqual([
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
      ])
      expect(Object.keys(result.styles ?? {})).toHaveLength(16)
      expect(result.styles?.display).toBe('v:display')
      expect(result.styles && 'margin' in result.styles).toBe(false)
    } finally {
      if (previous) Object.defineProperty(win, 'getComputedStyle', previous)
      else delete (win as unknown as Record<string, unknown>).getComputedStyle
    }
  })

  describe('selector', () => {
    test('is the id when that is unique', () => {
      load('<main><div id="x1"></div></main>')
      expect(pick(el('#x1')).selector).toBe('#x1')
    })

    test('climbs until the selector matches one element and numbers same-tag siblings', () => {
      load(`
        <section class="a"><button class="btn">One</button><button class="btn">Two</button></section>
        <section class="b"><button class="btn">Three</button><button class="btn">Four</button></section>
      `)
      const selector = pick(el('.a button:nth-of-type(2)')).selector
      expect(selector).toBe('section.a:nth-of-type(1) > button.btn:nth-of-type(2)')
      expect(document.querySelectorAll(selector)).toHaveLength(1)
      expect(document.querySelector(selector)?.textContent).toBe('Two')
    })

    test('escapes class names and ids that are not plain identifiers', () => {
      load('<div class="md:flex w-1/2"><span id="1st:item">x</span></div>')
      const spanSelector = pick(el('span')).selector
      expect(spanSelector).toBe('#\\31 st\\:item')
      expect(document.querySelector(spanSelector)?.localName).toBe('span')
      const divSelector = pick(el('div')).selector
      expect(document.querySelector(divSelector)).toBe(el('div'))
    })

    test('stops at an ancestor with a unique id', () => {
      load('<div id="root"><ul><li>a</li><li class="x">b</li></ul></div><div><ul><li>a</li><li class="x">b</li></ul></div>')
      const selector = pick(el('#root .x')).selector
      expect(selector).toBe('#root > ul > li.x:nth-of-type(2)')
      expect(document.querySelector(selector)).toBe(el('#root .x'))
    })

    test('joins shadow roots with >>>', () => {
      load('<div id="host"></div>')
      const host = el('#host')
      const shadow = host.attachShadow({ mode: 'open' })
      shadow.innerHTML = '<div class="inner"><button class="go">Go</button></div>'
      expect(pick(shadow.querySelector('button') as Element).selector).toBe('#host >>> button.go')
    })
  })

  describe('sensitive elements', () => {
    const IDENTITY = ['ref', 'url', 'title', 'tag', 'label', 'selector', 'sensitive', 'truncated']

    function expectIdentityOnly(result: PickResult) {
      expect(result.sensitive).toBe(true)
      expect(result.truncated).toBe(false)
      expect(Object.keys(result).sort()).toEqual([...IDENTITY].sort())
    }

    test('a password input returns only its identity', () => {
      load('<form><input type="password" class="pw" value="hunter2" data-box="0,0,100,20"></form>')
      const result = pick(el('input'))
      expectIdentityOnly(result)
      expect(JSON.stringify(result)).not.toContain('hunter2')
      expect(result.tag).toBe('input')
      expect(result.label).toBe('input.pw')
      expect(result.selector).toBe('input.pw')
    })

    test('a card field returns only its identity', () => {
      load('<input type="text" autocomplete="cc-number" value="4111111111111111">')
      const result = pick(el('input'))
      expectIdentityOnly(result)
      expect(JSON.stringify(result)).not.toContain('4111')
    })

    test('cc- tokens count in any position of the autocomplete list', () => {
      load('<input autocomplete="section-pay billing cc-csc" value="123">')
      expectIdentityOnly(pick(el('input')))
    })

    test('a container with a password field returns only its identity', () => {
      load('<form id="login"><label>Name <input value="ada"></label><div><input type="password" value="pw"></div></form>')
      const result = pick(el('#login'))
      expectIdentityOnly(result)
      expect(JSON.stringify(result)).not.toMatch(/ada|"pw"/)
    })

    test('a sensitive field inside a shadow root counts, also nested', () => {
      load('<section id="outer"><div id="host"></div></section>')
      const shadow = el('#host').attachShadow({ mode: 'open' })
      shadow.innerHTML = '<div id="inner"></div>'
      const nested = (shadow.querySelector('#inner') as Element).attachShadow({ mode: 'open' })
      nested.innerHTML = '<input type="password" value="deep">'
      expectIdentityOnly(pick(el('#outer')))
      expectIdentityOnly(pick(el('#host')))
    })

    test('a sensitive field is still registered so the page can mark it', () => {
      load('<input type="password" id="pw">')
      const result = pick(el('input'))
      expect(lookup(Number(result.ref))).toEqual({ ok: true })
    })

    test('an ordinary input is not sensitive and does not leak its value in html', () => {
      load('<input type="text" id="n" value="ada@example.com" autocomplete="email">')
      const result = pick(el('input'))
      expect(result.sensitive).toBe(false)
      expect(result.html).toBe('<input type="text" id="n" autocomplete="email">')
    })

    test('treats a subtree it cannot scan completely as sensitive', () => {
      load('<div id="big"></div>')
      const big = el('#big')
      const fragment = document.createDocumentFragment()
      for (let i = 0; i < 20_001; i += 1) fragment.appendChild(document.createElement('i'))
      big.appendChild(fragment)
      expectIdentityOnly(pick(big))
    })
  })

  describe('value stripping', () => {
    test('removes input values, hidden values and textarea content from the element and its siblings', () => {
      load(`
        <form>
          <input name="before" value="prev-secret">
          <div id="row">
            <input name="a" value="alpha"><input type="hidden" name="csrf" value="tok-123"><textarea name="t">typed text</textarea>
          </div>
          <textarea name="after">next-secret</textarea>
        </form>
      `)
      const result = pick(el('#row'))
      expect(result.html).toBe(
        '<div id="row">\n            <input name="a"><input type="hidden" name="csrf"><textarea name="t"></textarea>\n          </div>',
      )
      expect(result.prev).toBe('<input name="before">')
      expect(result.next).toBe('<textarea name="after"></textarea>')
      expect(JSON.stringify(result)).not.toMatch(/alpha|tok-123|typed text|prev-secret|next-secret/)
    })

    test('keeps textarea content out of text and name, for the textarea and for a container', () => {
      load('<div id="row">Notes <textarea>typed text</textarea> end</div>')
      const container = pick(el('#row'))
      expect(container.text).toBe('Notes end')
      expect(container.name).toBe('Notes end')
      const area = pick(el('textarea'))
      expect(area.text).toBe('')
      expect(area.name).toBe('')
      expect(JSON.stringify([container, area])).not.toContain('typed text')
    })

    test('masks the text of selected options only', () => {
      load('<select id="s"><option value="a">Alpha</option><option value="b" selected>Bravo</option></select>')
      const result = pick(el('#s'))
      expect(result.html).toBe('<select id="s"><option value="a">Alpha</option><option value="b" selected="">••••</option></select>')
    })

    test('does not change the page itself', () => {
      load('<div id="row"><input value="alpha"><textarea>typed</textarea></div>')
      pick(el('#row'))
      expect(el<HTMLInputElement>('input').getAttribute('value')).toBe('alpha')
      expect(el('textarea').textContent).toBe('typed')
    })
  })
})

describe('page program: marks', () => {
  type Mark = { box: HTMLElement; chip: HTMLElement }
  const shadows: ShadowRoot[] = []
  const modes: string[] = []
  let restoreAttach: (() => void) | null = null

  beforeEach(() => {
    const proto = (jsdomWindow() as unknown as { Element: { prototype: { attachShadow: (init: ShadowRootInit) => ShadowRoot } } }).Element.prototype
    const original = proto.attachShadow
    proto.attachShadow = function patched(this: Element, init: ShadowRootInit) {
      modes.push(init.mode)
      const root = original.call(this, { ...init, mode: 'open' })
      shadows.push(root)
      return root
    }
    restoreAttach = () => {
      proto.attachShadow = original
    }
  })

  afterEach(() => {
    const registry = (jsdomWindow() as unknown as Record<string, { marks?: { stop: () => void } | null } | undefined>)[STATE_KEY]
    registry?.marks?.stop()
    for (const child of Array.from(document.documentElement.children)) {
      if (child !== document.head && child !== document.body) child.remove()
    }
    shadows.length = 0
    modes.length = 0
    restoreAttach?.()
    restoreAttach = null
    vi.restoreAllMocks()
  })

  function marksOp(ids: number[]): number[] {
    return run<{ alive: number[] }>('marks', { ids }).alive
  }

  function overlay(): { host: HTMLElement; marks: Mark[] } | null {
    const root = shadows[shadows.length - 1]
    if (!root || !root.host.isConnected) return null
    const children = Array.from(root.children) as HTMLElement[]
    const marks: Mark[] = []
    for (let i = 0; i + 1 < children.length; i += 2) marks.push({ box: children[i] as HTMLElement, chip: children[i + 1] as HTMLElement })
    return { host: root.host as HTMLElement, marks }
  }

  function register(selector: string): number {
    return Number(pick(el(selector)).ref)
  }

  test('draws one orange outline and one label chip per element in a fixed closed overlay', () => {
    load(
      `<button class="buy" data-box="100,200,80,30">Buy</button><a class="more extra" href="#" data-box="300,300,60,20">More</a>`,
    )
    const first = register('button')
    const second = register('a')
    expect(marksOp([first, second])).toEqual([first, second])
    expect(modes).toEqual(['closed'])
    const shown = overlay()
    expect(shown?.marks).toHaveLength(2)
    const host = shown?.host as HTMLElement
    expect(host.parentElement).toBe(document.documentElement)
    expect(host.style.position).toBe('fixed')
    expect(host.style.zIndex).toBe('2147483647')
    expect(host.style.pointerEvents).toBe('none')
    const [one, two] = shown?.marks as Mark[]
    expect(one?.box.style.border).toContain('2px solid')
    expect(one?.box.style.borderRadius).toBe('6px')
    expect(one?.box.style.pointerEvents).toBe('none')
    expect(one?.chip.textContent).toBe('button.buy')
    expect(two?.chip.textContent).toBe('a.more')
  })

  test('puts the outline 2px around the element and the chip just above its top-left corner', () => {
    load('<button class="buy" data-box="100,200,80,30">Buy</button>')
    marksOp([register('button')])
    const [mark] = overlay()?.marks as Mark[]
    expect(mark?.box.style.left).toBe('98px')
    expect(mark?.box.style.top).toBe('198px')
    expect(mark?.box.style.width).toBe('84px')
    expect(mark?.box.style.height).toBe('34px')
    expect(mark?.box.style.display).toBe('block')
    expect(mark?.chip.style.left).toBe('98px')
    expect(mark?.chip.style.top).toBe('180px')
  })

  test('moves the chip inside the outline when there is no room above', () => {
    load('<button class="buy" data-box="100,5,80,30">Buy</button>')
    marksOp([register('button')])
    const [mark] = overlay()?.marks as Mark[]
    expect(mark?.chip.style.top).toBe('9px')
    expect(mark?.chip.style.left).toBe('98px')
  })

  test('writes no numbers, only the label', () => {
    load('<button class="buy" data-box="100,200,80,30">Buy</button><button class="sell" data-box="100,300,80,30">Sell</button>')
    marksOp([register('.buy'), register('.sell')])
    const chips = (overlay()?.marks ?? []).map((mark) => mark.chip.textContent)
    expect(chips).toEqual(['button.buy', 'button.sell'])
  })

  test('answers which ids are alive and skips unknown and removed elements', () => {
    load('<button class="a" data-box="0,0,10,10"></button><button class="b" data-box="0,20,10,10"></button>')
    const a = register('.a')
    const b = register('.b')
    el('.b').remove()
    expect(marksOp([a, b, 99])).toEqual([a])
    expect(overlay()?.marks).toHaveLength(1)
  })

  test('drops a mark when its element leaves the page and removes the overlay with the last one', () => {
    load('<button class="a" data-box="0,0,10,10"></button><button class="b" data-box="0,20,10,10"></button>')
    marksOp([register('.a'), register('.b')])
    el('.a').remove()
    window.dispatchEvent(new Event('resize'))
    expect(overlay()?.marks).toHaveLength(1)
    el('.b').remove()
    window.dispatchEvent(new Event('resize'))
    expect(overlay()).toBeNull()
  })

  test('follows the element on scroll and resize', () => {
    load('<button class="a" data-box="100,200,80,30"></button>')
    marksOp([register('.a')])
    const button = el('.a')
    place(button, 100, 150, 80, 30)
    window.dispatchEvent(new Event('scroll'))
    expect(overlay()?.marks[0]?.box.style.top).toBe('148px')
    place(button, 120, 150, 80, 30)
    window.dispatchEvent(new Event('resize'))
    expect(overlay()?.marks[0]?.box.style.left).toBe('118px')
  })

  test('hides the mark of an element that is out of view or has no size', () => {
    load('<button class="a" data-box="100,200,80,30"></button><button class="b" data-box="100,5000,80,30"></button><button class="c" data-box="0,0,0,0"></button>')
    marksOp([register('.a'), register('.b'), register('.c')])
    expect((overlay()?.marks ?? []).map((mark) => mark.box.style.display)).toEqual(['block', 'none', 'none'])
  })

  test('an empty list removes the overlay and stops following the page', () => {
    load('<button class="a" data-box="0,0,10,10"></button>')
    marksOp([register('.a')])
    const raf = vi.spyOn(jsdomWindow(), 'cancelAnimationFrame')
    expect(marksOp([])).toEqual([])
    expect(overlay()).toBeNull()
    expect(raf).toHaveBeenCalled()
    place(el('.a'), 0, 40, 10, 10)
    window.dispatchEvent(new Event('scroll'))
    expect(overlay()).toBeNull()
  })

  test('a new list replaces the previous overlay instead of stacking', () => {
    load('<button class="a" data-box="0,0,10,10"></button><button class="b" data-box="0,20,10,10"></button>')
    const a = register('.a')
    const b = register('.b')
    marksOp([a])
    const firstHost = overlay()?.host as HTMLElement
    marksOp([a, b])
    expect(firstHost.isConnected).toBe(false)
    expect(overlay()?.marks).toHaveLength(2)
    expect(Array.from(document.documentElement.children).filter((child) => child !== document.head && child !== document.body)).toHaveLength(1)
  })

  test('refreshes on a throttled animation-frame loop only while marks exist', () => {
    load('<button class="a" data-box="100,200,80,30"></button>')
    const callbacks: Array<(time: number) => void> = []
    vi.spyOn(jsdomWindow(), 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    marksOp([register('.a')])
    expect(callbacks).toHaveLength(1)
    place(el('.a'), 100, 100, 80, 30)
    callbacks.shift()?.(50)
    expect(overlay()?.marks[0]?.box.style.top).toBe('198px')
    expect(callbacks).toHaveLength(1)
    callbacks.shift()?.(150)
    expect(overlay()?.marks[0]?.box.style.top).toBe('98px')
    marksOp([])
    callbacks.shift()?.(400)
    expect(callbacks).toHaveLength(0)
  })

  test('places the mark of an element inside a same-origin frame at its position in the page', () => {
    load('<iframe data-box="100,300,300,200"></iframe>')
    const frame = el<HTMLIFrameElement>('iframe')
    fillFrame(frame, '<button class="deep" data-box="10,20,80,30">Deep</button>')
    const inner = (frame.contentDocument as Document).querySelector('button') as Element
    const win = jsdomWindow() as unknown as { eval(source: string): unknown }
    ;(win as unknown as Record<string, unknown>).__markTarget = inner
    const ref = Number((JSON.parse(String(win.eval(`JSON.stringify((${programSource()})("pick", {}, window.__markTarget))`))) as PickResult).ref)
    delete (win as unknown as Record<string, unknown>).__markTarget
    marksOp([ref])
    const [mark] = overlay()?.marks as Mark[]
    expect(mark?.box.style.left).toBe('108px')
    expect(mark?.box.style.top).toBe('318px')
    expect(mark?.box.style.display).toBe('block')
  })

  test('places the mark of an element inside a scaled frame at its drawn position', () => {
    load('<iframe data-box="100,300,300,200"></iframe>')
    const frame = el<HTMLIFrameElement>('iframe')
    sizeFrame(frame, 600, 400)
    fillFrame(frame, '<button class="deep" data-box="10,20,80,30">Deep</button>')
    const inner = (frame.contentDocument as Document).querySelector('button') as Element
    const win = jsdomWindow() as unknown as { eval(source: string): unknown }
    ;(win as unknown as Record<string, unknown>).__markTarget = inner
    const ref = Number((JSON.parse(String(win.eval(`JSON.stringify((${programSource()})("pick", {}, window.__markTarget))`))) as PickResult).ref)
    delete (win as unknown as Record<string, unknown>).__markTarget
    marksOp([ref])
    const [mark] = overlay()?.marks as Mark[]
    expect(mark?.box.style.left).toBe('103px')
    expect(mark?.box.style.top).toBe('308px')
    expect(mark?.box.style.width).toBe('44px')
    expect(mark?.box.style.height).toBe('19px')
  })

  test('hides and shows the overlay without losing the marks', () => {
    load('<button class="a" data-box="100,200,80,30"></button>')
    marksOp([register('.a')])
    expect(run('marksHidden', { hidden: true })).toEqual({ ok: true })
    expect(overlay()?.host.style.visibility).toBe('hidden')
    expect(run('marksHidden', { hidden: false })).toEqual({ ok: true })
    expect(overlay()?.host.style.visibility).toBe('visible')
    expect(overlay()?.marks).toHaveLength(1)
  })

  test('hiding with no marks is harmless', () => {
    expect(run('marksHidden', { hidden: true })).toEqual({ ok: true })
  })

  test('the overlay is invisible to a snapshot of the page', () => {
    load('<button class="a" data-box="100,200,80,30">Go</button>')
    const before = snap().text.split('\n').slice(3).join('\n')
    marksOp([register('.a')])
    expect(snap().text.split('\n').slice(3).join('\n')).toBe(before)
  })
})

describe('page program: pick and marks sources', () => {
  test('stay self-contained: no compiler helpers and no module references', () => {
    const source = programSource()
    expect(source).toContain('runPick')
    expect(source).toContain('runMarks')
    expect(source).not.toMatch(/__name|__publicField|__spread|__rest|_define_property|__defProp|__async/)
  })

  test('run in a fresh function scope that cannot see this module', () => {
    load('<button class="a" data-box="0,0,80,20">Go</button>')
    const isolated = new Function('op', 'args', 'target', `return (${programSource()})(op, args, target)`)
    const picked = isolated('pick', {}, el('button')) as PickResult
    expect(picked.label).toBe('button.a')
    const marked = isolated('marks', { ids: [Number(picked.ref)] }) as { alive: number[] }
    expect(marked.alive).toEqual([Number(picked.ref)])
    isolated('marks', { ids: [] })
  })
})
