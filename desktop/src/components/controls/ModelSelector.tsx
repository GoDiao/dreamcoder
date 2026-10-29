import { Fragment, useEffect, useMemo, useRef } from 'react'
import { OFFICIAL_DEFAULT_MODEL_ID } from '../../constants/modelCatalog'
import { useTranslation } from '../../i18n'
import { useChatStore, useSessionRuntimeSelection } from '../../stores/chatStore'
import { useProviderStore } from '../../stores/providerStore'
import { DRAFT_RUNTIME_SELECTION_KEY, useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { SavedProvider } from '../../types/provider'
import type { RuntimeSelection } from '../../types/runtime'
import type { EffortLevel, ModelInfo } from '../../types/settings'
import { cn } from '../../lib/utils'
import { Tooltip } from '../shared/Tooltip'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '../shared/ui/select'
import { PICKER_TRIGGER_CLASS } from './controlStyles'

const SELECT_TRIGGER_CLASS = cn(PICKER_TRIGGER_CLASS, 'w-auto justify-between border-0 py-0 pl-1.5 pr-1 data-[size=sm]:rounded-[7px]')

function runtimeOptionKey(providerId: string | null, modelId: string) {
  return JSON.stringify([providerId, modelId])
}

type ProviderChoice = {
  providerId: string
  providerName: string
  isDefault: boolean
  models: ModelInfo[]
}

type Props = {
  runtimeSelection?: RuntimeSelection
  onRuntimeSelectionChange?: (selection: RuntimeSelection) => void
  runtimeKey?: string
  disabled?: boolean
  compact?: boolean
}

function buildProviderModels(
  provider: SavedProvider,
): ModelInfo[] {
  return provider.models.map((model) => ({
    id: model.id,
    name: model.name || model.id,
    description: model.name ? model.id : '',
    context: '',
  }))
}

function buildProviderChoices(
  providers: SavedProvider[],
  activeId: string | null,
): ProviderChoice[] {
  return providers.map((provider) => ({
    providerId: provider.id,
    providerName: provider.name,
    isDefault: provider.id === activeId,
    models: buildProviderModels(provider),
  }))
}

function resolveDefaultRuntimeSelection(
  activeId: string | null,
  activeProviderName: string | null,
  providers: SavedProvider[],
  currentModelId: string | undefined,
): RuntimeSelection {
  const inferredProviderId = activeId ?? (
    activeProviderName
      ? providers.find((provider) => provider.name === activeProviderName)?.id ?? null
      : null
  )

  return {
    providerId: inferredProviderId,
    modelId: currentModelId ?? OFFICIAL_DEFAULT_MODEL_ID,
  }
}

export function ModelSelector({
  runtimeSelection: controlledRuntimeSelection,
  onRuntimeSelectionChange,
  runtimeKey,
  disabled = false,
  compact = false,
}: Props = {}) {
  const t = useTranslation()
  const storeModel = useSettingsStore((state) => state.currentModel)
  const effortLevel = useSettingsStore((state) => state.effortLevel)
  const activeProviderName = useSettingsStore((state) => state.activeProviderName)
  const providers = useProviderStore((state) => state.providers)
  const activeId = useProviderStore((state) => state.activeId)
  const providersLoading = useProviderStore((state) => state.isLoading)
  const fetchProviders = useProviderStore((state) => state.fetchProviders)
  const draftRuntimeSelection = useSessionRuntimeStore((state) =>
    runtimeKey === DRAFT_RUNTIME_SELECTION_KEY ? state.selections[runtimeKey] : undefined,
  )
  const sessionSelection = useSessionRuntimeSelection(
    runtimeKey && runtimeKey !== DRAFT_RUNTIME_SELECTION_KEY ? runtimeKey : null,
  )
  const runtimeSelection = draftRuntimeSelection ?? sessionSelection
  const requestedProvidersRef = useRef(false)

  const EFFORT_OPTIONS: { value: EffortLevel; label: string }[] = [
    { value: 'low', label: t('settings.general.effort.low') },
    { value: 'medium', label: t('settings.general.effort.medium') },
    { value: 'high', label: t('settings.general.effort.high') },
    { value: 'max', label: t('settings.general.effort.max') },
  ]

  useEffect(() => {
    if (providersLoading || requestedProvidersRef.current) return
    requestedProvidersRef.current = true
    void fetchProviders()
  }, [fetchProviders, providersLoading])

  const providerChoices = useMemo(
    () => buildProviderChoices(
      providers,
      activeId,
    ),
    [activeId, providers],
  )

  const explicitRuntimeSelection = controlledRuntimeSelection ?? runtimeSelection
  const activeRuntimeSelection: RuntimeSelection = explicitRuntimeSelection?.modelId
    ? explicitRuntimeSelection
    : {
        ...resolveDefaultRuntimeSelection(activeId, activeProviderName, providers, storeModel?.id),
        ...(explicitRuntimeSelection?.effort ? { effort: explicitRuntimeSelection.effort } : {}),
      }

  const selectedProviderChoice = providerChoices.find((choice) => choice.providerId === activeRuntimeSelection.providerId) ?? null
  const selectedRuntimeModel = selectedProviderChoice?.models.find((model) => model.id === activeRuntimeSelection.modelId)
    ?? {
      id: activeRuntimeSelection.modelId,
      name: activeRuntimeSelection.modelId,
      description: '',
      context: '',
    }

  const buttonModelLabel = selectedRuntimeModel.name
  const buttonProviderLabel = selectedProviderChoice?.providerName ?? activeProviderName ?? t('model.noProvider')

  const selectedEffort: EffortLevel = activeRuntimeSelection.effort ?? effortLevel
  const selectedEffortLabel = EFFORT_OPTIONS.find((option) => option.value === selectedEffort)?.label
  const triggerTitle = [buttonModelLabel, buttonProviderLabel].filter(Boolean).join('\n')

  const handleRuntimeSelect = (selection: RuntimeSelection) => {
    onRuntimeSelectionChange?.(selection)
    if (runtimeKey === DRAFT_RUNTIME_SELECTION_KEY) {
      useSessionRuntimeStore.getState().setSelection(runtimeKey, selection)
    } else if (runtimeKey) {
      useChatStore.getState().setSessionRuntime(runtimeKey, selection)
    }
  }

  const handleModelChange = (key: string) => {
    for (const choice of providerChoices) {
      const model = choice.models.find((candidate) => runtimeOptionKey(choice.providerId, candidate.id) === key)
      if (model) {
        handleRuntimeSelect({
          providerId: choice.providerId,
          modelId: model.id,
          ...(activeRuntimeSelection.effort ? { effort: activeRuntimeSelection.effort } : {}),
        })
        return
      }
    }
  }

  const handleEffortChange = (effort: EffortLevel) => {
    handleRuntimeSelect(explicitRuntimeSelection?.modelId
      ? { ...explicitRuntimeSelection, effort }
      : { providerId: null, modelId: '', effort })
  }

  const selectedModelKey = runtimeOptionKey(activeRuntimeSelection.providerId, activeRuntimeSelection.modelId)

  return (
    <>
      <Select value={selectedModelKey} onValueChange={handleModelChange} disabled={disabled}>
        <Tooltip content={triggerTitle}>
          <SelectTrigger size="sm" aria-label={`${t('model.selectModel')}: ${buttonModelLabel}`} className={cn(SELECT_TRIGGER_CLASS, compact ? 'max-w-[132px]' : 'max-w-[260px]')}>
            <SelectValue>{buttonModelLabel}</SelectValue>
          </SelectTrigger>
        </Tooltip>
        <SelectContent position="popper" align="start" collisionPadding={8} className="min-w-56">
          {providerChoices.map((choice, index) => (
            <Fragment key={choice.providerId}>
              {index > 0 && <SelectSeparator />}
              <SelectGroup>
                <SelectLabel>
                  {choice.providerName}
                  {choice.isDefault && <span className="ml-1.5 font-normal opacity-70">{t('settings.providers.default')}</span>}
                </SelectLabel>
                {choice.models.map((model) => (
                  <SelectItem key={model.id} value={runtimeOptionKey(choice.providerId, model.id)}>{model.name}</SelectItem>
                ))}
              </SelectGroup>
            </Fragment>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedEffort} onValueChange={(next) => handleEffortChange(next as EffortLevel)} disabled={disabled}>
        <SelectTrigger size="sm" aria-label={`${t('model.effort')}: ${selectedEffortLabel}`} className={SELECT_TRIGGER_CLASS}>
          <SelectValue>{compact ? selectedEffortLabel : `${t('model.effort')} ${selectedEffortLabel}`}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start" collisionPadding={8}>
          <SelectGroup>
            {EFFORT_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  )
}
