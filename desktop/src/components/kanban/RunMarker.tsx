import type { BoardView, CardView } from '@protocol'
import { useTranslation } from '../../i18n'
import { Spinner } from '../shared/ui/spinner'
import { activeAssignee, waitingForYou } from './board'

export function RunMarker({ view, card }: { view: BoardView; card: CardView }) {
  const t = useTranslation()
  const { state } = activeAssignee(view, card)
  const running = state.kind === 'session' && state.running
  const undelivered = card.failedNotifications.length > 0
  const waiting = !undelivered && waitingForYou(view, card.id)
  if (!running && !undelivered && !waiting) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium">
      {undelivered && <span className="whitespace-nowrap text-[var(--color-error)]">{t('kanban.marker.undelivered')}</span>}
      {waiting && <span className="whitespace-nowrap text-[var(--color-brand)]">{t('kanban.marker.waitingForYou')}</span>}
      {running && <Spinner className="size-3 text-[var(--color-success)]" aria-label={t('kanban.marker.running')} role="img" />}
    </span>
  )
}
