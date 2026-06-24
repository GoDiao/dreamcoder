import { describe, expect, test } from 'bun:test'
import { slugify } from './slug'

describe('slugify', () => {
  test('normalizes whitespace and punctuation', () => {
    expect(slugify('  Hello, Coding Agent!  ')).toBe('hello-coding-agent')
  })

  test('collapses repeated separators', () => {
    expect(slugify('Ship---Stable    Releases')).toBe('ship-stable-releases')
  })

  test('trims separators from the edges', () => {
    expect(slugify('---Quality Gate---')).toBe('quality-gate')
  })
})
