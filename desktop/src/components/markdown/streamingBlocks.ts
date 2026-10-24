import { marked } from 'marked'

export type StreamingBlocks = {
  source: string
  finished: string[]
  finishedLength: number
  tail: string
}

export const EMPTY_STREAMING_BLOCKS: StreamingBlocks = {
  source: '',
  finished: [],
  finishedLength: 0,
  tail: '',
}

const SETTLED_BLOCK_START = /^\p{L}/u

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) backslashes += 1
  return backslashes % 2 === 1
}

function displayMathOpenAfter(raw: string, open: boolean): boolean {
  let state = open
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '`') {
      const ticks = /^`+/.exec(raw.slice(i))![0]
      const end = raw.indexOf(ticks, i + ticks.length)
      if (end !== -1) {
        i = end + ticks.length - 1
        continue
      }
    }
    if (raw.startsWith('$$', i) && !isEscaped(raw, i)) {
      state = !state
      i += 1
    } else if (raw.startsWith('\\[', i) && !isEscaped(raw, i)) {
      state = true
      i += 1
    } else if (raw.startsWith('\\]', i) && !isEscaped(raw, i)) {
      state = false
      i += 1
    }
  }
  return state
}

export function splitStreamingBlocks(previous: StreamingBlocks, input: string): StreamingBlocks {
  const source = input.replace(/\r\n?/g, '\n')
  if (source === previous.source) return previous

  const base = source.startsWith(previous.source.slice(0, previous.finishedLength))
    ? previous
    : EMPTY_STREAMING_BLOCKS
  const rest = source.slice(base.finishedLength)
  const tokens = marked.lexer(rest)
  if (Object.keys(tokens.links).length > 0) {
    return { source, finished: [], finishedLength: 0, tail: source }
  }
  if (tokens.map((token) => token.raw).join('') !== rest) {
    return { source, finished: base.finished, finishedLength: base.finishedLength, tail: rest }
  }
  const lastNewline = rest.lastIndexOf('\n')

  const starts: number[] = []
  let position = 0
  for (const token of tokens) {
    starts.push(position)
    position += token.raw.length
  }

  const firstHtml = tokens.findIndex((token) => token.type === 'html')
  let boundary = 0
  for (let j = firstHtml === -1 ? tokens.length - 1 : firstHtml; j > 0; j--) {
    const token = tokens[j]!
    if (token.type !== 'space' && (starts[j]! <= lastNewline || SETTLED_BLOCK_START.test(token.raw))) {
      boundary = j
      break
    }
  }

  const finished = boundary > 0 ? [...base.finished] : base.finished
  let finishedLength = base.finishedLength
  let group = ''
  let mathOpen = false
  for (let i = 0; i < boundary; i++) {
    const token = tokens[i]!
    group += token.raw
    if (token.type !== 'code') mathOpen = displayMathOpenAfter(token.raw, mathOpen)
    if (mathOpen) continue
    if (group.trim()) finished.push(group)
    finishedLength += group.length
    group = ''
  }

  return {
    source,
    finished,
    finishedLength,
    tail: source.slice(finishedLength),
  }
}
