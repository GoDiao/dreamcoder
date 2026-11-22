import { describe, expect, test } from 'bun:test'
import { ColorFile } from './index.js'

describe('ColorFile', () => {
  test('colors keywords and strings differently from plain code', () => {
    const lines = new ColorFile('const answer = "yes"', 'answer.ts').render('dark', 80, false)
    const colors = new Set(lines?.join('').match(/\x1b\[38;5;\d+m/g))
    expect(colors.size).toBeGreaterThan(2)
  })
})
