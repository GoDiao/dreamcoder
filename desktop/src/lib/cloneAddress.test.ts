import { describe, expect, it } from 'vitest'
import { normalizeCloneAddress } from './cloneAddress'

describe('normalizeCloneAddress', () => {
  it('adds https to an address without a scheme and keeps http and https as they are', () => {
    expect(normalizeCloneAddress('example.com')).toBe('https://example.com/')
    expect(normalizeCloneAddress('  https://example.com/a?b=1  ')).toBe('https://example.com/a?b=1')
    expect(normalizeCloneAddress('http://example.com')).toBe('http://example.com/')
    expect(normalizeCloneAddress('localhost:3000/x')).toBe('https://localhost:3000/x')
  })

  it('refuses text that is not a web address', () => {
    for (const text of ['', '   ', 'two words.com', 'ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'mailto:a@b.co', 'intranet', 'https://user:pw@example.com/', 'https://']) {
      expect(normalizeCloneAddress(text)).toBeNull()
    }
  })
})
