import { describe, expect, test } from 'bun:test'
import sliceAnsi from './sliceAnsi.js'

const TITLE = '\x1b]0;title\x07'

describe('sliceAnsi', () => {
  test('drops a window title sequence before the slice start', () => {
    expect(sliceAnsi(`${TITLE}abc`, 0, 2)).toBe('ab')
  })

  test('keeps a window title sequence inside the slice', () => {
    expect(sliceAnsi(`ab${TITLE}cd`, 1, 3)).toBe(`b${TITLE}c`)
  })
})
