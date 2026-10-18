import { useEffect, useMemo, useState } from 'react'
import { Highlight, type PrismTheme } from 'prism-react-renderer'
import { useTranslation } from '../../i18n'

export const WORKSPACE_PREVIEW_LINE_LIMIT = 2000
export const WORKSPACE_PLAIN_TEXT_LINE_THRESHOLD = 5000

export const workspacePrismTheme: PrismTheme = {
  plain: {
    color: 'var(--color-code-fg)',
    backgroundColor: 'transparent',
  },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: 'var(--color-code-comment)', fontStyle: 'italic' } },
    { types: ['string', 'attr-value', 'template-string'], style: { color: 'var(--color-code-string)' } },
    { types: ['keyword', 'selector', 'important', 'atrule'], style: { color: 'var(--color-code-keyword)' } },
    { types: ['function'], style: { color: 'var(--color-code-function)' } },
    { types: ['tag'], style: { color: 'var(--color-code-keyword)' } },
    { types: ['number', 'boolean'], style: { color: 'var(--color-code-number)' } },
    { types: ['operator'], style: { color: 'var(--color-code-fg)' } },
    { types: ['punctuation'], style: { color: 'var(--color-code-punctuation)' } },
    { types: ['variable', 'parameter'], style: { color: 'var(--color-code-fg)' } },
    { types: ['property', 'attr-name'], style: { color: 'var(--color-code-property)' } },
    { types: ['builtin', 'class-name', 'constant', 'symbol'], style: { color: 'var(--color-code-type)' } },
    { types: ['inserted'], style: { color: 'var(--color-code-inserted)' } },
    { types: ['deleted'], style: { color: 'var(--color-code-deleted)' } },
  ],
}

export function getFileExtension(name: string) {
  const cleanName = name.split('/').pop() ?? name
  const lastDot = cleanName.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === cleanName.length - 1) return ''
  return cleanName.slice(lastDot + 1).toLowerCase()
}

export function normalizePrismLanguage(language: string) {
  const lower = language.toLowerCase()
  const map: Record<string, string> = {
    text: 'text',
    typescript: 'typescript',
    ts: 'typescript',
    tsx: 'tsx',
    javascript: 'javascript',
    js: 'javascript',
    jsx: 'jsx',
    markdown: 'markdown',
    md: 'markdown',
    html: 'markup',
    xml: 'markup',
    shell: 'bash',
    sh: 'bash',
    zsh: 'bash',
    diff: 'diff',
  }
  return map[lower] ?? lower
}

export function getLanguageFromPath(path: string) {
  return normalizePrismLanguage(getFileExtension(path) || 'text')
}

export function InlineHighlightedCode({
  value,
  language,
}: {
  value: string
  language: string
}) {
  return (
    <Highlight
      theme={workspacePrismTheme}
      code={value}
      language={normalizePrismLanguage(language)}
    >
      {({ tokens, getTokenProps }) => (
        <>
          {(tokens[0] ?? []).map((token, tokenIndex) => {
            const { key: tokenKey, ...tokenProps } = getTokenProps({ token, key: tokenIndex })
            return <span key={String(tokenKey)} {...tokenProps} />
          })}
        </>
      )}
    </Highlight>
  )
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
  /** Owned by the surface so the draft outlives re-renders of the line it is attached to. */
  draft: string
  onDraftChange: (draft: string) => void
  onCancel: () => void
  onSubmit: (note: string) => void
}) {
  const t = useTranslation()

  return (
    <div className="grid grid-cols-[48px_minmax(0,720px)] gap-3 bg-[var(--color-brand)]/10 px-3 py-2">
      <span aria-hidden="true" />
      <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] font-[var(--font-body)] shadow-sm">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <span className="material-symbols-outlined text-[15px] text-[var(--color-text-tertiary)]">chat_bubble</span>
          <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">{t('workspace.localComment')}</span>
          <span className="ml-auto text-[11px] text-[var(--color-text-tertiary)]">
            {t('workspace.commentLineTarget', { line: lineNumber })}
          </span>
        </div>
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          autoFocus
          rows={3}
          placeholder={t('workspace.commentPlaceholder')}
          className="block w-full resize-none whitespace-pre-wrap bg-transparent px-3 py-3 text-[13px] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
        />
        <div className="flex justify-end gap-2 px-3 pb-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[7px] px-2.5 py-1 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (draft.trim()) onSubmit(draft.trim())
            }}
            disabled={!draft.trim()}
            className="rounded-[7px] bg-[var(--color-text-primary)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {t('workspace.addCommentToChat')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function WorkspaceDiffSurface({
  value,
  path,
  className = 'min-h-0 flex-1 overflow-auto bg-[var(--color-code-bg)]',
  lineLimit = WORKSPACE_PREVIEW_LINE_LIMIT,
  hideFileHeaders = false,
  onAddLineComment,
  commentRequest = 0,
}: {
  value: string
  path: string
  className?: string
  lineLimit?: number
  hideFileHeaders?: boolean
  /** When set, added and context lines get a comment button keyed by their new-file line number. */
  onAddLineComment?: (line: number, note: string, quote: string) => void
  /** Incremented by the parent to open the comment editor on the first added (or context) line. */
  commentRequest?: number
}) {
  const t = useTranslation()
  const [showAllLines, setShowAllLines] = useState(false)
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const parsedLines = useMemo(() => {
    const parsed = parseUnifiedDiff(value)
    return hideFileHeaders ? parsed.filter((line) => line.kind !== 'file-header') : parsed
  }, [hideFileHeaders, value])
  const openComment = (line: number | null) => {
    setActiveCommentLine(line)
    setCommentDraft('')
  }
  const visibleLines = showAllLines ? parsedLines : parsedLines.slice(0, lineLimit)
  const language = getLanguageFromPath(path)
  const usePlainLargePreview = showAllLines && parsedLines.length > WORKSPACE_PLAIN_TEXT_LINE_THRESHOLD

  useEffect(() => {
    setShowAllLines(false)
    openComment(null)
  }, [path])

  // A refresh of the same file keeps the open editor while its line still exists.
  useEffect(() => {
    if (activeCommentLine === null) return
    const stillExists = parsedLines.some((line) => line.kind !== 'remove' && line.newLine === activeCommentLine)
    if (!stillExists) openComment(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedLines])

  useEffect(() => {
    if (commentRequest <= 0) return
    const target = parsedLines.find((line) => line.kind === 'add' && line.newLine)
      ?? parsedLines.find((line) => line.kind === 'context' && line.newLine)
    if (target?.newLine) openComment(target.newLine)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentRequest])

  return (
    <div className={className}>
      <div className="relative min-w-max py-2">
        <pre
          data-workspace-code=""
          data-testid="workspace-code"
          className="m-0 font-[var(--font-mono)] text-[12px] leading-[1.55] text-[var(--color-code-fg)]"
        >
          {visibleLines.map((line, index) => {
            const isAdded = line.kind === 'add'
            const isRemoved = line.kind === 'remove'
            const isHunk = line.kind === 'hunk'
            const isCodeLine = isAdded || isRemoved || line.kind === 'context'
            const prefix = isAdded ? '+' : isRemoved ? '-' : ' '
            const displayNumber = isRemoved ? line.oldLine : line.newLine
            const commentLine = !isRemoved ? line.newLine : undefined
            const canComment = Boolean(onAddLineComment && commentLine)

            return (
              <div key={index}>
                <div
                  data-diff-line-kind={line.kind}
                  data-workspace-line-number={commentLine}
                  className={`group grid min-w-full w-max grid-cols-[48px_18px_max-content] gap-2 px-3 ${
                    isAdded
                      ? 'bg-[var(--color-diff-added-bg)]'
                      : isRemoved
                        ? 'bg-[var(--color-diff-removed-bg)]'
                        : isHunk
                          ? 'bg-[var(--color-diff-highlight-bg)]'
                          : 'hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  {canComment && commentLine ? (
                    <button
                      type="button"
                      aria-label={t('workspace.commentLine', { line: commentLine })}
                      onClick={() => openComment(commentLine)}
                      className="select-none text-right text-[11px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-brand)] focus-visible:outline-none focus-visible:text-[var(--color-brand)]"
                    >
                      {displayNumber}
                    </button>
                  ) : (
                    <span className="select-none text-right text-[11px] text-[var(--color-text-tertiary)]">
                      {displayNumber ?? ''}
                    </span>
                  )}
                  <span
                    className={`select-none text-center ${
                      isAdded
                        ? 'text-[var(--color-diff-added-text)]'
                        : isRemoved
                          ? 'text-[var(--color-diff-removed-text)]'
                          : 'text-[var(--color-text-tertiary)]'
                    }`}
                  >
                    {prefix}
                  </span>
                  <span
                    className={`whitespace-pre pr-6 ${
                      line.kind === 'file-header'
                        ? 'font-semibold text-[var(--color-text-secondary)]'
                        : isHunk
                          ? 'font-semibold text-[var(--color-warning)]'
                          : ''
                    }`}
                  >
                    {isCodeLine && !usePlainLargePreview ? (
                      line.code ? <InlineHighlightedCode value={line.code} language={language} /> : ' '
                    ) : (
                      line.code || ' '
                    )}
                  </span>
                </div>
                {commentLine && commentLine === activeCommentLine && onAddLineComment ? (
                  <LineCommentEditor
                    lineNumber={commentLine}
                    draft={commentDraft}
                    onDraftChange={setCommentDraft}
                    onCancel={() => openComment(null)}
                    onSubmit={(note) => {
                      onAddLineComment(commentLine, note, line.code)
                      openComment(null)
                    }}
                  />
                ) : null}
              </div>
            )
          })}
        </pre>
        {parsedLines.length > lineLimit && (
          <div className="sticky bottom-0 flex items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-glass)] px-3 py-2 text-xs text-[var(--color-text-tertiary)] backdrop-blur">
            <span>
              {showAllLines
                ? t('workspace.previewAllLines', { total: parsedLines.length })
                : t('workspace.previewLineLimit', { count: visibleLines.length, total: parsedLines.length })}
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
    </div>
  )
}
