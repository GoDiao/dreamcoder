import { useEffect, useRef, useState } from 'react'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { Input } from '../shared/Input'
import { Button } from '../shared/Button'
import { DreamCoderIcon } from '../shared/DreamCoderIcon'

export function ProviderOnboarding() {
  const t = useTranslation()
  const { presets, error, isPresetsLoading, createProvider, activateProvider, fetchPresets } = useProviderStore()
  const setOnboardingCompleted = useSettingsStore((s) => s.setOnboardingCompleted)
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const requestedPresetsRef = useRef(false)

  useEffect(() => {
    if (presets.length > 0 || requestedPresetsRef.current) return
    requestedPresetsRef.current = true
    void fetchPresets()
  }, [fetchPresets, presets.length])

  if (presets.length === 0) {
    // fetchPresets 失败只会写入 store 的 error，这里必须给出重试入口，
    // 否则全新 profile 会永远停在加载动画上（issue #40 的遗留场景）。
    if (error && !isPresetsLoading) {
      return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[var(--color-surface)]">
          <p role="alert" className="max-w-md px-8 text-center text-sm text-[var(--color-error)]">
            {t('onboarding.presetsLoadFailed')}{error}
          </p>
          <Button onClick={() => void fetchPresets()}>{t('common.retry')}</Button>
        </div>
      )
    }
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-surface)]">
        <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
      </div>
    )
  }

  const dreamfieldPreset = presets.find((p) => p.id === 'dreamfield')
  if (!dreamfieldPreset) return null

  const handleSetup = async () => {
    if (!apiKey.trim()) return
    setLoading(true)
    try {
      const provider = await createProvider({
        presetId: 'dreamfield',
        name: dreamfieldPreset.name,
        apiKey: apiKey.trim(),
        authStrategy: dreamfieldPreset.authStrategy ?? 'auth_token',
        baseUrl: dreamfieldPreset.baseUrl,
        apiFormat: dreamfieldPreset.apiFormat,
        models: dreamfieldPreset.defaultModels,
      })
      await activateProvider(provider.id)
      await fetchSettings()
      setOnboardingCompleted()
    } catch (err) {
      console.error('Onboarding failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-surface)]">
      <div className="w-full max-w-md p-8 text-center">
        <DreamCoderIcon size={80} className="mx-auto mb-6" />
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2" style={{ fontFamily: 'var(--font-headline)' }}>
          {t('onboarding.welcome')}
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-8">
          {t('onboarding.tagline')}<br />
          {t('onboarding.instructions')}
        </p>

        <div className="space-y-4 text-left">
          <Input
            label={t('settings.providers.apiKey')}
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t('onboarding.apiKeyPlaceholder')}
          />
          <Button
            className="w-full"
            onClick={handleSetup}
            disabled={!apiKey.trim()}
            loading={loading}
          >
            {t('onboarding.getStarted')}
          </Button>
        </div>

        <p className="text-xs text-[var(--color-text-tertiary)] mt-6">
          {t('onboarding.noApiKey')}{' '}<a href="https://www.dreamfield.top" target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand)] hover:underline">{t('onboarding.signUp')}</a>
        </p>
      </div>
    </div>
  )
}
