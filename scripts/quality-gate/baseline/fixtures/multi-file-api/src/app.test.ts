import { describe, expect, test } from 'bun:test'
import { formatUser } from './api'
import { renderUser } from './app'

describe('renderUser', () => {
  test('renders name and email', () => {
    expect(renderUser({ name: 'Ada Lovelace', email: 'ada@example.com' })).toBe('User: Ada Lovelace <ada@example.com>')
  })

  test('uses the structured display API contract', () => {
    expect(formatUser({ name: 'Ada Lovelace', email: 'ada@example.com' })).toEqual({
      label: 'Ada Lovelace <ada@example.com>',
    })
  })
})
