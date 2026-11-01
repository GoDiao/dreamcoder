import { afterEach, describe, expect, it } from 'vitest'
import { SELECTION_PROBE_SOURCE } from './selectionProbe'

function probe(): boolean {
  return Function(`return ${SELECTION_PROBE_SOURCE}`)() as boolean
}

function selectAll(node: Node) {
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

afterEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

describe('selection probe', () => {
  it('passes a plain text selection', () => {
    document.body.innerHTML = '<p id="p">hello world</p><input type="text" autocomplete="off">'
    selectAll(document.getElementById('p') as HTMLElement)

    expect(probe()).toBe(false)
  })

  it('passes when nothing is selected', () => {
    document.body.innerHTML = '<p>hello</p>'

    expect(probe()).toBe(false)
  })

  it('flags a focused password field', () => {
    document.body.innerHTML = '<input id="f" type="password" value="hunter2">'
    ;(document.getElementById('f') as HTMLElement).focus()

    expect(probe()).toBe(true)
  })

  it('flags a focused card field by its autocomplete token', () => {
    document.body.innerHTML = '<input id="f" type="text" autocomplete="section-pay cc-number">'
    ;(document.getElementById('f') as HTMLElement).focus()

    expect(probe()).toBe(true)
  })

  it('flags a selection that spans a sensitive field', () => {
    document.body.innerHTML = '<div id="box">before <input type="password" value="x"> after</div>'
    selectAll(document.getElementById('box') as HTMLElement)

    expect(probe()).toBe(true)
  })

  it('flags a focused field inside a shadow root', () => {
    document.body.innerHTML = '<div id="host"></div>'
    const root = (document.getElementById('host') as HTMLElement).attachShadow({ mode: 'open' })
    root.innerHTML = '<input id="inner" type="password">'
    ;(root.getElementById('inner') as HTMLElement).focus()

    expect(probe()).toBe(true)
  })

  it('does not depend on anything outside its own source', () => {
    expect(SELECTION_PROBE_SOURCE).not.toContain('import')
    expect(() => new Function(`return ${SELECTION_PROBE_SOURCE}`)).not.toThrow()
  })
})
