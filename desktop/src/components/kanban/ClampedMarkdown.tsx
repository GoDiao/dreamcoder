import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { Button } from '../shared/ui/button'

export function ClampedMarkdown({ content }: { content: string }) {
  const t = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (element && !expanded) setOverflows(element.scrollHeight > element.clientHeight + 1)
  }, [content, expanded])

  return (
    <div className="flex flex-col items-start gap-1">
      <div ref={ref} data-testid="kanban-clamped" className={`w-full ${expanded ? '' : 'max-h-40 overflow-hidden'}`}>
        <MarkdownRenderer content={content} variant="compact" className="break-words" />
      </div>
      {(overflows || expanded) && (
        <Button variant="link" size="sm" className="h-auto px-0" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {t(expanded ? 'kanban.detail.showLess' : 'kanban.detail.showMore')}
        </Button>
      )}
    </div>
  )
}
