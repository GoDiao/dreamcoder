import { ChevronRight, Undo2 } from 'lucide-react'
import { Button } from '../shared/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../shared/ui/card'
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
    <Card role="region" className="mx-auto mb-5 w-full max-w-[860px] gap-0 py-0"
      aria-label={cardLabel}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <CardTitle>
              {t('chat.turnChangesTitle', { count: files.length })}
            </CardTitle>
            <span className="font-mono text-sm font-semibold text-[var(--color-success)]">
              +{checkpoint.code.insertions}
            </span>
            <span className="font-mono text-sm font-semibold text-[var(--color-error)]">
              -{checkpoint.code.deletions}
            </span>
          </div>
          <CardDescription>{subtitle}</CardDescription>
        </div>

        <Button variant="outline"
          type="button"
          onClick={onUndo}
          disabled={isUndoing}
          aria-label={undoAria}
          className="rounded-md bg-[var(--color-surface)] px-3 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-brand)]/40 hover:text-[var(--color-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
        >
          <Undo2 data-icon="inline-start" />
          {isUndoing ? t('chat.turnChangesUndoing') : undoLabel}
        </Button>
      </CardHeader>

      <CardContent className="divide-y divide-ui-border px-0">
        {files.map((fileEntry) => {
          const isExpanded = expandedPath === fileEntry.apiPath
          const diffState = diffByPath[fileEntry.apiPath]
          return (
            <div key={fileEntry.apiPath}>
              <Button variant="ghost"
                type="button"
                aria-expanded={isExpanded}
                onClick={() => toggleDiff(fileEntry)}
                aria-label={t(
                  isExpanded ? 'chat.turnChangesHideDiffAria' : 'chat.turnChangesShowDiffAria',
                  { path: fileEntry.displayPath },
                )}
                className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]/35"
              >
                <ChevronRight aria-hidden="true" className={isExpanded ? 'rotate-90' : undefined} />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                  {fileEntry.displayPath}
                </span>
              </Button>

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
                      className="max-h-[430px] overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-code-bg)]"
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
      </CardContent>

      {error && (
        <CardFooter className="border-t border-[var(--color-error)]/20 bg-[var(--color-error-container)]/18 px-4 py-3 text-xs text-[var(--color-error)]">
          {error}
        </CardFooter>
      )}
    </Card>
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
