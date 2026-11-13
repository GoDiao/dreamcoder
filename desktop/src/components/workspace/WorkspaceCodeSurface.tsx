import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseDiffFromFile, parsePatchFiles } from '@pierre/diffs'
import { Virtualizer } from '@pierre/diffs/react'
import { PierreDiffSurface } from '../shared/PierreDiffSurface'
import { useUIStore } from '../../stores/uiStore'
import { ArrowUp } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '../shared/ui/input-group'
import { getTextSelectionFromContainer, type WorkspaceQuoteSelection, type WorkspaceTextSelection } from './workspaceSelection'
import { useQuoteSelection } from '../../lib/selectionPopover'
import { PreviewLimitBar } from './PreviewLimitBar'
import { WorkspaceQuotePopover } from './WorkspaceQuotePopover'
import { useTranslation } from '../../i18n'

export const WORKSPACE_PREVIEW_LINE_LIMIT = 2000
export function getFileExtension(name: string) {
  const cleanName = name.split('/').pop() ?? name
  const lastDot = cleanName.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === cleanName.length - 1) return ''
  return cleanName.slice(lastDot + 1).toLowerCase()
}

export type DiffLineKind = 'file-header' | 'hunk' | 'add' | 'remove' | 'context' | 'meta'

export type ParsedDiffLine = {
  kind: DiffLineKind
  /** The line without its leading +/-/space marker (raw text for headers). */
  code: string
  /** Line number in the old file (removed and context lines). */
  oldLine?: number
  /** Line number in the new file (added and context lines). */
  newLine?: number
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Parse a unified diff into lines carrying real old/new file line numbers. */
export function parseUnifiedDiff(diff: string): ParsedDiffLine[] {
  const result: ParsedDiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let oldRemaining = 0
  let newRemaining = 0

  const lines = diff.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  for (const line of lines) {
    const hunk = HUNK_HEADER_PATTERN.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      oldRemaining = hunk[2] === undefined ? 1 : Number(hunk[2])
      newLine = Number(hunk[3])
      newRemaining = hunk[4] === undefined ? 1 : Number(hunk[4])
      result.push({ kind: 'hunk', code: line })
      continue
    }

    const inHunk = oldRemaining > 0 || newRemaining > 0
    if (!inHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        result.push({ kind: 'add', code: line.slice(1) })
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        result.push({ kind: 'remove', code: line.slice(1) })
      } else {
        result.push({ kind: line.startsWith('\\') ? 'meta' : 'file-header', code: line })
      }
      continue
    }

    if (line.startsWith('+')) {
      result.push({ kind: 'add', code: line.slice(1), newLine })
      newLine += 1
      newRemaining -= 1
    } else if (line.startsWith('-')) {
      result.push({ kind: 'remove', code: line.slice(1), oldLine })
      oldLine += 1
      oldRemaining -= 1
    } else if (line.startsWith('\\')) {
      result.push({ kind: 'meta', code: line })
    } else {
      result.push({ kind: 'context', code: line.slice(1), oldLine, newLine })
      oldLine += 1
      newLine += 1
      oldRemaining -= 1
      newRemaining -= 1
    }
  }

  return result
}

export function LineCommentEditor({
  lineNumber,
  draft,
  onDraftChange,
  onCancel,
  onSubmit,
}: {
  lineNumber: number
  draft: string
  onDraftChange: (draft: string) => void
  onCancel: () => void
  onSubmit: (note: string) => void
}) {
  const t = useTranslation()
  const note = draft.trim()
  const submit = () => {
    if (note) onSubmit(note)
  }

  return (
    <div
      className="max-w-180 font-body"
      onBlur={(event) => {
        if (!note && document.hasFocus() && !event.currentTarget.contains(event.relatedTarget)) onCancel()
      }}
    >
      <div className="mb-1 text-2xs text-subtle-foreground">{t('workspace.commentLineTarget', { line: lineNumber })}</div>
      <InputGroup className="items-end">
        <InputGroupTextarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            } else if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          autoFocus
          rows={1}
          aria-label={t('workspace.commentLineTarget', { line: lineNumber })}
          placeholder={t('workspace.commentPlaceholder')}
          className="max-h-40 min-h-0"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label={t('workspace.addCommentToChat')} onClick={submit} disabled={!note}>
            <ArrowUp aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export function limitUnifiedDiff(value: string, lineLimit: number) {
  const lines = value.replace(/\n$/, '').split('\n').slice(0, lineLimit)
  for (let index = 0; index < lines.length; index++) {
    const match = HUNK_HEADER_PATTERN.exec(lines[index]!)
    if (!match) continue
    let oldCount = 0
    let newCount = 0
    for (let cursor = index + 1; cursor < lines.length && !lines[cursor]!.startsWith('@@') && !lines[cursor]!.startsWith('diff --git'); cursor++) {
      const line = lines[cursor]!
      if (line.startsWith(' ') || line.startsWith('-')) oldCount++
      if (line.startsWith(' ') || line.startsWith('+')) newCount++
    }
    lines[index] = `@@ -${match[1]},${oldCount} +${match[3]},${newCount} @@${lines[index]!.slice(match[0].length)}`
  }
  return lines.join('\n') + '\n'
}

export function WorkspaceDiffSurface({ value, path, className = 'min-h-0 flex-1 overflow-auto', lineLimit = WORKSPACE_PREVIEW_LINE_LIMIT, hideFileHeaders = false, onAddLineComment, onAddSelection }: {
  value: string
  path: string
  className?: string
  lineLimit?: number
  hideFileHeaders?: boolean
  onAddLineComment?: (line: number, note: string, quote: string) => void
  onAddSelection?: (selection: WorkspaceTextSelection) => void
}) {
  const t = useTranslation()
  const theme = useUIStore((state) => state.theme)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [showAllLines, setShowAllLines] = useState(false)
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const parsedLines = useMemo(() => parseUnifiedDiff(value), [value])
  const newLines = useMemo(() => new Map(parsedLines.filter((line) => line.newLine !== undefined).map((line) => [line.newLine!, line.code])), [parsedLines])
  const diff = useMemo(() => {
    try {
      const patch = !showAllLines && parsedLines.length > lineLimit ? limitUnifiedDiff(value, lineLimit) : value
      const lines = parseUnifiedDiff(patch)
      const files = /^(?:@@ |diff --git |--- )/m.test(patch)
        ? parsePatchFiles(/^@@ /m.test(patch) && !/^--- /m.test(patch) ? `--- a/${path}\n+++ b/${path}\n${patch}` : patch).flatMap((entry) => entry.files)
        : [parseDiffFromFile(
            { name: path, contents: lines.filter((line) => line.kind === 'remove' || line.kind === 'context').map((line) => line.code).join('\n') },
            { name: path, contents: lines.filter((line) => line.kind === 'add' || line.kind === 'context').map((line) => line.code).join('\n') },
          )]
      return { files, error: false }
    } catch (error) {
      console.error('[WorkspaceDiff] Failed to parse patch:', path, error)
      return { files: [], error: true }
    }
  }, [value, path, showAllLines, parsedLines.length, lineLimit])
  const quote = useQuoteSelection<WorkspaceQuoteSelection>(
    (event) => onAddSelection ? getTextSelectionFromContainer(surfaceRef.current, event) : null,
    newLines,
  )
  const openComment = useCallback((line: number | null) => {
    setActiveCommentLine(line)
    setCommentDraft('')
  }, [])

  useEffect(() => {
    setShowAllLines(false)
    openComment(null)
  }, [path, openComment])
  useEffect(() => {
    if (activeCommentLine !== null && !newLines.has(activeCommentLine)) openComment(null)
  }, [newLines, activeCommentLine, openComment])

  const commentLine = useCallback((line: number) => {
    if (newLines.has(line)) openComment(line)
  }, [newLines, openComment])
  const lineAnnotations = useMemo(() => activeCommentLine !== null ? [{ side: 'additions' as const, lineNumber: activeCommentLine }] : [], [activeCommentLine])

  const content = diff.files.map((file, index) => (
    <PierreDiffSurface key={`${path}:${index}`} fileDiff={file} theme={theme} hideFileHeader={hideFileHeaders}
      onCommentLine={onAddLineComment ? commentLine : undefined}
      lineAnnotations={lineAnnotations}
      renderAnnotation={onAddLineComment && activeCommentLine !== null ? () => (
        <div className="px-3 py-1.5">
          <LineCommentEditor lineNumber={activeCommentLine} draft={commentDraft} onDraftChange={setCommentDraft} onCancel={() => openComment(null)} onSubmit={(note) => {
            onAddLineComment(activeCommentLine, note, newLines.get(activeCommentLine) ?? '')
            openComment(null)
          }} />
        </div>
      ) : undefined}
    />
  ))

  return (
    <div ref={surfaceRef} className={className} data-testid="workspace-code" data-workspace-code="" onMouseDown={quote.onMouseDown}>
      {diff.error ? <div role="alert">{t('workspace.diffParseError')}</div> : parsedLines.length > 200
        ? <Virtualizer style={{ height: 400, overflow: 'auto' }}>{content}</Virtualizer>
        : content}
      {parsedLines.length > lineLimit && (
        <PreviewLimitBar shown={Math.min(lineLimit, parsedLines.length)} total={parsedLines.length} expanded={showAllLines} onToggle={() => setShowAllLines((current) => !current)} />
      )}
      {onAddSelection && <WorkspaceQuotePopover quote={quote} onAddSelection={onAddSelection} />}
    </div>
  )
}
