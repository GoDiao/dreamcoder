import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTextSelectionFromContainer } from './workspaceSelection'

const pointer = { clientX: 5, clientY: 6 }

function quoted(root: HTMLElement) {
  const selection = getTextSelectionFromContainer(root, pointer)
  return selection && { text: selection.text, startLine: selection.startLine, endLine: selection.endLine }
}

function surface() {
  const root = document.createElement('div')
  const host = document.createElement('diffs-container')
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = '<div data-line="7" data-line-type="context">const first = 1</div><div data-line="8" data-line-type="change-deletion">old value</div><div data-line="8" data-line-type="change-addition">const second = 2</div>'
  root.append(host)
  document.body.append(root)
  const rows = Array.from(shadow.querySelectorAll('[data-line]'))
  return { root, host, shadow, rows }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
})

describe('workspace selection across shadow roots', () => {
  it('reads composed ranges without attributing removed text to new-file lines', () => {
    const { root, rows } = surface()
    const first = rows[0]!.firstChild!
    const last = rows[2]!.firstChild!
    const getComposedRanges = vi.fn(() => [{ startContainer: first, startOffset: 0, endContainer: last, endOffset: last.textContent!.length }])
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, getComposedRanges } as unknown as Selection)
    expect(quoted(root)).toEqual({ text: 'const first = 1\nold value\nconst second = 2' })
    expect(getComposedRanges).toHaveBeenCalledWith({ shadowRoots: [root.firstElementChild!.shadowRoot] })
  })

  it('supports the legacy Safari rest-argument composed-range API', () => {
    const { root, shadow, rows } = surface()
    const node = rows[2]!.firstChild!
    const getComposedRanges = vi.fn((argument: unknown) => {
      if (!(argument instanceof ShadowRoot)) throw new TypeError('Expected ShadowRoot')
      return [{ startContainer: node, startOffset: 0, endContainer: node, endOffset: node.textContent!.length }]
    })
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, getComposedRanges } as unknown as Selection)
    expect(quoted(root)).toEqual({ text: 'const second = 2', startLine: 8, endLine: 8 })
    expect(getComposedRanges).toHaveBeenLastCalledWith(shadow)
  })

  it('reads a backwards selection through ShadowRoot.getSelection without composed ranges', () => {
    const { root, shadow, rows } = surface()
    const node = rows[2]!.firstChild!
    Object.defineProperty(shadow, 'getSelection', { value: () => ({ isCollapsed: false, rangeCount: 0, anchorNode: node, anchorOffset: 12, focusNode: node, focusOffset: 6 }) })
    expect(quoted(root)).toEqual({ text: 'second', startLine: 8, endLine: 8 })
  })

  it('leaves out the next row when a triple-click ends at its start', () => {
    const { root, rows } = surface()
    const first = rows[0]!.firstChild!
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, getComposedRanges: () => [{ startContainer: first, startOffset: 0, endContainer: rows[1]!, endOffset: 0 }] } as unknown as Selection)
    expect(quoted(root)).toEqual({ text: 'const first = 1', startLine: 7, endLine: 7 })
  })

  it('quotes removed text without assigning a new-file line number', () => {
    const { root, shadow, rows } = surface()
    const node = rows[1]!.firstChild!
    Object.defineProperty(shadow, 'getSelection', { value: () => ({ isCollapsed: false, rangeCount: 0, anchorNode: node, anchorOffset: 0, focusNode: node, focusOffset: 9 }) })
    expect(quoted(root)).toEqual({ text: 'old value' })
  })

  it('anchors the quote at the pointer when the range has no layout', () => {
    const { root, rows } = surface()
    const node = rows[0]!.firstChild!
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, getComposedRanges: () => [{ startContainer: node, startOffset: 0, endContainer: node, endOffset: 5 }] } as unknown as Selection)
    expect(getTextSelectionFromContainer(root, pointer)).toMatchObject({ text: 'const', startLine: 7, endLine: 7, x: 5, y: 6 })
    expect(getTextSelectionFromContainer(null, pointer)).toBeNull()
  })

  it('rejects a selection that extends outside the preview', () => {
    const { root, rows } = surface()
    const outside = document.createTextNode('outside')
    document.body.append(outside)
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, getComposedRanges: () => [{ startContainer: rows[0]!.firstChild!, startOffset: 0, endContainer: outside, endOffset: 7 }] } as unknown as Selection)
    expect(getTextSelectionFromContainer(root, pointer)).toBeNull()
  })

  it('keeps line breaks the browser renders between code lines outside a shadow root', () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><span style="display:block"><span>const a = 1</span></span><span style="display:block"><span>const b = 2</span></span></pre>'
    document.body.append(root)
    const lines = root.querySelectorAll('span > span')
    const range = document.createRange()
    range.setStart(lines[0]!.firstChild!, 0)
    range.setEnd(lines[1]!.firstChild!, 11)
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, rangeCount: 1, getRangeAt: () => range, toString: () => 'const a = 1\nconst b = 2' } as unknown as Selection)
    expect(quoted(root)).toEqual({ text: 'const a = 1\nconst b = 2' })
  })
})
