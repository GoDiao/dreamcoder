import { describe, expect, test } from 'bun:test'
import { add } from './math'

describe('add', () => {
  test('adds positive numbers', () => {
    expect(add(2, 3)).toBe(5)
  })
})
