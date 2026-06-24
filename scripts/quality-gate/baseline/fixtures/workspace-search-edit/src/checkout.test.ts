import { describe, expect, test } from 'bun:test'
import { catalog } from './catalog'
import { calculateTotalCents } from './checkout'
import { testUser } from './user'

describe('calculateTotalCents', () => {
  test('applies percentage discounts to the subtotal', () => {
    expect(calculateTotalCents(catalog, testUser)).toBe(1500)
  })
})
