import { useEffect } from 'react'
import { useClaudeCodeImportStore } from '../../stores/claudeCodeImportStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'

/** Import from Claude Code on the storage settings page, available at any time. */
export function ClaudeCodeImportSettings() {
  const t = useTranslation()
  const { status, job, error, fetchStatus, startImport } = useClaudeCodeImportStore()
  const running = job?.state === 'running'

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  if (!status) return null

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-border)]/70 bg-[var(--color-surface)] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('claudeCodeImport.settingsTitle')}</div>
          <div className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
            {status.claudeCodeDir
              ? t('claudeCodeImport.settingsDescription', { dir: status.claudeCodeDir })
              : t('claudeCodeImport.unavailable')}
          </div>
        </div>
        {status.claudeCodeDir && (
          <Button size="sm" variant="secondary" loading={running} disabled={running} onClick={() => void startImport()}>
            {t('claudeCodeImport.import')}
          </Button>
        )}
      </div>

      {running && (
        <div className="mt-2 text-xs text-[var(--color-text-secondary)]" role="status">
          {t('claudeCodeImport.progress', { done: job.copied + job.skipped, total: job.total })}
        </div>
      )}
      {job?.state === 'done' && (
        <div className="mt-2 text-xs text-[var(--color-text-secondary)]" role="status">
          {t('claudeCodeImport.doneBody', { copied: job.copied, skipped: job.skipped })}
        </div>
      )}
      {(error || job?.state === 'failed') && (
        <div className="mt-2 text-xs text-[var(--color-error)]" role="alert">
          {t('claudeCodeImport.failed')}{error ?? job?.error}
        </div>
      )}
    </div>
  )
}
