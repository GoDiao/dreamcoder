import type { ComponentProps } from 'react'
import type { BoardView, CardView } from '@protocol'
import { useTranslation } from '../../i18n'
import { Spinner } from '../shared/ui/spinner'
import { activeAssignee, waitingForYou } from './board'

export function RunningSpinner(props: ComponentProps<typeof Spinner>) {
  return <span className="flex shrink-0 text-success"><Spinner {...props} /></span>
}

export function RunMarker({ view, card }: { view: BoardView; card: CardView }) {
  const t = useTranslation()
  const { state } = activeAssignee(view, card)
  const running = state.kind === 'session' && state.running
  const undelivered = card.failedNotifications.length > 0
  const waiting = !undelivered && waitingForYou(view, card.id)
  if (!running && !undelivered && !waiting) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-2xs font-medium">
      {undelivered && <span className="whitespace-nowrap text-destructive">{t('kanban.marker.undelivered')}</span>}
      {waiting && <span className="whitespace-nowrap text-primary">{t('kanban.marker.waitingForYou')}</span>}
      {running && <RunningSpinner className="size-3" aria-label={t('kanban.marker.running')} role="img" />}
    </span>
  )
}
