import type { TranslationKey } from '../i18n'

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

export function relativeTimeLabel(t: Translate, elapsedMs: number): string {
  if (elapsedMs < 60000) return t('session.timeJustNow')
  if (elapsedMs < 3600000) return t('session.timeMinutes', { n: Math.floor(elapsedMs / 60000) })
  if (elapsedMs < 86400000) return t('session.timeHours', { n: Math.floor(elapsedMs / 3600000) })
  return t('session.timeDays', { n: Math.floor(elapsedMs / 86400000) })
}
