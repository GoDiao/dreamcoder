import { describe, expect, test } from 'bun:test'
import { segmentTextByHighlights } from './textHighlighting.js'

const TITLE = '\x1b]0;title\x07'

describe('segmentTextByHighlights', () => {
  test('segments text that contains a window title sequence', () => {
    const segments = segmentTextByHighlights(`ab${TITLE}cd`, [
      { start: 1, end: 3, color: undefined, priority: 0 },
    ])
    expect(segments.map(segment => [segment.text, segment.start])).toEqual([
      ['a', 0],
      [`b${TITLE}c`, 1],
      ['d', 3],
    ])
  })

  test('segments text that starts with a window title sequence', () => {
    const segments = segmentTextByHighlights(`${TITLE}abc`, [
      { start: 0, end: 1, color: undefined, priority: 0 },
    ])
    expect(segments.map(segment => [segment.text, segment.start])).toEqual([
      [`${TITLE}a`, 0],
      ['bc', 1],
    ])
  })
})
