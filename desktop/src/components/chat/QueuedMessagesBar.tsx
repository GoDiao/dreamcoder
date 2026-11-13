import { Clock } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { cn } from '@/lib/utils'
import { useChatStore } from '../../stores/chatStore'
import { Button } from '../shared/ui/button'
import { TraceDescription, TraceIcon, TraceLine, TraceTitle } from '../shared/ui/trace'
import { ChatTraceBar } from './ChatTraceBar'

export function QueuedMessagesBar({ sessionId }: { sessionId: string | null | undefined }) {
  const t = useTranslation()
  const isMobile = useMobileViewport() && !isDesktopRuntime()
  const queued = useChatStore((state) => (sessionId ? state.sessions[sessionId]?.mirror?.queuedMessages : undefined))
  const cancelQueuedMessage = useChatStore((state) => state.cancelQueuedMessage)
  const sendQueuedNow = useChatStore((state) => state.sendQueuedNow)
  if (!sessionId || !queued?.length) return null

  return (
    <ChatTraceBar>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <TraceLine>
          <TraceIcon><Clock /></TraceIcon>
          <TraceTitle>{t('chat.queued.title')}</TraceTitle>
        </TraceLine>
        <Button
          type="button"
          variant="outline"
          size={isMobile ? 'lg' : 'sm'}
          className={cn(isMobile && 'min-h-11')}
          onClick={() => sendQueuedNow(sessionId)}
        >
          {t('chat.queued.sendNow')}
        </Button>
      </div>
      <ul className="flex max-h-[160px] flex-col gap-1.5 overflow-y-auto">
        {queued.map((message) => (
          <li key={message.id} className="flex min-w-0 items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{message.content}</span>
            {message.attachmentCount > 0 && (
              <TraceDescription>{t('chat.queued.attachments', { count: message.attachmentCount })}</TraceDescription>
            )}
            <Button
              type="button"
              variant="ghost"
              size={isMobile ? 'lg' : 'xs'}
              className={cn(isMobile && 'min-h-11')}
              aria-label={t('chat.queued.withdrawLabel', { text: message.content })}
              onClick={() => cancelQueuedMessage(sessionId, message.id)}
            >
              {t('chat.queued.withdraw')}
            </Button>
          </li>
        ))}
      </ul>
    </ChatTraceBar>
  )
}
