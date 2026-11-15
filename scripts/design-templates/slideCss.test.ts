import { describe, expect, it } from 'bun:test'
import { dedent, dropWindowMedia, scaleLengths, scaleStyleAttributes, stripCssComments, tidyCss } from './slideCss.js'

const doubled = { factor: 2, rootFontSize: 16 }
const native = { factor: 1, rootFontSize: 16 }

describe('scaleLengths', () => {
  it('turns viewport units into pixels of the 1920 by 1080 frame and scales fixed pixels', () => {
    expect(scaleLengths('padding: 5vh 7vw; margin: 10px -4px; width: 2rem;', doubled)).toBe('padding: 54px 134px; margin: 20px -8px; width: 64px;')
    expect(scaleLengths('left: 50vmax; top: 10vmin;', native)).toBe('left: 960px; top: 108px;')
  })

  it('folds clamp, min, max and calc once only pixels are left', () => {
    expect(scaleLengths('font-size: clamp(13px, 1.2vw, 16px);', doubled)).toBe('font-size: 26px;')
    expect(scaleLengths('font-size: clamp(72px, 16vw, 220px);', doubled)).toBe('font-size: 307px;')
    expect(scaleLengths('width: min(1100px, 90vw); height: max(10px, 2vh);', doubled)).toBe('width: 1728px; height: 22px;')
    expect(scaleLengths('top: calc(10px + 2vh - 4px * 2);', native)).toBe('top: 24px;')
    expect(scaleLengths('width: clamp(10px, calc(1vw + 2px), 40px);', native)).toBe('width: 21px;')
  })

  it('keeps an expression with relative units and only converts its viewport units', () => {
    expect(scaleLengths('width: calc(100% - 4vw); height: clamp(1em, 2vh, 3em);', native)).toBe('width: calc(100% - 77px); height: clamp(1em, 22px, 3em);')
  })

  it('keeps one decimal below four pixels and leaves strings, urls, colors and unitless numbers alone', () => {
    expect(scaleLengths('border: 0.75px solid #10a0c0; line-height: 1.4;', doubled)).toBe('border: 1.5px solid #10a0c0; line-height: 1.4;')
    expect(scaleLengths('content: "12px"; background: url(a-10px.svg); transform: rotate(-4deg) scale(0.98);', doubled)).toBe('content: "12px"; background: url(a-10px.svg); transform: rotate(-4deg) scale(0.98);')
  })

  it('keeps converting after a quoted data url that holds parentheses and the other quote', () => {
    const css = `.grain { background: url("data:image/svg+xml,<svg><rect filter='url(%23n)' width='10px'/></svg>"); }\n.title { font-size: clamp(2.5rem, 5vw, 4.5rem); padding: 10px; }`
    expect(scaleLengths(css, doubled)).toBe(`.grain { background: url("data:image/svg+xml,<svg><rect filter='url(%23n)' width='10px'/></svg>"); }\n.title { font-size: 96px; padding: 20px; }`)
  })
})

describe('dropWindowMedia', () => {
  it('drops rules for small windows and print, and keeps other media rules', () => {
    const css = '.a{color:red}\n@media (max-width: 900px){.a{color:blue}.b{x:y}}\n@media print{.c{d:e}}\n@media (prefers-reduced-motion: reduce){.a{animation:none}}\n.z{}'
    expect(dropWindowMedia(css)).toBe('.a{color:red}\n\n\n@media (prefers-reduced-motion: reduce){.a{animation:none}}\n.z{}')
  })
})

describe('tidying', () => {
  it('removes comments and the indentation the stylesheet had inside the page', () => {
    expect(tidyCss(stripCssComments('    /* hero */\n    .a {\n      color: red;\n    }\n\n\n\n    .b {}  '))).toBe('.a {\n  color: red;\n}\n\n.b {}')
    expect(dedent('<section>\n      <p>x</p>\n    </section>', 1)).toBe('<section>\n  <p>x</p>\n</section>')
  })

  it('scales lengths inside style attributes only', () => {
    expect(scaleStyleAttributes('<p class="w-10px" style="margin: 4px 1vw">10px</p>', doubled)).toBe('<p class="w-10px" style="margin: 8px 19px">10px</p>')
  })
})
