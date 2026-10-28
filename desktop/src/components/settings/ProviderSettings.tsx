import { useState, useEffect, useMemo } from 'react'
import { LoadingBlock } from '../shared/LoadingBlock'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/ui/button'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import type { SavedProvider, ProviderTestResult } from '../../types/provider'
import { ProviderFormModal } from './ProviderFormModal'
import { ProviderIcon } from './ProviderIcon'
import { SettingsPageHeader } from './SettingsPageHeader'
import { Plus } from 'lucide-react'

function ProviderSettings() {
  const {
    providers,
    activeId,
    hasLoadedProviders,
    presets,
    isLoading,
    isPresetsLoading,
    fetchProviders,
    fetchPresets,
    deleteProvider,
    activateProvider,
    testProvider,
  } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()
  const [editingProvider, setEditingProvider] = useState<SavedProvider | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [pendingDeleteProvider, setPendingDeleteProvider] = useState<SavedProvider | null>(null)
  const [isDeletingProvider, setIsDeletingProvider] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result?: ProviderTestResult }>>({})

  useEffect(() => {
    void fetchProviders()
    void fetchPresets()
  }, [fetchPresets, fetchProviders])

  const presetMap = useMemo(
    () => new Map(presets.map((preset) => [preset.id, preset])),
    [presets],
  )

  const handleDelete = async (provider: SavedProvider) => {
    if (activeId === provider.id) return
    setPendingDeleteProvider(provider)
  }

  const confirmDelete = async () => {
    if (!pendingDeleteProvider) return
    setIsDeletingProvider(true)
    try {
      await deleteProvider(pendingDeleteProvider.id)
      setPendingDeleteProvider(null)
    } catch (error) {
      console.error(error)
    } finally {
      setIsDeletingProvider(false)
    }
  }

  const handleTest = async (provider: SavedProvider) => {
    setTestResults((r) => ({ ...r, [provider.id]: { loading: true } }))
    try {
      const result = await testProvider(provider.id)
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result } }))
    } catch {
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result: { connectivity: { success: false, latencyMs: 0, error: t('settings.providers.requestFailed') } } } }))
    }
  }

  const handleActivate = async (id: string) => {
    await activateProvider(id)
    await fetchSettings()
  }

  const isProviderNotConfigured = hasLoadedProviders && activeId === null && providers.length > 0

  return (
    <div className="min-w-0">
      <SettingsPageHeader
        title={t('settings.providers.title')}
        description={t('settings.providers.description')}
        actions={
          <Button
            size="xs"
            variant="outline"
            onClick={() => setShowCreateModal(true)}
            disabled={isPresetsLoading || presets.length === 0}
          >
            <Plus data-icon="inline-start" size={13} aria-hidden="true" />
            {t('settings.providers.addProvider')}
          </Button>
        }
      />

      {isProviderNotConfigured && (
        <p
          data-testid="provider-settings-no-default"
          role="status"
          className="mb-3 rounded-[8px] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-xs leading-[1.5] text-[var(--color-text-secondary)]"
        >
          {t('chat.providerRequired.noDefault')}
        </p>
      )}

      {isLoading && providers.length === 0 ? (
        <LoadingBlock className="py-8" />
      ) : hasLoadedProviders && providers.length === 0 ? (
        <p className="py-6 text-xs text-[var(--color-text-tertiary)]">{t('settings.providers.empty')}</p>
      ) : (
        <div className="flex flex-col">
          {providers.map((provider) => {
            const isActive = activeId === provider.id
            const test = testResults[provider.id]
            const preset = presetMap.get(provider.presetId)
            return (
              <div
                key={provider.id}
                className="flex min-w-0 items-center justify-between gap-[18px] border-b border-[var(--color-border-separator)] py-2.5"
              >
                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <div className="flex flex-wrap items-center gap-[9px]">
                    <span className="inline-flex min-w-0 max-w-full items-start gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                      <ProviderIcon presetId={provider.presetId} className="mt-0.5" />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{provider.name}</span>
                    </span>
                    {isActive && (
                      <span className="rounded-[4px] bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">{t('settings.providers.default')}</span>
                    )}
                    {preset && preset.id !== 'custom' && (
                      <span className="rounded-[4px] bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">{preset.name}</span>
                    )}
                    {provider.apiFormat && provider.apiFormat !== 'anthropic' && (
                      <span className="rounded-[4px] bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--color-warning)]">
                        {provider.apiFormat === 'openai_chat' ? 'OpenAI Chat' : 'OpenAI Responses'}
                      </span>
                    )}
                  </div>
                  <div className="mt-px truncate text-xs leading-[1.5] text-[var(--color-text-secondary)]">
                    {provider.baseUrl} &middot; {provider.models[0]?.name || provider.models[0]?.id}
                  </div>
                  {test && !test.loading && test.result && (
                    <div
                      className={`mt-px text-xs leading-[1.5] ${test.result.connectivity.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}
                    >
                      {test.result.connectivity.success
                        ? t('settings.providers.connectivityOk', { latency: String(test.result.connectivity.latencyMs) })
                        : t('settings.providers.connectivityFailed', { error: test.result.connectivity.error || '' })}
                    </div>
                  )}
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
                  {!isActive && (
                    <Button variant="outline" size="xs" onClick={() => handleActivate(provider.id)}>{t('settings.providers.setDefault')}</Button>
                  )}
                  <Button variant="outline" size="xs" onClick={() => handleTest(provider)} loading={test?.loading}>{t('settings.providers.test')}</Button>
                  <Button variant="outline" size="xs" onClick={() => setEditingProvider(provider)}>{t('settings.providers.edit')}</Button>
                  {!isActive && (
                    <Button variant="outline" size="xs" onClick={() => handleDelete(provider)} className="text-[var(--color-error)] hover:text-[var(--color-error)]">{t('common.delete')}</Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showCreateModal && (
        <ProviderFormModal open={true} onClose={() => setShowCreateModal(false)} mode="create" presets={presets} />
      )}

      {editingProvider && (
        <ProviderFormModal key={editingProvider.id} open={true} onClose={() => setEditingProvider(null)} mode="edit" provider={editingProvider} presets={presets} />
      )}

      <ConfirmDialog
        open={pendingDeleteProvider !== null}
        onClose={() => {
          if (isDeletingProvider) return
          setPendingDeleteProvider(null)
        }}
        onConfirm={confirmDelete}
        title={t('common.delete')}
        body={pendingDeleteProvider ? t('settings.providers.confirmDelete', { name: pendingDeleteProvider.name }) : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="destructive"
        loading={isDeletingProvider}
      />
    </div>
  )
}

export { ProviderSettings }
