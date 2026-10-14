import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageDedup } from '../message-dedup.js'

describe('MessageDedup', () => {
  let dedup: MessageDedup

  beforeEach(() => {
    dedup = new MessageDedup(1000, 100)
  })

  afterEach(() => {
    dedup.destroy()
  })

  it('returns true for new messages', () => {
    expect(dedup.tryRecord('msg-1')).toBe(true)
    expect(dedup.tryRecord('msg-2')).toBe(true)
  })

  it('returns false for duplicate messages', () => {
    expect(dedup.tryRecord('msg-1')).toBe(true)
    expect(dedup.tryRecord('msg-1')).toBe(false)
    expect(dedup.tryRecord('msg-1')).toBe(false)
  })

  it('allows same ID after TTL expires', async () => {
    const shortDedup = new MessageDedup(50, 100)
    expect(shortDedup.tryRecord('msg-1')).toBe(true)
    expect(shortDedup.tryRecord('msg-1')).toBe(false)
    await new Promise((r) => setTimeout(r, 60))
    expect(shortDedup.tryRecord('msg-1')).toBe(true)
    shortDedup.destroy()
  })

  it('evicts oldest entry when at capacity', () => {
    const smallDedup = new MessageDedup(60_000, 3)
    expect(smallDedup.tryRecord('a')).toBe(true)
    expect(smallDedup.tryRecord('b')).toBe(true)
    expect(smallDedup.tryRecord('c')).toBe(true)
    expect(smallDedup.tryRecord('d')).toBe(true)
    expect(smallDedup.tryRecord('a')).toBe(true)
    expect(smallDedup.tryRecord('c')).toBe(false)
    smallDedup.destroy()
  })

  it('handles distinct messages independently', () => {
    expect(dedup.tryRecord('msg-1')).toBe(true)
    expect(dedup.tryRecord('msg-2')).toBe(true)
    expect(dedup.tryRecord('msg-1')).toBe(false)
    expect(dedup.tryRecord('msg-2')).toBe(false)
    expect(dedup.tryRecord('msg-3')).toBe(true)
  })
})
