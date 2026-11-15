import { ChevronDown, ChevronRight, FileCode, Undo2 } from 'lucide-react'
import { Button } from '../shared/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../shared/ui/collapsible'
import { FilePathLabel } from '../shared/FilePathLabel'
import { useCallback, useMemo, useState } from 'react'
import { sessionsApi, type SessionTurnCheckpoint } from '../../api/sessions'
import { useMobileViewport } from '../../hooks/useMobileViewport'
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
  const isMobile = useMobileViewport()
  const [open, setOpen] = useState(false)
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
  const undoLabel = isLatest
    ? t('chat.turnChangesLatestUndo')
    : t('chat.turnChangesHistoricalUndo')
  const undoAria = isLatest
    ? t('chat.turnChangesLatestUndoAria')
    : t('chat.turnChangesHistoricalUndoAria')

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      role="region"
      aria-label={cardLabel}
      data-testid="turn-change-card"
      className="mx-auto mb-5 w-full max-w-[860px] overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex items-center gap-1 pr-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="row" type="button" className="min-w-0 flex-1">
            <ChevronRight size={15} className="shrink-0 text-subtle-foreground transition-transform group-data-[state=open]/button:rotate-90" aria-hidden="true" />
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {t('chat.turnChangesTitle', { count: files.length })}
            </span>
            <span className="shrink-0 whitespace-nowrap font-mono text-xs">
              <span className="text-success">+{checkpoint.code.insertions}</span>{' '}
              <span className="text-destructive">−{checkpoint.code.deletions}</span>
            </span>
          </Button>
        </CollapsibleTrigger>
        <Button
          variant="outline"
          size={isMobile ? 'icon-sm' : 'xs'}
          type="button"
          onClick={onUndo}
          disabled={isUndoing}
          aria-label={undoAria}
          title={isMobile ? undoLabel : undefined}
        >
          <Undo2 data-icon={isMobile ? undefined : 'inline-start'} aria-hidden="true" />
          {!isMobile && (isUndoing ? t('chat.turnChangesUndoing') : undoLabel)}
        </Button>
      </div>

      <CollapsibleContent>
        <div data-testid="turn-change-files" className="border-t border-border p-1">
          {files.map((fileEntry) => {
            const isExpanded = expandedPath === fileEntry.apiPath
            const diffState = diffByPath[fileEntry.apiPath]
            const Chevron = isExpanded ? ChevronDown : ChevronRight
            return (
              <div key={fileEntry.apiPath}>
                <Button
                  type="button"
                  variant="ghost"
                  size="row-sm"
                  aria-expanded={isExpanded}
                  onClick={() => toggleDiff(fileEntry)}
                  aria-label={t(
                    isExpanded ? 'chat.turnChangesHideDiffAria' : 'chat.turnChangesShowDiffAria',
                    { path: fileEntry.displayPath },
                  )}
                >
                  <Chevron size={13} strokeWidth={2} aria-hidden="true" className="shrink-0 text-subtle-foreground" />
                  <FileCode size={13} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-subtle-foreground" />
                  <FilePathLabel path={fileEntry.displayPath} />
                </Button>

                {isExpanded && (
                  <div className="px-1.5 py-1.5">
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
      </CollapsibleContent>

      {error && (
        <div className="border-t border-destructive/20 bg-destructive-surface/18 px-4 py-3 text-xs text-destructive">
          {error}
        </div>
      )}
    </Collapsible>
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
