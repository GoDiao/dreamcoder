import { useCallback, useMemo, useState } from 'react'
import { sessionsApi, type SessionTurnCheckpoint } from '../../api/sessions'
import { useTranslation } from '../../i18n'
import { WorkspaceDiffSurface } from '../workspace/WorkspaceCodeSurface'

type DiffPreviewState = {
  loading: boolean
  diff?: string
  error?: string
}

type CurrentTurnChangeCardProps = {
  sessionId: string
  targetUserMessageId: string
  checkpoint: SessionTurnCheckpoint
  workDir: string | null
  error: string | null
  isUndoing: boolean
  isLatest: boolean
  onUndo: () => void
}

type ChangedFileEntry = {
  apiPath: string
  displayPath: string
}

export function CurrentTurnChangeCard({
  sessionId,
  targetUserMessageId,
  checkpoint,
  workDir,
  error,
  isUndoing,
  isLatest,
  onUndo,
}: CurrentTurnChangeCardProps) {
  const t = useTranslation()
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [diffByPath, setDiffByPath] = useState<Record<string, DiffPreviewState>>({})

  const files = useMemo<ChangedFileEntry[]>(
    () => checkpoint.code.filesChanged.map((filePath) => ({
      apiPath: filePath,
      displayPath: relativizeWorkspacePath(filePath, workDir),
    })),
    [checkpoint.code.filesChanged, workDir],
  )

  const toggleDiff = useCallback((fileEntry: ChangedFileEntry) => {
    const nextExpandedPath = expandedPath === fileEntry.apiPath ? null : fileEntry.apiPath
    setExpandedPath(nextExpandedPath)
    if (!nextExpandedPath || diffByPath[fileEntry.apiPath]?.diff || diffByPath[fileEntry.apiPath]?.loading) {
      return
    }

    setDiffByPath((current) => ({
      ...current,
      [fileEntry.apiPath]: { loading: true },
    }))

    void sessionsApi
      .getTurnCheckpointDiff(
        sessionId,
        targetUserMessageId,
        fileEntry.apiPath,
        checkpoint.target.userMessageIndex,
      )
      .then((result) => {
        setDiffByPath((current) => ({
          ...current,
          [fileEntry.apiPath]: {
            loading: false,
            diff: result.state === 'ok' ? result.diff || '' : undefined,
            error: result.state === 'ok'
              ? undefined
              : result.error || t('chat.turnChangesDiffUnavailable'),
          },
        }))
      })
      .catch((diffError) => {
        setDiffByPath((current) => ({
          ...current,
          [fileEntry.apiPath]: {
            loading: false,
            error: diffError instanceof Error
              ? diffError.message
              : String(diffError),
          },
        }))
      })
  }, [diffByPath, expandedPath, sessionId, t, targetUserMessageId])

  const cardLabel = isLatest
    ? t('chat.turnChangesLatestCardLabel')
    : t('chat.turnChangesHistoricalCardLabel')
  const subtitle = isLatest
    ? t('chat.turnChangesLatestSubtitle')
    : t('chat.turnChangesHistoricalSubtitle')
  const undoLabel = isLatest
    ? t('chat.turnChangesLatestUndo')
    : t('chat.turnChangesHistoricalUndo')
  const undoAria = isLatest
    ? t('chat.turnChangesLatestUndoAria')
    : t('chat.turnChangesHistoricalUndoAria')

  return (
    <section
      className="mx-auto mb-5 w-full max-w-[860px] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
      aria-label={cardLabel}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('chat.turnChangesTitle', { count: files.length })}
            </span>
            <span className="font-mono text-sm font-semibold text-[var(--color-success)]">
              +{checkpoint.code.insertions}
            </span>
            <span className="font-mono text-sm font-semibold text-[var(--color-error)]">
              -{checkpoint.code.deletions}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
            {subtitle}
          </div>
        </div>

        <button
          type="button"
          onClick={onUndo}
          disabled={isUndoing}
          aria-label={undoAria}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-brand)]/40 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[15px]">undo</span>
          {isUndoing ? t('chat.turnChangesUndoing') : undoLabel}
        </button>
      </div>

      <div className="divide-y divide-[var(--color-border)]">
        {files.map((fileEntry) => {
          const isExpanded = expandedPath === fileEntry.apiPath
          const diffState = diffByPath[fileEntry.apiPath]
          return (
            <div key={fileEntry.apiPath}>
              <button
                type="button"
                onClick={() => toggleDiff(fileEntry)}
                aria-label={t(
                  isExpanded ? 'chat.turnChangesHideDiffAria' : 'chat.turnChangesShowDiffAria',
                  { path: fileEntry.displayPath },
                )}
                className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]/35"
              >
                <span className="material-symbols-outlined shrink-0 text-[17px] text-[var(--color-text-tertiary)]">
                  {isExpanded ? 'keyboard_arrow_down' : 'chevron_right'}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                  {fileEntry.displayPath}
                </span>
              </button>

              {isExpanded && (
                <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-3">
                  {diffState?.loading ? (
                    <div className="text-xs text-[var(--color-text-tertiary)]">
                      {t('chat.turnChangesDiffLoading')}
                    </div>
                  ) : diffState?.error ? (
                    <div className="text-xs text-[var(--color-error)]">
                      {diffState.error}
                    </div>
                  ) : diffState?.diff ? (
                    <WorkspaceDiffSurface
                      value={diffState.diff}
                      path={fileEntry.displayPath}
                      className="max-h-[430px] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-code-bg)]"
                    />
                  ) : (
                    <div className="text-xs text-[var(--color-text-tertiary)]">
                      {t('chat.turnChangesDiffUnavailable')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="border-t border-[var(--color-error)]/20 bg-[var(--color-error-container)]/18 px-4 py-3 text-xs text-[var(--color-error)]">
          {error}
        </div>
      )}
    </section>
  )
}

export function relativizeWorkspacePath(filePath: string, workDir: string | null): string {
  const normalizedPath = filePath.replace(/\\/g, '/')
  const isAbsolute = normalizedPath.startsWith('/') || /^[a-zA-Z]:\//.test(normalizedPath)
  if (!workDir || !isAbsolute) return normalizedPath

  const normalizedWorkDir = workDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const comparablePath = normalizedPath.toLowerCase()
  const comparableWorkDir = normalizedWorkDir.toLowerCase()
  if (comparablePath === comparableWorkDir) return ''
  if (comparablePath.startsWith(`${comparableWorkDir}/`)) {
    return normalizedPath.slice(normalizedWorkDir.length + 1)
  }
  return normalizedPath
}
