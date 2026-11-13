import { MessageSquare } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { FileDiff, type FileDiffProps } from '@pierre/diffs/react'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { ThemeMode } from '../../types/settings'
import { themeColorScheme } from '../../theme/colorScheme'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/utils'
import { Button } from './ui/button'
import './pierre.css'

type Props = Omit<FileDiffProps<undefined, undefined>, 'options'> & {
  fileDiff: FileDiffMetadata
  theme: ThemeMode
  hideFileHeader?: boolean
  onCommentLine?: (line: number) => void
}

export function PierreDiffSurface({ fileDiff, theme, className, hideFileHeader = true, onCommentLine, ...props }: Props) {
  const t = useTranslation()
  const commentButtonRef = useRef<HTMLButtonElement>(null)
  const options = useMemo<FileDiffProps<undefined, undefined>['options']>(() => ({
    theme: { light: 'github-light', dark: 'github-dark' },
    themeType: themeColorScheme(theme),
    diffStyle: 'unified',
    diffIndicators: 'bars',
    hunkSeparators: 'line-info',
    lineDiffType: 'word',
    overflow: 'scroll',
    disableFileHeader: hideFileHeader,
    onPostRender: onCommentLine ? (host, _, phase) => {
      if (phase === 'unmount') return
      for (const number of host.shadowRoot?.querySelectorAll<HTMLElement>('[data-column-number]') ?? []) {
        if (number.getAttribute('data-line-type') === 'change-deletion' || number.closest('[data-deletions]')) continue
        const line = Number(number.getAttribute('data-column-number'))
        if (!(line > 0)) continue
        number.setAttribute('role', 'button')
        number.setAttribute('aria-label', t('workspace.commentLine', { line }))
        number.tabIndex = 0
        number.onkeydown = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onCommentLine(line)
          }
        }
      }
    } : undefined,
    onLineNumberClick: onCommentLine ? ({ annotationSide, lineNumber }) => {
      if (annotationSide === 'additions') onCommentLine(lineNumber)
    } : undefined,
    enableGutterUtility: Boolean(onCommentLine),
    onLineEnter: onCommentLine ? ({ annotationSide, lineNumber }) => {
      const button = commentButtonRef.current
      if (!button) return
      button.toggleAttribute('data-hidden', annotationSide !== 'additions')
      button.setAttribute('aria-label', t('workspace.commentLine', { line: lineNumber }))
    } : undefined,
  }), [theme, hideFileHeader, onCommentLine, t])
  return (
    <FileDiff
      fileDiff={fileDiff}
      options={options}
      className={cn('pierre-diff-surface', className)}
      renderGutterUtility={onCommentLine ? (getHoveredLine) => (
        <Button
          ref={commentButtonRef}
          type="button"
          variant="ghost-muted"
          size="icon-xs"
          aria-label={t('workspace.addComment')}
          className="data-hidden:hidden"
          onClick={() => {
            const line = getHoveredLine()
            if (line?.side === 'additions') onCommentLine(line.lineNumber)
          }}
        >
          <MessageSquare aria-hidden="true" />
        </Button>
      ) : undefined}
      {...props}
    />
  )
}
