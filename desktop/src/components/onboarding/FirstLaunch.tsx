import { useRef, useState } from 'react'
import { Check, Download, LoaderCircle } from 'lucide-react'
import { useClaudeCodeImportStore } from '../../stores/claudeCodeImportStore'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/ui/button'
import { DreamCoderIcon } from '../shared/DreamCoderIcon'
import { ProviderFormModal } from '../settings/ProviderFormModal'
import type { SavedProvider } from '../../types/provider'

/**
 * The single first-launch screen: an optional "import from Claude Code" row,
 * then adding a provider or setting up later. Once a default provider exists
 * (for example from the import) only "Get started" is left.
 */
export function FirstLaunch({ onFinish }: { onFinish: () => void }) {
  const t = useTranslation()
  const { status, job, error: importError, startImport, skip } = useClaudeCodeImportStore()
  const activeId = useProviderStore((s) => s.activeId)
  const presets = useProviderStore((s) => s.presets)
  const isPresetsLoading = useProviderStore((s) => s.isPresetsLoading)
  const setOnboardingCompleted = useSettingsStore((s) => s.setOnboardingCompleted)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [presetsError, setPresetsError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const createdRef = useRef(false)

  const showImport = !!status?.offer || !!job
  const running = job?.state === 'running'
  const done = job?.state === 'done'
  const failure = importError ?? (job?.state === 'failed' ? job.error ?? '' : null)
  const busy = running || finishing

  const finish = async (options?: { skipImport?: boolean }) => {
    setFinishing(true)
    setOnboardingCompleted()
    const importUndecided = !!useClaudeCodeImportStore.getState().status?.offer && !useClaudeCodeImportStore.getState().job
    if (options?.skipImport && importUndecided) await skip()
    onFinish()
  }

  const openProviderForm = async () => {
    setPresetsError(null)
    if (useProviderStore.getState().presets.length === 0) {
      await useProviderStore.getState().fetchPresets()
      const { presets: loaded, error } = useProviderStore.getState()
      if (loaded.length === 0) {
        setPresetsError(error ?? '')
        return
      }
    }
    setShowCreateModal(true)
  }

  const handleCreated = async (provider: SavedProvider) => {
    await useProviderStore.getState().activateProvider(provider.id)
    createdRef.current = true
  }

  const handleModalClose = () => {
    setShowCreateModal(false)
    if (createdRef.current) void finish()
  }

  let importStatus
  if (running) {
    importStatus = (
      <span role="status" className="inline-flex items-center gap-1.5 whitespace-nowrap text-ui-aux text-[var(--color-text-secondary)]">
        <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
        {t('firstLaunch.importProgress', {
          done: (job.copied + job.skipped).toLocaleString(),
          total: job.total.toLocaleString(),
        })}
      </span>
    )
  } else if (done) {
    importStatus = (
      <span role="status" className="inline-flex items-center gap-1.5 whitespace-nowrap text-ui-aux text-[var(--color-success)]">
        <Check size={14} aria-hidden="true" />
        {t('firstLaunch.importDone')}
      </span>
    )
  } else {
    importStatus = (
      <Button size="xs" variant="outline" disabled={finishing} onClick={() => void startImport()}>
        {t('firstLaunch.importAction')}
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[var(--color-surface)] p-6">
      <div className="w-full max-w-[400px] text-center">
        <DreamCoderIcon size={56} className="mx-auto mb-[22px]" />
        <h1 className="mb-2.5 text-[22px] font-semibold text-[var(--color-text-primary)]">
          {t('onboarding.welcome')}
        </h1>
        <p className="mb-6 text-ui-body leading-[1.7] text-[var(--color-text-secondary)]">
          {t('onboarding.tagline')}
        </p>

        {showImport && (
          <div className="mb-[18px] flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-3 pl-3.5 pr-3 text-left">
            <Download size={18} className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <strong className="text-ui-nav font-semibold text-[var(--color-text-primary)]">
                {t('firstLaunch.importTitle')}
              </strong>
              <span className="text-ui-aux leading-[1.55] text-[var(--color-text-secondary)]">
                {done
                  ? t('firstLaunch.importDoneDescription', {
                    copied: job.copied.toLocaleString(),
                    skipped: job.skipped.toLocaleString(),
                  })
                  : t('firstLaunch.importDescription', { dir: status?.claudeCodeDir ?? '~/.claude' })}
              </span>
              {failure !== null && !running && (
                <span role="alert" className="text-ui-aux leading-[1.55] text-[var(--color-error)]">
                  {t('claudeCodeImport.failed')}{failure}
                </span>
              )}
            </div>
            {importStatus}
          </div>
        )}

        <div className="grid gap-2">
          {activeId ? (
            <Button className="h-[38px] w-full" disabled={busy} onClick={() => void finish()}>
              {t('firstLaunch.start')}
            </Button>
          ) : (
            <>
              <Button
                className="h-[38px] w-full"
                disabled={busy}
                loading={isPresetsLoading && presets.length === 0}
                onClick={() => void openProviderForm()}
              >
                {t('settings.providers.addProvider')}
              </Button>
              <Button className="h-[38px] w-full" variant="ghost" disabled={busy} onClick={() => void finish({ skipImport: true })}>
                {t('onboarding.setUpLater')}
              </Button>
            </>
          )}
          {presetsError !== null && (
            <p role="alert" className="text-ui-aux text-[var(--color-error)]">
              {t('onboarding.presetsLoadFailed')}{presetsError}
            </p>
          )}
        </div>
      </div>

      {showCreateModal && (
        <ProviderFormModal
          open={true}
          onClose={handleModalClose}
          mode="create"
          presets={presets}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
