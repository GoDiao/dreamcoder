import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from './uuid'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomUUID', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds a version 4 UUID from random bytes when the page is not a secure context', () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    vi.stubGlobal('crypto', { getRandomValues })

    const first = randomUUID()
    const second = randomUUID()

    expect(first).toMatch(UUID_PATTERN)
    expect(second).toMatch(UUID_PATTERN)
    expect(first).not.toBe(second)
  })

  it('uses the browser UUID when it is available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-4111-8111-111111111111', getRandomValues: () => {} })

    expect(randomUUID()).toBe('11111111-1111-4111-8111-111111111111')
  })
})
