import { FormSelect } from '../shared/FormSelect'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupButton } from '../shared/ui/input-group'
import { ArrowDownIcon, ArrowUpIcon, ArrowUpRightIcon, Box, ChevronDown, EyeIcon, EyeOffIcon, KeyRoundIcon, Plus, Trash2Icon } from 'lucide-react'
import { useState, useEffect, useMemo, useRef } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { Modal } from '../shared/Modal'
import { Input } from '../shared/ui/input'
import { LabeledInput } from '../shared/LabeledInput'
import { Button } from '../shared/ui/button'
import { getPresetDisplayName } from './presetDisplayName'
import { ProviderIcon } from './ProviderIcon'
import { CommandItem, CommandList } from '../shared/ui/command'
import { Popover, PopoverAnchor, PopoverContent } from '../shared/ui/popover'
import type { SavedProvider, UpdateProviderInput, ProviderSaveResult, ProviderTestResult, ProviderModel, ApiFormat, ProviderAuthStrategy } from '../../types/provider'
import type { ProviderPreset } from '../../types/providerPreset'
import { openExternalUrl } from '../../lib/externalUrl'
import {
  ModelRulesEditor,
  buildModelOverrides,
  hasModelOverrideDraftError,
  toModelOverrideDraft,
  type ModelOverrideDraft,
} from './ModelRulesEditor'

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

const DEFAULT_PROVIDER_AUTH_STRATEGY: ProviderAuthStrategy = 'auth_token'

function getPresetAuthStrategy(preset: ProviderPreset): ProviderAuthStrategy {
  return preset.authStrategy ?? DEFAULT_PROVIDER_AUTH_STRATEGY
}

function getModelOverrideDrafts(provider?: SavedProvider): Record<string, ModelOverrideDraft> {
  return Object.fromEntries(
    Object.entries(provider?.modelOverrides ?? {}).map(([id, override]) => [id, toModelOverrideDraft(override)]),
  )
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

function buildFallbackPreset(provider?: SavedProvider): ProviderPreset {
  return {
    id: provider?.presetId ?? 'custom',
    name: provider?.name ?? 'Custom',
    baseUrl: provider?.baseUrl ?? '',
    apiFormat: provider?.apiFormat ?? 'anthropic',
    authStrategy: provider?.authStrategy,
    defaultModels: provider?.models ?? [],
    defaultFastModel: provider?.fastModel,
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
    <CommandPrimitive label={label} shouldFilter={false}>
      <Popover open={expanded} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <InputGroup>
            <CommandPrimitive.Input
              asChild
              value={value}
              onValueChange={(next) => {
                onChange(next)
                if (models.length > 0) setOpen(true)
              }}
            >
              <InputGroupInput
                autoComplete="off"
                onFocus={() => {
                  if (models.length > 0) setOpen(true)
                }}
                onKeyDown={(event) => {
                  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && models.length > 0) setOpen(true)
                }}
                placeholder={placeholder}
              />
            </CommandPrimitive.Input>
            {models.length > 0 && (
              <InputGroupAddon align="inline-end">
                <ChevronDown aria-hidden="true" />
              </InputGroupAddon>
            )}
          </InputGroup>
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
          className="w-[var(--radix-popover-trigger-width)]"
        >
          <CommandList aria-label={label} className="max-h-[240px]">
            {offerTyped && (
              <CommandItem value={`custom-model:${typed}`} onSelect={() => setOpen(false)}>
                <Plus aria-hidden="true" className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{useCustomLabel(typed)}</span>
              </CommandItem>
            )}
            {filteredModels.map((model) => (
              <CommandItem
                key={model.id}
                value={model.id}
                data-checked={model.id === value}
                onSelect={() => selectModel(model)}
              >
                <Box aria-hidden="true" className="text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{model.name || model.id}</span>
                  {model.name && <span className="block truncate text-2xs text-subtle-foreground">{model.id}</span>}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </PopoverContent>
      </Popover>
    </CommandPrimitive>
  )
}

function ProviderFormModal({ open, onClose, mode, provider, presets, onCreated }: ProviderFormProps) {
  const createProvider = useProviderStore((state) => state.createProvider)
  const updateProvider = useProviderStore((state) => state.updateProvider)
  const testConfig = useProviderStore((state) => state.testConfig)
  const discoverModels = useProviderStore((state) => state.discoverModels)
  const refreshProviderModels = useProviderStore((state) => state.refreshProviderModels)
  const storedResolvedModels = useProviderStore((state) => (
    provider ? state.providers.find((candidate) => candidate.id === provider.id)?.resolvedModels : undefined
  ))
  const addToast = useUIStore((state) => state.addToast)
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()

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
  const [modelOverrideDrafts, setModelOverrideDrafts] = useState<Record<string, ModelOverrideDraft>>(
    () => getModelOverrideDrafts(provider),
  )
  const [isRefreshingModelInfo, setIsRefreshingModelInfo] = useState(false)
  const [modelInfoRefresh, setModelInfoRefresh] = useState<ProviderSaveResult['modelDiscovery'] | { ok: true } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [discoveryCount, setDiscoveryCount] = useState<number | null>(null)
  const [discoveredModels, setDiscoveredModels] = useState<ProviderModel[]>([])
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
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

  const handlePresetChange = (preset: ProviderPreset) => {
    setSelectedPreset(preset)
    setName(getPresetDisplayName(preset, t))
    setBaseUrl(preset.baseUrl)
    setApiFormat(preset.apiFormat ?? 'anthropic')
    setModelsApiFormat(preset.apiFormat ?? 'anthropic')
    setAuthStrategy(getPresetAuthStrategy(preset))
    setModels(preset.defaultModels.map((model) => ({ ...model })))
    setFastModel(preset.defaultFastModel ?? '')
    setModelOverrideDrafts({})
    setTestResult(null)
    resetDiscovery()
  }

  const isCustom = selectedPreset.id === 'custom'
  const requiresApiKey = selectedPreset.needsApiKey !== false
  const resolvedModels = storedResolvedModels ?? provider?.resolvedModels
  const showModelRules = !provider || resolvedModels !== undefined
  const hasModelOverrideError = models.some((model) => hasModelOverrideDraftError(modelOverrideDrafts[model.id]))
  const canSubmit = name.trim() && baseUrl.trim() && (mode === 'edit' || !requiresApiKey || apiKey.trim()) && models.length > 0 && !hasModelOverrideError
  const apiKeyUrl = selectedPreset.apiKeyUrl?.trim()
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
  const handleBaseUrlChange = (value: string) => {
    resetDiscovery()
    setBaseUrl(value)
  }
  const handleApiKeyChange = (value: string) => {
    resetDiscovery()
    setApiKey(value)
  }
  const handleApiFormatChange = (value: ApiFormat) => {
    resetDiscovery()
    setApiFormat(value)
  }
  const handleAuthStrategyChange = (value: ProviderAuthStrategy) => {
    resetDiscovery()
    setAuthStrategy(value)
  }
  const updateModels = (nextModels: ProviderModel[], nextFastModel = fastModel) => {
    const normalized = normalizeModels(nextModels)
    const validFastModel = normalized.some((model) => model.id === nextFastModel) ? nextFastModel : ''
    setModels(nextModels)
    setFastModel(validFastModel)
  }
  const moveModel = (index: number, offset: number) => {
    const nextModels = [...models]
    const [moved] = nextModels.splice(index, 1)
    if (!moved) return
    nextModels.splice(index + offset, 0, moved)
    updateModels(nextModels)
  }
  const handleModelOverrideChange = (modelId: string, draft: ModelOverrideDraft) => {
    setModelOverrideDrafts((current) => ({ ...current, [modelId]: draft }))
  }
  const handleRefreshModelInfo = async () => {
    if (!provider) return
    setIsRefreshingModelInfo(true)
    setModelInfoRefresh(null)
    try {
      const result = await refreshProviderModels(provider.id)
      setModelInfoRefresh(result.modelDiscovery ?? { ok: true })
    } catch (err) {
      setModelInfoRefresh({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setIsRefreshingModelInfo(false)
    }
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
      type="button"
      key={preset.id}
      onClick={() => handlePresetChange(preset)}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-left text-xs font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50 ${
        selectedPreset.id === preset.id
          ? 'border-primary bg-secondary text-primary ring-3 ring-ring/50'
          : 'border-border text-muted-foreground hover:border-ring hover:bg-hover'
      }`}
    >
      <ProviderIcon presetId={preset.id} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{getPresetDisplayName(preset, t)}</span>
    </button>
  )

  const handleSubmit = async () => {
    if (!canSubmit) return
    const normalizedModels = normalizeModels(models)
    const modelOverrides = buildModelOverrides(normalizedModels, modelOverrideDrafts)
    setIsSubmitting(true)
    setSaveError(null)
    try {
      let modelDiscovery: ProviderSaveResult['modelDiscovery']
      if (mode === 'create') {
        const result = await createProvider({
          presetId: selectedPreset.id,
          name: name.trim(),
          apiKey: apiKey.trim(),
          authStrategy,
          baseUrl: baseUrl.trim(),
          apiFormat,
          models: normalizedModels,
          ...(fastModel && { fastModel }),
          ...(Object.keys(modelOverrides).length > 0 && { modelOverrides }),
          notes: notes.trim() || undefined,
        })
        modelDiscovery = result.modelDiscovery
        await onCreated?.(result.provider)
      } else if (provider) {
        const input: UpdateProviderInput = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          authStrategy,
          apiFormat,
          models: normalizedModels,
          fastModel: fastModel || null,
          modelOverrides,
          notes: notes.trim() || undefined,
        }
        if (apiKey.trim()) input.apiKey = apiKey.trim()
        const result = await updateProvider(provider.id, input)
        modelDiscovery = result.modelDiscovery
      }
      await fetchSettings()
      if (modelDiscovery) {
        const key = mode === 'edit' ? 'settings.providers.savedModelDiscoveryFailed' : 'settings.providers.modelDiscoveryFailed'
        addToast({ type: 'warning', message: t(key, { error: modelDiscovery.error }) })
      } else if (mode === 'edit') {
        addToast({ type: 'info', message: t('settings.providers.modelRulesApplyLater') })
      }
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
          {saveError && (
            <p role="alert" className="mr-auto self-center text-xs text-destructive [overflow-wrap:anywhere]">
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
            <label className="text-sm font-medium text-foreground mb-2 block">{t('settings.providers.preset')}</label>
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
            <label htmlFor="provider-api-format" className="text-sm font-medium text-foreground mb-1 block">{t('settings.providers.apiFormat')}</label>
            <FormSelect id="provider-api-format" label={t('settings.providers.apiFormat')} options={apiFormatOptions} value={apiFormat} onChange={handleApiFormatChange} description={apiFormat !== 'anthropic' ? t('settings.providers.proxyHint') : undefined} />
          </div>
        ) : apiFormat !== 'anthropic' ? (
          <div>
            <label className="text-sm font-medium text-foreground mb-1 block">{t('settings.providers.apiFormat')}</label>
            <div className="text-xs text-subtle-foreground px-3 py-2 rounded-md bg-card border border-border">
              {apiFormat === 'openai_chat' ? t('settings.providers.apiFormatOpenaiChat') : t('settings.providers.apiFormatOpenaiResponses')}
            </div>
          </div>
        ) : null}

        {apiFormat === 'anthropic' && (
          <div>
            <label htmlFor="provider-auth-strategy" className="text-sm font-medium text-foreground mb-1 block">{t('settings.providers.authStrategy')}</label>
            <FormSelect id="provider-auth-strategy" label={t('settings.providers.authStrategy')} options={authStrategyOptions} value={authStrategy} onChange={handleAuthStrategyChange} description={authStrategyOptions.find((option) => option.value === authStrategy)?.description} />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="provider-api-key" className="text-sm font-medium text-foreground">
            {t('settings.providers.apiKey')}
            {mode === 'create' && requiresApiKey && <span className="text-destructive ml-0.5">*</span>}
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
          <button
            type="button"
            onClick={() => openExternalUrl(apiKeyUrl)}
            className="group -mt-2 inline-flex h-6 w-fit cursor-pointer items-center gap-1 rounded-sm border border-border bg-card px-1.5 text-2xs font-medium leading-none text-primary outline-none transition-colors hover:border-ring hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <KeyRoundIcon aria-hidden="true" size={13} />
            {t('settings.providers.getApiKey')}
            <ArrowUpRightIcon className="shrink-0 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" size={9} />
          </button>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-foreground">{t('settings.providers.models')}</label>
            <div className="flex flex-wrap justify-end gap-2">
              {mode === 'edit' && provider && showModelRules && (
                <Button variant="outline" size="sm" onClick={handleRefreshModelInfo} loading={isRefreshingModelInfo}>
                  {t('settings.providers.refreshModelInfo')}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleDiscoverModels} loading={isDiscovering} disabled={!baseUrl.trim()}>
                {t('settings.providers.fetchModels')}
              </Button>
            </div>
          </div>
          {modelInfoRefresh && !modelInfoRefresh.ok && (
            <p role="alert" className="mb-2 text-2xs text-warning [overflow-wrap:anywhere]">
              {t('settings.providers.modelDiscoveryFailed', { error: modelInfoRefresh.error })}
            </p>
          )}
          {modelInfoRefresh?.ok && (
            <p role="status" className="mb-2 text-2xs text-muted-foreground">{t('settings.providers.modelInfoRefreshed')}</p>
          )}
          {discoveryError && (
            <p role="alert" className="mb-2 text-2xs text-destructive">{discoveryError}</p>
          )}
          {models.length > 0 && apiFormat !== modelsApiFormat && (
            <p role="status" className="mb-2 text-2xs text-warning">{t('settings.providers.apiFormatChangedModels')}</p>
          )}
          {discoveryCount !== null && (
            <p role="status" className="mb-2 text-2xs text-muted-foreground">
              {discoveryCount > 0
                ? t('settings.providers.modelsFound', { count: discoveryCount })
                : t('settings.providers.noModelsReturned')}
            </p>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('settings.providers.modelId')}</label>
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
              const view = resolvedModels?.[model.id]
              return (
                <div key={model.id} data-testid={`model-card-${model.id}`} className="rounded-md border border-border bg-card p-2">
                  <div className="flex items-start gap-2">
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
                      <div className="mt-1 truncate text-2xs text-subtle-foreground">{model.id}</div>
                      {(index === 0 || view?.usedFallback) && (
                        <div className="mt-1 flex flex-wrap gap-x-2 text-2xs">
                          {index === 0 && <span className="font-medium text-primary">{t('settings.providers.defaultModel')}</span>}
                          {view?.usedFallback && <span className="text-muted-foreground">{t('settings.providers.usesGenericDefaults')}</span>}
                        </div>
                      )}
                      {model.name && duplicateModelNames.has(model.name.trim()) && (
                        <div className="mt-1 text-2xs text-warning">{t('settings.providers.duplicateDisplayName')}</div>
                      )}
                    </div>
                    <Button
                      variant="ghost-muted"
                      size="icon"
                      disabled={index === 0}
                      onClick={() => moveModel(index, -1)}
                      aria-label={t('settings.providers.moveModelUp')}
                    >
                      <ArrowUpIcon aria-hidden="true" size={18} />
                    </Button>
                    <Button
                      variant="ghost-muted"
                      size="icon"
                      disabled={index === models.length - 1}
                      onClick={() => moveModel(index, 1)}
                      aria-label={t('settings.providers.moveModelDown')}
                    >
                      <ArrowDownIcon aria-hidden="true" size={18} />
                    </Button>
                    <Button
                      variant="ghost-destructive"
                      size="icon"
                      onClick={() => updateModels(models.filter((_, candidateIndex) => candidateIndex !== index), fastModel === model.id ? '' : fastModel)}
                      aria-label={t('common.delete')}
                    >
                      <Trash2Icon aria-hidden="true" size={18} />
                    </Button>
                  </div>
                  {showModelRules && (
                    <ModelRulesEditor
                      modelId={model.id}
                      view={view}
                      saved={provider?.modelOverrides?.[model.id]}
                      draft={modelOverrideDrafts[model.id]}
                      onChange={(draft) => handleModelOverrideChange(model.id, draft)}
                    />
                  )}
                </div>
              )
            })}
          </div>
          {showModelRules && (
            <p className="mt-1 text-2xs text-subtle-foreground">
              {t('settings.providers.modelRulesDesc')}
            </p>
          )}
          <div className="mt-3">
            <label htmlFor="provider-fast-model" className="mb-1 block text-sm font-medium text-foreground">{t('settings.providers.fastModel')}</label>
            <FormSelect
              id="provider-fast-model"
              label={t('settings.providers.fastModel')}
              value={fastModel}
              onChange={setFastModel}
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
              <span className={`text-xs ${testResult.connectivity.success ? 'text-success' : 'text-destructive'}`}>
                {testResult.connectivity.success
                  ? t('settings.providers.connectivityOk', { latency: String(testResult.connectivity.latencyMs) })
                  : t('settings.providers.connectivityFailed', { error: testResult.connectivity.error || '' })}
              </span>
            </div>
          )}
        </div>

      </div>
    </Modal>
  )
}

export { ProviderFormModal }
export type { ProviderFormProps }
