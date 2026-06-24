import { useState } from 'react'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { Input } from '../shared/Input'
import { Button } from '../shared/Button'
import { DreamCoderIcon } from '../shared/DreamCoderIcon'

export function ProviderOnboarding() {
  const { presets, createProvider, activateProvider, fetchPresets } = useProviderStore()
  const setOnboardingCompleted = useSettingsStore((s) => s.setOnboardingCompleted)
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)

  if (presets.length === 0) {
    fetchPresets()
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
          欢迎使用 DreamCoder
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-8">
          DreamField 官方 AI Coding Agent<br />
          输入你的 DreamField API Key 开始使用
        </p>

        <div className="space-y-4 text-left">
          <Input
            label="API Key"
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="输入 DreamField API Key"
          />
          <Button
            className="w-full"
            onClick={handleSetup}
            disabled={!apiKey.trim()}
            loading={loading}
          >
            开始使用
          </Button>
        </div>

        <p className="text-xs text-[var(--color-text-tertiary)] mt-6">
          没有 API Key？<a href="https://www.dreamfield.top" target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand)] hover:underline">前往 DreamField 注册</a>
        </p>
      </div>
    </div>
  )
}
