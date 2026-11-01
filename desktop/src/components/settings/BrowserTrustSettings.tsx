import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation, type TranslationKey } from '../../i18n'
import {
  listTrustedBrowserOrigins,
  trustBrowserOrigin,
  untrustBrowserOrigin,
} from '../../lib/shell'
import { Button } from '../shared/ui/button'
import { LabeledInput } from '../shared/LabeledInput'
import { LoadingBlock } from '../shared/LoadingBlock'
import { SettingsGroup, SettingsRow } from './SettingsRow'

const KNOWN_ERROR_CODES = ['invalid_origin', 'limit', 'unavailable'] as const

function trustErrorKey(error: unknown): TranslationKey {
  const code = error instanceof Error ? error.message : ''
  const known = KNOWN_ERROR_CODES.find((candidate) => candidate === code)
  return known ? `settings.browserTrust.error.${known}` : 'settings.browserTrust.error.generic'
}

export function BrowserTrustSettings() {
  const t = useTranslation()
  const [origins, setOrigins] = useState<string[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [addErrorKey, setAddErrorKey] = useState<TranslationKey | null>(null)
  const [removeErrorKey, setRemoveErrorKey] = useState<TranslationKey | null>(null)

  const load = useCallback(() => {
    let cancelled = false
    setLoadFailed(false)
    listTrustedBrowserOrigins()
      .then((list) => {
        if (!cancelled) setOrigins(list)
      })
      .catch((error: unknown) => {
        console.error('[browser] Failed to load the trusted sites', error)
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => load(), [load])

  const change = async (operation: () => Promise<string[]>, setErrorKey: (key: TranslationKey | null) => void) => {
    setBusy(true)
    setAddErrorKey(null)
    setRemoveErrorKey(null)
    try {
      setOrigins(await operation())
      return true
    } catch (error) {
      setErrorKey(trustErrorKey(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async (event: FormEvent) => {
    event.preventDefault()
    const origin = draft.trim()
    if (!origin) return
    if (await change(() => trustBrowserOrigin(origin), setAddErrorKey)) setDraft('')
  }

  return (
    <SettingsGroup title={t('settings.browserTrust.title')} className="mt-8">
      <p className="mb-3 max-w-[60ch] text-xs leading-[1.7] text-[var(--color-text-secondary)]">
        {t('settings.browserTrust.description')}
      </p>

      <form onSubmit={add} className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <LabeledInput
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setAddErrorKey(null)
            }}
            aria-label={t('settings.browserTrust.inputLabel')}
            placeholder={t('settings.browserTrust.placeholder')}
            error={addErrorKey ? t(addErrorKey) : undefined}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
        <Button type="submit" disabled={busy || !draft.trim()}>
          {t('settings.browserTrust.add')}
        </Button>
      </form>

      {loadFailed ? (
        <div role="alert" className="flex items-center gap-3 py-3 text-xs text-[var(--color-error)]">
          <span>{t('settings.browserTrust.loadFailed')}</span>
          <Button variant="outline" size="sm" onClick={load}>{t('settings.browserTrust.retry')}</Button>
        </div>
      ) : origins === null ? (
        <LoadingBlock className="py-6" />
      ) : origins.length === 0 ? (
        <p className="py-3 text-xs text-[var(--color-text-tertiary)]">{t('settings.browserTrust.empty')}</p>
      ) : (
        <ul aria-label={t('settings.browserTrust.title')}>
          {origins.map((origin) => (
            <li key={origin}>
              <SettingsRow
                title={<span className="break-all font-[var(--font-mono)]">{origin}</span>}
                control={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={t('settings.browserTrust.remove', { origin })}
                    onClick={() => change(() => untrustBrowserOrigin(origin), setRemoveErrorKey)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {removeErrorKey ? (
        <p role="alert" className="py-2 text-xs text-[var(--color-error)]">{t(removeErrorKey)}</p>
      ) : null}
    </SettingsGroup>
  )
}
