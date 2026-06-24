import { describe, expect, test } from 'bun:test'
import { greetingFor } from './greeting'

describe('greetingFor', () => {
  test('includes the desktop smoke marker', () => {
    expect(greetingFor('Ada Lovelace')).toBe('Hello, Ada Lovelace from desktop smoke!')
  })
})
