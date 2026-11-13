import { AppWindow, ArrowUpRight, ChevronDown, ChevronRight, CircleAlertIcon, CircleCheckIcon, ClipboardCopy, Copy, FileCode, FileDiffIcon, FolderOpen, FolderOpenIcon, FolderTree, FolderXIcon, GitBranchIcon, Eye, WrapText, Globe, ImageOffIcon, LayoutGrid, Layers, Maximize2, MessageSquare, MessageSquarePlus, Minimize2, PanelRight, Plus, RefreshCw, SearchXIcon, SquareKanban, SquareTerminal, TextSelect, Inbox, type LucideIcon } from 'lucide-react'
import type { UiPageSummary } from '@protocol'
import { toast } from 'sonner'
import { getTextSelectionFromContainer, type WorkspaceQuoteSelection, type WorkspaceTextSelection } from './workspaceSelection'
import { WorkspaceQuotePopover } from './WorkspaceQuotePopover'
import { PreviewLimitBar } from './PreviewLimitBar'
import { PanelLoading, PanelMessage } from './PanelStates'
import { WorkspaceFileTree, type TreeReveal } from './WorkspaceFileTree'
import { OpenProjectMenu, TargetIcon, useOpenTargets } from '../layout/OpenProjectMenu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../shared/ui/resizable'
import { ActionMenu, RowActionMenu, type MenuAction, type MenuEntry, type MenuSubmenu } from '../shared/ActionMenu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../shared/ui/input-group'
import { Button } from '../shared/ui/button'
import { Tooltip as HintTooltip } from '../shared/Tooltip'
import { Tabs, TabsClosableTrigger, TabsContent, TabsList } from '../shared/ui/tabs'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { useHighlightedCode } from '../../hooks/useHighlightedCode'
import type {
  WorkspaceChangedFile,
  WorkspaceFileStatus,
  WorkspaceStatusResult,
  WorkspaceTreeResult,
} from '../../api/sessions'
import { useTranslation } from '../../i18n'
import { useShallow } from 'zustand/react/shallow'
import {
  getShellDisplayName,
  getWorkspacePreviewId,
  makePreviewKey,
  makeTreeKey,
  useWorkspacePanelStore,
  type WorkspacePreviewEntry,
  type WorkspacePreviewKind,
  type WorkspaceTab,
  type WorkspaceTabKind,
  type WorkspaceTabTarget,
} from '../../stores/workspacePanelStore'
import { useChatStore } from '../../stores/chatStore'
import { useKanbanStore } from '../../stores/kanbanStore'
import { TaskDetail } from '../kanban/TaskDetail'
import { InboxView } from '../kanban/InboxView'
import { useWorkspaceChatContextStore } from '../../stores/workspaceChatContextStore'
import { TerminalSettings } from '../../pages/TerminalSettings'
import { ArtifactsView } from './ArtifactsView'
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
    className: 'text-warning',
  },
  added: {
    label: 'A',
    className: 'text-success',
  },
  deleted: {
    label: 'D',
    className: 'text-destructive',
  },
  renamed: {
    label: 'R',
    className: 'text-primary',
  },
  untracked: {
    label: 'U',
    className: 'text-info',
  },
  copied: {
    label: 'C',
    className: 'text-success',
  },
  type_changed: {
    label: 'T',
    className: 'text-muted-foreground',
  },
  unknown: {
    label: '?',
    className: 'text-muted-foreground',
  },
}

const EMPTY_IDS: string[] = []
const EMPTY_TABS: WorkspaceTab[] = []

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

function getLineRangeForText(value: string, text: string) {
  const index = value.indexOf(text)
  if (index < 0) return {}
  const startLine = value.slice(0, index).split('\n').length
  const endLine = startLine + text.split('\n').length - 1
  return { startLine, endLine }
}

type FileMenu = [MenuAction, ...MenuEntry[]]

function withFileMenu(actions: MenuEntry[] | undefined, surface: ReactElement) {
  if (!actions) return surface
  return <RowActionMenu actions={actions} selectable>{() => surface}</RowActionMenu>
}

function addSelectionEntry(addFile: MenuAction, selection: WorkspaceQuoteSelection | null, onAddSelection: (selection: WorkspaceTextSelection) => void, label: string): MenuAction {
  return selection ? { ...addFile, label, onSelect: () => onAddSelection(selection) } : addFile
}

function CodeSurface({
  path,
  value,
  language,
  onAddLineComment,
  onAddSelection,
  wrap = false,
  fileMenu,
  className = 'min-h-0 flex-1 overflow-auto bg-code',
}: {
  path: string
  value: string
  language: string
  onAddLineComment: (line: number, note: string, quote: string) => void
  onAddSelection: (selection: WorkspaceTextSelection) => void
  wrap?: boolean
  fileMenu?: FileMenu
  className?: string
}) {
  const t = useTranslation()
  const copyAndNotify = useCopyAndNotify()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const commentMarkerRef = useRef<HTMLSpanElement>(null)
  const [commentLine, setCommentLineState] = useState<number | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [showAllLines, setShowAllLines] = useState(false)
  const [menuTarget, setMenuTarget] = useState<{ selection: WorkspaceQuoteSelection | null; line: number | null }>({ selection: null, line: null })
  const lines = value.split('\n')
  const setCommentLine = (line: number | null) => {
    setCommentLineState(line)
    setCommentDraft('')
  }
  const visibleLines = showAllLines ? lines : lines.slice(0, WORKSPACE_PREVIEW_LINE_LIMIT)
  const readSelection = (pointer: { clientX: number; clientY: number }) => {
    const selection = getTextSelectionFromContainer(surfaceRef.current, pointer)
    if (!selection?.startLine || !selection.endLine || selection.startLine === selection.endLine) return selection
    return { ...selection, text: visibleLines.slice(selection.startLine - 1, selection.endLine).join('\n').trim() }
  }
  const quote = useQuoteSelection(readSelection, value)
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

  const gutter = { gridTemplateColumns: `calc(${String(visibleLines.length).length + 1}ch + 1rem) minmax(0,1fr)` }

  const renderLineCommentEditor = (lineNumber: number) => {
    if (commentLine !== lineNumber) return null
    return (
      <div className="grid gap-3 px-2 py-1.5" style={gutter}>
        <span aria-hidden="true" />
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
      </div>
    )
  }

  const renderLineNumberButton = (lineNumber: number) => (
    <button
      type="button"
      aria-label={t('workspace.commentLine', { line: lineNumber })}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => setCommentLine(lineNumber)}
      className="select-none text-right text-2xs text-subtle-foreground transition-colors outline-none hover:text-primary focus-visible:text-primary pointer-coarse:text-primary"
    >
      {lineNumber}
    </button>
  )

  const showCommentMarker = (target: EventTarget | null) => {
    const marker = commentMarkerRef.current
    const button = target instanceof Element ? target.closest('[data-workspace-line-number]')?.querySelector('button') : null
    if (!marker) return
    if (!button) {
      delete marker.dataset.line
      return
    }
    marker.dataset.line = ''
    marker.style.top = `${button.offsetTop}px`
    marker.style.height = `${button.offsetHeight}px`
  }

  const selectAll = () => {
    const code = surfaceRef.current?.querySelector('[data-workspace-code]')
    const selection = window.getSelection()
    if (!code || !selection) return
    const range = document.createRange()
    range.selectNodeContents(code)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  const { selection: menuSelection, line: menuLine } = menuTarget
  const menuActions: MenuEntry[] | undefined = fileMenu && [
    addSelectionEntry(fileMenu[0], menuSelection, onAddSelection, t('workspace.addSelectionToChat')),
    { id: 'comment', label: t('workspace.addComment'), icon: <MessageSquare aria-hidden="true" />, disabled: menuLine === null, afterClose: true, onSelect: () => setCommentLine(menuLine) },
    { id: 'copy-selection', label: t('common.copy'), icon: <Copy aria-hidden="true" />, separatorBefore: true, disabled: !menuSelection, onSelect: () => void copyAndNotify(menuSelection?.text ?? '') },
    { id: 'select-all', label: t('workspace.selectAll'), icon: <TextSelect aria-hidden="true" />, afterClose: true, onSelect: selectAll },
    ...startGroup(fileMenu.slice(1)),
  ]

  return withFileMenu(menuActions,
    <div
      ref={surfaceRef}
      className={className}
      onMouseDown={quote.onMouseDown}
      onMouseOver={(event) => showCommentMarker(event.target)}
      onFocus={(event) => showCommentMarker(event.target)}
      onMouseLeave={() => showCommentMarker(null)}
      onContextMenu={(event) => {
        const lineNumber = event.target instanceof Element ? event.target.closest('[data-workspace-line-number]')?.getAttribute('data-workspace-line-number') : null
        setMenuTarget({ selection: readSelection(event), line: lineNumber ? Number(lineNumber) : null })
      }}
    >
      <div className={`relative py-2 ${wrap ? '' : 'min-w-max'}`}>
        <span ref={commentMarkerRef} aria-hidden="true" className="pointer-events-none invisible absolute left-2 flex items-center text-primary data-line:visible">
          <MessageSquare className="size-3" />
        </span>
        <pre data-workspace-code="" data-testid="workspace-code" className="m-0 font-mono text-xs leading-normal">
          {visibleLines.map((line, index) => {
            const lineNumber = index + 1
            return (
              <div key={lineNumber}>
                <div data-workspace-line-number={lineNumber} className="grid items-start gap-3 px-2 hover:bg-muted" style={gutter}>
                  {renderLineNumberButton(lineNumber)}
                  <span className={wrap ? 'whitespace-pre-wrap wrap-break-word pr-3' : 'whitespace-pre pr-6'}>{highlightedLines[index] || line || ' '}</span>
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
    </div>,
  )
}

function MarkdownSurface({
  value,
  onAddSelection,
  fileMenu,
  className = 'min-h-0 flex-1 overflow-auto bg-background',
}: {
  value: string
  onAddSelection: (selection: WorkspaceTextSelection) => void
  fileMenu?: FileMenu
  className?: string
}) {
  const t = useTranslation()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [menuSelection, setMenuSelection] = useState<WorkspaceQuoteSelection | null>(null)
  const readSelection = (pointer: { clientX: number; clientY: number }) =>
    getTextSelectionFromContainer(surfaceRef.current, pointer, (text) => getLineRangeForText(value, text))
  const quote = useQuoteSelection(readSelection, value)
  const menuActions: MenuEntry[] | undefined = fileMenu && [
    addSelectionEntry(fileMenu[0], menuSelection, onAddSelection, t('workspace.addSelectionToChat')),
    ...fileMenu.slice(1),
  ]

  return withFileMenu(menuActions,
    <div
      ref={surfaceRef}
      className={className}
      onMouseDown={quote.onMouseDown}
      onContextMenu={(event) => setMenuSelection(readSelection(event))}
    >
      <div className="mx-auto w-full max-w-[860px] px-4 py-3">
        <MarkdownRenderer
          content={value}
          variant="document"
          className="workspace-markdown-preview prose-p:text-sm prose-p:leading-7 prose-h1:text-2xl prose-h2:text-lg prose-h3:text-sm prose-code:text-xs prose-pre:my-4"
        />
      </div>
      <WorkspaceQuotePopover quote={quote} onAddSelection={onAddSelection} />
    </div>,
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
    <div className="overflow-auto rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-center">
        <img
          src={tab.dataUrl}
          alt={tab.path}
          className="max-h-full max-w-full rounded-lg border border-border bg-popover object-contain shadow-sm"
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
      className={`w-4 shrink-0 text-center font-mono text-2xs font-semibold ${meta.className}`}
      aria-label={status}
    >
      {meta.label}
    </span>
  )
}

function ChangedFileItem({
  file,
  expanded,
  onToggle,
  onOpen,
  actions,
  children,
}: {
  file: WorkspaceChangedFile
  expanded: boolean
  onToggle: () => void
  onOpen: () => void
  actions: MenuEntry[]
  children?: ReactNode
}) {
  const t = useTranslation()
  const { name, dir } = getPathParts(file.path)
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <div data-testid="workspace-file-item">
      <RowActionMenu actions={actions} hint={file.path} triggerLabel={t('workspace.moreFileActions')}>{(trigger) => (
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="row-sm"
            aria-expanded={expanded}
            aria-label={file.path}
            onClick={onToggle}
          >
            <Chevron size={13} strokeWidth={2} aria-hidden="true" className="shrink-0 text-subtle-foreground" />
            <FileCode size={13} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-subtle-foreground" />
            <span className="min-w-0 flex-1 truncate">
              <span>{name}</span>
              {dir && <span className="ml-1.5 text-2xs text-subtle-foreground">{dir}</span>}
            </span>
            <span className="shrink-0 whitespace-nowrap font-mono text-2xs">
              <span className="text-success">+{file.additions}</span>{' '}
              <span className="text-destructive">−{file.deletions}</span>
            </span>
            <FileStatusLetter status={file.status} />
          </Button>
          {file.status !== 'deleted' && (
            <HintTooltip content={t('workspace.openFile')}>
              <Button variant="ghost-muted" size="icon-sm" aria-label={t('workspace.openFile')} onClick={onOpen}>
                <ArrowUpRight aria-hidden="true" />
              </Button>
            </HintTooltip>
          )}
          {trigger}
        </div>
      )}</RowActionMenu>
      {expanded && children}
    </div>
  )
}

function getProjectName(status: WorkspaceStatusResult | undefined) {
  return status?.repoName || status?.workDir.split(/[\\/]/).filter(Boolean).pop() || null
}

function startGroup(entries: MenuEntry[]) {
  return entries.map((entry, index) => index === 0 ? { ...entry, separatorBefore: true } : entry)
}

type PathMenus = {
  fileMenu: MenuEntry[]
  directoryMenu: (path: string) => MenuEntry[]
  absolutePath: (path: string) => string
  onReveal?: (path: string, isDirectory: boolean) => void
}

function PathBreadcrumb({ root, path, action, menus }: { root: string | null; path: string | null; action?: ReactNode; menus: PathMenus }) {
  const t = useTranslation()
  const parts = (path ?? '').split('/').filter(Boolean)
  const segments = [
    ...(root ? [{ label: root, path: '', isDirectory: true }] : []),
    ...parts.map((label, index) => ({ label, path: parts.slice(0, index + 1).join('/'), isDirectory: index < parts.length - 1 })),
  ]
  const { onReveal } = menus
  const segmentMenu = (segment: { path: string; isDirectory: boolean }) => segment.isDirectory ? menus.directoryMenu(segment.path) : menus.fileMenu
  return (
    <div className="flex h-9 min-w-0 shrink-0 items-center gap-2 pr-2 pl-2">
      <nav aria-label={t('workspace.filePath')} className="flex min-w-0 flex-1 items-center overflow-hidden text-xs text-subtle-foreground">
        {segments.map((segment, index) => {
          const last = index === segments.length - 1
          return (
            <span key={segment.path} className={`flex min-w-0 items-center ${last ? 'shrink' : 'shrink-[999]'}`}>
              {index > 0 && <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden="true" />}
              <RowActionMenu actions={segmentMenu(segment)} hint={onReveal ? menus.absolutePath(segment.path) : undefined}>{() => {
                const button = (
                  <Button
                    type="button"
                    variant={last ? 'ghost' : 'ghost-muted'}
                    size="xs"
                    className="min-w-0 shrink"
                    onClick={onReveal ? () => onReveal(segment.path, segment.isDirectory) : undefined}
                  >
                    <span className="truncate">{segment.label}</span>
                  </Button>
                )
                return onReveal ? button : <ActionMenu actions={segmentMenu(segment)} label={menus.absolutePath(segment.path)} trigger={button} />
              }}</RowActionMenu>
            </span>
          )
        })}
      </nav>
      {action}
    </div>
  )
}

function FileExpandedBody({
  path,
  root = null,
  entry,
  loading,
  error,
  fill = false,
  onAddLineComment,
  onAddSelection,
  headerAction,
  openInEditor,
  aside,
  fileMenu,
  menus,
}: {
  path: string | null
  root?: string | null
  entry: WorkspacePreviewEntry | undefined
  loading: boolean
  error: string | null
  fill?: boolean
  onAddLineComment: (line: number, note: string, quote: string) => void
  onAddSelection: (selection: WorkspaceTextSelection) => void
  headerAction?: ReactNode
  openInEditor?: ReactNode
  aside?: ReactNode
  fileMenu: FileMenu
  menus: PathMenus
}) {
  const t = useTranslation()
  const [showPreview, setShowPreview] = useState(false)
  const [wrap, setWrap] = useState(true)
  const state = loading || !entry ? 'loading' : entry.state ?? 'loading'
  const isDiff = entry?.kind === 'diff'
  const isImage = state === 'ok' && entry?.previewType === 'image'
  const isMarkdownFile = state === 'ok' && !isDiff && !isImage && entry ? isMarkdownPreview(entry) : false
  const isMarkdown = isMarkdownFile && (showPreview || !fill)
  const isCode = state === 'ok' && !isDiff && !isImage && !isMarkdown
  const isEmptyDiff = state === 'ok' && isDiff && !(entry?.diff ?? '').trim()
  const frameClass = `overflow-auto ${fill ? 'min-h-0 flex-1' : 'max-h-[420px] rounded-md'}`
  const codeSurfaceClass = `${frameClass} bg-code`
  const contentMenu = fill && path !== null && state === 'ok' ? fileMenu : undefined

  let content: ReactNode
  if (path === null) {
    content = <PanelMessage icon={FileCode} message={t('workspace.selectFile')} />
  } else if (state === 'loading') {
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
        onAddLineComment={onAddLineComment}
        onAddSelection={onAddSelection}
      />
    )
  } else if (isImage && entry) {
    content = withFileMenu(contentMenu, <ImagePreview tab={entry} />)
  } else if (isMarkdown) {
    content = (
      <MarkdownSurface
        value={entry?.content ?? ''}
        onAddSelection={onAddSelection}
        fileMenu={contentMenu}
        className={`${frameClass} bg-background`}
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
        wrap={wrap}
        fileMenu={contentMenu}
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

  if (!fill) return <div data-testid="workspace-file-body" className="pb-3 pl-6.25 pr-0.5">{content}</div>

  const toggleButton = (label: string, icon: ReactNode, pressed: boolean, onToggle: () => void) => (
    <HintTooltip content={label}>
      <Button variant="ghost-muted" size="icon-xs" aria-label={label} aria-pressed={pressed} onClick={onToggle}>
        {icon}
      </Button>
    </HintTooltip>
  )
  return (
    <div data-testid="workspace-file-body" className="flex min-h-0 flex-1 flex-col">
      <PathBreadcrumb root={root} path={path} menus={menus} action={
        <div className="flex shrink-0 items-center gap-0.5">
          {path !== null && openInEditor && <div className="mr-1 flex">{openInEditor}</div>}
          {isMarkdownFile && toggleButton(t('workspace.showPreview'), <Eye aria-hidden="true" />, showPreview, () => setShowPreview((value) => !value))}
          {isCode && toggleButton(t('workspace.wrapLines'), <WrapText aria-hidden="true" />, wrap, () => setWrap((value) => !value))}
          {headerAction}
        </div>
      } />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="file-content" minSize={200} className="flex min-h-0 min-w-0 flex-col">
          {content}
        </ResizablePanel>
        {aside}
      </ResizablePanelGroup>
    </div>
  )
}

function useWorkspaceFileActions(sessionId: string) {
  const t = useTranslation()
  const copyAndNotify = useCopyAndNotify()
  const workDir = useWorkspacePanelStore((state) => state.statusBySession[sessionId]?.workDir)
  const openTab = useWorkspacePanelStore((state) => state.openTab)
  const selectFile = useWorkspacePanelStore((state) => state.selectFile)
  const addWorkspaceReference = useWorkspaceChatContextStore((state) => state.addReference)
  const desktop = isDesktopRuntime()
  const openTargets = useOpenTargets(desktop)

  const absolutePath = (path: string) => path ? resolveWorkspaceAttachmentPath(workDir, path) : workDir ?? ''

  const addPathToChat = (path: string, isDirectory = false) => {
    addWorkspaceReference(sessionId, {
      kind: 'file',
      path: path || '.',
      absolutePath: absolutePath(path),
      name: getWorkspaceReferenceName(path || absolutePath(path), isDirectory),
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

  const copyPath = (text: string) => void copyAndNotify(text, t('workspace.pathCopied'))

  const addAction = (path: string, isDirectory = false): MenuAction => (
    { id: 'add', label: t('workspace.addToChat'), icon: <MessageSquarePlus aria-hidden="true" />, onSelect: () => addPathToChat(path, isDirectory) }
  )

  const copySubmenu = (path: string): MenuSubmenu => ({
    id: 'copy',
    label: t('workspace.copyPath'),
    icon: <Copy aria-hidden="true" />,
    items: [
      { id: 'relative', label: t('workspace.relativePath'), onSelect: () => copyPath(path || '.') },
      { id: 'absolute', label: t('workspace.absolutePath'), onSelect: () => copyPath(absolutePath(path)) },
    ],
  })

  const copyContents = (content: string): MenuAction => (
    { id: 'copy-contents', label: t('workspace.copyFileContents'), icon: <ClipboardCopy aria-hidden="true" />, onSelect: () => void copyAndNotify(content, t('workspace.contentsCopied')) }
  )

  const locationEntries = (path: string, isDirectory: boolean): MenuEntry[] => {
    if (!desktop) return []
    const target = absolutePath(path)
    const failure = t(isDirectory ? 'openProject.openFailed' : 'openProject.openFileFailed')
    const editors = openTargets.targets.filter((item) => item.kind === 'ide')
    const fileManagers = openTargets.targets.filter((item) => item.kind === 'file_manager')
    return [
      ...(editors.length > 0 ? [{
        id: 'open-in',
        label: t('workspace.openIn'),
        icon: <AppWindow aria-hidden="true" />,
        items: editors.map((editor) => ({ id: editor.id, label: editor.label, icon: <TargetIcon target={editor} size={16} />, onSelect: () => void openTargets.open(editor.id, target, failure) })),
      }] : []),
      ...fileManagers.map((manager) => ({ id: `reveal:${manager.id}`, label: t('openProject.revealIn', { target: manager.label }), icon: <FolderOpen aria-hidden="true" />, onSelect: () => void openTargets.open(manager.id, target, failure) })),
      ...(isDirectory ? [{ id: 'terminal', label: t('workspace.openInTerminal'), icon: <SquareTerminal aria-hidden="true" />, onSelect: () => { openTab(sessionId, { kind: 'terminal', cwd: target }) } }] : []),
    ]
  }

  const directoryMenu = (path: string): MenuEntry[] => [addAction(path, true), copySubmenu(path), ...startGroup(locationEntries(path, true))]

  const changeActions = (path: string, deleted: boolean): MenuEntry[] => [
    addAction(path),
    copySubmenu(path),
    ...(deleted ? [] : startGroup([
      { id: 'open-file', label: t('workspace.openFile'), icon: <ArrowUpRight aria-hidden="true" />, onSelect: () => selectFile(sessionId, path) },
      ...locationEntries(path, false),
    ])),
  ]

  const treeFileMenu = (path: string): MenuEntry[] => [
    { id: 'open-tab', label: t('workspace.openInNewTab'), icon: <AppWindow aria-hidden="true" />, onSelect: () => { openTab(sessionId, { kind: 'file', path }) } },
    addAction(path),
    copySubmenu(path),
    ...startGroup(locationEntries(path, false)),
  ]

  return { addPathToChat, addLineComment, addSelection, absolutePath, addAction, copySubmenu, copyContents, directoryMenu, changeActions, treeFileMenu }
}

function PreviewBody({ sessionId, path, kind, fill = false, headerAction, aside, onReveal }: {
  sessionId: string
  path: string | null
  kind: WorkspacePreviewKind
  fill?: boolean
  headerAction?: ReactNode
  aside?: ReactNode
  onReveal?: (path: string, isDirectory: boolean) => void
}) {
  const previewId = path === null ? '' : getWorkspacePreviewId(path, kind)
  const requestKey = makePreviewKey(sessionId, previewId)
  const entry = useWorkspacePanelStore((state) => state.previewsBySession[sessionId]?.[previewId])
  const loading = useWorkspacePanelStore((state) => state.loading.previewById[requestKey] ?? false)
  const error = useWorkspacePanelStore((state) => state.errors.previewById[requestKey] ?? null)
  const root = useWorkspacePanelStore((state) => fill ? getProjectName(state.statusBySession[sessionId]) : null)
  const actions = useWorkspaceFileActions(sessionId)
  const filePath = path ?? ''
  const fileMenu: FileMenu = [
    actions.addAction(filePath),
    actions.copySubmenu(filePath),
    ...(entry?.state === 'ok' && entry.previewType !== 'image' && entry.content !== undefined ? [actions.copyContents(entry.content)] : []),
  ]
  return (
    <FileExpandedBody
      path={path}
      root={root}
      entry={entry}
      loading={loading}
      error={error}
      fill={fill}
      onAddLineComment={(line, note, quote) => actions.addLineComment(filePath, line, note, quote)}
      onAddSelection={(selection) => actions.addSelection(filePath, selection)}
      headerAction={headerAction}
      openInEditor={fill && isDesktopRuntime() ? <OpenProjectMenu path={actions.absolutePath(filePath)} subject="file" /> : undefined}
      aside={aside}
      fileMenu={fileMenu}
      menus={{
        fileMenu,
        directoryMenu: actions.directoryMenu,
        absolutePath: actions.absolutePath,
        onReveal,
      }}
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
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <SearchField
          variant="ghost"
          value={filter}
          onChange={onFilterChange}
          aria-label={t('workspace.filterPlaceholder')}
          placeholder={t('workspace.filterPlaceholder')}
          className="min-w-0 flex-1"
        />
        <HintTooltip content={t('workspace.refresh')}>
          <Button variant="ghost-muted" size="icon-xs" aria-label={t('workspace.refresh')} onClick={onRefresh}>
            <RefreshCw aria-hidden="true" />
          </Button>
        </HintTooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">{children}</div>
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
  const selectFile = useWorkspacePanelStore((state) => state.selectFile)
  const { changeActions } = useWorkspaceFileActions(sessionId)
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
            onOpen={() => selectFile(sessionId, file.path)}
            actions={changeActions(file.path, file.status === 'deleted')}
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

const NARROW_FILES_WIDTH = 520

function useNarrow(threshold: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width < threshold)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [threshold])
  return { ref, narrow }
}

function FilesView({ sessionId }: { sessionId: string }) {
  const t = useTranslation()
  const [filterQuery, setFilterQuery] = useState('')
  const { ref, narrow } = useNarrow(NARROW_FILES_WIDTH)
  const [treeChoice, setTreeChoice] = useState<{ narrow: boolean; open: boolean } | null>(null)
  const [reveal, setReveal] = useState<TreeReveal | null>(null)
  const rootTree = useWorkspacePanelStore((state) => state.treeBySessionPath[sessionId]?.[''])
  const rootTreeLoading = useWorkspacePanelStore((state) => state.loading.treeBySessionPath[makeTreeKey(sessionId, '')] ?? false)
  const rootTreeError = useWorkspacePanelStore((state) => state.errors.treeBySessionPath[makeTreeKey(sessionId, '')] ?? null)
  const selectedFile = useWorkspacePanelStore((state) => state.panelByTab[sessionId]?.selectedFile ?? null)
  const treeOpen = treeChoice?.narrow === narrow ? treeChoice.open : !narrow || selectedFile === null
  const loadTree = useWorkspacePanelStore((state) => state.loadTree)
  const selectFile = useWorkspacePanelStore((state) => state.selectFile)
  const ensurePreview = useWorkspacePanelStore((state) => state.ensurePreview)
  const { directoryMenu, treeFileMenu } = useWorkspaceFileActions(sessionId)

  useEffect(() => {
    if (rootTree || rootTreeLoading || rootTreeError) return
    void loadTree(sessionId, '')
  }, [loadTree, rootTree, rootTreeError, rootTreeLoading, sessionId])

  useEffect(() => {
    if (selectedFile) void ensurePreview(sessionId, selectedFile, 'file')
  }, [ensurePreview, selectedFile, sessionId])

  const treeLabel = t(treeOpen ? 'workspace.hideFileTree' : 'workspace.showFileTree')
  const treeToggle = (
    <HintTooltip content={treeLabel}>
      <Button
        variant="ghost-muted"
        size="icon-xs"
        aria-pressed={treeOpen}
        aria-label={treeLabel}
        onClick={() => setTreeChoice({ narrow, open: !treeOpen })}
      >
        <FolderTree aria-hidden="true" />
      </Button>
    </HintTooltip>
  )

  const renderTree = () => {
    if (rootTreeLoading && !rootTree) return <PanelLoading label={t('common.loading')} />
    if (rootTreeError) return <PanelMessage icon={CircleAlertIcon} tone="error" message={rootTreeError} />
    if (rootTree?.state === 'missing') return <PanelMessage icon={FolderXIcon} message={t('workspace.missingWorkdir')} />
    if (rootTree?.state === 'error') return <PanelMessage icon={CircleAlertIcon} tone="error" message={rootTree.error || t('workspace.loadError')} />
    if (!rootTree) return <PanelLoading label={t('common.loading')} />
    if (rootTree.entries.length === 0) return <PanelMessage icon={FolderOpenIcon} message={t('workspace.noFiles')} />
    return (
      <WorkspaceFileTree
        sessionId={sessionId}
        label={t('workspace.allFiles')}
        filter={filterQuery}
        selectedPath={selectedFile}
        reveal={reveal}
        onOpenFile={(path) => selectFile(sessionId, path)}
        getActions={(path, isDirectory) => isDirectory ? directoryMenu(path) : treeFileMenu(path)}
      />
    )
  }

  const tree = treeOpen && (
    <>
      <ResizableHandle aria-label={t('workspace.resizeFileTree')} />
      <ResizablePanel id="files-tree" defaultSize="40%" minSize={160} maxSize="70%" groupResizeBehavior="preserve-pixel-size" className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-1 px-2">
          <HintTooltip content={t('workspace.refresh')}>
            <Button variant="ghost-muted" size="icon-xs" aria-label={t('workspace.refresh')} onClick={() => void loadTree(sessionId, '')}>
              <RefreshCw aria-hidden="true" />
            </Button>
          </HintTooltip>
          <SearchField
            variant="ghost"
            value={filterQuery}
            onChange={setFilterQuery}
            aria-label={t('workspace.filterPlaceholder')}
            placeholder={t('workspace.filterPlaceholder')}
            className="min-w-0 flex-1"
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-1 pb-2">{renderTree()}</div>
      </ResizablePanel>
    </>
  )

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      <PreviewBody
        sessionId={sessionId}
        path={selectedFile}
        kind="file"
        fill
        headerAction={treeToggle}
        aside={tree}
        onReveal={(path, isDirectory) => {
          setTreeChoice({ narrow, open: true })
          setReveal((current) => ({ path, isDirectory, nonce: (current?.nonce ?? 0) + 1 }))
        }}
      />
    </div>
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
  const selectFile = useWorkspacePanelStore((state) => state.selectFile)
  const recentFiles = useWorkspacePanelStore((state) => state.panelByTab[sessionId]?.recentFiles ?? EMPTY_IDS)
  const uiPages = useChatStore((state) => state.sessions[sessionId]?.mirror?.uiPages ?? EMPTY_UI_PAGES)
  const desktop = isDesktopRuntime()
  const tools: Array<{ target: WorkspaceTabTarget; kind: WorkspaceTabKind; label: string }> = [
    ...(desktop ? [{ target: { kind: 'terminal' } as const, kind: 'terminal' as const, label: t('workspace.tabTerminal') }] : []),
    { target: { kind: 'files' }, kind: 'files', label: t('workspace.tabFiles') },
    { target: { kind: 'changes' }, kind: 'changes', label: t('workspace.tabChanges') },
    ...(desktop ? [{ target: { kind: 'artifacts' } as const, kind: 'artifacts' as const, label: t('workspace.tabArtifacts') }] : []),
  ]
  const recents: Array<{ key: string; kind: WorkspaceTabKind; label: string; detail?: string; open: () => void }> = [
    ...uiPages.map((page) => ({
      key: `page:${page.pageId}`,
      kind: 'uiPage' as const,
      label: page.title,
      detail: t('workspace.launcher.pageRevision', { revision: page.revision }),
      open: () => openTab(sessionId, { kind: 'uiPage', pageId: page.pageId, revision: page.revision, title: page.title }),
    })),
    ...recentFiles.map((path) => ({
      key: `file:${path}`,
      kind: 'file' as const,
      label: getPathParts(path).name,
      detail: getPathParts(path).dir || undefined,
      open: () => selectFile(sessionId, path),
    })),
  ]

  const submit = (event: FormEvent) => {
    event.preventDefault()
    openAddress(sessionId, draft, projectRoot).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error))
    })
  }

  return (
    <div data-testid="workspace-launcher" className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-6 py-8">
      <div className="flex w-full max-w-xs flex-col gap-0.5">
        <h3 className="mb-3 text-center text-sm font-medium text-foreground">{t('workspace.launcher.title')}</h3>
        <form onSubmit={submit} className="mb-1.5">
          <InputGroup>
            <InputGroupAddon><Globe aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={t('workspace.launcher.address')}
              placeholder={t(desktop ? 'workspace.launcher.addressPlaceholder' : 'workspace.launcher.pathPlaceholder')}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </InputGroup>
        </form>
        {tools.map(({ target, kind, label }) => {
          const Icon = TAB_ICONS[kind]
          return (
            <Button key={kind} variant="ghost" size="row" onClick={() => openTab(sessionId, target)}>
              <Icon className="text-subtle-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </Button>
          )
        })}
        {recents.length > 0 && (
          <section className="mt-3 flex flex-col gap-0.5" aria-labelledby={`${sessionId}-launcher-recent`}>
            <h4 id={`${sessionId}-launcher-recent`} className="px-2 pb-1 text-xs text-subtle-foreground">
              {t('workspace.launcher.recent')}
            </h4>
            {recents.map(({ key, kind, label, detail, open }) => {
              const Icon = TAB_ICONS[kind]
              return (
                <Button key={key} variant="ghost" size="row" onClick={open}>
                  <Icon className="text-subtle-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">
                    <span>{label}</span>
                    {detail && <span className="ml-1.5 text-xs text-subtle-foreground">{detail}</span>}
                  </span>
                </Button>
              )
            })}
          </section>
        )}
      </div>
    </div>
  )
}

const TAB_ICONS: Record<WorkspaceTabKind, LucideIcon> = {
  launcher: LayoutGrid,
  changes: FileDiffIcon,
  files: FolderTree,
  artifacts: Layers,
  file: FileCode,
  browser: Globe,
  terminal: SquareTerminal,
  uiPage: AppWindow,
  task: SquareKanban,
  inbox: Inbox,
}

function getTabTitle(t: ReturnType<typeof useTranslation>, tab: WorkspaceTab, taskTitles: Record<string, string>) {
  switch (tab.kind) {
    case 'launcher':
      return t('workspace.newTab')
    case 'changes':
      return t('workspace.tabChanges')
    case 'files':
      return t('workspace.tabFiles')
    case 'artifacts':
      return t('workspace.tabArtifacts')
    case 'file':
      return getPathParts(tab.path).name
    case 'browser':
      return tab.title || tab.url || t('workspace.tabBrowser')
    case 'terminal':
      return `${tab.shell ?? t('terminal.defaultName')} ${tab.index}`
    case 'uiPage':
      return t('uiPage.revision', { title: tab.title, revision: tab.revision })
    case 'task':
      return `#${tab.card} ${taskTitles[tab.id] ?? ''}`.trim()
    case 'inbox':
      return t('kanban.inbox.title')
  }
}

function WorkspaceRefresh({ sessionId }: { sessionId: string }) {
  useWorkspaceRefresh(sessionId)
  return null
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

export type WorkspacePanelProps = {
  panelId: string
  sessionTitle: string
  titleRowStyle?: CSSProperties
  titleRowClass?: string
  terminalCwd?: string
  contextLabel?: string
  projectRoot?: string | null
  tasksOnly?: boolean
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const isOpen = useWorkspacePanelStore((state) => state.isPanelOpen(props.panelId))
  return isOpen ? <OpenWorkspacePanel {...props} /> : null
}

function OpenWorkspacePanel({ panelId: sessionId, sessionTitle, titleRowStyle, titleRowClass = '', terminalCwd, contextLabel, projectRoot = null, tasksOnly = false }: WorkspacePanelProps) {
  const t = useTranslation()
  const tabs = useWorkspacePanelStore((state) => state.panelByTab[sessionId]?.tabs ?? EMPTY_TABS)
  const activeTabId = useWorkspacePanelStore((state) => state.panelByTab[sessionId]?.activeTabId ?? null)
  const expanded = useWorkspacePanelStore((state) => state.isPanelExpanded(sessionId))
  const openTab = useWorkspacePanelStore((state) => state.openTab)
  const activateTab = useWorkspacePanelStore((state) => state.activateTab)
  const closeTab = useWorkspacePanelStore((state) => state.closeTab)
  const toggleExpanded = useWorkspacePanelStore((state) => state.toggleExpanded)
  const closePanel = useWorkspacePanelStore((state) => state.closePanel)
  const taskTitles = useKanbanStore(useShallow((state) => Object.fromEntries(tabs.flatMap((tab) =>
    tab.kind === 'task' ? [[tab.id, state.views[tab.board]?.cards.find((card) => card.id === tab.card)?.title ?? '']] : []))))

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
      case 'artifacts':
        return <ArtifactsView sessionId={sessionId} />
      case 'file':
        return <FileTabView sessionId={tab.sessionId ?? sessionId} path={tab.path} />
      case 'browser':
        return <BrowserView sessionId={sessionId} tab={tab} projectRoot={projectRoot} />
      case 'uiPage':
        return <UiPageTabView sessionId={sessionId} tab={tab} />
      case 'task':
        return <TaskDetail panelId={sessionId} board={tab.board} card={tab.card} poll={!tasksOnly} />
      case 'inbox':
        return <InboxView panelId={sessionId} board={tab.board} />
      case 'terminal':
        return null
    }
  }

  return (
    <Tabs value={activeTabId ?? ''} onValueChange={(id) => activateTab(sessionId, id)} asChild>
      <aside
        data-testid="workspace-panel"
        aria-label={t('workspace.panelTabs')}
        className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background"
      >
        {!tasksOnly && <WorkspaceRefresh sessionId={sessionId} />}
        <div style={titleRowStyle} className={`window-drag-region flex shrink-0 select-none items-center gap-1 pl-2 pr-2 ${titleRowClass}`}>
          {expanded && (
            <HintTooltip content={t('workspace.backToChat')}>
              <Button
                variant="ghost-muted"
                size="xs"
                onClick={() => toggleExpanded(sessionId)}
                className="max-w-50 shrink-0"
              >
                <MessageSquare size={12} strokeWidth={1.9} className="shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{sessionTitle}</span>
              </Button>
            </HintTooltip>
          )}
          <TabsList aria-label={t('workspace.panelTabs')} className="min-w-0 flex-1 justify-start overflow-x-auto overflow-y-hidden">
            {tabs.map((tab) => {
              const title = getTabTitle(t, tab, taskTitles)
              const Icon = TAB_ICONS[tab.kind]
              return (
                <TabsClosableTrigger
                  key={tab.id}
                  value={tab.id}
                  data-panel-tab={tab.kind}
                  title={title}
                  icon={<Icon aria-hidden="true" />}
                  closeLabel={t('workspace.closeTab', { name: title })}
                  onClose={() => closeTab(sessionId, tab.id)}
                  className="max-w-44"
                >
                  {title}
                </TabsClosableTrigger>
              )
            })}
          </TabsList>
          {!tasksOnly && (
            <HintTooltip content={t('workspace.newTab')}>
              <Button variant="ghost-muted" size="icon-xs" aria-label={t('workspace.newTab')} onClick={() => openTab(sessionId, { kind: 'launcher' })}>
                <Plus aria-hidden="true" />
              </Button>
            </HintTooltip>
          )}
          <HintTooltip content={expandLabel}>
            <Button variant="ghost-muted" size="icon-sm" aria-label={expandLabel} onClick={() => toggleExpanded(sessionId)}>
              {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </Button>
          </HintTooltip>
          <HintTooltip content={t('workspace.closeSidePanel')}>
            <Button variant="ghost-muted" size="icon-sm" aria-label={t('workspace.closeSidePanel')} onClick={() => closePanel(sessionId)}>
              <PanelRight aria-hidden="true" />
            </Button>
          </HintTooltip>
        </div>

        {tabs.filter((tab) => tab.kind === 'terminal').map((tab) => (
          <TabsContent key={tab.id} value={tab.id} forceMount hidden={tab.id !== activeTabId} data-testid="session-terminal-panel" className="flex min-h-0 flex-1 flex-col">
            <TerminalTabView sessionId={sessionId} tab={tab} active={tab.id === activeTabId} cwd={tab.cwd ?? terminalCwd} contextLabel={contextLabel} />
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
