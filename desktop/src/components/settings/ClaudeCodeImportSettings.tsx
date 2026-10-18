import { useEffect } from 'react'
import { useClaudeCodeImportStore } from '../../stores/claudeCodeImportStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'
import { SettingsRow } from './SettingsRow'

/** Import from Claude Code as a row in General > Advanced, available at any time. */
export function ClaudeCodeImportSettings() {
  const t = useTranslation()
  const { status, job, error, fetchStatus, startImport } = useClaudeCodeImportStore()
  const running = job?.state === 'running'

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  if (!status) return null

  return (
    <SettingsRow
      title={t('claudeCodeImport.settingsTitle')}
      description={
        <>
          {status.claudeCodeDir
            ? t('claudeCodeImport.settingsDescription', { dir: status.claudeCodeDir })
            : t('claudeCodeImport.unavailable')}
          {running && (
            <span className="block text-[var(--color-text-secondary)]" role="status">
              {t('claudeCodeImport.progress', { done: job.copied + job.skipped, total: job.total })}
            </span>
          )}
          {job?.state === 'done' && (
            <span className="block text-[var(--color-text-secondary)]" role="status">
              {t('claudeCodeImport.doneBody', { copied: job.copied, skipped: job.skipped })}
            </span>
          )}
          {(error || job?.state === 'failed') && (
            <span className="block text-[var(--color-error)]" role="alert">
              {t('claudeCodeImport.failed')}{error ?? job?.error}
            </span>
          )}
        </>
      }
      control={
        status.claudeCodeDir ? (
          <Button size="xs" variant="secondary" loading={running} disabled={running} onClick={() => void startImport()}>
            {t('claudeCodeImport.importShort')}
          </Button>
        ) : null
      }
    />
  )
}
