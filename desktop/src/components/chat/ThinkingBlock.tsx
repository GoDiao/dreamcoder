import { useState, useEffect, useRef } from 'react'
import { Brain } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from '../shared/ui/trace'

export function ThinkingBlock({ content, isActive = false }: { content: string; isActive?: boolean }) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (expanded && isActive && contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight
  }, [content, expanded, isActive])

  const firstLine = content.match(/\S[^\r\n]*/)?.[0]?.replace(/\s+/g, ' ').trim() ?? ''
  const preview = firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine

  return (
    <Trace className="mb-1">
      <TraceCollapsible open={expanded} onOpenChange={setExpanded}>
        <TraceCollapsibleTrigger className="min-h-7 select-none">
          <TraceLine status={isActive ? 'running' : undefined}>
            <TraceIcon><Brain /></TraceIcon>
            <TraceTitle>{t('thinking.label')}</TraceTitle>
            {!expanded && preview && <span className="min-w-0 flex-1 truncate text-ui-muted-foreground">{preview}</span>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div ref={contentRef} className="max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words text-ui-aux leading-[1.6]">{content}</div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
