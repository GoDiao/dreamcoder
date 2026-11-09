import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { BoardView, CardView } from '@protocol'
import { useTranslation } from '../../i18n'
import { relativeTimeLabel } from '../../lib/relativeTime'
import { TreeConnector, treeGuides } from '../shared/TreeConnector'
import { Spinner } from '../shared/ui/spinner'
import { STATUS_LABEL, activeAssignee, cardTreeRows, waitedBy } from './board'
import { StatusIcon } from './StatusIcon'
import { AssigneeName } from './TaskCard'

const INDENT = 22
const GRID = 'grid grid-cols-[minmax(220px,1fr)_120px_200px_200px_88px] items-center gap-3 px-8 @max-[940px]:grid-cols-[minmax(220px,1fr)_120px_160px] @max-[940px]:[&>*:nth-child(n+4)]:hidden'

export function TaskTree({ view, cards, selectedCard, onOpen }: { view: BoardView; cards: CardView[]; selectedCard: number | null; onOpen: (card: CardView) => void }) {
  const t = useTranslation()
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())
  const rows = useMemo(() => cardTreeRows(cards, collapsed), [cards, collapsed])
  const guides = useMemo(() => treeGuides(rows.map((row) => row.depth)), [rows])
  const selected = cards.find((card) => card.id === selectedCard) ?? null
  const related = useMemo(
    () => new Set(selected ? [...selected.dependsOn, ...waitedBy(view, selected.id)] : []),
    [selected, view],
  )
  const now = Date.now()

  const toggle = (id: number) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div data-testid="kanban-tree" role="table" aria-label={t('kanban.view.tree')} className="@container min-h-0 flex-1 overflow-auto text-[13px]">
      <div role="row" className={`${GRID} h-9 border-b border-[var(--color-border)] text-[12px] text-[var(--color-text-tertiary)]`}>
        <span role="columnheader">{t('kanban.tree.task')}</span>
        <span role="columnheader">{t('kanban.tree.status')}</span>
        <span role="columnheader">{t('kanban.tree.owner')}</span>
        <span role="columnheader">{t('kanban.tree.dependencies')}</span>
        <span role="columnheader" className="text-right">{t('kanban.tree.updated')}</span>
      </div>
      {rows.map(({ card, depth, childCount, doneChildren }, index) => {
        const { state: assignee } = activeAssignee(view, card)
        const waiting = waitedBy(view, card.id)
        const isSelected = card.id === selectedCard
        return (
          <div
            key={card.id}
            role="row"
            data-testid={`kanban-tree-row-${card.id}`}
            data-related={related.has(card.id) || undefined}
            className={`${GRID} min-h-10 border-b border-[var(--color-border-separator)] ${isSelected ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'} ${related.has(card.id) ? 'shadow-[inset_3px_0_0_var(--color-info)]' : ''}`}
          >
            <span role="cell" className="relative flex min-w-0 items-center gap-2 self-stretch overflow-hidden" style={{ paddingLeft: depth * INDENT }}>
              <TreeConnector guide={guides[index]!} indent={INDENT} />
              {childCount > 0 ? (
                <button
                  type="button"
                  onClick={() => toggle(card.id)}
                  aria-expanded={!collapsed.has(card.id)}
                  aria-label={t(collapsed.has(card.id) ? 'kanban.tree.expand' : 'kanban.tree.collapse', { card: `#${card.id}` })}
                  className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  {collapsed.has(card.id) ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                </button>
              ) : <span className="w-4 shrink-0" />}
              <button type="button" onClick={() => onOpen(card)} className="flex min-w-0 items-center gap-2 text-left">
                <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">#{card.id}</span>
                <span className={`truncate ${depth === 0 || isSelected ? 'font-medium' : ''}`}>{card.title}</span>
              </button>
              {childCount > 0 && <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">{t('kanban.card.children', { done: doneChildren, total: childCount })}</span>}
            </span>
            <span role="cell" className="flex items-center gap-1.5"><StatusIcon status={card.status} />{t(STATUS_LABEL[card.status])}</span>
            <span role="cell" className="flex min-w-0 items-center gap-1.5">
              <AssigneeName view={view} card={card} />
              {assignee.kind === 'session' && assignee.running && <Spinner className="size-3 shrink-0 text-[var(--color-success)]" role="img" aria-label={t('kanban.marker.running')} />}
            </span>
            <span role="cell" className="truncate text-[12px] text-[var(--color-text-secondary)]">
              {[
                card.dependsOn.length ? t('kanban.tree.waitsOn', { cards: card.dependsOn.map((id) => `#${id}`).join(' ') }) : null,
                waiting.length ? t('kanban.tree.waitedBy', { cards: waiting.map((id) => `#${id}`).join(' ') }) : null,
              ].filter(Boolean).join(' · ')}
            </span>
            <span role="cell" className="text-right text-[12px] text-[var(--color-text-tertiary)]">{relativeTimeLabel(t, now - Date.parse(card.updatedAt))}</span>
          </div>
        )
      })}
    </div>
  )
}
