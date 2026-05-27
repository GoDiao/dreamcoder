import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { Copy, Eye, EyeOff } from 'lucide-react'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { Modal } from '../shared/Modal'
import { Input } from '../shared/Input'
import { Button } from '../shared/Button'
import { Dropdown } from '../shared/Dropdown'
import type { SavedProvider, UpdateProviderInput, ProviderTestResult, ModelMapping, ApiFormat, ProviderAuthStrategy } from '../../types/provider'
import type { ProviderPreset } from '../../types/providerPreset'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import {
  API_KEY_JSON_PLACEHOLDER,
  maskSettingsJsonSecrets,
  restoreSettingsJsonSecrets,
  stripProviderSettingsJsonEnv,
} from '../../lib/providerSettingsJson'
import { openExternalUrl } from '../../lib/externalUrl'

// ─── Types & Constants ──────────────────────────────────────

type ProviderFormProps = {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  provider?: SavedProvider
  presets: ProviderPreset[]
}

function requirePreset(preset: ProviderPreset | undefined): ProviderPreset {
  if (!preset) {
    throw new Error('Provider presets are not configured')
  }
  return preset
}

const AUTO_COMPACT_WINDOW_ENV_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'
const MODEL_CONTEXT_WINDOWS_ENV_KEY = 'CLAUDE_CODE_MODEL_CONTEXT_WINDOWS'
const MODEL_CONTEXT_WINDOW_MIN = 16000
const MODEL_CONTEXT_WINDOW_MAX = 10000000
const MODEL_SLOTS = ['main', 'haiku', 'sonnet', 'opus'] as const
const DEFAULT_PROVIDER_AUTH_STRATEGY: ProviderAuthStrategy = 'auth_token'
const AUTH_ENV_KEYS = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])
type ModelSlot = typeof MODEL_SLOTS[number]
type ModelContextInputs = Record<ModelSlot, string>

function formatContextWindow(value: number): string {
  return value.toLocaleString('en-US')
}

function getPresetAutoCompactWindow(preset: ProviderPreset): string {
  return preset.defaultEnv?.[AUTO_COMPACT_WINDOW_ENV_KEY] ?? ''
}

function getPresetAuthStrategy(preset: ProviderPreset): ProviderAuthStrategy {
  return preset.authStrategy ?? DEFAULT_PROVIDER_AUTH_STRATEGY
}

function omitAuthEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {}
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !AUTH_ENV_KEYS.has(key.toUpperCase())),
  )
}

function getProviderAuthValue(apiKey: string, preset: ProviderPreset): string {
  return apiKey || preset.defaultEnv?.ANTHROPIC_AUTH_TOKEN || preset.defaultEnv?.ANTHROPIC_API_KEY || (preset.needsApiKey ? '(your API key)' : '')
}

function buildSettingsJsonAuthEnv(
  apiFormat: ApiFormat,
  authStrategy: ProviderAuthStrategy,
  apiKey: string,
  preset: ProviderPreset,
): Record<string, string> {
  if (apiFormat !== 'anthropic') {
    return { ANTHROPIC_API_KEY: 'proxy-managed' }
  }

  const value = getProviderAuthValue(apiKey, preset)
  switch (authStrategy) {
    case 'api_key':
      return value ? { ANTHROPIC_API_KEY: value } : {}
    case 'auth_token':
      return value ? { ANTHROPIC_AUTH_TOKEN: value } : {}
    case 'auth_token_empty_api_key':
      return {
        ANTHROPIC_API_KEY: '',
        ...(value ? { ANTHROPIC_AUTH_TOKEN: value } : {}),
      }
    case 'dual_same_token':
      return value ? { ANTHROPIC_API_KEY: value, ANTHROPIC_AUTH_TOKEN: value } : {}
    case 'dual_dummy':
      return { ANTHROPIC_API_KEY: 'dummy', ANTHROPIC_AUTH_TOKEN: 'dummy' }
  }
}

function inferAuthStrategyFromEnv(env: Record<string, string>): ProviderAuthStrategy | null {
  if (env.ANTHROPIC_API_KEY === 'dummy' && env.ANTHROPIC_AUTH_TOKEN === 'dummy') return 'dual_dummy'
  if (env.ANTHROPIC_API_KEY === '' && env.ANTHROPIC_AUTH_TOKEN) return 'auth_token_empty_api_key'
  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_AUTH_TOKEN && env.ANTHROPIC_API_KEY === env.ANTHROPIC_AUTH_TOKEN) return 'dual_same_token'
  if (env.ANTHROPIC_AUTH_TOKEN) return 'auth_token'
  if (env.ANTHROPIC_API_KEY) return 'api_key'
  return null
}

function parseAutoCompactWindowInput(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) return undefined
  if (parsed < MODEL_CONTEXT_WINDOW_MIN || parsed > MODEL_CONTEXT_WINDOW_MAX) return undefined
  return parsed
}

function getAutoCompactWindowErrorKey(value: string): 'number' | 'range' | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) return 'number'
  if (parsed < MODEL_CONTEXT_WINDOW_MIN || parsed > MODEL_CONTEXT_WINDOW_MAX) return 'range'
  return null
}

function parseModelContextWindowsInput(value: string): number | undefined {
  return parseAutoCompactWindowInput(value)
}

function getModelContextWindowErrorKey(value: string): 'number' | 'range' | null {
  return getAutoCompactWindowErrorKey(value)
}

function getModelContextInputValue(
  model: string | undefined,
  preset: ProviderPreset,
  provider?: SavedProvider,
): string {
  const trimmedModel = model?.trim()
  if (!trimmedModel) return ''
  const value = provider?.modelContextWindows?.[trimmedModel] ?? preset.modelContextWindows?.[trimmedModel]
  return value !== undefined ? String(value) : ''
}

function getModelContextInputs(
  models: ModelMapping,
  preset: ProviderPreset,
  provider?: SavedProvider,
): ModelContextInputs {
  const inputs = {} as ModelContextInputs
  for (const slot of MODEL_SLOTS) {
    inputs[slot] = getModelContextInputValue(models[slot], preset, provider)
  }
  return inputs
}

function buildModelContextWindows(
  models: ModelMapping,
  inputs: ModelContextInputs,
): Record<string, number> {
  const windows: Record<string, number> = {}
  for (const slot of MODEL_SLOTS) {
    const model = models[slot]?.trim()
    const parsed = parseModelContextWindowsInput(inputs[slot])
    if (model && parsed !== undefined) {
      windows[model] = parsed
    }
  }
  return windows
}

function normalizeModelMapping(models: ModelMapping): ModelMapping {
  const main = models.main.trim()
  return {
    main,
    haiku: models.haiku.trim() || main,
    sonnet: models.sonnet.trim() || main,
    opus: models.opus.trim() || main,
  }
}

function updateSettingsJsonAutoCompactWindow(raw: string, value: string): string {
  try {
    const parsed = JSON.parse(raw || '{}') as { env?: Record<string, unknown> }
    const existingEnv = parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
      ? parsed.env
      : {}
    const env = { ...existingEnv }
    const trimmed = value.trim()
    if (trimmed) {
      env[AUTO_COMPACT_WINDOW_ENV_KEY] = trimmed
    } else {
      delete env[AUTO_COMPACT_WINDOW_ENV_KEY]
    }
    parsed.env = env
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function updateSettingsJsonModelContextWindows(
  raw: string,
  modelContextWindows: Record<string, number>,
): string {
  try {
    const parsed = JSON.parse(raw || '{}') as { env?: Record<string, unknown> }
    const existingEnv = parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
      ? parsed.env
      : {}
    const env = { ...existingEnv }
    if (Object.keys(modelContextWindows).length > 0) {
      env[MODEL_CONTEXT_WINDOWS_ENV_KEY] = JSON.stringify(modelContextWindows)
    } else {
      delete env[MODEL_CONTEXT_WINDOWS_ENV_KEY]
    }
    parsed.env = env
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function updateSettingsJsonModels(raw: string, models: ModelMapping): string {
  try {
    const parsed = JSON.parse(raw || '{}') as { env?: Record<string, unknown> }
    const existingEnv = parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
      ? parsed.env
      : {}
    parsed.env = {
      ...existingEnv,
      ANTHROPIC_MODEL: models.main,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haiku,
      ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnet,
      ANTHROPIC_DEFAULT_OPUS_MODEL: models.opus,
    }
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function updateSettingsJsonProviderConnection(
  raw: string,
  apiFormat: ApiFormat,
  authStrategy: ProviderAuthStrategy,
  apiKey: string,
  preset: ProviderPreset,
  baseUrl: string,
): string {
  try {
    const parsed = JSON.parse(raw || '{}') as { env?: Record<string, unknown> }
    const existingEnv = parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
      ? parsed.env
      : {}
    const env = { ...existingEnv }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
    env.ANTHROPIC_BASE_URL = apiFormat !== 'anthropic' ? 'http://127.0.0.1:3456/proxy' : baseUrl
    Object.assign(env, buildSettingsJsonAuthEnv(apiFormat, authStrategy, apiKey, preset))
    parsed.env = env
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function buildFallbackPreset(provider?: SavedProvider): ProviderPreset {
  return {
    id: provider?.presetId ?? 'custom',
    name: provider?.name ?? 'Custom',
    baseUrl: provider?.baseUrl ?? '',
    apiFormat: provider?.apiFormat ?? 'anthropic',
    authStrategy: provider?.authStrategy,
    defaultModels: provider?.models ?? { main: '', haiku: '', sonnet: '', opus: '' },
    modelContextWindows: provider?.modelContextWindows,
    defaultEnv: provider?.autoCompactWindow !== undefined
      ? { [AUTO_COMPACT_WINDOW_ENV_KEY]: String(provider.autoCompactWindow) }
      : undefined,
    needsApiKey: true,
    websiteUrl: '',
  }
}

// ─── ProviderFormModal Component ────────────────────────────

function ProviderFormModal({ open, onClose, mode, provider, presets }: ProviderFormProps) {
  const { createProvider, updateProvider, testConfig } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()

  const availablePresets = presets.filter((p) => p.id !== 'official')
  const regularPresets = availablePresets.filter((p) => !p.featured)
  const featuredPresets = availablePresets.filter((p) => p.featured)
  const presetDefaultEnvKeys = useMemo(
    () => presets.flatMap((preset) => Object.keys(preset.defaultEnv ?? {})),
    [presets],
  )
  const fallbackPreset = provider
    ? buildFallbackPreset(provider)
    : requirePreset(availablePresets[availablePresets.length - 1])
  const initialPreset = requirePreset(
    provider
      ? availablePresets.find((p) => p.id === provider.presetId) ?? fallbackPreset
      : availablePresets[0] ?? fallbackPreset,
  )

  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset>(initialPreset)
  const [name, setName] = useState(provider?.name ?? initialPreset.name)
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? initialPreset.baseUrl)
  const [apiFormat, setApiFormat] = useState<ApiFormat>(provider?.apiFormat ?? initialPreset.apiFormat ?? 'anthropic')
  const [authStrategy, setAuthStrategy] = useState<ProviderAuthStrategy>(provider?.authStrategy ?? getPresetAuthStrategy(initialPreset))
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [notes, setNotes] = useState(provider?.notes ?? '')
  const [models, setModels] = useState<ModelMapping>(provider?.models ?? { ...initialPreset.defaultModels })
  const [modelContextInputs, setModelContextInputs] = useState<ModelContextInputs>(
    getModelContextInputs(provider?.models ?? initialPreset.defaultModels, initialPreset, provider),
  )
  const [autoCompactWindow, setAutoCompactWindow] = useState(
    provider?.autoCompactWindow !== undefined
      ? String(provider.autoCompactWindow)
      : getPresetAutoCompactWindow(initialPreset),
  )
  const [showContextSettings, setShowContextSettings] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [settingsJson, setSettingsJson] = useState('')
  const [settingsJsonError, setSettingsJsonError] = useState<string | null>(null)
  const jsonPastedRef = useRef(false)

  // Load current settings.json and merge provider env vars
  useEffect(() => {
    // Skip if JSON was just populated by user paste
    if (jsonPastedRef.current) {
      jsonPastedRef.current = false
      return
    }
    import('../../api/providers').then(({ providersApi }) => {
      providersApi.getSettings().then((settings) => {
        const needsProxy = apiFormat !== 'anthropic'
        const autoCompactWindowEnv = autoCompactWindow.trim()
        const modelContextWindows = buildModelContextWindows(models, modelContextInputs)
        const normalizedModels = normalizeModelMapping(models)
        const existingEnv = (settings.env as Record<string, string>) || {}
        const cleanedEnv = stripProviderSettingsJsonEnv(existingEnv, presetDefaultEnvKeys)
        const merged = {
          ...settings,
          skipWebFetchPreflight: settings.skipWebFetchPreflight ?? true,
          env: {
            ...cleanedEnv,
            ...omitAuthEnv(selectedPreset.defaultEnv),
            ...(autoCompactWindowEnv ? { [AUTO_COMPACT_WINDOW_ENV_KEY]: autoCompactWindowEnv } : {}),
            ...(Object.keys(modelContextWindows).length > 0
              ? { [MODEL_CONTEXT_WINDOWS_ENV_KEY]: JSON.stringify(modelContextWindows) }
              : {}),
            ANTHROPIC_BASE_URL: needsProxy ? 'http://127.0.0.1:3456/proxy' : baseUrl,
            ...buildSettingsJsonAuthEnv(apiFormat, authStrategy, apiKey, selectedPreset),
            ANTHROPIC_MODEL: normalizedModels.main,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: normalizedModels.haiku,
            ANTHROPIC_DEFAULT_SONNET_MODEL: normalizedModels.sonnet,
            ANTHROPIC_DEFAULT_OPUS_MODEL: normalizedModels.opus,
          },
        }
        setSettingsJson(JSON.stringify(merged, null, 2))
      }).catch(() => {
        setSettingsJson(JSON.stringify({}, null, 2))
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset.id])

  const handlePresetChange = (preset: ProviderPreset) => {
    setSelectedPreset(preset)
    setName(preset.name)
    setBaseUrl(preset.baseUrl)
    setApiFormat(preset.apiFormat ?? 'anthropic')
    setAuthStrategy(getPresetAuthStrategy(preset))
    setModels({ ...preset.defaultModels })
    setModelContextInputs(getModelContextInputs(preset.defaultModels, preset))
    setAutoCompactWindow(getPresetAutoCompactWindow(preset))
    setShowContextSettings(false)
    setTestResult(null)
  }

  const isCustom = selectedPreset.id === 'custom'
  const requiresApiKey = selectedPreset.needsApiKey !== false
  const autoCompactWindowErrorKey = getAutoCompactWindowErrorKey(autoCompactWindow)
  const modelContextWindowErrorSlots = MODEL_SLOTS.filter((slot) => getModelContextWindowErrorKey(modelContextInputs[slot]))
  const canSubmit = name.trim() && baseUrl.trim() && (mode === 'edit' || !requiresApiKey || apiKey.trim()) && models.main.trim() && !settingsJsonError && !autoCompactWindowErrorKey && modelContextWindowErrorSlots.length === 0
  const apiKeyUrl = selectedPreset.apiKeyUrl?.trim()
  const promoText = selectedPreset.promoText?.trim()
  const displayedSettingsJson = showApiKey
    ? settingsJson
    : maskSettingsJsonSecrets(settingsJson)
  const apiFormatItems = [
    {
      value: 'anthropic' as const,
      label: t('settings.providers.apiFormatAnthropic'),
      icon: <span className="material-symbols-outlined text-[17px]">hub</span>,
    },
    {
      value: 'openai_chat' as const,
      label: t('settings.providers.apiFormatOpenaiChat'),
      icon: <span className="material-symbols-outlined text-[17px]">forum</span>,
    },
    {
      value: 'openai_responses' as const,
      label: t('settings.providers.apiFormatOpenaiResponses'),
      icon: <span className="material-symbols-outlined text-[17px]">route</span>,
    },
  ]
  const selectedApiFormatLabel = apiFormatItems.find((item) => item.value === apiFormat)?.label ?? t('settings.providers.apiFormatAnthropic')
  const authStrategyItems = [
    {
      value: 'auth_token' as const,
      label: t('settings.providers.authStrategyAuthToken'),
      description: t('settings.providers.authStrategyAuthTokenDesc'),
      icon: <span className="material-symbols-outlined text-[17px]">key</span>,
    },
    {
      value: 'auth_token_empty_api_key' as const,
      label: t('settings.providers.authStrategyAuthTokenEmptyApiKey'),
      description: t('settings.providers.authStrategyAuthTokenEmptyApiKeyDesc'),
      icon: <span className="material-symbols-outlined text-[17px]">key_off</span>,
    },
    {
      value: 'api_key' as const,
      label: t('settings.providers.authStrategyApiKey'),
      description: t('settings.providers.authStrategyApiKeyDesc'),
      icon: <span className="material-symbols-outlined text-[17px]">vpn_key</span>,
    },
    {
      value: 'dual_same_token' as const,
      label: t('settings.providers.authStrategyDualSameToken'),
      description: t('settings.providers.authStrategyDualSameTokenDesc'),
      icon: <span className="material-symbols-outlined text-[17px]">sync_alt</span>,
    },
    {
      value: 'dual_dummy' as const,
      label: t('settings.providers.authStrategyDualDummy'),
      description: t('settings.providers.authStrategyDualDummyDesc'),
      icon: <span className="material-symbols-outlined text-[17px]">construction</span>,
    },
  ] satisfies Array<{ value: ProviderAuthStrategy; label: string; description: string; icon: ReactNode }>
  const selectedAuthStrategyLabel = authStrategyItems.find((item) => item.value === authStrategy)?.label ?? t('settings.providers.authStrategyAuthToken')
  const configuredContextWindows = buildModelContextWindows(models, modelContextInputs)
  const configuredContextSummary = Object.entries(configuredContextWindows)
    .filter(([model], index, entries) => entries.findIndex(([candidate]) => candidate === model) === index)
    .map(([model, value]) => `${model}: ${formatContextWindow(value)}`)
  const parsedFallbackContextWindow = parseAutoCompactWindowInput(autoCompactWindow)
  const fallbackContextSummary = parsedFallbackContextWindow !== undefined
    ? t('settings.providers.contextFallbackSummary', {
      tokens: formatContextWindow(parsedFallbackContextWindow),
    })
    : t('settings.providers.contextFallbackAuto')
  const contextSummary = configuredContextSummary.length > 0
    ? [...configuredContextSummary, fallbackContextSummary].join(' · ')
    : t('settings.providers.contextSummaryAuto')
  const shouldShowContextFields = showContextSettings || modelContextWindowErrorSlots.length > 0 || !!autoCompactWindowErrorKey
  const handleAutoCompactWindowChange = (value: string) => {
    setAutoCompactWindow(value)
    setSettingsJson((current) => updateSettingsJsonAutoCompactWindow(current, value))
  }
  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value)
    setSettingsJson((current) => updateSettingsJsonProviderConnection(current, apiFormat, authStrategy, apiKey, selectedPreset, value))
  }
  const handleApiKeyChange = (value: string) => {
    setApiKey(value)
    setSettingsJson((current) => updateSettingsJsonProviderConnection(current, apiFormat, authStrategy, value, selectedPreset, baseUrl))
  }
  const handleApiFormatChange = (value: ApiFormat) => {
    setApiFormat(value)
    setSettingsJson((current) => updateSettingsJsonProviderConnection(current, value, authStrategy, apiKey, selectedPreset, baseUrl))
  }
  const handleAuthStrategyChange = (value: ProviderAuthStrategy) => {
    setAuthStrategy(value)
    setSettingsJson((current) => updateSettingsJsonProviderConnection(current, apiFormat, value, apiKey, selectedPreset, baseUrl))
  }
  const handleModelChange = (slot: ModelSlot, value: string) => {
    const nextModels = { ...models, [slot]: value }
    const nextInputs = {
      ...modelContextInputs,
      [slot]: getModelContextInputValue(value, selectedPreset, provider),
    }
    setModels(nextModels)
    setModelContextInputs(nextInputs)
    setSettingsJson((current) => updateSettingsJsonModelContextWindows(
      updateSettingsJsonModels(current, normalizeModelMapping(nextModels)),
      buildModelContextWindows(nextModels, nextInputs),
    ))
  }
  const handleModelContextWindowChange = (slot: ModelSlot, value: string) => {
    const nextInputs = { ...modelContextInputs, [slot]: value }
    setModelContextInputs(nextInputs)
    setSettingsJson((current) => updateSettingsJsonModelContextWindows(
      current,
      buildModelContextWindows(models, nextInputs),
    ))
  }
  const renderPresetButton = (preset: ProviderPreset) => (
    <button
      key={preset.id}
      onClick={() => handlePresetChange(preset)}
      className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
        selectedPreset.id === preset.id
          ? 'border-[var(--color-brand)] bg-[var(--color-surface-container-high)] text-[var(--color-brand)] shadow-[var(--shadow-focus-ring)]'
          : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      {preset.name}
    </button>
  )

  const handleSubmit = async () => {
    if (!canSubmit) return
    const normalizedModels = normalizeModelMapping(models)
    const parsedAutoCompactWindow = parseAutoCompactWindowInput(autoCompactWindow)
    const parsedModelContextWindows = buildModelContextWindows(models, modelContextInputs)
    setIsSubmitting(true)
    try {
      // Write the edited dreamcoder settings.json first so provider-specific model
      // settings never conflict with the user's global ~/.claude/settings.json.
      if (settingsJson.trim()) {
        try {
          const parsed = restoreSettingsJsonSecrets(JSON.parse(settingsJson), settingsJson, apiKey)
          const { providersApi } = await import('../../api/providers')
          await providersApi.updateSettings(parsed)
        } catch {
          // JSON validation already prevents this
        }
      }

      if (mode === 'create') {
        await createProvider({
          presetId: selectedPreset.id,
          name: name.trim(),
          apiKey: apiKey.trim(),
          authStrategy,
          baseUrl: baseUrl.trim(),
          apiFormat,
          models: normalizedModels,
          ...(parsedAutoCompactWindow !== undefined && { autoCompactWindow: parsedAutoCompactWindow }),
          ...(Object.keys(parsedModelContextWindows).length > 0 && { modelContextWindows: parsedModelContextWindows }),
          notes: notes.trim() || undefined,
        })
      } else if (provider) {
        const input: UpdateProviderInput = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          authStrategy,
          apiFormat,
          models: normalizedModels,
          autoCompactWindow: parsedAutoCompactWindow ?? null,
          modelContextWindows: Object.keys(parsedModelContextWindows).length > 0
            ? parsedModelContextWindows
            : null,
          notes: notes.trim() || undefined,
        }
        if (apiKey.trim()) input.apiKey = apiKey.trim()
        await updateProvider(provider.id, input)
      }
      await fetchSettings()
      onClose()
    } catch (err) {
      console.error('Failed to save provider:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleTest = async () => {
    if (!baseUrl.trim() || !models.main.trim()) return
    setIsTesting(true)
    setTestResult(null)
    try {
      let result: ProviderTestResult
      if (mode === 'edit' && provider && !apiKey.trim()) {
        result = await useProviderStore.getState().testProvider(provider.id, {
          baseUrl: baseUrl.trim(),
          modelId: models.main.trim(),
          apiFormat,
          authStrategy,
        })
      } else {
        if (requiresApiKey && !apiKey.trim()) return
        result = await testConfig({
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || selectedPreset.defaultEnv?.ANTHROPIC_AUTH_TOKEN || 'local',
          modelId: models.main.trim(),
          authStrategy,
          apiFormat,
        })
      }
      setTestResult(result)
    } catch {
      setTestResult({ connectivity: { success: false, latencyMs: 0, error: t('settings.providers.requestFailed') } })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? t('settings.providers.addTitle') : t('settings.providers.editTitle')}
      width={720}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {mode === 'create' ? t('common.add') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Preset chips */}
        {mode === 'create' && (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.preset')}</label>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {regularPresets.map(renderPresetButton)}
              </div>
              {featuredPresets.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)]/60 pt-2">
                  {featuredPresets.map(renderPresetButton)}
                </div>
              )}
            </div>
          </div>
        )}

        <Input label={t('settings.providers.name')} required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.providers.namePlaceholder')} />

        <Input label={t('settings.providers.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('settings.providers.notesPlaceholder')} />

        <Input label={t('settings.providers.baseUrl')} required value={baseUrl} onChange={(e) => handleBaseUrlChange(e.target.value)} placeholder={t('settings.providers.baseUrlPlaceholder')} />

        {/* API Format */}
        {(isCustom || mode === 'edit') ? (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-1 block">{t('settings.providers.apiFormat')}</label>
            <Dropdown<ApiFormat>
              items={apiFormatItems}
              value={apiFormat}
              onChange={handleApiFormatChange}
              width="100%"
              className="block w-full"
              trigger={
                <button
                  type="button"
                  className="flex h-10 w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-left text-sm text-[var(--color-text-primary)] outline-none transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-container-low)] focus-visible:border-[var(--color-border-focus)] focus-visible:shadow-[var(--shadow-focus-ring)]"
                >
                  <span className="min-w-0 flex-1 truncate">{selectedApiFormatLabel}</span>
                  <span className="material-symbols-outlined flex-shrink-0 text-[18px] text-[var(--color-text-secondary)]">expand_more</span>
                </button>
              }
            />
            {apiFormat !== 'anthropic' && (
              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('settings.providers.proxyHint')}</p>
            )}
          </div>
        ) : apiFormat !== 'anthropic' ? (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-1 block">{t('settings.providers.apiFormat')}</label>
            <div className="text-xs text-[var(--color-text-tertiary)] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border border-[var(--color-border)]">
              {apiFormat === 'openai_chat' ? t('settings.providers.apiFormatOpenaiChat') : t('settings.providers.apiFormatOpenaiResponses')}
            </div>
          </div>
        ) : null}

        {apiFormat === 'anthropic' && (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-1 block">{t('settings.providers.authStrategy')}</label>
            <Dropdown<ProviderAuthStrategy>
              items={authStrategyItems}
              value={authStrategy}
              onChange={handleAuthStrategyChange}
              width="100%"
              className="block w-full"
              trigger={
                <button
                  type="button"
                  className="flex min-h-10 w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left text-sm text-[var(--color-text-primary)] outline-none transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-container-low)] focus-visible:border-[var(--color-border-focus)] focus-visible:shadow-[var(--shadow-focus-ring)]"
                >
                  <span className="min-w-0 flex-1 truncate">{selectedAuthStrategyLabel}</span>
                  <span className="material-symbols-outlined flex-shrink-0 text-[18px] text-[var(--color-text-secondary)]">expand_more</span>
                </button>
              }
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="provider-api-key" className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('settings.providers.apiKey')}
            {mode === 'create' && requiresApiKey && <span className="text-[var(--color-error)] ml-0.5">*</span>}
          </label>
          <div className="relative">
            <input
              id="provider-api-key"
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder="sk-..."
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 pr-10 text-sm text-[var(--color-text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
            />
            <button
              type="button"
              onClick={() => setShowApiKey((visible) => !visible)}
              aria-label={showApiKey ? 'Hide API Key' : 'Show API Key'}
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)]"
            >
              <span className="material-symbols-outlined text-[16px]">
                {showApiKey ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>
        </div>

        {(apiKeyUrl || promoText) && (
          <div className="-mt-2 flex flex-col gap-1.5">
            {apiKeyUrl && (
              <button
                type="button"
                onClick={() => openExternalUrl(apiKeyUrl)}
                className="group inline-flex h-6 w-fit cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 text-[11px] font-medium leading-none text-[var(--color-brand)] transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)]"
              >
                <span className="material-symbols-outlined text-[13px]">key</span>
                {t('settings.providers.getApiKey')}
                <span className="material-symbols-outlined text-[9px] opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">arrow_outward</span>
              </button>
            )}
            {promoText && (
              <button
                type="button"
                onClick={() => apiKeyUrl && openExternalUrl(apiKeyUrl)}
                disabled={!apiKeyUrl}
                className="group flex w-full cursor-pointer items-start gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-brand)]/25 bg-[var(--color-brand)]/8 px-2.5 py-1.5 text-left text-[11px] leading-5 text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-brand)]/45 hover:bg-[var(--color-brand)]/12 focus:outline-none focus:shadow-[var(--shadow-focus-ring)] disabled:cursor-default disabled:hover:border-[var(--color-brand)]/25 disabled:hover:bg-[var(--color-brand)]/8"
              >
                <span className="material-symbols-outlined mt-0.5 text-[13px] text-[var(--color-brand)]">tips_and_updates</span>
                <span>{promoText}</span>
                {apiKeyUrl && (
                  <span className="material-symbols-outlined ml-auto mt-1 text-[10px] text-[var(--color-brand)] opacity-45 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">arrow_outward</span>
                )}
              </button>
            )}
          </div>
        )}

        {/* Model Mapping */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.modelMapping')}</label>
          <div className="grid grid-cols-2 gap-2">
            <Input label={t('settings.providers.mainModel')} required value={models.main} onChange={(e) => handleModelChange('main', e.target.value)} placeholder="Model ID" />
            <Input label={t('settings.providers.haikuModel')} value={models.haiku} onChange={(e) => handleModelChange('haiku', e.target.value)} placeholder={t('settings.providers.sameAsMain')} />
            <Input label={t('settings.providers.sonnetModel')} value={models.sonnet} onChange={(e) => handleModelChange('sonnet', e.target.value)} placeholder={t('settings.providers.sameAsMain')} />
            <Input label={t('settings.providers.opusModel')} value={models.opus} onChange={(e) => handleModelChange('opus', e.target.value)} placeholder={t('settings.providers.sameAsMain')} />
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
          <button
            type="button"
            onClick={() => setShowContextSettings((visible) => !visible)}
            className="flex w-full items-start gap-3 px-3 py-3 text-left outline-none transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:shadow-[var(--shadow-focus-ring)]"
            aria-expanded={shouldShowContextFields}
          >
            <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-brand)]">compress</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.providers.contextSettingsTitle')}
              </span>
              <span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">
                {contextSummary}
              </span>
              <span className="mt-1 block text-[11px] leading-5 text-[var(--color-text-tertiary)]">
                {t('settings.providers.contextSettingsDesc')}
              </span>
            </span>
            <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand)]">
              {shouldShowContextFields
                ? t('settings.providers.contextSettingsHide')
                : t('settings.providers.contextSettingsEdit')}
              <span className="material-symbols-outlined text-[16px]">
                {shouldShowContextFields ? 'expand_less' : 'expand_more'}
              </span>
            </span>
          </button>

          {shouldShowContextFields && (
            <div className="border-t border-[var(--color-border)] px-3 pb-3 pt-3">
              <div>
                <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.modelContextWindows')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {MODEL_SLOTS.map((slot) => {
                    const errorKey = getModelContextWindowErrorKey(modelContextInputs[slot])
                    const labelKey = slot === 'main'
                      ? 'settings.providers.mainContextWindow'
                      : slot === 'haiku'
                        ? 'settings.providers.haikuContextWindow'
                        : slot === 'sonnet'
                          ? 'settings.providers.sonnetContextWindow'
                          : 'settings.providers.opusContextWindow'
                    return (
                      <div key={slot}>
                        <Input
                          label={t(labelKey)}
                          value={modelContextInputs[slot]}
                          onChange={(e) => handleModelContextWindowChange(slot, e.target.value)}
                          placeholder={t('settings.providers.contextWindowPlaceholder')}
                        />
                        {errorKey && (
                          <p className="text-[11px] text-[var(--color-error)] mt-1">
                            {errorKey === 'number'
                              ? t('settings.providers.modelContextWindowNumberError')
                              : t('settings.providers.modelContextWindowRangeError')}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
                <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
                  {t('settings.providers.modelContextWindowsDesc')}
                </p>
              </div>

              <div className="mt-3">
                <Input
                  label={t('settings.providers.autoCompactWindow')}
                  value={autoCompactWindow}
                  onChange={(e) => handleAutoCompactWindowChange(e.target.value)}
                  placeholder={t('settings.providers.autoCompactWindowPlaceholder')}
                />
                {autoCompactWindowErrorKey ? (
                  <p className="text-[11px] text-[var(--color-error)] mt-1">
                    {autoCompactWindowErrorKey === 'number'
                      ? t('settings.providers.autoCompactWindowNumberError')
                      : t('settings.providers.autoCompactWindowRangeError')}
                  </p>
                ) : (
                  <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
                    {t('settings.providers.autoCompactWindowDesc')}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Test connection */}
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleTest} loading={isTesting} disabled={!baseUrl.trim() || !models.main.trim()}>
            {t('settings.providers.testConnection')}
          </Button>
          {testResult && (
            <div className="flex flex-col gap-0.5">
              <span className={`text-xs ${testResult.connectivity.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                {testResult.connectivity.success
                  ? t('settings.providers.connectivityOk', { latency: String(testResult.connectivity.latencyMs) })
                  : t('settings.providers.connectivityFailed', { error: testResult.connectivity.error || '' })}
              </span>
              {testResult.proxy && (
                <span className={`text-xs ${testResult.proxy.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                  {testResult.proxy.success
                    ? t('settings.providers.proxyOk', { latency: String(testResult.proxy.latencyMs) })
                    : t('settings.providers.proxyFailed', { error: testResult.proxy.error || '' })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Settings JSON — editable, shown for all presets including official */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.settingsJson')}</label>
          <textarea
            value={displayedSettingsJson}
            onChange={(e) => {
              const raw = e.target.value
              try {
                const parsed = restoreSettingsJsonSecrets(JSON.parse(raw), settingsJson, apiKey)
                setSettingsJson(JSON.stringify(parsed, null, 2))
                setSettingsJsonError(null)
                // Auto-fill form fields from parsed JSON env
                const env = parsed.env as Record<string, string> | undefined
                if (env) {
                  if (env.ANTHROPIC_BASE_URL) {
                    setBaseUrl(env.ANTHROPIC_BASE_URL)
                    // Auto-switch to matching preset or Custom
                    if (mode === 'create') {
                      const matchedPreset = availablePresets.find((p) => p.id !== 'custom' && p.baseUrl === env.ANTHROPIC_BASE_URL)
                      const targetPreset = requirePreset(
                        matchedPreset ?? availablePresets.find((p) => p.id === 'custom'),
                      )
                      if (targetPreset.id !== selectedPreset.id) {
                        jsonPastedRef.current = true
                        setSelectedPreset(targetPreset)
                      }
                    }
                  }
                  const nextApiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY
                  if (nextApiKey && nextApiKey !== '(your API key)' && nextApiKey !== API_KEY_JSON_PLACEHOLDER) {
                    setApiKey(nextApiKey)
                  }
                  const nextAuthStrategy = inferAuthStrategyFromEnv(env)
                  if (nextAuthStrategy) {
                    setAuthStrategy(nextAuthStrategy)
                  }
                  if (env[AUTO_COMPACT_WINDOW_ENV_KEY] !== undefined) {
                    setAutoCompactWindow(String(env[AUTO_COMPACT_WINDOW_ENV_KEY]))
                  } else {
                    setAutoCompactWindow('')
                  }
                  let parsedContextWindows: Record<string, number> = {}
                  if (typeof env[MODEL_CONTEXT_WINDOWS_ENV_KEY] === 'string') {
                    try {
                      const parsedContext = JSON.parse(env[MODEL_CONTEXT_WINDOWS_ENV_KEY]) as Record<string, unknown>
                      parsedContextWindows = Object.fromEntries(
                        Object.entries(parsedContext)
                          .filter(([, value]) => typeof value === 'number' && Number.isInteger(value)),
                      ) as Record<string, number>
                    } catch {
                      parsedContextWindows = {}
                    }
                  }
                  const newModels: Partial<ModelMapping> = {}
                  if (env.ANTHROPIC_MODEL) newModels.main = env.ANTHROPIC_MODEL
                  if (env.ANTHROPIC_DEFAULT_HAIKU_MODEL) newModels.haiku = env.ANTHROPIC_DEFAULT_HAIKU_MODEL
                  if (env.ANTHROPIC_DEFAULT_SONNET_MODEL) newModels.sonnet = env.ANTHROPIC_DEFAULT_SONNET_MODEL
                  if (env.ANTHROPIC_DEFAULT_OPUS_MODEL) newModels.opus = env.ANTHROPIC_DEFAULT_OPUS_MODEL
                  if (Object.keys(newModels).length > 0) {
                    setModels((prev) => {
                      const nextModels = { ...prev, ...newModels }
                      setModelContextInputs(getModelContextInputs(nextModels, {
                        ...selectedPreset,
                        modelContextWindows: parsedContextWindows,
                      }))
                      return nextModels
                    })
                  } else if (Object.keys(parsedContextWindows).length > 0) {
                    setModelContextInputs(getModelContextInputs(models, {
                      ...selectedPreset,
                      modelContextWindows: parsedContextWindows,
                    }))
                  }
                }
              } catch (err) {
                setSettingsJson(raw)
                setSettingsJsonError(err instanceof Error ? err.message : 'Invalid JSON')
              }
            }}
            rows={16}
            spellCheck={false}
            className={`w-full text-xs px-3 py-3 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border font-mono leading-relaxed resize-y text-[var(--color-text-secondary)] outline-none ${
              settingsJsonError
                ? 'border-[var(--color-error)] focus:border-[var(--color-error)]'
                : 'border-[var(--color-border)] focus:border-[var(--color-border-focus)]'
            }`}
          />
          {settingsJsonError && (
            <p className="text-[11px] text-[var(--color-error)] mt-1">{t('settings.providers.jsonError', { error: settingsJsonError })}</p>
          )}
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('settings.providers.settingsJsonDesc')}</p>
        </div>
      </div>
    </Modal>
  )
}

export { ProviderFormModal }
export type { ProviderFormProps }
