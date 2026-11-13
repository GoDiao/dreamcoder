import { memo, type DragEvent } from 'react'
import type { BoardView, CardStatus, CardView } from '@protocol'
import { useTranslation } from '../../i18n'
import { CardButton } from '../shared/CardButton'
import { RowActionMenu, type MenuAction } from '../shared/ActionMenu'
import { ALL_STATUSES, PRIORITY_LABEL, STATUS_LABEL, activeAssignee, cardNote, cardStatus, moveIntent } from './board'
import { RunMarker } from './RunMarker'

export const CARD_DRAG_TYPE = 'application/x-dreamcoder-kanban-card'

const PRIORITY_BAR: Record<CardView['priority'], string> = {
  high: 'bg-destructive',
  normal: 'bg-subtle-foreground',
  low: 'bg-border',
}

type Props = {
  view: BoardView
  card: CardView
  compact?: boolean
  selected?: boolean
  draggable?: boolean
  onOpen: (card: CardView) => void
  onMove: (card: CardView, to: CardStatus) => void
  onArchive: (card: CardView) => void
}

export function AssigneeName({ view, card }: { view: BoardView; card: CardView }) {
  const t = useTranslation()
  const { role, state } = activeAssignee(view, card)
  if (state.kind === 'missing') return <span className="truncate text-destructive">{t('kanban.owner.missing')}</span>
  if (state.kind === 'none') return <span className="truncate text-subtle-foreground">{t('kanban.owner.none')}</span>
  const name = state.title || t('session.untitled')
  return <span className="truncate text-muted-foreground">{role === 'reviewer' ? t('kanban.card.reviewing', { name }) : name}</span>
}

export const TaskCard = memo(function TaskCard({ view, card, compact = false, selected = false, draggable = false, onOpen, onMove, onArchive }: Props) {
  const t = useTranslation()
  const note = compact ? null : cardNote(t, card)
  const doneChildren = card.children.filter((id) => cardStatus(view, id) === 'done').length
  const actions: MenuAction[] = [
    ...ALL_STATUSES.filter((status) => moveIntent(card, status) !== null).map((status, index) => ({
      id: `move-${status}`,
      label: t(STATUS_LABEL[status]),
      heading: index === 0 ? t('kanban.action.moveTo') : undefined,
      onSelect: () => onMove(card, status),
    })),
    {
      id: 'archive',
      label: t(card.archived ? 'kanban.action.unarchive' : 'kanban.action.archive'),
      separatorBefore: true,
      onSelect: () => onArchive(card),
    },
  ]

  const handleDragStart = (event: DragEvent) => {
    event.dataTransfer.setData(CARD_DRAG_TYPE, String(card.id))
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <RowActionMenu actions={actions} triggerLabel={t('kanban.card.actions', { card: `#${card.id}` })}>
      {(menuTrigger) => (
        <div className="group/card relative" data-testid={`kanban-card-${card.id}`}>
          <CardButton
            draggable={draggable}
            onDragStart={handleDragStart}
            onClick={() => onOpen(card)}
            aria-current={selected || undefined}
            className={`flex w-full min-w-0 flex-col gap-1 border px-2.5 py-2 ${selected ? 'border-ring bg-selected' : 'border-border'} ${card.archived ? 'opacity-60' : ''}`}
          >
            <span className="flex min-w-0 items-center gap-1.5 pr-5 text-2xs text-subtle-foreground">
              <span className="font-mono">#{card.id}</span>
              {!compact && card.parent !== null && <span className="truncate font-mono">↑#{card.parent}</span>}
              <span className="flex-1" />
              <RunMarker view={view} card={card} />
            </span>
            <span className="line-clamp-2 text-sm leading-4.5 text-foreground">{card.title}</span>
            {note && <span className="truncate text-xs text-subtle-foreground">{note}</span>}
            <span className="flex min-w-0 items-center gap-2 text-2xs">
              {!compact && <span aria-label={t('kanban.card.priority', { priority: t(PRIORITY_LABEL[card.priority]) })} role="img" className={`h-3 w-[3px] shrink-0 rounded-full ${PRIORITY_BAR[card.priority]}`} />}
              {!compact && card.children.length > 0 && (
                <span className="shrink-0 tabular-nums text-subtle-foreground">{t('kanban.card.children', { done: doneChildren, total: card.children.length })}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-right">
                <AssigneeName view={view} card={card} />
              </span>
            </span>
          </CardButton>
          <div className="absolute right-1.5 top-1.5 opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 has-data-[state=open]:opacity-100">{menuTrigger}</div>
        </div>
      )}
    </RowActionMenu>
  )
})
