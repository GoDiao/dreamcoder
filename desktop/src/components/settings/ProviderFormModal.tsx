import { FormSelect } from '../shared/FormSelect'
import { Textarea } from '../shared/ui/textarea'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupButton } from '../shared/ui/input-group'
import { ArrowDownIcon, ArrowUpIcon, ArrowUpRightIcon, Box, ChevronDown, EyeIcon, EyeOffIcon, KeyRoundIcon, Plus, Trash2Icon } from 'lucide-react'
import { useState, useEffect, useMemo, useRef } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { Modal } from '../shared/Modal'
import { Input } from '../shared/ui/input'
import { LabeledInput } from '../shared/LabeledInput'
import { Button } from '../shared/ui/button'
import { getPresetDisplayName } from './presetDisplayName'
import { ProviderIcon } from './ProviderIcon'
import { Command, CommandItem, CommandList } from '../shared/ui/command'
import { Popover, PopoverAnchor, PopoverContent } from '../shared/ui/popover'
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
  useCustomLabel: (id: string) => string
}

function ModelDiscoveryCombobox({
  models,
  value,
  onChange,
  onSelect,
  label,
  placeholder,
  useCustomLabel,
}: ModelDiscoveryComboboxProps) {
  const [open, setOpen] = useState(false)
  const typed = value.trim()
  const query = typed.toLowerCase()
  const filteredModels = useMemo(() => {
    if (!query) return models
    const matches = models.filter((model) => (
      model.id.toLowerCase().includes(query) || model.name?.toLowerCase().includes(query)
    ))
    return [...matches.filter((model) => model.id === typed), ...matches.filter((model) => model.id !== typed)]
  }, [models, query, typed])
  const offerTyped = typed !== '' && !models.some((model) => model.id === typed)
  const expanded = open && models.length > 0

  useEffect(() => {
    if (models.length === 0) setOpen(false)
  }, [models.length])

  const selectModel = (model: ProviderModel) => {
    onSelect(model)
    setOpen(false)
  }

  return (
    <Command label={label} shouldFilter={false} className="block size-auto overflow-visible rounded-none! bg-transparent p-0">
      <Popover open={expanded} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <CommandPrimitive.Input
              asChild
              value={value}
              onValueChange={(next) => {
                onChange(next)
                if (models.length > 0) setOpen(true)
              }}
            >
              <Input
                autoComplete="off"
                onFocus={() => {
                  if (models.length > 0) setOpen(true)
                }}
                onKeyDown={(event) => {
                  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && models.length > 0) setOpen(true)
                }}
                placeholder={placeholder}
                className="pr-8"
              />
            </CommandPrimitive.Input>
            {models.length > 0 && (
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target instanceof Element && event.target.closest('[cmdk-root]')) event.preventDefault()
          }}
          onMouseDown={(event) => event.preventDefault()}
          className="w-[var(--radix-popover-trigger-width)] p-1"
        >
          <CommandList aria-label={label} className="max-h-[240px]">
            {offerTyped && (
              <CommandItem value={`custom-model:${typed}`} onSelect={() => setOpen(false)} className="gap-2 px-3 py-2">
                <Plus aria-hidden="true" className="text-[var(--color-text-secondary)]" />
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">{useCustomLabel(typed)}</span>
              </CommandItem>
            )}
            {filteredModels.map((model) => (
              <CommandItem
                key={model.id}
                value={model.id}
                data-checked={model.id === value}
                onSelect={() => selectModel(model)}
                className="gap-2 px-3 py-2"
              >
                <Box aria-hidden="true" className="text-[var(--color-text-secondary)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{model.name || model.id}</span>
                  {model.name && <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">{model.id}</span>}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
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
  const apiFormatOptions: Array<{ value: ApiFormat; label: string }> = [
    { value: 'anthropic', label: t('settings.providers.apiFormatAnthropic') },
    { value: 'openai_chat', label: t('settings.providers.apiFormatOpenaiChat') },
    { value: 'openai_responses', label: t('settings.providers.apiFormatOpenaiResponses') },
  ]
  const authStrategyOptions: Array<{ value: ProviderAuthStrategy; label: string; description: string }> = [
    { value: 'auth_token', label: t('settings.providers.authStrategyAuthToken'), description: t('settings.providers.authStrategyAuthTokenDesc') },
    { value: 'auth_token_empty_api_key', label: t('settings.providers.authStrategyAuthTokenEmptyApiKey'), description: t('settings.providers.authStrategyAuthTokenEmptyApiKeyDesc') },
    { value: 'api_key', label: t('settings.providers.authStrategyApiKey'), description: t('settings.providers.authStrategyApiKeyDesc') },
    { value: 'dual_same_token', label: t('settings.providers.authStrategyDualSameToken'), description: t('settings.providers.authStrategyDualSameTokenDesc') },
    { value: 'dual_dummy', label: t('settings.providers.authStrategyDualDummy'), description: t('settings.providers.authStrategyDualDummyDesc') },
  ]
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
  const moveModel = (index: number, offset: number) => {
    const nextModels = [...models]
    const [moved] = nextModels.splice(index, 1)
    if (!moved) return
    nextModels.splice(index + offset, 0, moved)
    updateModels(nextModels)
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
    <Button
      variant="ghost"
      key={preset.id}
      onClick={() => handlePresetChange(preset)}
      className={`inline-flex max-w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium rounded-full border transition-all ${
        selectedPreset.id === preset.id
          ? 'border-[var(--color-brand)] bg-[var(--color-surface-container-high)] text-[var(--color-brand)] ring-3 ring-ui-ring/50'
          : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <ProviderIcon presetId={preset.id} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{getPresetDisplayName(preset, t)}</span>
    </Button>
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

  const VisibilityIcon = showApiKey ? EyeOffIcon : EyeIcon
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
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
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

        <LabeledInput
          label={t('settings.providers.name')}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.providers.namePlaceholder')}
        />

        <LabeledInput
          label={t('settings.providers.notes')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('settings.providers.notesPlaceholder')}
        />

        <LabeledInput
          label={t('settings.providers.baseUrl')}
          required
          value={baseUrl}
          onChange={(e) => handleBaseUrlChange(e.target.value)}
          placeholder={t('settings.providers.baseUrlPlaceholder')}
        />

        {(isCustom || mode === 'edit') ? (
          <div>
            <label htmlFor="provider-api-format" className="text-sm font-medium text-[var(--color-text-primary)] mb-1 block">{t('settings.providers.apiFormat')}</label>
            <FormSelect id="provider-api-format" label={t('settings.providers.apiFormat')} options={apiFormatOptions} value={apiFormat} onChange={handleApiFormatChange} description={apiFormat !== 'anthropic' ? t('settings.providers.proxyHint') : undefined} />
          </div>
        ) : apiFormat !== 'anthropic' ? (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-1 block">{t('settings.providers.apiFormat')}</label>
            <div className="text-xs text-[var(--color-text-tertiary)] px-3 py-2 rounded-md bg-[var(--color-surface-container-low)] border border-[var(--color-border)]">
              {apiFormat === 'openai_chat' ? t('settings.providers.apiFormatOpenaiChat') : t('settings.providers.apiFormatOpenaiResponses')}
            </div>
          </div>
        ) : null}

        {apiFormat === 'anthropic' && (
          <div>
            <label htmlFor="provider-auth-strategy" className="text-sm font-medium text-[var(--color-text-primary)] mb-1 block">{t('settings.providers.authStrategy')}</label>
            <FormSelect id="provider-auth-strategy" label={t('settings.providers.authStrategy')} options={authStrategyOptions} value={authStrategy} onChange={handleAuthStrategyChange} description={authStrategyOptions.find((option) => option.value === authStrategy)?.description} />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="provider-api-key" className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('settings.providers.apiKey')}
            {mode === 'create' && requiresApiKey && <span className="text-[var(--color-error)] ml-0.5">*</span>}
          </label>
          <InputGroup>
            <InputGroupInput
              id="provider-api-key"
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder="sk-..."
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" onClick={() => setShowApiKey((visible) => !visible)} aria-label={t(showApiKey ? 'settings.providers.hideApiKey' : 'settings.providers.showApiKey')}>
                <VisibilityIcon aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>

        {apiKeyUrl && (
          <Button
            variant="ghost"
            type="button"
            onClick={() => openExternalUrl(apiKeyUrl)}
            className="group -mt-2 inline-flex h-6 w-fit cursor-pointer items-center gap-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 text-[11px] font-medium leading-none text-[var(--color-brand)] transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus:outline-none"
          >
            <KeyRoundIcon aria-hidden="true" size={13} />
            {t('settings.providers.getApiKey')}
            <ArrowUpRightIcon className="shrink-0 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" size={9} />
          </Button>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.providers.models')}</label>
            <Button variant="outline" size="sm" onClick={handleDiscoverModels} loading={isDiscovering} disabled={!baseUrl.trim()}>
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
                useCustomLabel={(id) => t('settings.providers.useCustomModel', { id })}
              />
            </div>
            <LabeledInput
              label={t('settings.providers.displayName')}
              value={newModelName}
              onChange={(event) => {
                discoveredSelectionRef.current = null
                setNewModelName(event.target.value)
              }}
              placeholder={t('settings.providers.displayNameOptional')}
            />
            <Button variant="outline" onClick={handleAddModel} disabled={!newModelId.trim() || models.some((model) => model.id === newModelId.trim())}>
              {t('common.add')}
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {models.map((model, index) => {
              const errorKey = getModelContextWindowErrorKey(modelContextInputs[model.id] ?? '')
              return (
                <div key={model.id} className="flex flex-wrap items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label={t('settings.providers.displayName')}
                      value={model.name ?? ''}
                      onChange={(event) => updateModels(models.map((entry, candidateIndex) => (
                        candidateIndex === index
                          ? { ...entry, name: event.target.value || undefined }
                          : entry
                      )))}
                      placeholder={model.id}
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
                    <Input
                      aria-label={t('settings.providers.modelContextWindowLabel', { model: model.id })}
                      aria-invalid={!!errorKey}
                      inputMode="numeric"
                      value={modelContextInputs[model.id] ?? ''}
                      onChange={(event) => handleModelContextWindowChange(model.id, event.target.value)}
                      placeholder={t('settings.providers.contextWindowPlaceholder')}
                    />
                    <div className={`mt-1 text-[11px] ${errorKey ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'}`}>
                      {errorKey
                        ? t(errorKey === 'number'
                          ? 'settings.providers.modelContextWindowNumberError'
                          : 'settings.providers.modelContextWindowRangeError')
                        : t('settings.providers.modelContextWindow')}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    onClick={() => moveModel(index, -1)}
                    aria-label={t('settings.providers.moveModelUp')}
                    className="text-[var(--color-text-tertiary)]"
                  >
                    <ArrowUpIcon aria-hidden="true" size={18} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === models.length - 1}
                    onClick={() => moveModel(index, 1)}
                    aria-label={t('settings.providers.moveModelDown')}
                    className="text-[var(--color-text-tertiary)]"
                  >
                    <ArrowDownIcon aria-hidden="true" size={18} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => updateModels(models.filter((_, candidateIndex) => candidateIndex !== index), fastModel === model.id ? '' : fastModel)}
                    aria-label={t('common.delete')}
                    className="text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]"
                  >
                    <Trash2Icon aria-hidden="true" size={18} />
                  </Button>
                </div>
              )
            })}
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
            {t('settings.providers.modelContextWindowsDesc')}
          </p>
          <div className="mt-3">
            <label htmlFor="provider-fast-model" className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">{t('settings.providers.fastModel')}</label>
            <FormSelect
              id="provider-fast-model"
              label={t('settings.providers.fastModel')}
              value={fastModel}
              onChange={(nextFastModel) => {
                setFastModel(nextFastModel)
                setSettingsJson((current) => updateSettingsJsonModels(current, normalizeModels(models), nextFastModel))
              }}
              options={[
                { value: '', label: t('settings.providers.fastModelDefault') },
                ...models.map((model) => ({ value: model.id, label: model.name || model.id })),
              ]}
              description={t('settings.providers.fastModelDesc')}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleTest} loading={isTesting} disabled={!baseUrl.trim() || !models[0]?.id.trim()}>
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
          <Textarea
            aria-label={t('settings.providers.settingsJson')}
            aria-invalid={!!settingsJsonError}
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
            className={`field-sizing-fixed w-full text-xs px-3 py-3 rounded-md bg-[var(--color-surface-container-low)] border font-mono leading-relaxed resize-y text-[var(--color-text-secondary)] outline-none ${
              settingsJsonError
                ? 'border-[var(--color-error)] focus:border-[var(--color-error)]'
                : 'border-[var(--color-border)]'
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
