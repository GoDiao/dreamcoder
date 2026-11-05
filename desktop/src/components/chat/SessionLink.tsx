import { useTranslation } from '../../i18n'
import { useSessionLink } from '../../lib/sessionNavigation'
import { cn } from '@/lib/utils'

type Props = {
  sessionId: string
  sentTitle?: string
  className?: string
}

export function SessionLink({ sessionId, sentTitle, className }: Props) {
  const t = useTranslation()
  const link = useSessionLink({ sessionId, sentTitle })
  return (
    <button
      type="button"
      onClick={link.open}
      aria-label={t('chat.sessionMessage.open', { name: link.title })}
      className={cn(
        'truncate rounded bg-transparent font-medium text-[var(--color-brand)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
        className,
      )}
    >
      {link.title}
    </button>
  )
}
