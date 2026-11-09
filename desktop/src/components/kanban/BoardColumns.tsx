import { useState, type DragEvent } from 'react'
import { Plus } from 'lucide-react'
import type { BoardView, CardStatus, CardView } from '@protocol'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/ui/button'
import { Tooltip } from '../shared/Tooltip'
import { BOARD_COLUMNS, COMPACT_FOLDED, STATUS_LABEL } from './board'
import { StatusIcon } from './StatusIcon'
import { CARD_DRAG_TYPE, TaskCard } from './TaskCard'

type Props = {
  view: BoardView
  cards: CardView[]
  compact: boolean
  showCancelled: boolean
  selectedCard: number | null
  draggable: boolean
  onOpen: (card: CardView) => void
  onMove: (card: CardView, to: CardStatus) => void
  onArchive: (card: CardView) => void
  onCreate: (status: 'backlog' | 'todo') => void
}

export function BoardColumns({ view, cards, compact, showCancelled, selectedCard, draggable, onOpen, onMove, onArchive, onCreate }: Props) {
  const t = useTranslation()
  const [unfolded, setUnfolded] = useState<ReadonlySet<CardStatus>>(new Set())
  const [dropTarget, setDropTarget] = useState<CardStatus | null>(null)
  const columns: CardStatus[] = showCancelled ? [...BOARD_COLUMNS, 'cancelled'] : [...BOARD_COLUMNS]

  const toggleFold = (status: CardStatus) => setUnfolded((current) => {
    const next = new Set(current)
    if (next.has(status)) next.delete(status)
    else next.add(status)
    return next
  })

  const handleDrop = (event: DragEvent, status: CardStatus) => {
    event.preventDefault()
    setDropTarget(null)
    const id = Number(event.dataTransfer.getData(CARD_DRAG_TYPE))
    const card = cards.find((candidate) => candidate.id === id)
    if (card && card.status !== status) onMove(card, status)
  }

  return (
    <div data-testid="kanban-columns" data-compact={compact || undefined} className="flex min-h-0 flex-1 overflow-x-auto">
      {columns.map((status, index) => {
        const columnCards = cards
          .filter((card) => card.status === status)
          .sort((a, b) => a.order - b.order || a.id - b.id)
        const label = t(STATUS_LABEL[status])
        const folded = compact && COMPACT_FOLDED.has(status) && !unfolded.has(status)
        const border = index > 0 ? 'border-l border-[var(--color-border)]' : ''
        if (folded) {
          return (
            <Tooltip key={status} content={t('kanban.column.expand', { status: label })}>
              <button
                type="button"
                data-testid={`kanban-column-${status}`}
                data-folded="true"
                onClick={() => toggleFold(status)}
                onDragOver={(event) => { if (draggable) event.preventDefault() }}
                onDrop={(event) => handleDrop(event, status)}
                aria-label={t('kanban.column.expand', { status: label })}
                className={`flex w-9 shrink-0 flex-col items-center gap-2 py-3 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] ${border}`}
              >
                <StatusIcon status={status} />
                <span className="[writing-mode:vertical-rl]">{label}</span>
                <span className="tabular-nums text-[var(--color-text-tertiary)]">{columnCards.length}</span>
              </button>
            </Tooltip>
          )
        }
        return (
          <section
            key={status}
            data-testid={`kanban-column-${status}`}
            aria-label={label}
            onDragOver={(event) => {
              if (!draggable || !event.dataTransfer.types.includes(CARD_DRAG_TYPE)) return
              event.preventDefault()
              setDropTarget(status)
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => current === status ? null : current)
            }}
            onDrop={(event) => handleDrop(event, status)}
            className={`flex min-h-0 shrink-0 flex-col ${compact ? 'w-[164px]' : 'w-[264px]'} ${border} ${dropTarget === status ? 'bg-[var(--color-surface-hover)]' : ''}`}
          >
            <header className="flex h-10 shrink-0 items-center gap-2 px-3 text-[12px]">
              {compact && COMPACT_FOLDED.has(status) ? (
                <button type="button" onClick={() => toggleFold(status)} aria-label={t('kanban.column.collapse', { status: label })} className="flex min-w-0 items-center gap-2">
                  <StatusIcon status={status} />
                  <span className="truncate font-medium text-[var(--color-text-primary)]">{label}</span>
                </button>
              ) : (
                <>
                  <StatusIcon status={status} />
                  <span className="truncate font-medium text-[var(--color-text-primary)]">{label}</span>
                </>
              )}
              <span className="tabular-nums text-[var(--color-text-tertiary)]">{columnCards.length}</span>
              <span className="flex-1" />
              {(status === 'backlog' || status === 'todo') && (
                <Tooltip content={t('kanban.column.add', { status: label })}>
                  <Button variant="ghost" size="icon-xs" aria-label={t('kanban.column.add', { status: label })} onClick={() => onCreate(status)}>
                    <Plus aria-hidden="true" />
                  </Button>
                </Tooltip>
              )}
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
              {columnCards.map((card) => (
                <TaskCard
                  key={card.id}
                  view={view}
                  card={card}
                  compact={compact}
                  selected={card.id === selectedCard}
                  draggable={draggable}
                  onOpen={onOpen}
                  onMove={onMove}
                  onArchive={onArchive}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
