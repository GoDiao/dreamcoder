import { describe, it, expect } from 'vitest'
import { describeCron, isValidCron, parseCron } from '../cronDescribe'

const t = (key: string, params?: Record<string, string | number>) => {
  let text = key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return text
}

describe('describeCron', () => {
  it('every minute', () => {
    expect(describeCron('* * * * *', t)).toBe('cron.everyMinute')
  })

  it('every N minutes', () => {
    expect(describeCron('*/15 * * * *', t)).toBe('cron.everyNMinutes')
    expect(describeCron('*/5 * * * *', t)).toBe('cron.everyNMinutes')
  })

  it('*/1 is treated as every minute', () => {
    expect(describeCron('*/1 * * * *', t)).toBe('cron.everyMinute')
  })

  it('every hour', () => {
    expect(describeCron('0 */1 * * *', t)).toBe('cron.everyHour')
  })

  it('every N hours', () => {
    expect(describeCron('0 */4 * * *', t)).toBe('cron.everyNHours')
  })

  it('every N hours at minute offset', () => {
    expect(describeCron('30 */4 * * *', t)).toBe('cron.everyNHoursAtMinute')
  })

  it('daily at time', () => {
    expect(describeCron('30 9 * * *', t)).toBe('cron.dailyAt')
  })

  it('weekdays at time', () => {
    expect(describeCron('30 9 * * 1-5', t)).toBe('cron.weekdaysAt')
  })

  it('specific days of week', () => {
    const result = describeCron('0 9 * * 1,3,5', t)
    expect(result).toBe('cron.specificDaysAt')
  })

  it('monthly on specific day', () => {
    expect(describeCron('0 9 15 * *', t)).toBe('cron.monthlyAt')
  })

  it('unrecognized pattern falls back to custom', () => {
    expect(describeCron('0 9 1 6 *', t)).toBe('cron.customSchedule')
  })

  it('invalid field count falls back to custom', () => {
    expect(describeCron('0 9 *', t)).toBe('cron.customSchedule')
  })
})

describe('isValidCron', () => {
  it('accepts valid expressions', () => {
    expect(isValidCron('0 9 * * *')).toBe(true)
    expect(isValidCron('*/15 * * * *')).toBe(true)
    expect(isValidCron('30 14 * * 1-5')).toBe(true)
    expect(isValidCron('0 9 * * 1,3,5')).toBe(true)
    expect(isValidCron('0 9 15 * *')).toBe(true)
    expect(isValidCron('0 */2 * * *')).toBe(true)
  })

  it('rejects invalid expressions', () => {
    expect(isValidCron('')).toBe(false)
    expect(isValidCron('hello')).toBe(false)
    expect(isValidCron('0 9 *')).toBe(false)
    expect(isValidCron('0 9 * * * *')).toBe(false)
    expect(isValidCron('60 9 * * *')).toBe(false)
    expect(isValidCron('0 25 * * *')).toBe(false)
    expect(isValidCron('0 9 32 * *')).toBe(false)
    expect(isValidCron('0 9 * 13 *')).toBe(false)
    expect(isValidCron('0 9 * * 8')).toBe(false)
  })

  it('accepts edge case values', () => {
    expect(isValidCron('0 0 1 1 0')).toBe(true)
    expect(isValidCron('59 23 31 12 7')).toBe(true)
  })
})

describe('parseCron', () => {
  it('recognises the day-of-week ranges describeCron already accepts', () => {
    expect(parseCron('0 9 * * 1-3').frequency).toBe('specificDays')
    expect(parseCron('0 9 * * 1-3').selectedDays).toEqual([1, 2, 3])
    expect(parseCron('0 9 * * 0-4').frequency).toBe('specificDays')
    expect(parseCron('0 9 * * 0-4').selectedDays).toEqual([0, 1, 2, 3, 4])
  })

  it('still expands comma-separated days and the 1-5 weekday range', () => {
    expect(parseCron('0 9 * * 1,3,5').frequency).toBe('specificDays')
    expect(parseCron('0 9 * * 1,3,5').selectedDays).toEqual([1, 3, 5])
    expect(parseCron('0 9 * * 1-5').frequency).toBe('weekdays')
    expect(parseCron('0 9 * * 1-5').selectedDays).toEqual([1])
  })

  it('expands a range mixed into a comma list', () => {
    expect(parseCron('0 9 * * 1-3,5').frequency).toBe('specificDays')
    expect(parseCron('0 9 * * 1-3,5').selectedDays).toEqual([1, 2, 3, 5])
  })

  it('keeps the other frequencies intact', () => {
    expect(parseCron('*/15 * * * *').frequency).toBe('everyNMinutes')
    expect(parseCron('*/15 * * * *').minuteInterval).toBe(15)
    expect(parseCron('0 */4 * * *').frequency).toBe('everyNHours')
    expect(parseCron('0 */4 * * *').hourInterval).toBe(4)
    expect(parseCron('30 9 * * *').frequency).toBe('daily')
    expect(parseCron('30 9 * * *').time).toBe('09:30')
    expect(parseCron('0 9 15 * *').frequency).toBe('monthly')
    expect(parseCron('0 9 15 * *').monthDay).toBe(15)
    expect(parseCron('0 9 1 6 *').frequency).toBe('customCron')
    expect(parseCron('0 9 *').frequency).toBe('customCron')
  })

  it('round-trips what buildCron serialises', () => {
    expect(parseCron('30 9 * * 1-5').frequency).toBe('weekdays')
    const rebuilt = parseCron('0 9 * * 1,2,3')
    expect(rebuilt.frequency).toBe('specificDays')
    expect(rebuilt.time).toBe('09:00')
    expect(rebuilt.selectedDays).toEqual([1, 2, 3])
  })
})

describe('parseCron day-of-week validity', () => {
  it('normalises the Sunday alias 7 to 0', () => {
    expect(parseCron('0 9 * * 7').frequency).toBe('specificDays')
    expect(parseCron('0 9 * * 7').selectedDays).toEqual([0])
  })

  it('rejects values above 7 instead of wrapping them into range', () => {
    expect(parseCron('0 9 * * 8').frequency).toBe('customCron')
    expect(parseCron('0 9 * * 14').frequency).toBe('customCron')
  })

  it('rejects a reversed range rather than emitting a partial day list', () => {
    expect(parseCron('0 9 * * 5-1').frequency).toBe('customCron')
  })

  it('rejects the whole field when any token is invalid', () => {
    expect(parseCron('0 9 * * 1-3,99').frequency).toBe('customCron')
    expect(parseCron('0 9 * * 1-3,5').frequency).toBe('specificDays')
    expect(parseCron('0 9 * * 1-3,5').selectedDays).toEqual([1, 2, 3, 5])
  })

  it('still accepts every in-range value', () => {
    expect(parseCron('0 9 * * 0').selectedDays).toEqual([0])
    expect(parseCron('0 9 * * 6').selectedDays).toEqual([6])
    expect(parseCron('0 9 * * 0-6').selectedDays).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

describe('describeCron with an unusable day-of-week field', () => {
  it('falls back to the custom schedule instead of throwing', () => {
    for (const cron of ['0 9 * * 8', '0 9 * * 5-1', '0 9 * * 1-3,99']) {
      expect(() => describeCron(cron, t)).not.toThrow()
      expect(describeCron(cron, t)).toBe('cron.customSchedule')
    }
  })

  it('still names the days for a valid field', () => {
    expect(describeCron('0 9 * * 1,3', t)).toBe('cron.specificDaysAt')
    expect(describeCron('0 9 * * 7', t)).toBe('cron.specificDaysAt')
  })
})
