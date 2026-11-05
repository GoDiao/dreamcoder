import { memo, useState } from 'react'
import { MessageSquareShare } from 'lucide-react'
import { useTranslation, type TranslationKey } from '../../i18n'
import type { SessionOrigin } from '../../types/chat'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from '../shared/ui/trace'
import { MessageActionBar } from './MessageActionBar'
import { SessionLink } from './SessionLink'

const PURPOSE_LABEL_KEYS: Record<SessionOrigin['purpose'], TranslationKey> = {
  message: 'chat.sessionMessage.purpose.message',
  brief: 'chat.sessionMessage.purpose.brief',
  report: 'chat.sessionMessage.purpose.report',
}

const PREVIEW_MAX_LENGTH = 80

function previewOf(summary: string | undefined, content: string): string {
  const text = summary?.trim() || content.match(/\S[^\r\n]*/)?.[0]?.replace(/\s+/g, ' ').trim() || ''
  return text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH)}…` : text
}

type Props = {
  content: string
  origin: SessionOrigin
  timestamp?: number
}

export const SessionMessageCard = memo(function SessionMessageCard({ content, origin, timestamp }: Props) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const preview = previewOf(origin.summary, content)

  return (
    <div data-message-shell="session" className="group mb-1 flex w-full min-w-0 flex-col">
      <Trace>
        <TraceCollapsible open={expanded} onOpenChange={setExpanded}>
          <div className="flex min-h-7 min-w-0 items-center gap-2">
            <TraceLine className="flex-shrink-0">
              <TraceIcon><MessageSquareShare /></TraceIcon>
              <TraceTitle className="flex-shrink-0">{t('chat.sessionMessage.from')}</TraceTitle>
            </TraceLine>
            <SessionLink sessionId={origin.sessionId} sentTitle={origin.name} className="min-w-0 max-w-[40%]" />
            <TraceCollapsibleTrigger className="min-w-0 flex-1 select-none">
              <TraceLine>
                <span className="flex-shrink-0 text-ui-muted-foreground/70">{t(PURPOSE_LABEL_KEYS[origin.purpose])}</span>
                {!expanded && preview && <span className="min-w-0 flex-1 truncate text-ui-muted-foreground">{preview}</span>}
              </TraceLine>
            </TraceCollapsibleTrigger>
          </div>
          <TraceCollapsibleContent>
            <div className="text-ui-message leading-[1.7] text-[var(--color-text-primary)]">
              <MarkdownRenderer content={content} />
            </div>
            <MessageActionBar
              copyText={content}
              copyLabel={t('chat.copyPrompt')}
              align="start"
              timestamp={timestamp}
            />
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    </div>
  )
})
