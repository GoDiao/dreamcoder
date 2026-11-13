import { ChevronRight, Undo2 } from 'lucide-react'
import { Button } from '../shared/ui/button'
import { CardTitle, CardDescription } from '../shared/ui/card'
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
    <div role="region" className="mx-auto mb-5 w-full max-w-[860px] overflow-hidden rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10"
      aria-label={cardLabel}
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <CardTitle>
              {t('chat.turnChangesTitle', { count: files.length })}
            </CardTitle>
            <span className="font-mono text-sm font-semibold text-success">
              +{checkpoint.code.insertions}
            </span>
            <span className="font-mono text-sm font-semibold text-destructive">
              -{checkpoint.code.deletions}
            </span>
          </div>
          <CardDescription>{subtitle}</CardDescription>
        </div>

        <Button variant="outline" size="sm"
          type="button"
          onClick={onUndo}
          disabled={isUndoing}
          aria-label={undoAria}
        >
          <Undo2 data-icon="inline-start" />
          {isUndoing ? t('chat.turnChangesUndoing') : undoLabel}
        </Button>
      </div>

      <div className="divide-y divide-border">
        {files.map((fileEntry) => {
          const isExpanded = expandedPath === fileEntry.apiPath
          const diffState = diffByPath[fileEntry.apiPath]
          return (
            <div key={fileEntry.apiPath}>
              <Button
                type="button"
                variant="ghost"
                size="row-lg"
                aria-expanded={isExpanded}
                onClick={() => toggleDiff(fileEntry)}
                aria-label={t(
                  isExpanded ? 'chat.turnChangesHideDiffAria' : 'chat.turnChangesShowDiffAria',
                  { path: fileEntry.displayPath },
                )}
              >
                <ChevronRight aria-hidden="true" className={isExpanded ? 'rotate-90' : undefined} />
                <span className="min-w-0 flex-1 truncate font-mono text-sm">
                  {fileEntry.displayPath}
                </span>
              </Button>

              {isExpanded && (
                <div className="border-t border-border bg-popover px-4 py-3">
                  {diffState?.loading ? (
                    <div className="text-xs text-subtle-foreground">
                      {t('chat.turnChangesDiffLoading')}
                    </div>
                  ) : diffState?.error ? (
                    <div className="text-xs text-destructive">
                      {diffState.error}
                    </div>
                  ) : diffState?.diff ? (
                    <WorkspaceDiffSurface
                      value={diffState.diff}
                      path={fileEntry.displayPath}
                      className="max-h-[430px] overflow-auto rounded-md border border-border bg-code"
                    />
                  ) : (
                    <div className="text-xs text-subtle-foreground">
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
        <div className="border-t border-destructive/20 bg-destructive-surface/18 px-4 py-3 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
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
