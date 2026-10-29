import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { EMPTY_STREAMING_BLOCKS, splitStreamingBlocks, type StreamingBlocks } from './streamingBlocks'

const DOC = [
  '# Plan',
  '',
  'First paragraph with `code` and $x^2$.',
  '',
  '1. one',
  '',
  '2. two',
  '',
  '3. three',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```ts',
  'const a = 1',
  '',
  'const b = 2',
  '```',
  '',
  'Display math:',
  '',
  '$$',
  'a + b',
  '',
  '= c',
  '$$',
  '',
  'Heading',
  '---',
  '',
  '- item',
  '  continued',
  '',
  '  more of the item',
  '',
  'Last line.',
].join('\n')

function stream(text: string, step: number) {
  const snapshots: StreamingBlocks[] = []
  let state = EMPTY_STREAMING_BLOCKS
  for (let end = step; end < text.length + step; end += step) {
    state = splitStreamingBlocks(state, text.slice(0, Math.min(end, text.length)))
    snapshots.push(state)
  }
  return snapshots
}

function renderBlocks(state: StreamingBlocks) {
  return [...state.finished, state.tail].map((block) => marked.parse(block) as string).join('').replace(/\s+/g, ' ')
}

describe('splitStreamingBlocks', () => {
  it('only appends finished blocks and never changes one', () => {
    for (const step of [1, 3, 17]) {
      const snapshots = stream(DOC, step)
      for (let i = 1; i < snapshots.length; i++) {
        const previous = snapshots[i - 1]!.finished
        const current = snapshots[i]!.finished
        expect(current.slice(0, previous.length)).toEqual(previous)
      }
    }
  })

  it('renders the same HTML as the whole reply once it is complete', () => {
    const whole = (marked.parse(DOC) as string).replace(/\s+/g, ' ')
    for (const step of [1, 5, 40]) {
      const snapshots = stream(DOC, step)
      const last = snapshots[snapshots.length - 1]!
      expect(last.finished.length).toBeGreaterThan(3)
      expect(renderBlocks(last)).toBe(whole)
    }
  })

  it('keeps a block open while the next line could still continue it', () => {
    let state = splitStreamingBlocks(EMPTY_STREAMING_BLOCKS, '1. one\n\n2')
    expect(state.finished).toEqual([])
    state = splitStreamingBlocks(state, '1. one\n\n2. two\n\n- ')
    expect(state.finished).toEqual([])
    state = splitStreamingBlocks(state, '1. one\n\n2. two\n\n- item\n')
    expect(state.finished).toEqual(['1. one\n\n2. two'])
    expect(state.tail).toBe('- item\n')
  })

  it('finishes a block as soon as the next one starts with a letter', () => {
    let state = splitStreamingBlocks(EMPTY_STREAMING_BLOCKS, '1. one\n\nN')
    expect(state.finished).toEqual(['1. one'])
    expect(state.tail).toBe('N')
    state = splitStreamingBlocks(state, '1. one\n\nNext\n\n中')
    expect(state.finished).toEqual(['1. one', 'Next'])
    expect(state.tail).toBe('中')
  })

  it('keeps display math that spans blank lines in one block', () => {
    const state = splitStreamingBlocks(EMPTY_STREAMING_BLOCKS, 'Intro\n\n$$\na\n\nb\n$$\n\nAfter\n\nMore\n')
    expect(state.finished).toEqual(['Intro', '$$\na\n\nb\n$$', 'After'])
  })

  it('keeps an unclosed code fence in the tail', () => {
    const state = splitStreamingBlocks(EMPTY_STREAMING_BLOCKS, 'Intro\n\n```js\nconst a = 1\n\nconst b')
    expect(state.finished).toEqual(['Intro'])
    expect(state.tail).toBe('```js\nconst a = 1\n\nconst b')
  })

  it('falls back to the whole reply when it has link reference definitions', () => {
    const text = 'Intro\n\n[r]: https://example.com\n\nSee [docs][r].\n\nNext paragraph\n'
    const last = stream(text, 4)[stream(text, 4).length - 1]!
    expect(last.finished).toEqual([])
    expect(last.tail).toBe(text)
    expect(renderBlocks(last)).toBe((marked.parse(text) as string).replace(/\s+/g, ' '))
  })

  it('splits CRLF text at the right offsets', () => {
    const state = splitStreamingBlocks(EMPTY_STREAMING_BLOCKS, '```js\r\na\r\nb\r\n```\r\n\r\nNext')
    expect(state.finished).toEqual(['```js\na\nb\n```'])
    expect(state.tail).toBe('Next')
  })

  it('ignores display math delimiters inside inline code', () => {
    let state = splitStreamingBlocks(EMPTY_STREAMING_BLOCKS, 'Use `$$` for the PID.\n\nTail')
    expect(state.finished).toEqual(['Use `$$` for the PID.'])
    state = splitStreamingBlocks(EMPTY_STREAMING_BLOCKS, 'Use `$$` here.\n\n$$\na\n\nb\n$$\n\nDone\n\nMore')
    expect(state.finished).toEqual(['Use `$$` here.', '$$\na\n\nb\n$$', 'Done'])
  })

  it('keeps the remainder in the tail when token text does not match the reply', () => {
    let state = splitStreamingBlocks(EMPTY_STREAMING_BLOCKS, 'Intro\n\nNext')
    expect(state.finished).toEqual(['Intro'])
    state = splitStreamingBlocks(state, 'Intro\n\nfoo\n    bar\n---\nNext')
    expect(state.finished).toEqual(['Intro'])
    expect(state.tail).toBe('foo\n    bar\n---\nNext')
  })

  it('keeps block HTML and everything after it in the tail', () => {
    const text = 'Intro\n\n<details>\n<summary>More</summary>\n\nHidden text\n\n</details>\n\nDone\n\nAfter'
    for (const step of [1, 7]) {
      const snapshots = stream(text, step)
      const last = snapshots[snapshots.length - 1]!
      expect(last.finished).toEqual(['Intro'])
      expect(last.tail.startsWith('<details>')).toBe(true)
      expect(renderBlocks(last)).toBe((marked.parse(text) as string).replace(/\s+/g, ' '))
    }
  })

  it('starts over when the text is replaced', () => {
    const first = splitStreamingBlocks(EMPTY_STREAMING_BLOCKS, 'One\n\nTwo\n\nThree\n')
    expect(first.finished.length).toBeGreaterThan(0)
    const next = splitStreamingBlocks(first, 'Other')
    expect(next.finished).toEqual([])
    expect(next.tail).toBe('Other')
  })
})
