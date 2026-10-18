import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  FileCode,
  Files,
  Folder,
  Maximize2,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  Minimize2,
  Plus,
  RefreshCw,
  SquareTerminal,
  X,
} from 'lucide-react'
import { Highlight } from 'prism-react-renderer'
import type {
  WorkspaceChangedFile,
  WorkspaceFileStatus,
  WorkspaceTreeEntry,
  WorkspaceTreeResult,
} from '../../api/sessions'
import { moveRovingFocus } from '../../lib/rovingFocus'
import { useTranslation } from '../../i18n'
import { useShallow } from 'zustand/react/shallow'
import {
  getWorkspacePreviewId,
  useWorkspacePanelStore,
  type WorkspacePreviewEntry,
  type WorkspacePreviewKind,
} from '../../stores/workspacePanelStore'
import {
  getShellDisplayName,
  useTerminalPanelStore,
  type SessionTerminal,
} from '../../stores/terminalPanelStore'
import { useChatStore } from '../../stores/chatStore'
import { useWorkspaceChatContextStore } from '../../stores/workspaceChatContextStore'
import { useUIStore } from '../../stores/uiStore'
import { TerminalSettings } from '../../pages/TerminalSettings'
import { SearchField } from '../shared/SearchField'
import { copyTextToClipboard } from '../chat/clipboard'
import { clearWindowSelection, getSelectionPopoverPosition, useSelectionPopoverDismiss } from '../../hooks/useSelectionPopoverDismiss'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import {
  getFileExtension,
  LineCommentEditor,
  normalizePrismLanguage,
  WORKSPACE_PREVIEW_LINE_LIMIT,
  WorkspaceDiffSurface,
  workspacePrismTheme,
} from './WorkspaceCodeSurface'

type FileContextMenuState = {
  path: string
  isDirectory: boolean
  x: number
  y: number
}

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
const EMPTY_PREVIEWS: Record<string, WorkspacePreviewEntry | undefined> = {}
const EMPTY_IDS: string[] = []
const SELECTION_MENU_OFFSET = 10
const SELECTION_MENU_WIDTH = 158
const SELECTION_MENU_HEIGHT = 44

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

type WorkspaceTextSelection = {
  text: string
  startLine?: number
  endLine?: number
}

type FloatingSelectionMenuState = WorkspaceTextSelection & {
  x: number
  y: number
}

type SelectionPointer = {
  clientX: number
  clientY: number
}

function getElementForNode(node: Node | null): Element | null {
  if (!node) return null
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
}

function getLineNumberFromNode(node: Node | null, root: HTMLElement) {
  const element = getElementForNode(node)
  const row = element?.closest('[data-workspace-line-number]')
  if (!row || !root.contains(row)) return undefined
  const line = Number(row.getAttribute('data-workspace-line-number'))
  return Number.isFinite(line) ? line : undefined
}

function getSelectionPosition(range: Range, root: HTMLElement, pointer?: SelectionPointer) {
  return getSelectionPopoverPosition(range, root, {
    menuWidth: SELECTION_MENU_WIDTH,
    menuHeight: SELECTION_MENU_HEIGHT,
    offset: SELECTION_MENU_OFFSET,
    fallbackPointer: pointer,
  })
}

function getTextSelectionFromContainer(
  root: HTMLElement | null,
  resolveLines?: (text: string, range: Range) => { startLine?: number; endLine?: number },
  pointer?: SelectionPointer,
): FloatingSelectionMenuState | null {
  if (!root) return null

  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const startElement = getElementForNode(range.startContainer)
  const endElement = getElementForNode(range.endContainer)
  if (!startElement || !endElement || !root.contains(startElement) || !root.contains(endElement)) {
    return null
  }

  const text = selection.toString().trim()
  if (!text) return null

  const nodeLines = {
    startLine: getLineNumberFromNode(range.startContainer, root),
    endLine: getLineNumberFromNode(range.endContainer, root),
  }
  const resolvedLines = resolveLines?.(text, range) ?? nodeLines
  const startLine = resolvedLines.startLine ?? nodeLines.startLine
  const endLine = resolvedLines.endLine ?? nodeLines.endLine ?? startLine
  const orderedStart = startLine && endLine ? Math.min(startLine, endLine) : startLine
  const orderedEnd = startLine && endLine ? Math.max(startLine, endLine) : endLine

  return {
    ...getSelectionPosition(range, root, pointer),
    text,
    ...(orderedStart ? { startLine: orderedStart } : {}),
    ...(orderedEnd ? { endLine: orderedEnd } : {}),
  }
}

function getLineRangeForText(value: string, text: string) {
  const index = value.indexOf(text)
  if (index < 0) return {}
  const startLine = value.slice(0, index).split('\n').length
  const endLine = startLine + text.split('\n').length - 1
  return { startLine, endLine }
}

function FloatingSelectionMenu({
  selection,
  onAdd,
  popoverRef,
}: {
  selection: FloatingSelectionMenuState | null
  onAdd: () => void
  popoverRef: { current: HTMLButtonElement | null }
}) {
  const t = useTranslation()
  if (!selection) return null

  return (
    <button
      ref={popoverRef}
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onAdd}
      className="fixed z-50 inline-flex h-11 items-center gap-2 rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-lowest)] px-5 text-[15px] font-semibold text-[var(--color-text-primary)] shadow-[0_10px_28px_rgba(15,23,42,0.14),0_2px_8px_rgba(15,23,42,0.08)] transition-colors hover:bg-[var(--color-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
      style={{ left: selection.x, top: selection.y }}
    >
      <MessageCircle size={21} strokeWidth={2.15} className="shrink-0 text-[var(--color-text-primary)]" aria-hidden="true" />
      <span>{t('workspace.addSelectionToChat')}</span>
    </button>
  )
}

function PanelMessage({
  icon,
  message,
  tone = 'muted',
  compact = false,
}: {
  icon: string
  message: string
  tone?: 'muted' | 'error'
  compact?: boolean
}) {
  const toneClass =
    tone === 'error'
      ? 'text-[var(--color-error)]'
      : 'text-[var(--color-text-tertiary)]'

  return (
    <div
      className={`flex items-center gap-2 px-4 ${compact ? 'py-2 text-[11px]' : 'py-8 text-xs'} ${toneClass}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className={`material-symbols-outlined shrink-0 text-[16px] ${icon === 'progress_activity' ? 'animate-spin' : ''}`}>
        {icon}
      </span>
      <span className="min-w-0 leading-relaxed">{message}</span>
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
  const selectionMenuRef = useRef<HTMLButtonElement>(null)
  const [commentLine, setCommentLineState] = useState<number | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [showAllLines, setShowAllLines] = useState(false)
  const [selectionMenu, setSelectionMenu] = useState<FloatingSelectionMenuState | null>(null)
  const lines = value.split('\n')
  const setCommentLine = (line: number | null) => {
    setCommentLineState(line)
    setCommentDraft('')
  }
  const visibleLines = showAllLines ? lines : lines.slice(0, WORKSPACE_PREVIEW_LINE_LIMIT)
  const activeQuote = commentLine ? visibleLines[commentLine - 1] ?? '' : ''
  const usePlainLargePreview = showAllLines && lines.length > WORKSPACE_PREVIEW_LINE_LIMIT
  const visibleCode = usePlainLargePreview ? '' : visibleLines.join('\n')

  useEffect(() => {
    setShowAllLines(false)
    setCommentLine(null)
    setSelectionMenu(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, language])

  // A refresh of the same file keeps the open editor while its line still exists.
  useEffect(() => {
    setSelectionMenu(null)
    if (commentLine !== null && commentLine > lines.length) setCommentLine(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    if (commentRequest > 0) setCommentLine(1)
  }, [commentRequest])

  const dismissSelectionMenu = useCallback(() => {
    setSelectionMenu(null)
  }, [])

  useSelectionPopoverDismiss({
    active: Boolean(selectionMenu),
    popoverRef: selectionMenuRef,
    onDismiss: dismissSelectionMenu,
  })

  const handleSelectionMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    const selection = getTextSelectionFromContainer(surfaceRef.current, undefined, event)
    if (!selection?.startLine || !selection.endLine || selection.startLine === selection.endLine) {
      setSelectionMenu(selection)
      return
    }

    setSelectionMenu({
      ...selection,
      text: visibleLines.slice(selection.startLine - 1, selection.endLine).join('\n').trim(),
    })
  }

  const addCurrentSelectionToChat = () => {
    if (!selectionMenu) return
    onAddSelection({
      text: selectionMenu.text,
      startLine: selectionMenu.startLine,
      endLine: selectionMenu.endLine,
    })
    setSelectionMenu(null)
    clearWindowSelection()
  }

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
      onMouseUp={handleSelectionMouseUp}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setSelectionMenu(null)
      }}
    >
      <div className="relative min-w-max py-2">
        {usePlainLargePreview ? (
          <pre
            data-workspace-code=""
            data-testid="workspace-code"
            className="m-0 font-[var(--font-mono)] text-[12px] leading-[1.55]"
            style={{ color: 'var(--color-code-fg)', background: 'transparent' }}
          >
            {visibleLines.map((line, index) => {
              const lineNumber = index + 1
              return (
                <div key={lineNumber}>
                  <div
                    className="group grid grid-cols-[48px_minmax(0,1fr)] gap-3 px-3 hover:bg-[var(--color-surface-hover)]"
                    data-workspace-line-number={lineNumber}
                  >
                    {renderLineNumberButton(lineNumber)}
                    <span className="whitespace-pre pr-6">{line || ' '}</span>
                  </div>
                  {renderLineCommentEditor(lineNumber)}
                </div>
              )
            })}
          </pre>
        ) : (
          <Highlight
            theme={workspacePrismTheme}
            code={visibleCode}
            language={normalizePrismLanguage(language)}
          >
            {({ tokens, getLineProps, getTokenProps }) => (
              <pre
                data-workspace-code=""
                data-testid="workspace-code"
                className="m-0 font-[var(--font-mono)] text-[12px] leading-[1.55]"
                style={{ color: 'var(--color-code-fg)', background: 'transparent' }}
              >
                {tokens.map((line, index) => {
                  const { key: lineKey, ...lineProps } = getLineProps({ line, key: index })
                  const lineNumber = index + 1
                  return (
                    <div key={String(lineKey)}>
                      <div
                        {...lineProps}
                        data-workspace-line-number={lineNumber}
                        className="group grid grid-cols-[48px_minmax(0,1fr)] gap-3 px-3 hover:bg-[var(--color-surface-hover)]"
                      >
                        {renderLineNumberButton(lineNumber)}
                        <span className="whitespace-pre pr-6">
                          {line.length === 1 && line[0]?.empty ? ' ' : line.map((token, tokenIndex) => {
                            const { key: tokenKey, ...tokenProps } = getTokenProps({ token, key: tokenIndex })
                            return <span key={String(tokenKey)} {...tokenProps} />
                          })}
                        </span>
                      </div>
                      {renderLineCommentEditor(lineNumber)}
                    </div>
                  )
                })}
              </pre>
            )}
          </Highlight>
        )}
        {lines.length > WORKSPACE_PREVIEW_LINE_LIMIT && (
          <div className="sticky bottom-0 flex items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-glass)] px-3 py-2 text-xs text-[var(--color-text-tertiary)] backdrop-blur">
            <span>
              {showAllLines
                ? t('workspace.previewAllLines', { total: lines.length })
                : t('workspace.previewLineLimit', { count: visibleLines.length, total: lines.length })}
            </span>
            <button
              type="button"
              onClick={() => setShowAllLines((current) => !current)}
              className="ml-auto rounded-[6px] px-2 py-1 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              {showAllLines ? t('workspace.collapsePreview') : t('workspace.showAllLoadedLines')}
            </button>
          </div>
        )}
      </div>
      <FloatingSelectionMenu selection={selectionMenu} onAdd={addCurrentSelectionToChat} popoverRef={selectionMenuRef} />
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
  const selectionMenuRef = useRef<HTMLButtonElement>(null)
  const [selectionMenu, setSelectionMenu] = useState<FloatingSelectionMenuState | null>(null)

  useEffect(() => {
    setSelectionMenu(null)
  }, [value])

  const dismissSelectionMenu = useCallback(() => {
    setSelectionMenu(null)
  }, [])

  useSelectionPopoverDismiss({
    active: Boolean(selectionMenu),
    popoverRef: selectionMenuRef,
    onDismiss: dismissSelectionMenu,
  })

  const handleSelectionMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    setSelectionMenu(getTextSelectionFromContainer(
      surfaceRef.current,
      (text) => getLineRangeForText(value, text),
      event,
    ))
  }

  const addCurrentSelectionToChat = () => {
    if (!selectionMenu) return
    onAddSelection({
      text: selectionMenu.text,
      startLine: selectionMenu.startLine,
      endLine: selectionMenu.endLine,
    })
    setSelectionMenu(null)
    clearWindowSelection()
  }

  return (
    <div
      ref={surfaceRef}
      className={className}
      onMouseUp={handleSelectionMouseUp}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setSelectionMenu(null)
      }}
    >
      <div className="mx-auto w-full max-w-[860px] px-4 py-3">
        <MarkdownRenderer
          content={value}
          variant="document"
          className="workspace-markdown-preview prose-p:text-[14px] prose-p:leading-7 prose-h1:text-[24px] prose-h2:text-[18px] prose-h3:text-[15px] prose-code:text-[12px] prose-pre:my-4"
        />
      </div>
      <FloatingSelectionMenu selection={selectionMenu} onAdd={addCurrentSelectionToChat} popoverRef={selectionMenuRef} />
    </div>
  )
}

function ImagePreview({ tab }: { tab: WorkspacePreviewEntry }) {
  const t = useTranslation()

  if (!tab.dataUrl) {
    return (
      <PanelMessage
        icon="image_not_supported"
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

const FILE_ROW_CLASS =
  'flex w-full items-center gap-1.5 rounded-[6px] py-[7px] pr-1.5 text-left text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]'

function ChangedFileItem({
  file,
  expanded,
  onToggle,
  onContextMenu,
  children,
}: {
  file: WorkspaceChangedFile
  expanded: boolean
  onToggle: () => void
  onContextMenu: (event: MouseEvent, path: string) => void
  children?: ReactNode
}) {
  const { name, dir } = getPathParts(file.path)
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <div data-testid="workspace-file-item" className="border-t border-[var(--color-border)] first:border-t-0">
      <button
        type="button"
        aria-expanded={expanded}
        title={file.path}
        onClick={onToggle}
        onContextMenu={(event) => onContextMenu(event, file.path)}
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
      </button>
      {expanded && children}
    </div>
  )
}

type TreeNodeProps = {
  sessionId: string
  entry: WorkspaceTreeEntry
  depth: number
  expandedPaths: Set<string>
  expandedFilePaths: Set<string>
  treeByPath: Record<string, WorkspaceTreeResult | undefined>
  treeLoadingByPath: Record<string, boolean | undefined>
  treeErrorsByPath: Record<string, string | null | undefined>
  filterQuery: string
  onToggle: (path: string) => void
  onToggleFile: (path: string) => void
  onFileContextMenu: (event: MouseEvent, path: string, isDirectory: boolean) => void
  renderFileBody: (path: string) => ReactNode
}

function TreeNode({
  sessionId,
  entry,
  depth,
  expandedPaths,
  expandedFilePaths,
  treeByPath,
  treeLoadingByPath,
  treeErrorsByPath,
  filterQuery,
  onToggle,
  onToggleFile,
  onFileContextMenu,
  renderFileBody,
}: TreeNodeProps) {
  const t = useTranslation()
  const childTree = treeByPath[entry.path]
  const childLoading = treeLoadingByPath[makeTreeStateKey(sessionId, entry.path)] ?? false
  const childError = treeErrorsByPath[makeTreeStateKey(sessionId, entry.path)] ?? null
  const isExpanded = entry.isDirectory
    ? expandedPaths.has(entry.path) || filterQuery.length > 0
    : expandedFilePaths.has(entry.path)
  const indent = 6 + depth * 14
  const Chevron = isExpanded ? ChevronDown : ChevronRight

  if (!entry.isDirectory) {
    return (
      <div>
        <button
          type="button"
          aria-expanded={isExpanded}
          title={entry.path}
          onClick={() => onToggleFile(entry.path)}
          onContextMenu={(event) => onFileContextMenu(event, entry.path, false)}
          className={FILE_ROW_CLASS}
          style={{ paddingLeft: indent }}
        >
          <Chevron size={13} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
          <FileCode size={13} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
          <span className="min-w-0 truncate">{entry.name}</span>
        </button>
        {isExpanded && <div style={{ paddingLeft: indent }}>{renderFileBody(entry.path)}</div>}
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(entry.path)}
        onContextMenu={(event) => onFileContextMenu(event, entry.path, true)}
        aria-expanded={isExpanded}
        className={FILE_ROW_CLASS}
        style={{ paddingLeft: indent }}
      >
        <Chevron size={13} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
        <Folder size={13} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
        <span className="min-w-0 truncate">{entry.name}</span>
      </button>

      {isExpanded && (
        <div>
          {childLoading && !childTree && (
            <PanelMessage compact icon="progress_activity" message={t('common.loading')} />
          )}

          {!childLoading && childError && (
            <PanelMessage compact icon="error" tone="error" message={childError} />
          )}

          {!childLoading && !childError && childTree?.state === 'missing' && (
            <PanelMessage compact icon="folder_off" message={t('workspace.previewState.missing')} />
          )}

          {!childLoading && !childError && childTree?.state === 'error' && (
            <PanelMessage
              compact
              icon="error"
              tone="error"
              message={childTree.error || t('workspace.loadError')}
            />
          )}

          {!childLoading && !childError && childTree?.state === 'ok' && childTree.entries.length === 0 && (
            <PanelMessage compact icon="folder_open" message={t('workspace.noFiles')} />
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
                expandedFilePaths={expandedFilePaths}
                treeByPath={treeByPath}
                treeLoadingByPath={treeLoadingByPath}
                treeErrorsByPath={treeErrorsByPath}
                filterQuery={filterQuery}
                onToggle={onToggle}
                onToggleFile={onToggleFile}
                onFileContextMenu={onFileContextMenu}
                renderFileBody={renderFileBody}
              />
            ))}
        </div>
      )}
    </div>
  )
}

const EXPANDED_SURFACE_CLASS =
  'max-h-[420px] overflow-auto rounded-[7px] border border-[var(--color-border)] bg-[var(--color-code-bg)]'

function FileActionButton({
  label,
  onClick,
  disabled = false,
  children,
  iconOnly = false,
  ...rest
}: {
  label: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  children: ReactNode
  iconOnly?: boolean
  'aria-haspopup'?: 'menu'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      className="inline-flex h-7 items-center gap-1 rounded-[6px] px-1.5 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] disabled:cursor-not-allowed disabled:opacity-45"
      {...rest}
    >
      {children}
      {!iconOnly && <span>{label}</span>}
    </button>
  )
}

function FileExpandedBody({
  path,
  entry,
  loading,
  error,
  onAddToChat,
  onMore,
  onAddLineComment,
  onAddSelection,
}: {
  path: string
  entry: WorkspacePreviewEntry | undefined
  loading: boolean
  error: string | null
  onAddToChat: () => void
  onMore: (event: MouseEvent<HTMLButtonElement>) => void
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

  let content: ReactNode
  if (state === 'loading') {
    content = <PanelMessage compact icon="progress_activity" message={t('workspace.previewState.loading')} />
  } else if (isEmptyDiff) {
    content = <PanelMessage compact icon="difference" message={t('workspace.emptyDiff')} />
  } else if (state === 'ok' && isDiff) {
    content = (
      <WorkspaceDiffSurface
        value={entry?.diff ?? ''}
        path={path}
        hideFileHeaders
        className={EXPANDED_SURFACE_CLASS}
        commentRequest={commentRequest}
        onAddLineComment={onAddLineComment}
      />
    )
  } else if (isImage && entry) {
    content = <ImagePreview tab={entry} />
  } else if (isMarkdown) {
    content = (
      <MarkdownSurface
        value={entry?.content ?? ''}
        onAddSelection={onAddSelection}
        className="max-h-[420px] overflow-auto rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)]"
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
        className={EXPANDED_SURFACE_CLASS}
      />
    )
  } else {
    content = (
      <PanelMessage
        compact
        icon="error"
        tone={state === 'error' ? 'error' : 'muted'}
        message={getInlineStateMessage(t, state, error || entry?.error || null)}
      />
    )
  }

  return (
    <div data-testid="workspace-file-body" className="pb-3 pl-[25px] pr-0.5">
      <div className="mb-1.5 break-all text-[11px] text-[var(--color-text-tertiary)]">{path}</div>
      {content}
      <div className="mt-1.5 flex flex-wrap items-center gap-0.5">
        <FileActionButton label={t('workspace.addToChat')} onClick={onAddToChat}>
          <MessageSquarePlus size={13} strokeWidth={1.9} aria-hidden="true" />
        </FileActionButton>
        <FileActionButton
          label={t('workspace.lineComment')}
          onClick={() => setCommentRequest((value) => value + 1)}
          disabled={!canComment}
        >
          <MessageSquare size={13} strokeWidth={1.9} aria-hidden="true" />
        </FileActionButton>
        <FileActionButton label={t('workspace.moreFileActions')} onClick={onMore} iconOnly aria-haspopup="menu">
          <Ellipsis size={14} strokeWidth={1.9} aria-hidden="true" />
        </FileActionButton>
      </div>
    </div>
  )
}

function WorkspaceFilesView({ sessionId }: { sessionId: string }) {
  const t = useTranslation()
  const addToast = useUIStore((state) => state.addToast)
  const [filterQuery, setFilterQuery] = useState('')
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false)
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenuState | null>(null)
  const activeView = useWorkspacePanelStore((state) => state.getActiveView(sessionId))
  const status = useWorkspacePanelStore((state) => state.statusBySession[sessionId])
  const treeByPath = useWorkspacePanelStore((state) => state.treeBySessionPath[sessionId] ?? EMPTY_TREE_BY_PATH)
  const previews = useWorkspacePanelStore((state) => state.previewsBySession[sessionId] ?? EMPTY_PREVIEWS)
  const expandedPreviewIds = useWorkspacePanelStore((state) => state.expandedPreviewIdsBySession[sessionId] ?? EMPTY_IDS)
  const expandedPaths = useWorkspacePanelStore((state) => state.expandedPathsBySession[sessionId] ?? EMPTY_IDS)
  const statusLoading = useWorkspacePanelStore((state) => state.loading.statusBySession[sessionId] ?? false)
  const treeLoadingByPath = useWorkspacePanelStore(
    useShallow((state) => getSessionScopedRecord(state.loading.treeBySessionPath, sessionId)),
  )
  const previewLoadingById = useWorkspacePanelStore(
    useShallow((state) => getSessionScopedRecord(state.loading.previewById, sessionId)),
  )
  const previewErrorsById = useWorkspacePanelStore(
    useShallow((state) => getSessionScopedRecord(state.errors.previewById, sessionId)),
  )
  const statusError = useWorkspacePanelStore((state) => state.errors.statusBySession[sessionId] ?? null)
  const treeErrorsByPath = useWorkspacePanelStore(
    useShallow((state) => getSessionScopedRecord(state.errors.treeBySessionPath, sessionId)),
  )
  const setActiveView = useWorkspacePanelStore((state) => state.setActiveView)
  const loadStatus = useWorkspacePanelStore((state) => state.loadStatus)
  const loadTree = useWorkspacePanelStore((state) => state.loadTree)
  const toggleTreeNode = useWorkspacePanelStore((state) => state.toggleTreeNode)
  const togglePreview = useWorkspacePanelStore((state) => state.togglePreview)
  const refreshPreviews = useWorkspacePanelStore((state) => state.refreshPreviews)
  const addWorkspaceReference = useWorkspaceChatContextStore((state) => state.addReference)
  const chatState = useChatStore((state) => state.sessions[sessionId]?.chatState ?? 'idle')
  const refreshLifecycleRef = useRef<{ sessionId: string | null; chatState: string }>({
    sessionId: null,
    chatState: 'idle',
  })

  const rootTree = treeByPath['']
  const rootTreeKey = makeTreeStateKey(sessionId, '')
  const rootTreeLoading = treeLoadingByPath[rootTreeKey] ?? false
  const rootTreeError = treeErrorsByPath[rootTreeKey] ?? null
  const normalizedFilterQuery = normalizeFilterQuery(filterQuery)
  const expandedPathSet = new Set(expandedPaths)
  const expandedIdSet = new Set(expandedPreviewIds)
  const expandedFilePaths = new Set(
    expandedPreviewIds
      .filter((id) => id.startsWith('file:'))
      .map((id) => id.slice('file:'.length)),
  )
  const filteredChangedFiles = useMemo(
    () => (status?.changedFiles ?? []).filter((file) => changedFileMatchesFilter(file, normalizedFilterQuery)),
    [normalizedFilterQuery, status?.changedFiles],
  )
  const filteredRootEntries = useMemo(
    () => rootTree?.state === 'ok'
      ? rootTree.entries.filter((entry) => treeEntryMatchesFilter(entry, normalizedFilterQuery, treeByPath))
      : [],
    [normalizedFilterQuery, rootTree, treeByPath],
  )

  useEffect(() => {
    const previous = refreshLifecycleRef.current
    const opened = previous.sessionId !== sessionId
    const completedTurn = !opened && previous.chatState !== 'idle' && chatState === 'idle'
    refreshLifecycleRef.current = { sessionId, chatState }

    if (completedTurn) void refreshPreviews(sessionId)
    if ((!opened && !completedTurn) || statusLoading) return
    void loadStatus(sessionId)
  }, [chatState, loadStatus, refreshPreviews, sessionId, statusLoading])

  useEffect(() => {
    if (activeView !== 'all' || rootTree || rootTreeLoading || rootTreeError) return
    void loadTree(sessionId, '')
  }, [activeView, loadTree, rootTree, rootTreeError, rootTreeLoading, sessionId])

  useEffect(() => {
    if (!fileContextMenu && !isViewMenuOpen) return
    const close = () => {
      setFileContextMenu(null)
      setIsViewMenuOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [fileContextMenu, isViewMenuOpen])

  const handleRefresh = () => {
    void loadStatus(sessionId)
    void refreshPreviews(sessionId)
    if (activeView === 'all') {
      void loadTree(sessionId, '')
    }
  }

  const addWorkspacePathToChat = (path: string, isDirectory = false) => {
    addWorkspaceReference(sessionId, {
      kind: 'file',
      path,
      absolutePath: resolveWorkspaceAttachmentPath(status?.workDir, path),
      name: getWorkspaceReferenceName(path, isDirectory),
      isDirectory,
    })
  }

  const addLineCommentToChat = (path: string, line: number, note: string, quote: string) => {
    addWorkspaceReference(sessionId, {
      kind: 'code-comment',
      path,
      absolutePath: resolveWorkspaceAttachmentPath(status?.workDir, path),
      name: path.split('/').pop() || path,
      lineStart: line,
      lineEnd: line,
      note,
      quote,
    })
  }

  const addSelectionToChat = (path: string, selection: WorkspaceTextSelection) => {
    addWorkspaceReference(sessionId, {
      kind: 'code-selection',
      path,
      absolutePath: resolveWorkspaceAttachmentPath(status?.workDir, path),
      name: path.split('/').pop() || path,
      lineStart: selection.startLine,
      lineEnd: selection.endLine,
      quote: selection.text,
    })
  }

  const handleSetActiveView = (view: 'changed' | 'all') => {
    setActiveView(sessionId, view)
    setIsViewMenuOpen(false)
  }

  const handleFileContextMenu = (event: MouseEvent, path: string, isDirectory = false) => {
    event.preventDefault()
    event.stopPropagation()
    setFileContextMenu({ path, isDirectory, x: event.clientX, y: event.clientY })
  }

  const openFileActionsMenu = (event: MouseEvent<HTMLButtonElement>, path: string) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setFileContextMenu({ path, isDirectory: false, x: rect.left, y: rect.bottom + 4 })
  }

  const copyWorkspacePath = async (path: string, mode: 'relative' | 'absolute' = 'relative') => {
    const pathToCopy = mode === 'absolute' ? resolveWorkspaceAttachmentPath(status?.workDir, path) : path
    const copied = await copyTextToClipboard(pathToCopy)
    setFileContextMenu(null)
    addToast({
      type: copied ? 'success' : 'error',
      message: copied ? t('workspace.pathCopied') : t('common.copyFailed'),
    })
  }

  const renderFileBody = (path: string, kind: WorkspacePreviewKind) => {
    const previewId = getWorkspacePreviewId(path, kind)
    const requestKey = makePreviewStateKey(sessionId, previewId)
    return (
      <FileExpandedBody
        path={path}
        entry={previews[previewId]}
        loading={previewLoadingById[requestKey] ?? false}
        error={previewErrorsById[requestKey] ?? null}
        onAddToChat={() => addWorkspacePathToChat(path)}
        onMore={(event) => openFileActionsMenu(event, path)}
        onAddLineComment={(line, note, quote) => addLineCommentToChat(path, line, note, quote)}
        onAddSelection={(selection) => addSelectionToChat(path, selection)}
      />
    )
  }

  const renderChangedView = () => {
    if (statusLoading && !status) {
      return <PanelMessage icon="progress_activity" message={t('common.loading')} />
    }

    if (status?.state === 'missing_workdir') {
      return <PanelMessage icon="folder_off" message={t('workspace.missingWorkdir')} />
    }

    if (status?.state === 'not_git_repo') {
      return <PanelMessage icon="account_tree" message={t('workspace.notGitRepo')} />
    }

    if (statusError || status?.state === 'error') {
      return (
        <PanelMessage
          icon="error"
          tone="error"
          message={statusError || status?.error || t('workspace.loadError')}
        />
      )
    }

    if (!status) {
      return <PanelMessage icon="progress_activity" message={t('common.loading')} />
    }

    if (status.changedFiles.length === 0) {
      return <PanelMessage icon="check_circle" message={t('workspace.noChanges')} />
    }

    if (filteredChangedFiles.length === 0) {
      return <PanelMessage icon="search_off" message={t('workspace.noMatchingFiles')} />
    }

    return (
      <div>
        {filteredChangedFiles.map((file) => (
          <ChangedFileItem
            key={`${file.path}:${file.status}:${file.oldPath ?? ''}`}
            file={file}
            expanded={expandedIdSet.has(getWorkspacePreviewId(file.path, 'diff'))}
            onToggle={() => void togglePreview(sessionId, file.path, 'diff')}
            onContextMenu={handleFileContextMenu}
          >
            {renderFileBody(file.path, 'diff')}
          </ChangedFileItem>
        ))}
      </div>
    )
  }

  const renderAllFilesView = () => {
    if (rootTreeLoading && !rootTree) {
      return <PanelMessage icon="progress_activity" message={t('common.loading')} />
    }

    if (rootTreeError) {
      return <PanelMessage icon="error" tone="error" message={rootTreeError} />
    }

    if (rootTree?.state === 'missing') {
      return <PanelMessage icon="folder_off" message={t('workspace.missingWorkdir')} />
    }

    if (rootTree?.state === 'error') {
      return <PanelMessage icon="error" tone="error" message={rootTree.error || t('workspace.loadError')} />
    }

    if (!rootTree) {
      return <PanelMessage icon="progress_activity" message={t('common.loading')} />
    }

    if (rootTree.entries.length === 0) {
      return <PanelMessage icon="folder_open" message={t('workspace.noFiles')} />
    }

    if (filteredRootEntries.length === 0) {
      return <PanelMessage icon="search_off" message={t('workspace.noMatchingFiles')} />
    }

    return (
      <div>
        {filteredRootEntries.map((entry) => (
          <TreeNode
            key={entry.path}
            sessionId={sessionId}
            entry={entry}
            depth={0}
            expandedPaths={expandedPathSet}
            expandedFilePaths={expandedFilePaths}
            treeByPath={treeByPath}
            treeLoadingByPath={treeLoadingByPath}
            treeErrorsByPath={treeErrorsByPath}
            filterQuery={normalizedFilterQuery}
            onToggle={(path) => {
              void toggleTreeNode(sessionId, path)
            }}
            onToggleFile={(path) => {
              void togglePreview(sessionId, path, 'file')
            }}
            onFileContextMenu={handleFileContextMenu}
            renderFileBody={(path) => renderFileBody(path, 'file')}
          />
        ))}
      </div>
    )
  }

  const viewLabel = activeView === 'changed' ? t('workspace.changedFiles') : t('workspace.allFiles')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2 pt-3">
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            aria-label={viewLabel}
            aria-haspopup="menu"
            aria-expanded={isViewMenuOpen}
            onClick={(event) => {
              event.stopPropagation()
              setIsViewMenuOpen((open) => !open)
            }}
            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-[6px] px-1.5 py-1 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
          >
            <span className="truncate">{viewLabel}</span>
            <ChevronDown size={13} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
          </button>
          {isViewMenuOpen && (
            <div
              role="menu"
              onClick={(event) => event.stopPropagation()}
              className="absolute left-0 top-[calc(100%+4px)] z-30 min-w-[132px] overflow-hidden rounded-[9px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)]"
            >
              {(['changed', 'all'] as const).map((view) => {
                const selected = activeView === view
                return (
                  <button
                    key={view}
                    type="button"
                    role="menuitem"
                    onClick={() => handleSetActiveView(view)}
                    className={`flex h-7 w-full items-center gap-2 px-2.5 text-left text-[12px] transition-colors ${
                      selected ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {view === 'changed' ? t('workspace.changedFiles') : t('workspace.allFiles')}
                    </span>
                    {selected && <Check size={13} strokeWidth={2} aria-hidden="true" className="text-[var(--color-brand)]" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <PanelIconButton label={t('workspace.refresh')} onClick={handleRefresh}>
          <RefreshCw size={14} strokeWidth={1.9} aria-hidden="true" />
        </PanelIconButton>
      </div>

      <div className="shrink-0 px-3 pb-2">
        <SearchField
          value={filterQuery}
          onChange={setFilterQuery}
          aria-label={t('workspace.filterPlaceholder')}
          placeholder={t('workspace.filterPlaceholder')}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {activeView === 'changed' ? renderChangedView() : renderAllFilesView()}
      </div>

      {fileContextMenu && (
        <div
          role="menu"
          className="fixed z-50 min-w-[156px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 text-[12px] shadow-[var(--shadow-dropdown)]"
          style={{ left: fileContextMenu.x, top: fileContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              addWorkspacePathToChat(fileContextMenu.path, fileContextMenu.isDirectory)
              setFileContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
          >
            <MessageSquarePlus size={14} strokeWidth={1.9} aria-hidden="true" className="text-[var(--color-text-tertiary)]" />
            <span>{t('workspace.addToChat')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyWorkspacePath(fileContextMenu.path)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
          >
            <Copy size={14} strokeWidth={1.9} aria-hidden="true" className="text-[var(--color-text-tertiary)]" />
            <span>{t('workspace.copyPath')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyWorkspacePath(fileContextMenu.path, 'absolute')}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
          >
            <Copy size={14} strokeWidth={1.9} aria-hidden="true" className="text-[var(--color-text-tertiary)]" />
            <span>{t('workspace.copyAbsolutePath')}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function PanelIconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
    >
      {children}
    </button>
  )
}

function WorkspaceTerminalView({
  sessionId,
  active,
  cwd,
  contextLabel,
}: {
  sessionId: string
  active: boolean
  cwd?: string
  contextLabel?: string
}) {
  const t = useTranslation()
  const terminalState = useTerminalPanelStore((state) => state.terminalsBySession[sessionId])
  const ensureSession = useTerminalPanelStore((state) => state.ensureSession)
  const addTerminal = useTerminalPanelStore((state) => state.addTerminal)
  const closeTerminal = useTerminalPanelStore((state) => state.closeTerminal)
  const setActiveTerminal = useTerminalPanelStore((state) => state.setActiveTerminal)
  const setTerminalShell = useTerminalPanelStore((state) => state.setTerminalShell)
  const containerRef = useRef<HTMLDivElement>(null)
  const focusTabAfterSwitchRef = useRef(false)
  const activeTerminalIdForFocus = terminalState?.activeTerminalId

  useEffect(() => {
    ensureSession(sessionId)
  }, [ensureSession, sessionId])

  // Each terminal renders its own copy of the tab strip, so keyboard switching moves focus to the visible copy.
  useEffect(() => {
    if (!focusTabAfterSwitchRef.current) return
    focusTabAfterSwitchRef.current = false
    containerRef.current
      ?.querySelector<HTMLElement>('[data-testid="session-terminal-panel"]:not([hidden]) [role="tab"][aria-selected="true"]')
      ?.focus()
  }, [activeTerminalIdForFocus])

  if (!terminalState) return null

  const { terminals, activeTerminalId } = terminalState
  const canClose = terminals.length > 1
  const getTitle = (terminal: SessionTerminal) =>
    `${terminal.shell ?? t('terminal.defaultName')} ${terminal.index}`

  const tabs = (
    <div
      role="tablist"
      aria-label={t('terminal.tabsLabel')}
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
      onKeyDown={(event) => {
        const id = moveRovingFocus(event, '[role="tab"]', 'horizontal')?.dataset.terminalId
        if (id && id !== activeTerminalId) {
          focusTabAfterSwitchRef.current = true
          setActiveTerminal(sessionId, id)
        }
      }}
    >
      {terminals.map((terminal) => {
        const selected = terminal.id === activeTerminalId
        const title = getTitle(terminal)
        return (
          <span
            key={terminal.id}
            className={`inline-flex shrink-0 items-center rounded-[6px] ${
              selected
                ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              data-terminal-id={terminal.id}
              onClick={() => setActiveTerminal(sessionId, terminal.id)}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11px] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
            >
              <SquareTerminal size={12} strokeWidth={1.9} aria-hidden="true" />
              {title}
            </button>
            {canClose && (
              <button
                type="button"
                aria-label={t('terminal.closeTerminal', { name: title })}
                title={t('terminal.closeTerminal', { name: title })}
                onClick={() => closeTerminal(sessionId, terminal.id)}
                className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-[4px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
              >
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </span>
        )
      })}
      <PanelIconButton label={t('terminal.newTab')} onClick={() => addTerminal(sessionId)}>
        <Plus size={14} strokeWidth={1.9} aria-hidden="true" />
      </PanelIconButton>
    </div>
  )

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      {terminals.map((terminal) => {
        const selected = terminal.id === activeTerminalId
        return (
          <div
            key={terminal.id}
            data-testid="session-terminal-panel"
            hidden={!selected}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TerminalSettings
              active={active && selected}
              docked
              cwd={cwd}
              runtimeId={terminal.id}
              preserveOnUnmount
              testId={`session-terminal-host-${terminal.id}`}
              toolbarLeading={tabs}
              meta={contextLabel}
              onShellChange={(shell) => {
                const name = getShellDisplayName(shell)
                if (name) setTerminalShell(sessionId, terminal.id, name)
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

type WorkspacePanelProps = {
  sessionId: string
  /** Working directory for new terminals. */
  terminalCwd?: string
  /** Light context line shown above the terminal, e.g. "project · branch". */
  contextLabel?: string
}

export function WorkspacePanel({ sessionId, terminalCwd, contextLabel }: WorkspacePanelProps) {
  const t = useTranslation()
  const isOpen = useWorkspacePanelStore((state) => state.isPanelOpen(sessionId))
  const tab = useWorkspacePanelStore((state) => state.getPanelTab(sessionId))
  const expanded = useWorkspacePanelStore((state) => state.isPanelExpanded(sessionId))
  const setPanelTab = useWorkspacePanelStore((state) => state.setPanelTab)
  const toggleExpanded = useWorkspacePanelStore((state) => state.toggleExpanded)
  const closePanel = useWorkspacePanelStore((state) => state.closePanel)
  const hasTerminals = useTerminalPanelStore((state) => Boolean(state.terminalsBySession[sessionId]))

  if (!isOpen) return null

  const panelTabs = [
    { id: 'files' as const, label: t('workspace.tabFiles'), Icon: Files },
    { id: 'terminal' as const, label: t('workspace.tabTerminal'), Icon: SquareTerminal },
  ]
  const expandLabel = expanded ? t('workspace.restorePanel') : t('workspace.expandPanel')

  return (
    <aside
      data-testid="workspace-panel"
      aria-label={t('workspace.panelTabs')}
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--color-surface)]"
    >
      <div className="flex shrink-0 items-center gap-0.5 border-b border-[var(--color-border)] pl-2.5 pr-2 pt-1.5">
        <div
          role="tablist"
          aria-label={t('workspace.panelTabs')}
          className="flex items-center gap-0.5"
          onKeyDown={(event) => {
            const id = moveRovingFocus(event, '[role="tab"]', 'horizontal')?.dataset.panelTab
            const next = panelTabs.find((entry) => entry.id === id)
            if (next && next.id !== tab) setPanelTab(sessionId, next.id)
          }}
        >
          {panelTabs.map(({ id, label, Icon }) => {
            const selected = tab === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                data-panel-tab={id}
                onClick={() => setPanelTab(sessionId, id)}
                className={`-mb-px inline-flex items-center gap-1.5 rounded-t-[6px] border-b-2 px-2.5 pb-2 pt-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
                  selected
                    ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Icon size={14} strokeWidth={1.9} aria-hidden="true" />
                {label}
              </button>
            )
          })}
        </div>
        <span className="flex-1" />
        <div className="flex items-center gap-0.5 pb-1">
          <PanelIconButton label={expandLabel} onClick={() => toggleExpanded(sessionId)}>
            {expanded
              ? <Minimize2 size={14} strokeWidth={1.9} aria-hidden="true" />
              : <Maximize2 size={14} strokeWidth={1.9} aria-hidden="true" />}
          </PanelIconButton>
          <PanelIconButton label={t('workspace.closeSidePanel')} onClick={() => closePanel(sessionId)}>
            <X size={14} strokeWidth={1.9} aria-hidden="true" />
          </PanelIconButton>
        </div>
      </div>

      <div hidden={tab !== 'files'} className="flex min-h-0 flex-1 flex-col">
        <WorkspaceFilesView sessionId={sessionId} />
      </div>
      {(tab === 'terminal' || hasTerminals) && (
        <div hidden={tab !== 'terminal'} className="flex min-h-0 flex-1 flex-col">
          <WorkspaceTerminalView
            sessionId={sessionId}
            active={tab === 'terminal'}
            cwd={terminalCwd}
            contextLabel={contextLabel}
          />
        </div>
      )}
    </aside>
  )
}
