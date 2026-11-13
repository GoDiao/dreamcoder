import { Plus, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from '../../i18n'
import { useDecisionProviderStore } from '../../stores/decisionProviderStore'
import type { ProviderTestResult, SavedDecisionProvider } from '../../types/provider'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { LoadingBlock } from '../shared/LoadingBlock'
import { Button } from '../shared/ui/button'
import { DecisionProviderFormModal } from './DecisionProviderFormModal'

function DecisionProviderSettingsSection() {
  const t = useTranslation()
  const {
    providers,
    presets,
    isLoading,
    fetchProviders,
    fetchPresets,
    deleteProvider,
    testProvider,
  } = useDecisionProviderStore()
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<SavedDecisionProvider | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SavedDecisionProvider | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result?: ProviderTestResult }>>({})

  useEffect(() => {
    void fetchProviders()
    void fetchPresets()
  }, [fetchPresets, fetchProviders])

  const handleTest = async (provider: SavedDecisionProvider) => {
    setTestResults((current) => ({ ...current, [provider.id]: { loading: true } }))
    try {
      const result = await testProvider(provider.id)
      setTestResults((current) => ({ ...current, [provider.id]: { loading: false, result } }))
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [provider.id]: {
          loading: false,
          result: {
            connectivity: {
              success: false,
              latencyMs: 0,
              error: error instanceof Error ? error.message : String(error),
            },
          },
        },
      }))
    }
  }

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {t('settings.decisionProviders.title')}
          </h3>
          <p className="mt-1 max-w-[70ch] text-xs leading-[1.6] text-[var(--color-text-secondary)]">
            {t('settings.decisionProviders.description')}
          </p>
        </div>
        <Button variant="outline" size="xs" onClick={() => setShowCreate(true)} disabled={presets.length === 0}>
          <Plus data-icon="inline-start" size={13} aria-hidden="true" />
          {t('settings.decisionProviders.add')}
        </Button>
      </div>

      {isLoading && providers.length === 0 ? (
        <LoadingBlock className="py-8" />
      ) : providers.length === 0 ? (
        <p className="py-5 text-xs text-[var(--color-text-tertiary)]">{t('settings.decisionProviders.empty')}</p>
      ) : (
        <div className="flex flex-col">
          {providers.map((provider) => {
            const test = testResults[provider.id]
            return (
              <div key={provider.id} className="flex min-w-0 items-center justify-between gap-[18px] border-b border-[var(--color-border-separator)] py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck size={15} className="text-[var(--color-text-secondary)]" aria-hidden="true" />
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">{provider.name}</span>
                    <span className="rounded-[4px] bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                      {provider.deployment === 'local' ? t('settings.decisionProviders.local') : t('settings.decisionProviders.hosted')}
                    </span>
                  </div>
                  <p className="mt-px truncate text-xs text-[var(--color-text-secondary)]">
                    {provider.baseUrl} · {provider.models[0]?.name ?? provider.models[0]?.id}
                  </p>
                  {test?.result && (
                    <p className={`mt-px text-xs ${test.result.connectivity.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                      {test.result.connectivity.success
                        ? t('settings.providers.connectivityOk', { latency: String(test.result.connectivity.latencyMs) })
                        : t('settings.providers.connectivityFailed', { error: test.result.connectivity.error ?? '' })}
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
                  <Button variant="outline" size="xs" onClick={() => handleTest(provider)} loading={test?.loading}>{t('settings.providers.test')}</Button>
                  <Button variant="outline" size="xs" onClick={() => setEditing(provider)}>{t('settings.providers.edit')}</Button>
                  <Button variant="outline" size="xs" className="text-[var(--color-error)] hover:text-[var(--color-error)]" onClick={() => setPendingDelete(provider)}>{t('common.delete')}</Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showCreate && <DecisionProviderFormModal open onClose={() => setShowCreate(false)} presets={presets} />}
      {editing && <DecisionProviderFormModal key={editing.id} open onClose={() => setEditing(null)} provider={editing} presets={presets} />}
      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return
          await deleteProvider(pendingDelete.id)
          setPendingDelete(null)
        }}
        title={t('common.delete')}
        body={pendingDelete ? t('settings.decisionProviders.confirmDelete', { name: pendingDelete.name }) : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="destructive"
      />
    </section>
  )
}

export { DecisionProviderSettingsSection }
