import { describe, expect, it } from 'vitest'
import { matchesQuery } from './textMatch'

describe('matchesQuery', () => {
  it('matches everything for an empty or blank query', () => {
    expect(matchesQuery(['a'], '')).toBe(true)
    expect(matchesQuery([], '   ')).toBe(true)
  })

  it('matches a substring of any text without regard to case', () => {
    expect(matchesQuery(['Hello', 'World'], 'WORL')).toBe(true)
    expect(matchesQuery(['你好'], '好')).toBe(true)
  })

  it('trims the query', () => {
    expect(matchesQuery(['hello'], '  hello  ')).toBe(true)
  })

  it('does not match when no text contains the query', () => {
    expect(matchesQuery(['hello'], 'bye')).toBe(false)
    expect(matchesQuery([], 'bye')).toBe(false)
  })
})
