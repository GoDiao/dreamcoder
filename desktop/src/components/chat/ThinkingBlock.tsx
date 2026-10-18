import { useState, useEffect, useRef } from 'react'
import { useTranslation } from '../../i18n'
import { ChevronDown, ChevronRight } from 'lucide-react'

export function ThinkingBlock({ content, isActive = false }: { content: string; isActive?: boolean }) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (expanded && isActive && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [content, expanded, isActive])

  const lines = content.split('\n').filter((l) => l.trim())
  const firstLine = lines[0]?.replace(/\s+/g, ' ').trim() || ''
  const preview = firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine

  return (
    <div className="mb-1">
      <style>{thinkingStyles}</style>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-7 w-full items-center gap-2 rounded-md text-left text-ui-aux text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
      >
        <span className="text-[var(--color-text-tertiary)]" aria-hidden="true">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="shrink-0 font-medium">
          {t('thinking.label')}
          {isActive && <span className="thinking-dots" />}
        </span>
        {!expanded && preview && (
          <span className="min-w-0 flex-1 truncate text-[var(--color-text-tertiary)]">
            {preview}
            {isActive && <span className="thinking-inline-cursor" />}
          </span>
        )}
      </button>
      {expanded && (
        <div
          ref={contentRef}
          className="mb-2 ml-[7px] mt-1 max-h-[300px] overflow-y-auto border-l border-[var(--color-border)] py-0.5 pl-4 text-ui-aux leading-[1.6] text-[var(--color-text-tertiary)] whitespace-pre-wrap break-words"
        >
          {content}
          {isActive && expanded && <span className="thinking-cursor" />}
        </div>
      )}
    </div>
  )
}

const thinkingStyles = `
@keyframes thinking-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes thinking-dots {
  0%, 20% { content: ''; }
  40% { content: '.'; }
  60% { content: '..'; }
  80%, 100% { content: '...'; }
}
.thinking-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--color-text-tertiary);
  vertical-align: middle;
  margin-left: 1px;
  animation: thinking-cursor-blink 1s step-end infinite;
}
.thinking-inline-cursor {
  display: inline-block;
  width: 1px;
  height: 0.95em;
  margin-left: 3px;
  vertical-align: text-bottom;
  background: var(--color-text-tertiary);
  animation: thinking-cursor-blink 1s step-end infinite;
}
.thinking-dots::after {
  content: '';
  animation: thinking-dots 1.4s steps(1, end) infinite;
}
`
