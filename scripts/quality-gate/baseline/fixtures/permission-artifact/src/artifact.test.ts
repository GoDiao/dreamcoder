import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

describe('release artifact', () => {
  test('has the required summary marker', () => {
    expect(existsSync('notes/summary.md')).toBe(true)
    expect(readFileSync('notes/summary.md', 'utf8')).toContain('baseline-ready')
  })
})
