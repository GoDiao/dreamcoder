import { describe, expect, it } from 'vitest'
import { relativeTimeLabel } from './relativeTime'

const t = (key: string, params?: Record<string, string | number>) => (params ? `${key}:${params.n}` : key)

describe('relativeTimeLabel', () => {
  it.each([
    [0, 'session.timeJustNow'],
    [59_999, 'session.timeJustNow'],
    [60_000, 'session.timeMinutes:1'],
    [3_599_999, 'session.timeMinutes:59'],
    [3_600_000, 'session.timeHours:1'],
    [86_399_999, 'session.timeHours:23'],
    [86_400_000, 'session.timeDays:1'],
    [3 * 86_400_000, 'session.timeDays:3'],
  ])('labels %d ms as %s', (elapsedMs, label) => {
    expect(relativeTimeLabel(t, elapsedMs)).toBe(label)
  })
})
