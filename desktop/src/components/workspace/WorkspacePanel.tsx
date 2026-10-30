import { AppWindow, ChevronDown, ChevronRight, CircleAlertIcon, CircleCheckIcon, Copy, Ellipsis, FileCode, FileDiffIcon, Folder, FolderOpenIcon, FolderTree, FolderXIcon, GitBranchIcon, Globe, ImageOffIcon, LayoutGrid, Maximize2, MessageSquare, MessageSquarePlus, Minimize2, PanelRight, Plus, RefreshCw, SearchXIcon, SquareTerminal, X, type LucideIcon } from 'lucide-react'
import type { UiPageSummary } from '@protocol'
import { toast } from 'sonner'
import { getTextSelectionFromContainer, type WorkspaceTextSelection } from './workspaceSelection'
import { WorkspaceQuotePopover } from './WorkspaceQuotePopover'
import { PreviewLimitBar } from './PreviewLimitBar'
import { WorkspaceTreeNavigation } from './WorkspaceTreeNavigation'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../shared/ui/collapsible'
import { ActionMenu, RowActionMenu, type MenuAction } from '../shared/ActionMenu'
import { Input } from '../shared/ui/input'
import { Button } from '../shared/ui/button'
import { Tooltip as HintTooltip } from '../shared/Tooltip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../shared/ui/tabs'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '../shared/ui/empty'
import { Skeleton } from '../shared/ui/skeleton'
import { useEffect, useMemo, useRef, useState, useId, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useHighlightedCode } from '../../hooks/useHighlightedCode'
import type {
  WorkspaceChangedFile,
  WorkspaceFileStatus,
  WorkspaceTreeEntry,
  WorkspaceTreeResult,
} from '../../api/sessions'
import { useTranslation } from '../../i18n'
import { useShallow } from 'zustand/react/shallow'
import {
  getShellDisplayName,
  getWorkspacePreviewId,
  useWorkspacePanelStore,
  type WorkspacePreviewEntry,
  type WorkspacePreviewKind,
  type WorkspaceTab,
  type WorkspaceTabKind,
  type WorkspaceTabTarget,
} from '../../stores/workspacePanelStore'
import { useChatStore } from '../../stores/chatStore'
import { useWorkspaceChatContextStore } from '../../stores/workspaceChatContextStore'
import { TerminalSettings } from '../../pages/TerminalSettings'
import { BrowserView } from './BrowserView'
import { UiPageFrame } from '../chat/UiPageFrame'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { SearchField } from '../shared/SearchField'
import { useCopyAndNotify } from '../../hooks/useCopyAndNotify'
import { useQuoteSelection } from '../../lib/selectionPopover'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import {
  getFileExtension,
  LineCommentEditor,
  WORKSPACE_PREVIEW_LINE_LIMIT,
  WorkspaceDiffSurface,
} from './WorkspaceCodeSurface'



const FILE_STATUS_META: Record<WorkspaceFileStatus, { label: string; className: string }> = {
  modified: {
    label: 'M',
    className: 'text-[var(--color-warning)]',
  },
  added: {
    label: 'A',
    className: 'text-[var(--color-success)]',
  },
  deleted: {
    label: 'D',
    className: 'text-[var(--color-error)]',
  },
  renamed: {
    label: 'R',
    className: 'text-[var(--color-brand)]',
  },
  untracked: {
    label: 'U',
    className: 'text-[var(--color-tertiary)]',
  },
  copied: {
    label: 'C',
    className: 'text-[var(--color-secondary)]',
  },
  type_changed: {
    label: 'T',
    className: 'text-[var(--color-text-secondary)]',
  },
  unknown: {
    label: '?',
    className: 'text-[var(--color-text-secondary)]',
  },
}

const EMPTY_TREE_BY_PATH: Record<string, WorkspaceTreeResult | undefined> = {}
const EMPTY_IDS: string[] = []
const EMPTY_TABS: WorkspaceTab[] = []

function makeTreeStateKey(sessionId: string, path: string) {
  return `${sessionId}::${path}`
}

function makePreviewStateKey(sessionId: string, tabId: string) {
  return `${sessionId}::${tabId}`
}

function getSessionScopedRecord<T>(
  record: Record<string, T>,
  sessionId: string,
) {
  const prefix = `${sessionId}::`
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key.startsWith(prefix)),
  ) as Record<string, T>
}

function resolveWorkspaceAttachmentPath(workDir: string | undefined, filePath: string) {
  if (!workDir || filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath)) return filePath
  return `${workDir.replace(/[\\/]+$/, '')}/${filePath.replace(/^[/\\]+/, '')}`
}

function getWorkspaceReferenceName(path: string, isDirectory = false) {
  const name = path.split('/').filter(Boolean).pop() || path
  return isDirectory && !name.endsWith('/') ? `${name}/` : name
}

function isMarkdownPreview(tab: WorkspacePreviewEntry) {
  if (tab.kind !== 'file') return false
  const language = (tab.language ?? '').toLowerCase()
  const extension = getFileExtension(tab.path)
  return language === 'markdown' || language === 'md' || extension === 'md' || extension === 'markdown'
}

function getInlineStateMessage(
  t: ReturnType<typeof useTranslation>,
  state: WorkspacePreviewEntry['state'] | WorkspaceTreeResult['state'] | 'not_git_repo' | undefined,
  fallbackError?: string | null,
) {
  switch (state) {
    case 'loading':
      return t('workspace.previewState.loading')
    case 'binary':
      return t('workspace.previewState.binary')
    case 'too_large':
      return t('workspace.previewState.tooLarge')
    case 'missing':
      return t('workspace.previewState.missing')
    case 'not_git_repo':
      return t('workspace.notGitRepo')
    case 'error':
      return fallbackError || t('workspace.loadError')
    default:
      return fallbackError || t('workspace.loadError')
  }
}

function normalizeFilterQuery(query: string) {
  return query.trim().toLowerCase()
}

function changedFileMatchesFilter(file: WorkspaceChangedFile, query: string) {
  if (!query) return true
  return (
    file.path.toLowerCase().includes(query)
    || file.oldPath?.toLowerCase().includes(query)
    || file.status.toLowerCase().includes(query)
  )
}

function treeEntryMatchesFilter(
  entry: WorkspaceTreeEntry,
  query: string,
  treeByPath: Record<string, WorkspaceTreeResult | undefined>,
): boolean {
  if (!query) return true
  if (entry.name.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query)) {
    return true
  }

  if (!entry.isDirectory) return false
  const childTree = treeByPath[entry.path]
  if (childTree?.state !== 'ok') return false
  return childTree.entries.some((child) => treeEntryMatchesFilter(child, query, treeByPath))
}

function getLineRangeForText(value: string, text: string) {
  const index = value.indexOf(text)
  if (index < 0) return {}
  const startLine = value.slice(0, index).split('\n').length
  const endLine = startLine + text.split('\n').length - 1
  return { startLine, endLine }
}

function PanelMessage({
  icon: Icon,
  message,
  tone = 'muted',
  compact = false,
}: {
  icon: LucideIcon
  message: string
  tone?: 'muted' | 'error'
  compact?: boolean
}) {
  const toneClass = tone === 'error' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'

  if (compact) {
    return (
      <Empty role={tone === 'error' ? 'alert' : 'status'} className={`flex-row justify-start gap-2 rounded-none p-0 px-4 py-2 text-left text-[11px] ${toneClass}`}>
        <Icon className="shrink-0" aria-hidden="true" size={16} />
        <EmptyDescription className={`min-w-0 text-[11px] leading-relaxed ${toneClass}`}>{message}</EmptyDescription>
      </Empty>
    )
  }

  return (
    <Empty role={tone === 'error' ? 'alert' : 'status'} className="gap-2 px-4 py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon" className={toneClass}><Icon aria-hidden="true" /></EmptyMedia>
        <EmptyDescription className={`text-xs ${toneClass}`}>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function PanelLoading({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div role="status" className={`flex flex-col gap-2 px-4 ${compact ? 'py-2' : 'py-4'}`}>
      <span className="sr-only">{label}</span>
      <Skeleton className="h-3 w-40" />
      {!compact && (
        <>
          <Skeleton className="h-3 w-56" />
          <Skeleton className="h-3 w-32" />
        </>
      )}
    </div>
  )
}

function CodeSurface({
  path,
  value,
  language,
  onAddLineComment,
  onAddSelection,
  commentRequest = 0,
  className = 'min-h-0 flex-1 overflow-auto bg-[var(--color-code-bg)]',
}: {
  path: string
  value: string
  language: string
  onAddLineComment: (line: number, note: string, quote: string) => void
  onAddSelection: (selection: WorkspaceTextSelection) => void
  /** Incremented by the parent to open the comment editor on the first line. */
  commentRequest?: number
  className?: string
}) {
  const t = useTranslation()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [commentLine, setCommentLineState] = useState<number | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [showAllLines, setShowAllLines] = useState(false)
  const lines = value.split('\n')
  const setCommentLine = (line: number | null) => {
    setCommentLineState(line)
    setCommentDraft('')
  }
  const visibleLines = showAllLines ? lines : lines.slice(0, WORKSPACE_PREVIEW_LINE_LIMIT)
  const quote = useQuoteSelection((event) => {
    const selection = getTextSelectionFromContainer(surfaceRef.current, event)
    if (!selection?.startLine || !selection.endLine || selection.startLine === selection.endLine) return selection
    return { ...selection, text: visibleLines.slice(selection.startLine - 1, selection.endLine).join('\n').trim() }
  }, value)
  const activeQuote = commentLine ? visibleLines[commentLine - 1] ?? '' : ''
  const usePlainLargePreview = showAllLines && lines.length > WORKSPACE_PREVIEW_LINE_LIMIT
  const highlightedLines = useHighlightedCode(visibleLines.join('\n'), usePlainLargePreview ? 'text' : language)

  useEffect(() => {
    setShowAllLines(false)
    setCommentLine(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, language])

  // A refresh of the same file keeps the open editor while its line still exists.
  useEffect(() => {
    if (commentLine !== null && commentLine > lines.length) setCommentLine(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    if (commentRequest > 0) setCommentLine(1)
  }, [commentRequest])

  const renderLineCommentEditor = (lineNumber: number) => {
    if (commentLine !== lineNumber) return null
    return (
      <LineCommentEditor
        lineNumber={lineNumber}
        draft={commentDraft}
        onDraftChange={setCommentDraft}
        onCancel={() => setCommentLine(null)}
        onSubmit={(note) => {
          onAddLineComment(lineNumber, note, activeQuote)
          setCommentLine(null)
        }}
      />
    )
  }

  const renderLineNumberButton = (lineNumber: number) => (
    <button
      type="button"
      aria-label={t('workspace.commentLine', { line: lineNumber })}
      onClick={() => setCommentLine(lineNumber)}
      className="select-none text-right text-[11px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-brand)] focus-visible:outline-none focus-visible:text-[var(--color-brand)]"
    >
      {lineNumber}
    </button>
  )

  return (
    <div
      ref={surfaceRef}
      className={className}
      onMouseUp={quote.onMouseUp}
    >
      <div className="relative min-w-max py-2">
        <pre data-workspace-code="" data-testid="workspace-code" className="m-0 font-mono text-xs leading-[1.55]">
          {visibleLines.map((line, index) => {
            const lineNumber = index + 1
            return (
              <div key={lineNumber}>
                <div data-workspace-line-number={lineNumber} className="group grid grid-cols-[48px_minmax(0,1fr)] gap-3 px-3 hover:bg-ui-muted">
                  {renderLineNumberButton(lineNumber)}
                  <span className="whitespace-pre pr-6">{highlightedLines[index] || line || ' '}</span>
                </div>
                {renderLineCommentEditor(lineNumber)}
              </div>
            )
          })}
        </pre>
        {lines.length > WORKSPACE_PREVIEW_LINE_LIMIT && (
          <PreviewLimitBar shown={visibleLines.length} total={lines.length} expanded={showAllLines} onToggle={() => setShowAllLines((current) => !current)} />
        )}
      </div>
      <WorkspaceQuotePopover quote={quote} onAddSelection={onAddSelection} />
    </div>
  )
}

function MarkdownSurface({
  value,
  onAddSelection,
  className = 'min-h-0 flex-1 overflow-auto bg-[var(--color-surface)]',
}: {
  value: string
  onAddSelection: (selection: WorkspaceTextSelection) => void
  className?: string
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const quote = useQuoteSelection(
    (event) => getTextSelectionFromContainer(surfaceRef.current, event, (text) => getLineRangeForText(value, text)),
    value,
  )

  return (
    <div
      ref={surfaceRef}
      className={className}
      onMouseUp={quote.onMouseUp}
    >
      <div className="mx-auto w-full max-w-[860px] px-4 py-3">
        <MarkdownRenderer
          content={value}
          variant="document"
          className="workspace-markdown-preview prose-p:text-[14px] prose-p:leading-7 prose-h1:text-[24px] prose-h2:text-[18px] prose-h3:text-[15px] prose-code:text-[12px] prose-pre:my-4"
        />
      </div>
      <WorkspaceQuotePopover quote={quote} onAddSelection={onAddSelection} />
    </div>
  )
}

function ImagePreview({ tab }: { tab: WorkspacePreviewEntry }) {
  const t = useTranslation()

  if (!tab.dataUrl) {
    return (
      <PanelMessage
        icon={ImageOffIcon}
        message={tab.error || t('workspace.imagePreviewUnavailable')}
      />
    )
  }

  return (
    <div className="overflow-auto rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center justify-center">
        <img
          src={tab.dataUrl}
          alt={tab.path}
          className="max-h-full max-w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] object-contain shadow-sm"
        />
      </div>
    </div>
  )
}

function getPathParts(path: string) {
  const segments = path.split('/').filter(Boolean)
  const name = segments.pop() ?? path
  return { name, dir: segments.join('/') }
}

function FileStatusLetter({ status }: { status: WorkspaceFileStatus }) {
  const meta = FILE_STATUS_META[status]
  return (
    <span
      className={`w-4 shrink-0 text-center font-[var(--font-mono)] text-[11px] font-semibold ${meta.className}`}
      aria-label={status}
    >
      {meta.label}
    </span>
  )
}

const FILE_ROW_CLASS = 'gap-1.5 rounded-[6px] py-[7px] pr-1.5 text-[12px] text-[var(--color-text-primary)]'

function ChangedFileItem({
  file,
  expanded,
  onToggle,
  actions,
  children,
}: {
  file: WorkspaceChangedFile
  expanded: boolean
  onToggle: () => void
  actions: MenuAction[]
  children?: ReactNode
}) {
  const { name, dir } = getPathParts(file.path)
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <div data-testid="workspace-file-item" className="border-t border-[var(--color-border)] first:border-t-0">
      <RowActionMenu actions={actions} hint={file.path}>{() => <Button
        variant="ghost"
        size="row"
        aria-expanded={expanded}
        aria-label={file.path}
        onClick={onToggle}
        className={`${FILE_ROW_CLASS} pl-1.5`}
      >
        <Chevron size={13} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
        <FileCode size={13} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
        <span className="min-w-0 flex-1 truncate">
          <span>{name}</span>
          {dir && <span className="ml-1.5 text-[11px] text-[var(--color-text-tertiary)]">{dir}</span>}
        </span>
        <span className="shrink-0 whitespace-nowrap font-[var(--font-mono)] text-[11px]">
          <span className="text-[var(--color-success)]">+{file.additions}</span>{' '}
          <span className="text-[var(--color-error)]">−{file.deletions}</span>
        </span>
        <FileStatusLetter status={file.status} />
      </Button>}</RowActionMenu>
      {expanded && children}
    </div>
  )
}

type TreeNodeProps = {
  sessionId: string
  entry: WorkspaceTreeEntry
  depth: number
  expandedPaths: Set<string>
  treeByPath: Record<string, WorkspaceTreeResult | undefined>
  treeLoadingByPath: Record<string, boolean | undefined>
  treeErrorsByPath: Record<string, string | null | undefined>
  filterQuery: string
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  getFileActions: (path: string, isDirectory: boolean) => MenuAction[]
}

function TreeNode({
  sessionId,
  entry,
  depth,
  expandedPaths,
  treeByPath,
  treeLoadingByPath,
  treeErrorsByPath,
  filterQuery,
  onToggle,
  onOpenFile,
  getFileActions,
}: TreeNodeProps) {
  const t = useTranslation()
  const groupId = useId()
  const parentPath = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : ''
  const childTree = treeByPath[entry.path]
  const childLoading = treeLoadingByPath[makeTreeStateKey(sessionId, entry.path)] ?? false
  const childError = treeErrorsByPath[makeTreeStateKey(sessionId, entry.path)] ?? null
  const isExpanded = expandedPaths.has(entry.path) || filterQuery.length > 0
  const indent = 6 + depth * 14
  const Chevron = isExpanded ? ChevronDown : ChevronRight
  const rowProps = {
    variant: 'ghost' as const,
    size: 'row' as const,
    role: 'treeitem',
    tabIndex: -1,
    'aria-level': depth + 1,
    'aria-label': entry.path,
    'data-tree-path': entry.path,
    'data-parent-path': parentPath,
    className: FILE_ROW_CLASS,
    style: { paddingLeft: indent },
  }

  if (!entry.isDirectory) {
    return (
      <RowActionMenu actions={getFileActions(entry.path, false)} hint={entry.path}>{() => (
        <Button {...rowProps} onClick={() => onOpenFile(entry.path)}>
          <span className="w-[13px] shrink-0" aria-hidden="true" />
          <FileCode size={13} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
          <span className="min-w-0 truncate">{entry.name}</span>
        </Button>
      )}</RowActionMenu>
    )
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={() => onToggle(entry.path)}>
      <RowActionMenu actions={getFileActions(entry.path, true)} hint={entry.path}>{() => (
        <CollapsibleTrigger asChild>
          <Button
            {...rowProps}
            aria-expanded={isExpanded}
            data-directory
            aria-owns={isExpanded ? groupId : undefined}
          >
            <Chevron size={13} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
            <Folder size={13} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
            <span className="min-w-0 truncate">{entry.name}</span>
          </Button>
        </CollapsibleTrigger>
      )}</RowActionMenu>
      <CollapsibleContent id={groupId} role="group">
        {childLoading && !childTree && (
          <PanelLoading compact label={t('common.loading')} />
        )}

        {!childLoading && childError && (
          <PanelMessage compact icon={CircleAlertIcon} tone="error" message={childError} />
        )}

        {!childLoading && !childError && childTree?.state === 'missing' && (
          <PanelMessage compact icon={FolderXIcon} message={t('workspace.previewState.missing')} />
        )}

        {!childLoading && !childError && childTree?.state === 'error' && (
          <PanelMessage
            compact
            icon={CircleAlertIcon}
            tone="error"
            message={childTree.error || t('workspace.loadError')}
          />
        )}

        {!childLoading && !childError && childTree?.state === 'ok' && childTree.entries.length === 0 && (
          <PanelMessage compact icon={FolderOpenIcon} message={t('workspace.noFiles')} />
        )}

        {!childLoading && !childError && childTree?.state === 'ok' && childTree.entries
          .filter((childEntry) => treeEntryMatchesFilter(childEntry, filterQuery, treeByPath))
          .map((childEntry) => (
            <TreeNode
              key={childEntry.path}
              sessionId={sessionId}
              entry={childEntry}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              treeByPath={treeByPath}
              treeLoadingByPath={treeLoadingByPath}
              treeErrorsByPath={treeErrorsByPath}
              filterQuery={filterQuery}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              getFileActions={getFileActions}
            />
          ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

const SURFACE_FRAME_CLASS = 'overflow-auto rounded-[7px] border border-[var(--color-border)]'

function FileExpandedBody({
  path,
  entry,
  loading,
  error,
  fill = false,
  onAddToChat,
  actions,
  onAddLineComment,
  onAddSelection,
}: {
  path: string
  entry: WorkspacePreviewEntry | undefined
  loading: boolean
  error: string | null
  fill?: boolean
  onAddToChat: () => void
  actions: MenuAction[]
  onAddLineComment: (line: number, note: string, quote: string) => void
  onAddSelection: (selection: WorkspaceTextSelection) => void
}) {
  const t = useTranslation()
  const [commentRequest, setCommentRequest] = useState(0)
  const state = loading || !entry ? 'loading' : entry.state ?? 'loading'
  const isDiff = entry?.kind === 'diff'
  const isImage = state === 'ok' && entry?.previewType === 'image'
  const isMarkdown = state === 'ok' && !isDiff && !isImage && entry ? isMarkdownPreview(entry) : false
  const isEmptyDiff = state === 'ok' && isDiff && !(entry?.diff ?? '').trim()
  const canComment = state === 'ok' && !isImage && !isMarkdown && !isEmptyDiff
  const frameClass = `${SURFACE_FRAME_CLASS} ${fill ? 'min-h-0 flex-1' : 'max-h-[420px]'}`
  const codeSurfaceClass = `${frameClass} bg-[var(--color-code-bg)]`

  let content: ReactNode
  if (state === 'loading') {
    content = <PanelLoading compact label={t('workspace.previewState.loading')} />
  } else if (isEmptyDiff) {
    content = <PanelMessage compact icon={FileDiffIcon} message={t('workspace.emptyDiff')} />
  } else if (state === 'ok' && isDiff) {
    content = (
      <WorkspaceDiffSurface
        value={entry?.diff ?? ''}
        path={path}
        hideFileHeaders
        className={codeSurfaceClass}
        commentRequest={commentRequest}
        onAddLineComment={onAddLineComment}
        onAddSelection={onAddSelection}
      />
    )
  } else if (isImage && entry) {
    content = <ImagePreview tab={entry} />
  } else if (isMarkdown) {
    content = (
      <MarkdownSurface
        value={entry?.content ?? ''}
        onAddSelection={onAddSelection}
        className={`${frameClass} bg-[var(--color-surface)]`}
      />
    )
  } else if (state === 'ok') {
    content = (
      <CodeSurface
        path={path}
        value={entry?.content ?? ''}
        language={entry?.language ?? 'text'}
        onAddLineComment={onAddLineComment}
        onAddSelection={onAddSelection}
        commentRequest={commentRequest}
        className={codeSurfaceClass}
      />
    )
  } else {
    content = (
      <PanelMessage
        compact
        icon={CircleAlertIcon}
        tone={state === 'error' ? 'error' : 'muted'}
        message={getInlineStateMessage(t, state, error || entry?.error || null)}
      />
    )
  }

  return (
    <div data-testid="workspace-file-body" className={fill ? 'flex min-h-0 flex-1 flex-col px-3 pb-2 pt-3' : 'pb-3 pl-[25px] pr-0.5'}>
      <div className="mb-1.5 shrink-0 break-all text-[11px] text-[var(--color-text-tertiary)]">{path}</div>
      {content}
      <div className="mt-1.5 flex shrink-0 flex-wrap items-center gap-0.5">
        <Button variant="ghost" size="xs" onClick={onAddToChat}>
          <MessageSquarePlus aria-hidden="true" />
          {t('workspace.addToChat')}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setCommentRequest((value) => value + 1)} disabled={!canComment}>
          <MessageSquare aria-hidden="true" />
          {t('workspace.lineComment')}
        </Button>
        <ActionMenu label={t('workspace.moreFileActions')} actions={actions} trigger={
          <Button variant="ghost" size="icon-sm" aria-label={t('workspace.moreFileActions')}><Ellipsis size={14} aria-hidden="true" /></Button>
        } />
      </div>
    </div>
  )
}

function useWorkspaceFileActions(sessionId: string) {
  const t = useTranslation()
  const copyAndNotify = useCopyAndNotify()
  const workDir = useWorkspacePanelStore((state) => state.statusBySession[sessionId]?.workDir)
  const addWorkspaceReference = useWorkspaceChatContextStore((state) => state.addReference)

  const addPathToChat = (path: string, isDirectory = false) => {
    addWorkspaceReference(sessionId, {
      kind: 'file',
      path,
      absolutePath: resolveWorkspaceAttachmentPath(workDir, path),
      name: getWorkspaceReferenceName(path, isDirectory),
      isDirectory,
    })
  }

  const addLineComment = (path: string, line: number, note: string, quote: string) => {
    addWorkspaceReference(sessionId, {
      kind: 'code-comment',
      path,
      absolutePath: resolveWorkspaceAttachmentPath(workDir, path),
      name: path.split('/').pop() || path,
      lineStart: line,
      lineEnd: line,
      note,
      quote,
    })
  }

  const addSelection = (path: string, selection: WorkspaceTextSelection) => {
    addWorkspaceReference(sessionId, {
      kind: 'code-selection',
      path,
      absolutePath: resolveWorkspaceAttachmentPath(workDir, path),
      name: path.split('/').pop() || path,
      lineStart: selection.startLine,
      lineEnd: selection.endLine,
      quote: selection.text,
    })
  }

  const copyPath = async (path: string, mode: 'relative' | 'absolute') => {
    const pathToCopy = mode === 'absolute' ? resolveWorkspaceAttachmentPath(workDir, path) : path
    await copyAndNotify(pathToCopy, t('workspace.pathCopied'))
  }

  const getFileActions = (path: string, isDirectory = false): MenuAction[] => [
    { id: 'add', label: t('workspace.addToChat'), icon: <MessageSquarePlus size={14} aria-hidden="true" />, onSelect: () => addPathToChat(path, isDirectory) },
    { id: 'relative', label: t('workspace.copyPath'), icon: <Copy size={14} aria-hidden="true" />, onSelect: () => void copyPath(path, 'relative') },
    { id: 'absolute', label: t('workspace.copyAbsolutePath'), icon: <Copy size={14} aria-hidden="true" />, onSelect: () => void copyPath(path, 'absolute') },
  ]

  return { addPathToChat, addLineComment, addSelection, getFileActions }
}

function PreviewBody({ sessionId, path, kind, fill = false }: { sessionId: string; path: string; kind: WorkspacePreviewKind; fill?: boolean }) {
  const previewId = getWorkspacePreviewId(path, kind)
  const requestKey = makePreviewStateKey(sessionId, previewId)
  const entry = useWorkspacePanelStore((state) => state.previewsBySession[sessionId]?.[previewId])
  const loading = useWorkspacePanelStore((state) => state.loading.previewById[requestKey] ?? false)
  const error = useWorkspacePanelStore((state) => state.errors.previewById[requestKey] ?? null)
  const actions = useWorkspaceFileActions(sessionId)
  return (
    <FileExpandedBody
      path={path}
      entry={entry}
      loading={loading}
      error={error}
      fill={fill}
      onAddToChat={() => actions.addPathToChat(path)}
      actions={actions.getFileActions(path)}
      onAddLineComment={(line, note, quote) => actions.addLineComment(path, line, note, quote)}
      onAddSelection={(selection) => actions.addSelection(path, selection)}
    />
  )
}

function ListView({
  filter,
  onFilterChange,
  onRefresh,
  children,
}: {
  filter: string
  onFilterChange: (value: string) => void
  onRefresh: () => void
  children: ReactNode
}) {
  const t = useTranslation()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2 pt-3">
        <SearchField
          value={filter}
          onChange={onFilterChange}
          aria-label={t('workspace.filterPlaceholder')}
          placeholder={t('workspace.filterPlaceholder')}
          className="min-w-0 flex-1"
        />
        <HintTooltip content={t('workspace.refresh')}>
          <Button variant="ghost" size="icon-sm" aria-label={t('workspace.refresh')} onClick={onRefresh}>
            <RefreshCw aria-hidden="true" />
          </Button>
        </HintTooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">{children}</div>
    </div>
  )
}

function ChangesView({ sessionId }: { sessionId: string }) {
  const t = useTranslation()
  const [filterQuery, setFilterQuery] = useState('')
  const status = useWorkspacePanelStore((state) => state.statusBySession[sessionId])
  const statusLoading = useWorkspacePanelStore((state) => state.loading.statusBySession[sessionId] ?? false)
  const statusError = useWorkspacePanelStore((state) => state.errors.statusBySession[sessionId] ?? null)
  const expandedPreviewIds = useWorkspacePanelStore((state) => state.expandedPreviewIdsBySession[sessionId] ?? EMPTY_IDS)
  const loadStatus = useWorkspacePanelStore((state) => state.loadStatus)
  const refreshPreviews = useWorkspacePanelStore((state) => state.refreshPreviews)
  const togglePreview = useWorkspacePanelStore((state) => state.togglePreview)
  const { getFileActions } = useWorkspaceFileActions(sessionId)
  const normalizedFilterQuery = normalizeFilterQuery(filterQuery)
  const filteredChangedFiles = useMemo(
    () => (status?.changedFiles ?? []).filter((file) => changedFileMatchesFilter(file, normalizedFilterQuery)),
    [normalizedFilterQuery, status?.changedFiles],
  )

  const renderBody = () => {
    if (statusLoading && !status) return <PanelLoading label={t('common.loading')} />
    if (status?.state === 'missing_workdir') return <PanelMessage icon={FolderXIcon} message={t('workspace.missingWorkdir')} />
    if (status?.state === 'not_git_repo') return <PanelMessage icon={GitBranchIcon} message={t('workspace.notGitRepo')} />
    if (statusError || status?.state === 'error') {
      return <PanelMessage icon={CircleAlertIcon} tone="error" message={statusError || status?.error || t('workspace.loadError')} />
    }
    if (!status) return <PanelLoading label={t('common.loading')} />
    if (status.changedFiles.length === 0) return <PanelMessage icon={CircleCheckIcon} message={t('workspace.noChanges')} />
    if (filteredChangedFiles.length === 0) return <PanelMessage icon={SearchXIcon} message={t('workspace.noMatchingFiles')} />
    return (
      <div>
        {filteredChangedFiles.map((file) => (
          <ChangedFileItem
            key={`${file.path}:${file.status}:${file.oldPath ?? ''}`}
            file={file}
            expanded={expandedPreviewIds.includes(getWorkspacePreviewId(file.path, 'diff'))}
            onToggle={() => void togglePreview(sessionId, file.path, 'diff')}
            actions={getFileActions(file.path)}
          >
            <PreviewBody sessionId={sessionId} path={file.path} kind="diff" />
          </ChangedFileItem>
        ))}
      </div>
    )
  }

  return (
    <ListView
      filter={filterQuery}
      onFilterChange={setFilterQuery}
      onRefresh={() => {
        void loadStatus(sessionId)
        void refreshPreviews(sessionId)
      }}
    >
      {renderBody()}
    </ListView>
  )
}

function FilesView({ sessionId }: { sessionId: string }) {
  const t = useTranslation()
  const [filterQuery, setFilterQuery] = useState('')
  const treeByPath = useWorkspacePanelStore((state) => state.treeBySessionPath[sessionId] ?? EMPTY_TREE_BY_PATH)
  const expandedPaths = useWorkspacePanelStore((state) => state.expandedPathsBySession[sessionId] ?? EMPTY_IDS)
  const treeLoadingByPath = useWorkspacePanelStore(
    useShallow((state) => getSessionScopedRecord(state.loading.treeBySessionPath, sessionId)),
  )
  const treeErrorsByPath = useWorkspacePanelStore(
    useShallow((state) => getSessionScopedRecord(state.errors.treeBySessionPath, sessionId)),
  )
  const loadTree = useWorkspacePanelStore((state) => state.loadTree)
  const toggleTreeNode = useWorkspacePanelStore((state) => state.toggleTreeNode)
  const openTab = useWorkspacePanelStore((state) => state.openTab)
  const { getFileActions } = useWorkspaceFileActions(sessionId)
  const rootTree = treeByPath['']
  const rootTreeKey = makeTreeStateKey(sessionId, '')
  const rootTreeLoading = treeLoadingByPath[rootTreeKey] ?? false
  const rootTreeError = treeErrorsByPath[rootTreeKey] ?? null
  const normalizedFilterQuery = normalizeFilterQuery(filterQuery)
  const expandedPathSet = new Set(expandedPaths)
  const filteredRootEntries = useMemo(
    () => rootTree?.state === 'ok'
      ? rootTree.entries.filter((entry) => treeEntryMatchesFilter(entry, normalizedFilterQuery, treeByPath))
      : [],
    [normalizedFilterQuery, rootTree, treeByPath],
  )

  useEffect(() => {
    if (rootTree || rootTreeLoading || rootTreeError) return
    void loadTree(sessionId, '')
  }, [loadTree, rootTree, rootTreeError, rootTreeLoading, sessionId])

  const renderBody = () => {
    if (rootTreeLoading && !rootTree) return <PanelLoading label={t('common.loading')} />
    if (rootTreeError) return <PanelMessage icon={CircleAlertIcon} tone="error" message={rootTreeError} />
    if (rootTree?.state === 'missing') return <PanelMessage icon={FolderXIcon} message={t('workspace.missingWorkdir')} />
    if (rootTree?.state === 'error') return <PanelMessage icon={CircleAlertIcon} tone="error" message={rootTree.error || t('workspace.loadError')} />
    if (!rootTree) return <PanelLoading label={t('common.loading')} />
    if (rootTree.entries.length === 0) return <PanelMessage icon={FolderOpenIcon} message={t('workspace.noFiles')} />
    if (filteredRootEntries.length === 0) return <PanelMessage icon={SearchXIcon} message={t('workspace.noMatchingFiles')} />
    return (
      <WorkspaceTreeNavigation label={t('workspace.allFiles')}>
        {filteredRootEntries.map((entry) => (
          <TreeNode
            key={entry.path}
            sessionId={sessionId}
            entry={entry}
            depth={0}
            expandedPaths={expandedPathSet}
            treeByPath={treeByPath}
            treeLoadingByPath={treeLoadingByPath}
            treeErrorsByPath={treeErrorsByPath}
            filterQuery={normalizedFilterQuery}
            onToggle={(path) => void toggleTreeNode(sessionId, path)}
            onOpenFile={(path) => openTab(sessionId, { kind: 'file', path })}
            getFileActions={getFileActions}
          />
        ))}
      </WorkspaceTreeNavigation>
    )
  }

  return (
    <ListView filter={filterQuery} onFilterChange={setFilterQuery} onRefresh={() => void loadTree(sessionId, '')}>
      {renderBody()}
    </ListView>
  )
}

function FileTabView({ sessionId, path }: { sessionId: string; path: string }) {
  const ensurePreview = useWorkspacePanelStore((state) => state.ensurePreview)
  useEffect(() => {
    void ensurePreview(sessionId, path, 'file')
  }, [ensurePreview, path, sessionId])
  return <PreviewBody sessionId={sessionId} path={path} kind="file" fill />
}

function UiPageTabView({ sessionId, tab }: { sessionId: string; tab: Extract<WorkspaceTab, { kind: 'uiPage' }> }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <UiPageFrame sessionId={sessionId} pageId={tab.pageId} revision={tab.revision} title={tab.title} maxHeight={Infinity} />
    </div>
  )
}

function TerminalTabView({
  sessionId,
  tab,
  active,
  cwd,
  contextLabel,
}: {
  sessionId: string
  tab: Extract<WorkspaceTab, { kind: 'terminal' }>
  active: boolean
  cwd?: string
  contextLabel?: string
}) {
  const patchTab = useWorkspacePanelStore((state) => state.patchTab)
  return (
    <TerminalSettings
      active={active}
      docked
      cwd={cwd}
      runtimeId={tab.id}
      preserveOnUnmount
      testId={`session-terminal-host-${tab.id}`}
      meta={contextLabel}
      onShellChange={(shell) => {
        const name = getShellDisplayName(shell)
        if (name) patchTab(sessionId, tab.id, { shell: name })
      }}
    />
  )
}

const EMPTY_UI_PAGES: UiPageSummary[] = []

function LauncherView({ sessionId, projectRoot }: { sessionId: string; projectRoot: string | null }) {
  const t = useTranslation()
  const [draft, setDraft] = useState('')
  const openTab = useWorkspacePanelStore((state) => state.openTab)
  const openAddress = useWorkspacePanelStore((state) => state.openAddress)
  const recentFiles = useWorkspacePanelStore((state) => state.panelBySession[sessionId]?.recentFiles ?? EMPTY_IDS)
  const uiPages = useChatStore((state) => state.sessions[sessionId]?.mirror?.uiPages ?? EMPTY_UI_PAGES)
  const desktop = isDesktopRuntime()
  const tools: Array<{ target: WorkspaceTabTarget; kind: WorkspaceTabKind; label: string }> = [
    ...(desktop ? [{ target: { kind: 'terminal' } as const, kind: 'terminal' as const, label: t('workspace.tabTerminal') }] : []),
    { target: { kind: 'files' }, kind: 'files', label: t('workspace.tabFiles') },
    { target: { kind: 'changes' }, kind: 'changes', label: t('workspace.tabChanges') },
  ]
  const recents: Array<{ key: string; kind: WorkspaceTabKind; label: string; detail?: string; target: WorkspaceTabTarget }> = [
    ...uiPages.map((page) => ({
      key: `page:${page.pageId}`,
      kind: 'uiPage' as const,
      label: page.title,
      detail: t('workspace.launcher.pageRevision', { revision: page.revision }),
      target: { kind: 'uiPage' as const, pageId: page.pageId, revision: page.revision, title: page.title },
    })),
    ...recentFiles.map((path) => ({
      key: `file:${path}`,
      kind: 'file' as const,
      label: getPathParts(path).name,
      detail: getPathParts(path).dir || undefined,
      target: { kind: 'file' as const, path },
    })),
  ]

  const submit = (event: FormEvent) => {
    event.preventDefault()
    openAddress(sessionId, draft, projectRoot).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error))
    })
  }

  return (
    <div data-testid="workspace-launcher" className="min-h-0 flex-1 overflow-auto px-4 py-5">
      <form onSubmit={submit}>
        <Input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t('workspace.launcher.address')}
          placeholder={t(desktop ? 'workspace.launcher.addressPlaceholder' : 'workspace.launcher.pathPlaceholder')}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </form>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {tools.map(({ target, kind, label }) => {
          const Icon = TAB_ICONS[kind]
          return (
            <Button key={kind} variant="outline" className="h-auto flex-col gap-1.5 py-3" onClick={() => openTab(sessionId, target)}>
              <Icon aria-hidden="true" />
              <span className="text-[12px]">{label}</span>
            </Button>
          )
        })}
      </div>
      {recents.length > 0 && (
        <section className="mt-6" aria-labelledby={`${sessionId}-launcher-recent`}>
          <h3 id={`${sessionId}-launcher-recent`} className="mb-1.5 px-1 text-[11px] font-medium text-[var(--color-text-tertiary)]">
            {t('workspace.launcher.recent')}
          </h3>
          {recents.map(({ key, kind, label, detail, target }) => {
            const Icon = TAB_ICONS[kind]
            return (
              <Button key={key} variant="ghost" size="row" className={`${FILE_ROW_CLASS} pl-1.5`} onClick={() => openTab(sessionId, target)}>
                <Icon size={13} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
                <span className="min-w-0 flex-1 truncate">
                  <span>{label}</span>
                  {detail && <span className="ml-1.5 text-[11px] text-[var(--color-text-tertiary)]">{detail}</span>}
                </span>
              </Button>
            )
          })}
        </section>
      )}
    </div>
  )
}

const TAB_ICONS: Record<WorkspaceTabKind, LucideIcon> = {
  launcher: LayoutGrid,
  changes: FileDiffIcon,
  files: FolderTree,
  file: FileCode,
  browser: Globe,
  terminal: SquareTerminal,
  uiPage: AppWindow,
}

function getTabTitle(t: ReturnType<typeof useTranslation>, tab: WorkspaceTab) {
  switch (tab.kind) {
    case 'launcher':
      return t('workspace.newTab')
    case 'changes':
      return t('workspace.tabChanges')
    case 'files':
      return t('workspace.tabFiles')
    case 'file':
      return getPathParts(tab.path).name
    case 'browser':
      return tab.title || tab.url || t('workspace.tabBrowser')
    case 'terminal':
      return `${tab.shell ?? t('terminal.defaultName')} ${tab.index}`
    case 'uiPage':
      return t('uiPage.revision', { title: tab.title, revision: tab.revision })
  }
}

function useWorkspaceRefresh(sessionId: string) {
  const chatState = useChatStore((state) => state.sessions[sessionId]?.chatState ?? 'idle')
  const statusLoading = useWorkspacePanelStore((state) => state.loading.statusBySession[sessionId] ?? false)
  const loadStatus = useWorkspacePanelStore((state) => state.loadStatus)
  const refreshPreviews = useWorkspacePanelStore((state) => state.refreshPreviews)
  const lifecycleRef = useRef<{ sessionId: string | null; chatState: string }>({ sessionId: null, chatState: 'idle' })

  useEffect(() => {
    const previous = lifecycleRef.current
    const opened = previous.sessionId !== sessionId
    const completedTurn = !opened && previous.chatState !== 'idle' && chatState === 'idle'
    lifecycleRef.current = { sessionId, chatState }

    if (completedTurn) void refreshPreviews(sessionId)
    if ((!opened && !completedTurn) || statusLoading) return
    void loadStatus(sessionId)
  }, [chatState, loadStatus, refreshPreviews, sessionId, statusLoading])
}

type WorkspacePanelProps = {
  sessionId: string
  sessionTitle: string
  titleRowStyle?: CSSProperties
  titleRowClass?: string
  terminalCwd?: string
  contextLabel?: string
  projectRoot?: string | null
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const isOpen = useWorkspacePanelStore((state) => state.isPanelOpen(props.sessionId))
  return isOpen ? <OpenWorkspacePanel {...props} /> : null
}

function OpenWorkspacePanel({ sessionId, sessionTitle, titleRowStyle, titleRowClass = '', terminalCwd, contextLabel, projectRoot = null }: WorkspacePanelProps) {
  const t = useTranslation()
  const tabs = useWorkspacePanelStore((state) => state.panelBySession[sessionId]?.tabs ?? EMPTY_TABS)
  const activeTabId = useWorkspacePanelStore((state) => state.panelBySession[sessionId]?.activeTabId ?? null)
  const expanded = useWorkspacePanelStore((state) => state.isPanelExpanded(sessionId))
  const openTab = useWorkspacePanelStore((state) => state.openTab)
  const activateTab = useWorkspacePanelStore((state) => state.activateTab)
  const closeTab = useWorkspacePanelStore((state) => state.closeTab)
  const toggleExpanded = useWorkspacePanelStore((state) => state.toggleExpanded)
  const closePanel = useWorkspacePanelStore((state) => state.closePanel)
  useWorkspaceRefresh(sessionId)

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const expandLabel = expanded ? t('workspace.restorePanel') : t('workspace.expandPanel')

  const renderContent = (tab: WorkspaceTab) => {
    switch (tab.kind) {
      case 'launcher':
        return <LauncherView sessionId={sessionId} projectRoot={projectRoot} />
      case 'changes':
        return <ChangesView sessionId={sessionId} />
      case 'files':
        return <FilesView sessionId={sessionId} />
      case 'file':
        return <FileTabView sessionId={sessionId} path={tab.path} />
      case 'browser':
        return <BrowserView sessionId={sessionId} tab={tab} projectRoot={projectRoot} />
      case 'uiPage':
        return <UiPageTabView sessionId={sessionId} tab={tab} />
      case 'terminal':
        return null
    }
  }

  return (
    <Tabs value={activeTabId ?? ''} onValueChange={(id) => activateTab(sessionId, id)} asChild>
      <aside
        data-testid="workspace-panel"
        aria-label={t('workspace.panelTabs')}
        className="flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--color-surface)]"
      >
        <div style={titleRowStyle} className={`window-drag-region flex shrink-0 select-none items-center gap-0.5 border-b border-[var(--color-border)] pl-2 pr-2 ${titleRowClass}`}>
          {expanded && (
            <HintTooltip content={t('workspace.backToChat')}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleExpanded(sessionId)}
                className="max-w-[200px] shrink-0 gap-1.5 px-2 text-[11px] text-[var(--color-text-secondary)]"
              >
                <MessageSquare size={12} strokeWidth={1.9} className="shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{sessionTitle}</span>
              </Button>
            </HintTooltip>
          )}
          <TabsList aria-label={t('workspace.panelTabs')} variant="line" className="min-w-0 flex-1 justify-start overflow-x-auto overflow-y-hidden">
            {tabs.map((tab) => {
              const title = getTabTitle(t, tab)
              const Icon = TAB_ICONS[tab.kind]
              const selected = tab.id === activeTabId
              return (
                <span
                  key={tab.id}
                  className={`inline-flex max-w-[180px] shrink-0 items-center rounded-[6px] ${
                    selected
                      ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <TabsTrigger
                    value={tab.id}
                    data-panel-tab={tab.kind}
                    title={title}
                    className="inline-flex min-w-0 items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11px] after:hidden focus-visible:outline-none"
                  >
                    <Icon size={12} strokeWidth={1.9} className="shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{title}</span>
                  </TabsTrigger>
                  <HintTooltip content={t('workspace.closeTab', { name: title })}>
                    <button
                      type="button"
                      aria-label={t('workspace.closeTab', { name: title })}
                      onClick={() => closeTab(sessionId, tab.id)}
                      className="mr-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ui-ring/50"
                    >
                      <X size={11} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </HintTooltip>
                </span>
              )
            })}
          </TabsList>
          <HintTooltip content={t('workspace.newTab')}>
            <Button variant="ghost" size="icon-sm" aria-label={t('workspace.newTab')} onClick={() => openTab(sessionId, { kind: 'launcher' })}>
              <Plus aria-hidden="true" />
            </Button>
          </HintTooltip>
          <HintTooltip content={expandLabel}>
            <Button variant="ghost" size="icon-sm" aria-label={expandLabel} onClick={() => toggleExpanded(sessionId)}>
              {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </Button>
          </HintTooltip>
          <HintTooltip content={t('workspace.closeSidePanel')}>
            <Button variant="ghost" size="icon-sm" aria-label={t('workspace.closeSidePanel')} onClick={() => closePanel(sessionId)}>
              <PanelRight aria-hidden="true" />
            </Button>
          </HintTooltip>
        </div>

        {tabs.filter((tab) => tab.kind === 'terminal').map((tab) => (
          <TabsContent key={tab.id} value={tab.id} forceMount hidden={tab.id !== activeTabId} data-testid="session-terminal-panel" className="flex min-h-0 flex-1 flex-col">
            <TerminalTabView sessionId={sessionId} tab={tab} active={tab.id === activeTabId} cwd={terminalCwd} contextLabel={contextLabel} />
          </TabsContent>
        ))}
        {activeTab && activeTab.kind !== 'terminal' && (
          <TabsContent key={activeTab.id} value={activeTab.id} className="flex min-h-0 flex-1 flex-col">
            {renderContent(activeTab)}
          </TabsContent>
        )}
      </aside>
    </Tabs>
  )
}
