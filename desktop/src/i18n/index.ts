import { useCallback } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { en, type TranslationKey } from './locales/en'
import { zh } from './locales/zh'

export type Locale = 'en' | 'zh'

const translations: Record<Locale, Record<string, string>> = { en, zh }

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  let text = translations[locale]?.[key] ?? translations.zh[key] ?? translations.en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), () => String(v))
    }
  }
  return text
}

export function useTranslation() {
  const locale = useSettingsStore((s) => s.locale)
  return useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  )
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const locale = useSettingsStore.getState().locale
  return translate(locale, key, params)
}

export type { TranslationKey }
