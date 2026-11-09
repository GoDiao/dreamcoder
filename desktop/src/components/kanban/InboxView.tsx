import { useState, type ReactNode } from 'react'
import type { BoardView, HandledItem, InboxItem } from '@protocol'
import { useTranslation, type TranslationKey } from '../../i18n'
import { relativeTimeLabel } from '../../lib/relativeTime'
import { openSessionTab } from '../../lib/sessionNavigation'
import { inboxItemKey, useKanbanStore } from '../../stores/kanbanStore'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import { Button } from '../shared/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '../shared/ui/empty'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../shared/ui/tabs'
import { assigneeState, blockReason, cardTitle, type Translate } from './board'
import { useKanbanCommand } from './useKanbanCommand'
import { useMoveCard } from './useReasonPrompt'

const KIND_LABEL: Record<InboxItem['kind'], TranslationKey> = {
  review: 'kanban.inbox.kind.review',
  blocked: 'kanban.inbox.kind.blocked',
  owner_missing: 'kanban.inbox.kind.owner_missing',
}

const HANDLED_LABEL: Record<HandledItem['kind'], TranslationKey> = {
  assigned: 'kanban.inbox.handled.assigned',
  accepted: 'kanban.inbox.handled.accepted',
  changes_requested: 'kanban.inbox.handled.changes_requested',
  unblocked: 'kanban.inbox.handled.unblocked',
}

function itemNote(t: Translate, view: BoardView, item: InboxItem): string {
  const card = view.cards.find((candidate) => candidate.id === item.card)
  if (!card) return ''
  switch (item.kind) {
    case 'review':
      return card.deliveries.at(-1)?.summary ?? ''
    case 'blocked':
      return blockReason(card) ?? ''
    case 'owner_missing':
      return t('kanban.inbox.note.owner_missing')
  }
}

export function InboxView({ panelId, board }: { panelId: string; board: string }) {
  const t = useTranslation()
  const view = useKanbanStore((state) => state.views[board])
  const snoozedKeys = useKanbanStore((state) => state.snoozed[board])
  const setSnoozed = useKanbanStore((state) => state.setSnoozed)
  const run = useKanbanCommand(board)
  const { move, dialog } = useMoveCard(board)
  const openTab = useWorkspacePanelStore((state) => state.openTab)
  const openTask = (card: number) => openTab(panelId, { kind: 'task', board, card })
  const [tab, setTab] = useState('needs')
  if (!view) return null

  const snoozed = new Set(snoozedKeys ?? [])
  const items = view.inbox ?? []
  const needs = items.filter((item) => !snoozed.has(inboxItemKey(item)))
  const later = items.filter((item) => snoozed.has(inboxItemKey(item)))
  const now = Date.now()

  const accept = (id: number) => {
    const card = view.cards.find((candidate) => candidate.id === id)
    if (card) move(card, 'done')
  }

  const actionsFor = (item: InboxItem): ReactNode => {
    const openCard = () => openTask(item.card)
    switch (item.kind) {
      case 'review':
        return (
          <>
            <Button size="sm" onClick={openCard}>{t('kanban.inbox.viewDelivery')}</Button>
            <Button variant="ghost" size="sm" onClick={() => accept(item.card)}>{t('kanban.action.accept')}</Button>
          </>
        )
      case 'blocked': {
        const owner = assigneeState(view, view.cards.find((candidate) => candidate.id === item.card)?.owner ?? null)
        return (
          <>
            <Button size="sm" onClick={openCard}>{t('kanban.inbox.view')}</Button>
            {owner.kind === 'session' && (
              <Button variant="ghost" size="sm" onClick={() => openSessionTab(owner.sessionId, owner.title)}>{t('kanban.inbox.openOwner')}</Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void run({ type: 'unblock', card: item.card })}>{t('kanban.action.unblock')}</Button>
          </>
        )
      }
      case 'owner_missing':
        return <Button size="sm" onClick={openCard}>{t('kanban.inbox.reassign')}</Button>
    }
  }

  const row = (item: InboxItem, isSnoozed: boolean) => {
    const key = inboxItemKey(item)
    return (
      <li key={key} data-testid={`kanban-inbox-${key}`} className="flex flex-col gap-1.5 border-b border-[var(--color-border-separator)] px-4 py-3">
        <span className="flex min-w-0 items-baseline gap-2 text-[13px]">
          <span className="shrink-0 text-[12px] font-medium text-[var(--color-brand)]">{t(KIND_LABEL[item.kind])}</span>
          <button type="button" onClick={() => openTask(item.card)} className="min-w-0 truncate text-left hover:underline">
            <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">#{item.card}</span> {cardTitle(view, item.card)}
          </button>
        </span>
        <span className="line-clamp-2 text-[12px] text-[var(--color-text-secondary)]">{itemNote(t, view, item)}</span>
        <span className="flex flex-wrap gap-2">
          {actionsFor(item)}
          <Button variant="ghost" size="sm" onClick={() => setSnoozed(board, key, !isSnoozed)}>{t(isSnoozed ? 'kanban.inbox.unsnooze' : 'kanban.inbox.snooze')}</Button>
        </span>
      </li>
    )
  }

  const empty = (label: TranslationKey) => (
    <Empty className="flex-none py-10"><EmptyHeader><EmptyTitle className="text-[13px] font-normal text-[var(--color-text-secondary)]">{t(label)}</EmptyTitle></EmptyHeader></Empty>
  )

  return (
    <>
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="mx-3 mt-2 shrink-0">
          <TabsTrigger value="needs">{t('kanban.inbox.needs', { count: needs.length })}</TabsTrigger>
          <TabsTrigger value="later">{t('kanban.inbox.later', { count: later.length })}</TabsTrigger>
          <TabsTrigger value="handled">{t('kanban.inbox.handledTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="needs" className="min-h-0 flex-1 overflow-y-auto">
          {needs.length ? <ul>{needs.map((item) => row(item, false))}</ul> : empty('kanban.inbox.emptyNeeds')}
        </TabsContent>
        <TabsContent value="later" className="min-h-0 flex-1 overflow-y-auto">
          {later.length ? <ul>{later.map((item) => row(item, true))}</ul> : empty('kanban.inbox.emptyLater')}
        </TabsContent>
        <TabsContent value="handled" className="min-h-0 flex-1 overflow-y-auto">
          {view.handled?.length ? (
            <ul>
              {view.handled.map((item) => (
                <li key={item.seq} className="flex items-baseline gap-2 border-b border-[var(--color-border-separator)] px-4 py-2.5 text-[13px]">
                  <span className="shrink-0 text-[12px] text-[var(--color-text-secondary)]">{t(HANDLED_LABEL[item.kind])}</span>
                  <button type="button" onClick={() => openTask(item.card)} className="min-w-0 flex-1 truncate text-left hover:underline">
                    <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">#{item.card}</span> {cardTitle(view, item.card)}
                  </button>
                  <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{relativeTimeLabel(t, now - Date.parse(item.at))}</span>
                </li>
              ))}
            </ul>
          ) : empty('kanban.inbox.emptyHandled')}
        </TabsContent>
      </Tabs>
      {dialog}
    </>
  )
}
