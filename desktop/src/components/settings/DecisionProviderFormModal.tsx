import { Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { useDecisionProviderStore } from '../../stores/decisionProviderStore'
import type {
  DecisionProviderFormat,
  DecisionProviderPreset,
  DecisionProviderPresetId,
  ProviderModel,
  ProviderTestResult,
  SavedDecisionProvider,
} from '../../types/provider'
import { FormSelect } from '../shared/FormSelect'
import { LabeledInput } from '../shared/LabeledInput'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/ui/button'
import { ModelDiscoveryCombobox } from './ModelDiscoveryCombobox'

type Props = {
  open: boolean
  onClose: () => void
  provider?: SavedDecisionProvider
  presets: DecisionProviderPreset[]
}

const FORMAT_OPTIONS: DecisionProviderFormat[] = [
  'openai_decisions',
  'openrouter_decisions',
  'openai_chat',
  'ollama_chat',
]

function initialModels(
  provider: SavedDecisionProvider | undefined,
  preset: DecisionProviderPreset | undefined,
): ProviderModel[] {
  const configured = provider?.models ?? preset?.models ?? []
  return configured.map((model) => ({ ...model }))
}

function DecisionProviderFormModal({ open, onClose, provider, presets }: Props) {
  const t = useTranslation()
  const createProvider = useDecisionProviderStore((state) => state.createProvider)
  const updateProvider = useDecisionProviderStore((state) => state.updateProvider)
  const discoverModels = useDecisionProviderStore((state) => state.discoverModels)
  const testConfig = useDecisionProviderStore((state) => state.testConfig)
  const initialPreset = presets.find((entry) => entry.id === provider?.presetId) ?? presets[0]
  const [presetId, setPresetId] = useState<DecisionProviderPresetId>(initialPreset?.id ?? 'openai')
  const [name, setName] = useState(provider?.name ?? initialPreset?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? initialPreset?.baseUrl ?? '')
  const [apiFormat, setApiFormat] = useState<DecisionProviderFormat>(provider?.apiFormat ?? initialPreset?.apiFormat ?? 'openai_decisions')
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? '')
  const configuredModels = initialModels(provider, initialPreset)
  const [models, setModels] = useState<ProviderModel[]>(configuredModels)
  const [discoveredModels, setDiscoveredModels] = useState<ProviderModel[]>(configuredModels)
  const [newModelId, setNewModelId] = useState('')
  const [saving, setSaving] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applyPreset = (nextId: DecisionProviderPresetId) => {
    const preset = presets.find((entry) => entry.id === nextId)
    setPresetId(nextId)
    if (!preset) return
    setName(preset.name)
    setBaseUrl(preset.baseUrl)
    setApiFormat(preset.apiFormat)
    setModels(preset.models.map((model) => ({ ...model })))
    setDiscoveredModels(preset.models.map((model) => ({ ...model })))
    setNewModelId('')
    setTestResult(null)
  }

  const handleDiscover = async () => {
    setDiscovering(true)
    setError(null)
    try {
      const discovered = await discoverModels({ presetId, baseUrl, apiKey, apiFormat })
      setDiscoveredModels(discovered)
      setModels((current) => current.map((model) => (
        discovered.find((candidate) => candidate.id === model.id) ?? model
      )))
      setNewModelId('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDiscovering(false)
    }
  }

  const handleAddModel = () => {
    const id = newModelId.trim()
    if (!id || models.some((model) => model.id === id)) return
    const discovered = discoveredModels.find((model) => model.id === id)
    setModels((current) => [...current, discovered ?? { id }])
    setNewModelId('')
  }

  const handleTest = async () => {
    if (!models[0]) return
    setTesting(true)
    setError(null)
    try {
      setTestResult(await testConfig({ baseUrl, apiKey, apiFormat, modelId: models[0].id }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim() || !baseUrl.trim() || models.length === 0) return
    setSaving(true)
    setError(null)
    try {
      const input = {
        presetId,
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiFormat,
        apiKey,
        models,
      }
      if (provider) await updateProvider(provider.id, input)
      else await createProvider(input)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={provider ? t('settings.decisionProviders.editTitle') : t('settings.decisionProviders.addTitle')}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} loading={saving} disabled={!name.trim() || !baseUrl.trim() || models.length === 0}>
            {t('common.save')}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-primary)]">
            {t('settings.decisionProviders.preset')}
          </label>
          <FormSelect
            value={presetId}
            onChange={applyPreset}
            label={t('settings.decisionProviders.preset')}
            options={presets.map((entry) => ({ value: entry.id, label: entry.name }))}
          />
        </div>
        <LabeledInput label={t('settings.decisionProviders.name')} value={name} onChange={(event) => setName(event.target.value)} />
        <LabeledInput label={t('settings.decisionProviders.baseUrl')} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-primary)]">
            {t('settings.decisionProviders.apiFormat')}
          </label>
          <FormSelect
            value={apiFormat}
            onChange={(value) => {
              setApiFormat(value)
              setDiscoveredModels([])
              setNewModelId('')
            }}
            label={t('settings.decisionProviders.apiFormat')}
            options={FORMAT_OPTIONS.map((value) => ({ value, label: value }))}
          />
        </div>
        <LabeledInput
          label={t('settings.decisionProviders.apiKey')}
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={apiFormat === 'ollama_chat' ? t('settings.decisionProviders.apiKeyOptional') : ''}
        />
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.decisionProviders.models')}</label>
            <Button variant="outline" size="xs" onClick={handleDiscover} loading={discovering}>
              {t('settings.decisionProviders.fetchModels')}
            </Button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">{t('settings.providers.modelId')}</label>
              <ModelDiscoveryCombobox
                models={discoveredModels}
                value={newModelId}
                onChange={setNewModelId}
                onSelect={(model) => setNewModelId(model.id)}
                label={t('settings.providers.modelId')}
                placeholder={t('settings.providers.modelIdPlaceholder')}
                useCustomLabel={(id) => t('settings.providers.useCustomModel', { id })}
              />
            </div>
            <Button
              variant="outline"
              onClick={handleAddModel}
              disabled={!newModelId.trim() || models.some((model) => model.id === newModelId.trim())}
            >
              {t('common.add')}
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {models.map((model) => (
              <div key={model.id} className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{model.name || model.id}</div>
                  {model.name && <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">{model.id}</div>}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setModels((current) => current.filter((entry) => entry.id !== model.id))}
                  aria-label={t('common.delete')}
                  className="text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]"
                >
                  <Trash2Icon aria-hidden="true" size={18} />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="xs" onClick={handleTest} loading={testing} disabled={models.length === 0}>
            {t('settings.providers.test')}
          </Button>
        </div>
        {testResult && (
          <p className={`text-xs ${testResult.connectivity.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
            {testResult.connectivity.success
              ? t('settings.providers.connectivityOk', { latency: String(testResult.connectivity.latencyMs) })
              : t('settings.providers.connectivityFailed', { error: testResult.connectivity.error ?? '' })}
          </p>
        )}
        {error && <p role="alert" className="text-xs text-[var(--color-error)]">{error}</p>}
      </div>
    </Modal>
  )
}

export { DecisionProviderFormModal }
