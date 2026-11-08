import { useTranslation } from '../../i18n'
import { useSessionLink } from '../../lib/sessionNavigation'
import { Button } from '../shared/ui/button'
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
    <Button
      type="button"
      variant="link"
      onClick={link.open}
      aria-label={t('chat.sessionMessage.open', { name: link.title })}
      className={cn('h-auto min-w-0 justify-start px-0 text-[length:inherit]', className)}
    >
      <span className="truncate">{link.title}</span>
    </Button>
  )
}
