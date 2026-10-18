import { useClaudeCodeImportStore } from '../../stores/claudeCodeImportStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'
import { DreamCoderIcon } from '../shared/DreamCoderIcon'

/**
 * First-launch offer to import sessions and settings from Claude Code, shown
 * when DreamCoder's directory is empty and Claude Code's has data.
 */
export function ClaudeCodeImport() {
  const t = useTranslation()
  const { status, job, error, startImport, skip, closePrompt } = useClaudeCodeImportStore()
  const running = job?.state === 'running'
  const done = job?.state === 'done'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-surface)]">
      <div className="w-full max-w-md p-8 text-center">
        <DreamCoderIcon size={80} className="mx-auto mb-6" />
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2" style={{ fontFamily: 'var(--font-headline)' }}>
          {done ? t('claudeCodeImport.doneTitle') : t('claudeCodeImport.title')}
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-8">
          {done
            ? t('claudeCodeImport.doneBody', { copied: job.copied, skipped: job.skipped })
            : t('claudeCodeImport.body', { dir: status?.claudeCodeDir ?? '~/.claude' })}
        </p>

        {running && (
          <p className="mb-6 text-sm text-[var(--color-text-secondary)]" role="status">
            {t('claudeCodeImport.progress', { done: job.copied + job.skipped, total: job.total })}
          </p>
        )}

        {(error || job?.state === 'failed') && (
          <p role="alert" className="mb-6 text-sm text-[var(--color-error)]">
            {t('claudeCodeImport.failed')}{error ?? job?.error}
          </p>
        )}

        <div className="space-y-3">
          {done ? (
            <Button className="w-full" onClick={closePrompt}>
              {t('claudeCodeImport.continue')}
            </Button>
          ) : (
            <>
              <Button className="w-full" loading={running} disabled={running} onClick={() => void startImport()}>
                {t('claudeCodeImport.import')}
              </Button>
              <Button className="w-full" variant="ghost" disabled={running} onClick={() => void skip()}>
                {t('claudeCodeImport.skip')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
