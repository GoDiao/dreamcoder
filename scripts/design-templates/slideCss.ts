import { DECK_HEIGHT, DECK_WIDTH } from '../../src/utils/deck.js'

export type LengthScale = {
  factor: number
  rootFontSize: number
}

const LENGTH = /(?<![\w.#])(-?(?:\d+\.\d+|\d+|\.\d+))(px|vw|vh|vmin|vmax|rem)(?![\w-])/g
const FOLDABLE = /\b(clamp|min|max|calc)\(\s*([^()]*?)\s*\)/g
const WINDOW_MEDIA = /max-width|max-height|max-aspect-ratio|orientation\s*:\s*portrait|\bprint\b/

function formatPx(value: number): string {
  return `${Math.abs(value) >= 4 ? Math.round(value) : Number(value.toFixed(1))}px`
}

function toPx(value: number, unit: string, scale: LengthScale): number {
  switch (unit) {
    case 'vw':
    case 'vmax':
      return (value * DECK_WIDTH) / 100
    case 'vh':
    case 'vmin':
      return (value * DECK_HEIGHT) / 100
    case 'rem':
      return value * scale.rootFontSize * scale.factor
    default:
      return value * scale.factor
  }
}

type Term = { value: number; px: boolean }

function evaluate(expression: string): number | null {
  const tokens = expression.match(/-?(?:\d+\.\d+|\d+|\.\d+)(?:px)?|[+*/]|-(?=\s)|\S+/g)
  if (!tokens) return null
  const terms: Term[] = []
  const operators: string[] = []
  for (const token of tokens) {
    if (/^[+*/-]$/.test(token)) {
      operators.push(token)
      continue
    }
    const match = /^(-?(?:\d+\.\d+|\d+|\.\d+))(px)?$/.exec(token)
    if (!match) return null
    terms.push({ value: Number(match[1]), px: match[2] === 'px' })
  }
  if (terms.length !== operators.length + 1) return null
  const sums: Term[] = [terms[0]!]
  const signs: string[] = []
  for (let index = 0; index < operators.length; index++) {
    const operator = operators[index]!
    const next = terms[index + 1]!
    const last = sums[sums.length - 1]!
    if (operator === '*') {
      if (last.px && next.px) return null
      sums[sums.length - 1] = { value: last.value * next.value, px: last.px || next.px }
    } else if (operator === '/') {
      if (next.px || next.value === 0) return null
      sums[sums.length - 1] = { value: last.value / next.value, px: last.px }
    } else {
      signs.push(operator)
      sums.push(next)
    }
  }
  if (!sums.every(term => term.px)) return null
  return sums.slice(1).reduce((total, term, index) => (signs[index] === '+' ? total + term.value : total - term.value), sums[0]!.value)
}

function fold(name: string, inner: string): string | null {
  const values = inner.split(',').map(part => evaluate(part.trim()))
  if (values.some(value => value === null)) return null
  const numbers = values as number[]
  if (name === 'calc') return numbers.length === 1 ? formatPx(numbers[0]!) : null
  if (name === 'clamp') return numbers.length === 3 ? formatPx(Math.max(numbers[0]!, Math.min(numbers[1]!, numbers[2]!))) : null
  if (numbers.length === 0) return null
  return formatPx(name === 'min' ? Math.min(...numbers) : Math.max(...numbers))
}

function scalePlain(text: string, scale: LengthScale): string {
  let result = text.replace(LENGTH, (_, value: string, unit: string) => formatPx(toPx(Number(value), unit, scale)))
  for (let previous = ''; previous !== result;) {
    previous = result
    result = result.replace(FOLDABLE, (whole, name: string, inner: string) => fold(name, inner) ?? whole)
  }
  return result
}

export function scaleLengths(css: string, scale: LengthScale): string {
  const protectedParts = /url\(\s*"(?:\\.|[^"\\])*"\s*\)|url\(\s*'(?:\\.|[^'\\])*'\s*\)|url\([^)"']*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g
  let result = ''
  let cursor = 0
  for (const match of css.matchAll(protectedParts)) {
    result += scalePlain(css.slice(cursor, match.index), scale) + match[0]
    cursor = match.index! + match[0].length
  }
  return result + scalePlain(css.slice(cursor), scale)
}

export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function blockEnd(css: string, open: number): number {
  let depth = 0
  for (let index = open; index < css.length; index++) {
    const char = css[index]
    if (char === '"' || char === "'") {
      const close = css.indexOf(char, index + 1)
      index = close < 0 ? css.length : close
    } else if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) return index + 1
    }
  }
  return css.length
}

export function dropWindowMedia(css: string): string {
  let result = ''
  let cursor = 0
  for (let start = css.indexOf('@media', cursor); start >= 0; start = css.indexOf('@media', cursor)) {
    const open = css.indexOf('{', start)
    if (open < 0) break
    const end = blockEnd(css, open)
    result += css.slice(cursor, start)
    if (!WINDOW_MEDIA.test(css.slice(start, open))) result += css.slice(start, end)
    cursor = end
  }
  return result + css.slice(cursor)
}

export function dedent(text: string, fromLine = 0): string {
  const lines = text.split('\n').map(line => line.replace(/\s+$/, ''))
  const indent = Math.min(...lines.slice(fromLine).filter(line => line !== '').map(line => /^ */.exec(line)![0].length))
  return lines.map((line, index) => (index >= fromLine && Number.isFinite(indent) ? line.slice(indent) : line)).join('\n')
}

export function tidyCss(css: string): string {
  return dedent(css).replace(/\n{3,}/g, '\n\n').trim()
}

export function scaleStyleAttributes(html: string, scale: LengthScale): string {
  return html.replace(/(\sstyle=")([^"]*)(")/g, (_, before: string, value: string, after: string) => `${before}${scaleLengths(value, scale)}${after}`)
}
