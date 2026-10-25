import { useState, useEffect, useId, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { Modal } from '../shared/Modal'
import { Input } from '../shared/Input'
import { Button } from '../shared/Button'
import { getPresetDisplayName } from './presetDisplayName'
import { ProviderIcon } from './ProviderIcon'
import { Dropdown } from '../shared/Dropdown'
import type { SavedProvider, UpdateProviderInput, ProviderTestResult, ProviderModel, DiscoveredProviderModel, ApiFormat, ProviderAuthStrategy } from '../../types/provider'
import type { ProviderPreset } from '../../types/providerPreset'
import {
  API_KEY_JSON_PLACEHOLDER,
  maskSettingsJsonSecrets,
  restoreSettingsJsonSecrets,
  stripProviderSettingsJsonEnv,
} from '../../lib/providerSettingsJson'
import { openExternalUrl } from '../../lib/externalUrl'

type ProviderFormProps = {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  provider?: SavedProvider
  presets: ProviderPreset[]
  onCreated?: (provider: SavedProvider) => Promise<void> | void
}

function requirePreset(preset: ProviderPreset | undefined): ProviderPreset {
  if (!preset) {
    throw new Error('Provider presets are not configured')
  }
  return preset
}

const MODEL_CONTEXT_WINDOWS_ENV_KEY = 'CLAUDE_CODE_MODEL_CONTEXT_WINDOWS'
const MODEL_CONTEXT_WINDOW_MIN = 16000
const MODEL_CONTEXT_WINDOW_MAX = 10000000
const DEFAULT_PROVIDER_AUTH_STRATEGY: ProviderAuthStrategy = 'auth_token'
const AUTH_ENV_KEYS = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])
type ModelContextInputs = Record<string, string>

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

function getModelContextWindowErrorKey(value: string): 'number' | 'range' | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) return 'number'
  if (parsed < MODEL_CONTEXT_WINDOW_MIN || parsed > MODEL_CONTEXT_WINDOW_MAX) return 'range'
  return null
}

function parseModelContextWindowsInput(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed || getModelContextWindowErrorKey(trimmed)) return undefined
  return Number(trimmed)
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
  models: ProviderModel[],
  preset: ProviderPreset,
  provider?: SavedProvider,
): ModelContextInputs {
  return Object.fromEntries(models.map((model) => [
    model.id,
    getModelContextInputValue(model.id, preset, provider),
  ]))
}

function buildModelContextWindows(
  models: ProviderModel[],
  inputs: ModelContextInputs,
): Record<string, number> {
  const windows: Record<string, number> = {}
  for (const model of models) {
    const id = model.id.trim()
    const parsed = parseModelContextWindowsInput(inputs[id] ?? '')
    if (id && parsed !== undefined) {
      windows[id] = parsed
    }
  }
  return windows
}

function normalizeModels(models: ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>()
  return models.flatMap((model) => {
    const id = model.id.trim()
    if (!id || seen.has(id)) return []
    seen.add(id)
    const name = model.name?.trim()
    return [{ id, ...(name ? { name } : {}) }]
  })
}

function runtimeModelMapping(models: ProviderModel[], fastModel?: string): {
  main: string
  fast: string
} {
  const main = models[0]?.id ?? ''
  return {
    main,
    fast: fastModel && models.some((model) => model.id === fastModel) ? fastModel : main,
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

function updateSettingsJsonModels(raw: string, models: ProviderModel[], fastModel?: string): string {
  try {
    const parsed = JSON.parse(raw || '{}') as { env?: Record<string, unknown> }
    const existingEnv = parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
      ? parsed.env
      : {}
    const runtime = runtimeModelMapping(models, fastModel)
    parsed.env = {
      ...existingEnv,
      ANTHROPIC_MODEL: runtime.main,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: runtime.fast,
      ANTHROPIC_SMALL_FAST_MODEL: runtime.fast,
      ANTHROPIC_DEFAULT_SONNET_MODEL: runtime.main,
      ANTHROPIC_DEFAULT_OPUS_MODEL: runtime.main,
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
    defaultModels: provider?.models ?? [],
    defaultFastModel: provider?.fastModel,
    modelContextWindows: provider?.modelContextWindows,
    needsApiKey: true,
    websiteUrl: '',
  }
}

type ModelDiscoveryComboboxProps = {
  models: ProviderModel[]
  value: string
  onChange: (value: string) => void
  onSelect: (model: ProviderModel) => void
  label: string
  placeholder: string
  noMatchesLabel: string
}

function ModelDiscoveryCombobox({
  models,
  value,
  onChange,
  onSelect,
  label,
  placeholder,
  noMatchesLabel,
}: ModelDiscoveryComboboxProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listboxId = useId()
  const query = value.trim().toLowerCase()
  const filteredModels = useMemo(() => (
    query
      ? models.filter((model) => (
          model.id.toLowerCase().includes(query) || model.name?.toLowerCase().includes(query)
        ))
      : models
  ), [models, query])
  const expanded = open && models.length > 0

  useEffect(() => {
    if (!open) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [open])

  useEffect(() => {
    if (models.length === 0) {
      setOpen(false)
      setActiveIndex(-1)
    }
  }, [models.length])

  useEffect(() => {
    if (activeIndex >= filteredModels.length) setActiveIndex(-1)
  }, [activeIndex, filteredModels.length])

  useEffect(() => {
    if (expanded && activeIndex >= 0) {
      optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [activeIndex, expanded])

  const selectModel = (model: ProviderModel) => {
    onSelect(model)
    setOpen(false)
    setActiveIndex(-1)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && models.length > 0) {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => Math.min(current + 1, filteredModels.length - 1))
      return
    }
    if (event.key === 'ArrowUp' && models.length > 0) {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => current <= 0 ? filteredModels.length - 1 : current - 1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const selected = expanded ? filteredModels[activeIndex] : undefined
      if (selected) selectModel(selected)
      return
    }
    if (event.key === 'Escape' && expanded) {
      event.preventDefault()
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        aria-label={label}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={expanded}
        aria-activedescendant={expanded && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        role="combobox"
        autoComplete="off"
        value={value}
        onFocus={() => {
          if (models.length > 0) setOpen(true)
        }}
        onChange={(event) => {
          onChange(event.target.value)
          setActiveIndex(-1)
          if (models.length > 0) setOpen(true)
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="h-10 w-full cursor-text rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 pr-10 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
      />
      {models.length > 0 && (
        <span className="material-symbols-outlined pointer-events-none absolute right-3 top-5 -translate-y-1/2 text-[18px] text-[var(--color-text-secondary)]">expand_more</span>
      )}
      {expanded && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          data-state="open"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            setActiveIndex(-1)
          }}
          className="motion-menu absolute left-0 right-0 top-full z-50 mt-1 max-h-[240px] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)]"
        >
          {filteredModels.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">{noMatchesLabel}</div>
          ) : filteredModels.map((model, index) => (
            <button
              key={model.id}
              id={`${listboxId}-option-${index}`}
              ref={(element) => { optionRefs.current[index] = element }}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={model.id === value}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectModel(model)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                index === activeIndex || model.id === value
                  ? 'bg-[var(--color-surface-hover)]'
                  : 'hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <span className="material-symbols-outlined text-[17px] text-[var(--color-text-secondary)]">deployed_code</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{model.name || model.id}</span>
                {model.name && <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">{model.id}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ProviderFormModal({ open, onClose, mode, provider, presets, onCreated }: ProviderFormProps) {
  const createProvider = useProviderStore((state) => state.createProvider)
  const updateProvider = useProviderStore((state) => state.updateProvider)
  const testConfig = useProviderStore((state) => state.testConfig)
  const discoverModels = useProviderStore((state) => state.discoverModels)
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()

  const presetDefaultEnvKeys = useMemo(
    () => presets.flatMap((preset) => Object.keys(preset.defaultEnv ?? {})),
    [presets],
  )
  const fallbackPreset = provider
    ? buildFallbackPreset(provider)
    : requirePreset(presets[presets.length - 1])
  const initialPreset = requirePreset(
    provider
      ? presets.find((p) => p.id === provider.presetId) ?? fallbackPreset
      : presets[0] ?? fallbackPreset,
  )

  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset>(initialPreset)
  const [name, setName] = useState(provider?.name ?? getPresetDisplayName(initialPreset, t))
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? initialPreset.baseUrl)
  const [apiFormat, setApiFormat] = useState<ApiFormat>(provider?.apiFormat ?? initialPreset.apiFormat ?? 'anthropic')
  const [modelsApiFormat, setModelsApiFormat] = useState<ApiFormat>(apiFormat)
  const [authStrategy, setAuthStrategy] = useState<ProviderAuthStrategy>(provider?.authStrategy ?? getPresetAuthStrategy(initialPreset))
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [notes, setNotes] = useState(provider?.notes ?? '')
  const [models, setModels] = useState<ProviderModel[]>(() => (provider?.models ?? initialPreset.defaultModels).map((model) => ({ ...model })))
  const [fastModel, setFastModel] = useState(
    provider ? (provider.fastModel ?? '') : (initialPreset.defaultFastModel ?? ''),
  )
  const [modelContextInputs, setModelContextInputs] = useState<ModelContextInputs>(
    getModelContextInputs(provider?.models ?? initialPreset.defaultModels, initialPreset, provider),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [discoveryCount, setDiscoveryCount] = useState<number | null>(null)
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredProviderModel[]>([])
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [settingsJson, setSettingsJson] = useState('')
  const [settingsReady, setSettingsReady] = useState(false)
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false)
  const [settingsJsonError, setSettingsJsonError] = useState<string | null>(null)
  const jsonPastedRef = useRef(false)
  const discoveryRequestRef = useRef(0)
  const discoveredSelectionRef = useRef<{ id: string; name: string } | null>(null)

  const clearDiscoveredSelection = () => {
    const selection = discoveredSelectionRef.current
    discoveredSelectionRef.current = null
    if (!selection) return
    setNewModelId((current) => {
      if (current !== selection.id) return current
      return ''
    })
    setNewModelName((current) => current === selection.name ? '' : current)
  }

  const resetDiscovery = () => {
    discoveryRequestRef.current++
    setDiscoveredModels([])
    setDiscoveryError(null)
    setDiscoveryCount(null)
    setIsDiscovering(false)
    clearDiscoveredSelection()
  }

  useEffect(() => {
    if (jsonPastedRef.current) {
      jsonPastedRef.current = false
      return
    }
    let cancelled = false
    setSettingsLoadFailed(false)
    import('../../api/providers').then(({ providersApi }) => providersApi.getSettings()).then((settings) => {
      if (cancelled) return
      const needsProxy = apiFormat !== 'anthropic'
      const modelContextWindows = buildModelContextWindows(models, modelContextInputs)
      const normalizedModels = normalizeModels(models)
      const runtime = runtimeModelMapping(normalizedModels, fastModel)
      const existingEnv = (settings.env as Record<string, string>) || {}
      const cleanedEnv = stripProviderSettingsJsonEnv(existingEnv, presetDefaultEnvKeys)
      const merged = {
        ...settings,
        skipWebFetchPreflight: settings.skipWebFetchPreflight ?? true,
        env: {
          ...cleanedEnv,
          ...omitAuthEnv(selectedPreset.defaultEnv),
          ...(Object.keys(modelContextWindows).length > 0
            ? { [MODEL_CONTEXT_WINDOWS_ENV_KEY]: JSON.stringify(modelContextWindows) }
            : {}),
          ANTHROPIC_BASE_URL: needsProxy ? 'http://127.0.0.1:3456/proxy' : baseUrl,
          ...buildSettingsJsonAuthEnv(apiFormat, authStrategy, apiKey, selectedPreset),
          ANTHROPIC_MODEL: runtime.main,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: runtime.fast,
          ANTHROPIC_SMALL_FAST_MODEL: runtime.fast,
          ANTHROPIC_DEFAULT_SONNET_MODEL: runtime.main,
          ANTHROPIC_DEFAULT_OPUS_MODEL: runtime.main,
        },
      }
      setSettingsJson(JSON.stringify(merged, null, 2))
      setSettingsReady(true)
    }).catch(() => {
      if (!cancelled) setSettingsLoadFailed(true)
    })
    return () => { cancelled = true }
  }, [selectedPreset.id])

  const handlePresetChange = (preset: ProviderPreset) => {
    if (preset.id !== selectedPreset.id) setSettingsReady(false)
    setSelectedPreset(preset)
    setName(getPresetDisplayName(preset, t))
    setBaseUrl(preset.baseUrl)
    setApiFormat(preset.apiFormat ?? 'anthropic')
    setModelsApiFormat(preset.apiFormat ?? 'anthropic')
    setAuthStrategy(getPresetAuthStrategy(preset))
    setModels(preset.defaultModels.map((model) => ({ ...model })))
    setFastModel(preset.defaultFastModel ?? '')
    setModelContextInputs(getModelContextInputs(preset.defaultModels, preset))
    setTestResult(null)
    resetDiscovery()
  }

  const isCustom = selectedPreset.id === 'custom'
  const requiresApiKey = selectedPreset.needsApiKey !== false
  const hasModelContextWindowError = models.some((model) => (
    !!getModelContextWindowErrorKey(modelContextInputs[model.id] ?? '')
  ))
  const canSubmit = settingsReady && name.trim() && baseUrl.trim() && (mode === 'edit' || !requiresApiKey || apiKey.trim()) && models.length > 0 && !settingsJsonError && !hasModelContextWindowError
  const apiKeyUrl = selectedPreset.apiKeyUrl?.trim()
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
  useEffect(() => {
    if (!settingsReady) return
    setSettingsJson((current) => updateSettingsJsonModelContextWindows(
      current,
      buildModelContextWindows(models, modelContextInputs),
    ))
  }, [settingsReady, models, modelContextInputs])
  const handleBaseUrlChange = (value: string) => {
    resetDiscovery()
    setBaseUrl(value)
    setSettingsJson((current) => updateSettingsJsonProviderConnection(current, apiFormat, authStrategy, apiKey, selectedPreset, value))
  }
  const handleApiKeyChange = (value: string) => {
    resetDiscovery()
    setApiKey(value)
    setSettingsJson((current) => updateSettingsJsonProviderConnection(current, apiFormat, authStrategy, value, selectedPreset, baseUrl))
  }
  const handleApiFormatChange = (value: ApiFormat) => {
    resetDiscovery()
    setApiFormat(value)
    setSettingsJson((current) => updateSettingsJsonProviderConnection(current, value, authStrategy, apiKey, selectedPreset, baseUrl))
  }
  const handleAuthStrategyChange = (value: ProviderAuthStrategy) => {
    resetDiscovery()
    setAuthStrategy(value)
    setSettingsJson((current) => updateSettingsJsonProviderConnection(current, apiFormat, value, apiKey, selectedPreset, baseUrl))
  }
  const updateModels = (nextModels: ProviderModel[], nextFastModel = fastModel) => {
    const normalized = normalizeModels(nextModels)
    const validFastModel = normalized.some((model) => model.id === nextFastModel) ? nextFastModel : ''
    setModels(nextModels)
    setFastModel(validFastModel)
    setSettingsJson((current) => updateSettingsJsonModels(current, normalized, validFastModel))
  }
  const handleModelContextWindowChange = (modelId: string, value: string) => {
    setModelContextInputs((current) => ({ ...current, [modelId]: value }))
  }
  const selectDiscoveredModel = (model: ProviderModel) => {
    const name = model.name ?? ''
    discoveredSelectionRef.current = { id: model.id, name }
    setNewModelId(model.id)
    setNewModelName(name)
  }
  const handleDiscoverModels = async () => {
    if (!baseUrl.trim()) return
    const requestId = ++discoveryRequestRef.current
    setIsDiscovering(true)
    setDiscoveryError(null)
    setDiscoveryCount(null)
    try {
      const fetched = await discoverModels({
        presetId: selectedPreset.id,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || selectedPreset.defaultEnv?.ANTHROPIC_AUTH_TOKEN || '',
        authStrategy,
        apiFormat,
      })
      if (requestId !== discoveryRequestRef.current) return
      setDiscoveredModels(fetched)
      setModelContextInputs((current) => {
        const next = { ...current }
        for (const model of fetched) {
          if (Object.prototype.hasOwnProperty.call(current, model.id) && !current[model.id]?.trim() && model.contextWindow !== undefined) {
            next[model.id] = String(model.contextWindow)
          }
        }
        return next
      })
      setDiscoveryCount(fetched.length)
      setModelsApiFormat(apiFormat)
    } catch (err) {
      if (requestId !== discoveryRequestRef.current) return
      setDiscoveredModels([])
      setDiscoveryError(err instanceof Error ? err.message : String(err))
    } finally {
      if (requestId === discoveryRequestRef.current) setIsDiscovering(false)
    }
  }
  const handleAddModel = () => {
    const id = newModelId.trim()
    if (!id || models.some((model) => model.id === id)) return
    const suggestion = discoveredModels.find((model) => model.id === id)
    const name = newModelName.trim() || suggestion?.name
    const nextModels = [...models, { id, ...(name ? { name } : {}) }]
    setModelContextInputs((current) => ({
      ...current,
      [id]: getModelContextInputValue(id, selectedPreset, provider) || (suggestion?.contextWindow !== undefined ? String(suggestion.contextWindow) : ''),
    }))
    updateModels(nextModels)
    discoveredSelectionRef.current = null
    setNewModelId('')
    setNewModelName('')
  }
  const duplicateModelNames = new Set(
    models.map((model) => model.name?.trim()).filter((name): name is string => !!name)
      .filter((name, index, names) => names.indexOf(name) !== index),
  )
  const renderPresetButton = (preset: ProviderPreset) => (
    <button
      key={preset.id}
      onClick={() => handlePresetChange(preset)}
      className={`inline-flex max-w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium rounded-full border transition-all ${
        selectedPreset.id === preset.id
          ? 'border-[var(--color-brand)] bg-[var(--color-surface-container-high)] text-[var(--color-brand)] shadow-[var(--shadow-focus-ring)]'
          : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <ProviderIcon presetId={preset.id} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{getPresetDisplayName(preset, t)}</span>
    </button>
  )

  const handleSubmit = async () => {
    if (!canSubmit) return
    const normalizedModels = normalizeModels(models)
    const parsedModelContextWindows = buildModelContextWindows(models, modelContextInputs)
    setIsSubmitting(true)
    setSaveError(null)
    try {
      if (settingsJson.trim()) {
        try {
          const parsed = restoreSettingsJsonSecrets(JSON.parse(settingsJson), settingsJson, apiKey)
          const { providersApi } = await import('../../api/providers')
          await providersApi.updateSettings(parsed)
        } catch {
        }
      }

      if (mode === 'create') {
        const created = await createProvider({
          presetId: selectedPreset.id,
          name: name.trim(),
          apiKey: apiKey.trim(),
          authStrategy,
          baseUrl: baseUrl.trim(),
          apiFormat,
          models: normalizedModels,
          ...(fastModel && { fastModel }),
          ...(Object.keys(parsedModelContextWindows).length > 0 && { modelContextWindows: parsedModelContextWindows }),
          notes: notes.trim() || undefined,
        })
        await onCreated?.(created)
      } else if (provider) {
        const input: UpdateProviderInput = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          authStrategy,
          apiFormat,
          models: normalizedModels,
          fastModel: fastModel || null,
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
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleTest = async () => {
    const testModel = models[0]?.id.trim()
    if (!baseUrl.trim() || !testModel) return
    setIsTesting(true)
    setTestResult(null)
    try {
      let result: ProviderTestResult
      if (mode === 'edit' && provider && !apiKey.trim()) {
        result = await useProviderStore.getState().testProvider(provider.id, {
          baseUrl: baseUrl.trim(),
          modelId: testModel,
          apiFormat,
          authStrategy,
        })
      } else {
        if (requiresApiKey && !apiKey.trim()) return
        result = await testConfig({
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || selectedPreset.defaultEnv?.ANTHROPIC_AUTH_TOKEN || 'local',
          modelId: testModel,
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
          {settingsLoadFailed && (
            <p role="alert" className="mr-auto self-center text-xs text-[var(--color-error)]">
              {t('settings.providers.settingsLoadFailed')}
            </p>
          )}
          {saveError && (
            <p role="alert" className="mr-auto self-center text-xs text-[var(--color-error)] [overflow-wrap:anywhere]">
              {t('settings.providers.saveFailed', { error: saveError })}
            </p>
          )}
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {mode === 'create' ? t('common.add') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {mode === 'create' && (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.preset')}</label>
            <div className="flex flex-wrap gap-2">
              {presets.map(renderPresetButton)}
            </div>
          </div>
        )}

        <Input label={t('settings.providers.name')} required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.providers.namePlaceholder')} />

        <Input label={t('settings.providers.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('settings.providers.notesPlaceholder')} />

        <Input label={t('settings.providers.baseUrl')} required value={baseUrl} onChange={(e) => handleBaseUrlChange(e.target.value)} placeholder={t('settings.providers.baseUrlPlaceholder')} />

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

        {apiKeyUrl && (
          <button
            type="button"
            onClick={() => openExternalUrl(apiKeyUrl)}
            className="group -mt-2 inline-flex h-6 w-fit cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 text-[11px] font-medium leading-none text-[var(--color-brand)] transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)]"
          >
            <span className="material-symbols-outlined text-[13px]">key</span>
            {t('settings.providers.getApiKey')}
            <span className="material-symbols-outlined text-[9px] opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">arrow_outward</span>
          </button>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.providers.models')}</label>
            <Button variant="secondary" size="sm" onClick={handleDiscoverModels} loading={isDiscovering} disabled={!baseUrl.trim()}>
              {t('settings.providers.fetchModels')}
            </Button>
          </div>
          {discoveryError && (
            <p role="alert" className="mb-2 text-[11px] text-[var(--color-error)]">{discoveryError}</p>
          )}
          {models.length > 0 && apiFormat !== modelsApiFormat && (
            <p role="status" className="mb-2 text-[11px] text-[var(--color-warning)]">{t('settings.providers.apiFormatChangedModels')}</p>
          )}
          {discoveryCount !== null && (
            <p role="status" className="mb-2 text-[11px] text-[var(--color-text-secondary)]">
              {discoveryCount > 0
                ? t('settings.providers.modelsFound', { count: discoveryCount })
                : t('settings.providers.noModelsReturned')}
            </p>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">{t('settings.providers.modelId')}</label>
              <ModelDiscoveryCombobox
                models={discoveredModels}
                value={newModelId}
                onChange={(id) => {
                  discoveredSelectionRef.current = null
                  setNewModelId(id)
                  const suggestion = discoveredModels.find((model) => model.id === id)
                  if (suggestion?.name) setNewModelName(suggestion.name)
                }}
                onSelect={selectDiscoveredModel}
                label={t('settings.providers.modelId')}
                placeholder={t('settings.providers.modelIdPlaceholder')}
                noMatchesLabel={t('settings.providers.noModelMatches')}
              />
            </div>
            <Input
              label={t('settings.providers.displayName')}
              value={newModelName}
              onChange={(event) => {
                discoveredSelectionRef.current = null
                setNewModelName(event.target.value)
              }}
              placeholder={t('settings.providers.displayNameOptional')}
            />
            <Button variant="secondary" onClick={handleAddModel} disabled={!newModelId.trim() || models.some((model) => model.id === newModelId.trim())}>
              {t('common.add')}
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {models.map((model, index) => {
              const errorKey = getModelContextWindowErrorKey(modelContextInputs[model.id] ?? '')
              return (
                <div key={model.id} className="flex flex-wrap items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-2">
                  <div className="min-w-0 flex-1">
                    <input
                      aria-label={t('settings.providers.displayName')}
                      value={model.name ?? ''}
                      onChange={(event) => updateModels(models.map((entry, candidateIndex) => (
                        candidateIndex === index
                          ? { ...entry, name: event.target.value || undefined }
                          : entry
                      )))}
                      placeholder={model.id}
                      className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                    />
                    <div className="mt-1 truncate text-[11px] text-[var(--color-text-tertiary)]">{model.id}</div>
                    {index === 0 && (
                      <div className="mt-1 text-[11px] font-medium text-[var(--color-brand)]">{t('settings.providers.defaultModel')}</div>
                    )}
                    {model.name && duplicateModelNames.has(model.name.trim()) && (
                      <div className="mt-1 text-[11px] text-[var(--color-warning)]">{t('settings.providers.duplicateDisplayName')}</div>
                    )}
                  </div>
                  <div className="w-36 min-w-0">
                    <input
                      aria-label={t('settings.providers.modelContextWindowLabel', { model: model.id })}
                      aria-invalid={!!errorKey}
                      inputMode="numeric"
                      value={modelContextInputs[model.id] ?? ''}
                      onChange={(event) => handleModelContextWindowChange(model.id, event.target.value)}
                      placeholder={t('settings.providers.contextWindowPlaceholder')}
                      className={`h-8 w-full rounded-[var(--radius-sm)] border bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)] ${errorKey ? 'border-[var(--color-error)]' : 'border-[var(--color-border)]'}`}
                    />
                    <div className={`mt-1 text-[11px] ${errorKey ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}>
                      {errorKey
                        ? t(errorKey === 'number'
                          ? 'settings.providers.modelContextWindowNumberError'
                          : 'settings.providers.modelContextWindowRangeError')
                        : t('settings.providers.modelContextWindow')}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => {
                      const nextModels = [...models]
                      const [moved] = nextModels.splice(index, 1)
                      if (!moved) return
                      nextModels.splice(index - 1, 0, moved)
                      updateModels(nextModels)
                    }}
                    aria-label={t('settings.providers.moveModelUp')}
                    className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-30"
                  >
                    <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                  </button>
                  <button
                    type="button"
                    disabled={index === models.length - 1}
                    onClick={() => {
                      const nextModels = [...models]
                      const [moved] = nextModels.splice(index, 1)
                      if (!moved) return
                      nextModels.splice(index + 1, 0, moved)
                      updateModels(nextModels)
                    }}
                    aria-label={t('settings.providers.moveModelDown')}
                    className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-30"
                  >
                    <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => updateModels(models.filter((_, candidateIndex) => candidateIndex !== index), fastModel === model.id ? '' : fastModel)}
                    aria-label={t('common.delete')}
                    className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-error)]"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              )
            })}
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
            {t('settings.providers.modelContextWindowsDesc')}
          </p>
          <div className="mt-3">
            <label htmlFor="provider-fast-model" className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">{t('settings.providers.fastModel')}</label>
            <select
              id="provider-fast-model"
              value={fastModel}
              onChange={(event) => {
                const nextFastModel = event.target.value
                setFastModel(nextFastModel)
                setSettingsJson((current) => updateSettingsJsonModels(current, normalizeModels(models), nextFastModel))
              }}
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
            >
              <option value="">{t('settings.providers.fastModelDefault')}</option>
              {models.map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{t('settings.providers.fastModelDesc')}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleTest} loading={isTesting} disabled={!baseUrl.trim() || !models[0]?.id.trim()}>
            {t('settings.providers.testConnection')}
          </Button>
          {testResult && (
            <div className="flex flex-col gap-0.5">
              <span className={`text-xs ${testResult.connectivity.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                {testResult.connectivity.success
                  ? t('settings.providers.connectivityOk', { latency: String(testResult.connectivity.latencyMs) })
                  : t('settings.providers.connectivityFailed', { error: testResult.connectivity.error || '' })}
              </span>
            </div>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.settingsJson')}</label>
          <textarea
            disabled={!settingsReady}
            value={displayedSettingsJson}
            onChange={(e) => {
              const raw = e.target.value
              try {
                const parsed = restoreSettingsJsonSecrets(JSON.parse(raw), settingsJson, apiKey)
                setSettingsJsonError(null)
                const env = parsed.env as Record<string, string> | undefined
                if (env) {
                  const nextApiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY
                  const validNextApiKey = nextApiKey && nextApiKey !== '(your API key)' && nextApiKey !== API_KEY_JSON_PLACEHOLDER
                    ? nextApiKey
                    : undefined
                  const nextAuthStrategy = inferAuthStrategyFromEnv(env)
                  const connectionChanged = (
                    (!!env.ANTHROPIC_BASE_URL && env.ANTHROPIC_BASE_URL !== baseUrl) ||
                    (!!validNextApiKey && validNextApiKey !== apiKey) ||
                    (!!nextAuthStrategy && nextAuthStrategy !== authStrategy)
                  )
                  if (connectionChanged) resetDiscovery()
                  if (env.ANTHROPIC_BASE_URL) {
                    setBaseUrl(env.ANTHROPIC_BASE_URL)
                    if (mode === 'create') {
                      const matchedPreset = presets.find((p) => p.id !== 'custom' && p.baseUrl === env.ANTHROPIC_BASE_URL)
                      const targetPreset = requirePreset(
                        matchedPreset ?? presets.find((p) => p.id === 'custom'),
                      )
                      if (targetPreset.id !== selectedPreset.id) {
                        jsonPastedRef.current = true
                        setSelectedPreset(targetPreset)
                      }
                    }
                  }
                  if (validNextApiKey) {
                    setApiKey(validNextApiKey)
                  }
                  if (nextAuthStrategy) {
                    setAuthStrategy(nextAuthStrategy)
                  }
                }
                const normalizedModels = normalizeModels(models)
                setSettingsJson(updateSettingsJsonModelContextWindows(
                  updateSettingsJsonModels(JSON.stringify(parsed, null, 2), normalizedModels, fastModel),
                  buildModelContextWindows(normalizedModels, modelContextInputs),
                ))
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
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('settings.providers.settingsJsonModelsGenerated')}</p>
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('settings.providers.settingsJsonDesc')}</p>
        </div>
      </div>
    </Modal>
  )
}

export { ProviderFormModal }
export type { ProviderFormProps }
