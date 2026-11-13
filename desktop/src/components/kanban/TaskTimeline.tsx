import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { BoardView, CardView, KanbanEvent } from '@protocol'
import { kanbanApi } from '../../api/kanban'
import { useTranslation, type TranslationKey } from '../../i18n'
import { relativeTimeLabel } from '../../lib/relativeTime'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { Button } from '../shared/ui/button'
import { CardLinks } from './CardLinks'
import { ROLE_LABEL, STATUS_LABEL, actorName, kanbanErrorMessage, sessionTitle, shortTitle, type Translate } from './board'
import { useKanbanCommand } from './useKanbanCommand'

const UPDATE_LABEL: Record<Extract<KanbanEvent, { type: 'update_added' }>['kind'], TranslationKey> = {
  progress: 'kanban.event.progress',
  comment: 'kanban.event.comment',
  decision: 'kanban.event.decision',
  blocked: 'kanban.event.blocked',
  changes_requested: 'kanban.event.changesRequested',
  accepted: 'kanban.event.accepted',
}

function targetName(t: Translate, view: BoardView, sessionId: string | undefined): string {
  return shortTitle((sessionId && sessionTitle(view, sessionId)) || t('kanban.actor.session'))
}

type Line = { text: string; detail?: string; links?: readonly string[]; resend?: number }

type StatusChange = Extract<KanbanEvent, { type: 'status_changed' }>

type Entry = { event: KanbanEvent; line: Line; status?: { from: StatusChange['from']; to: StatusChange['to'] } }

function sameCommand(a: KanbanEvent, b: KanbanEvent): boolean {
  if (a.at !== b.at || a.actor.kind !== b.actor.kind) return false
  return a.actor.kind === 'human' || (b.actor.kind === 'session' && a.actor.sessionId === b.actor.sessionId)
}

function commandGroups(events: readonly KanbanEvent[]): KanbanEvent[][] {
  const groups: KanbanEvent[][] = []
  for (const event of events) {
    const current = groups.at(-1)
    if (current && sameCommand(current[0]!, event)) current.push(event)
    else groups.push([event])
  }
  return groups
}

function entriesFor(t: Translate, view: BoardView, card: CardView, events: readonly KanbanEvent[]): Entry[] {
  return commandGroups(events).flatMap((group) => {
    const statuses = group.filter((event): event is StatusChange => event.type === 'status_changed')
    const main = group.filter((event) => event.type !== 'status_changed')
    const entries: Entry[] = main.flatMap((event) => {
      const line = describe(t, view, card, event)
      return line ? [{ event, line }] : []
    })
    if (!entries.length) {
      return statuses.flatMap((event) => {
        const line = describe(t, view, card, event)
        return line ? [{ event, line }] : []
      })
    }
    if (statuses.length) entries[0] = { ...entries[0]!, status: { from: statuses[0]!.from, to: statuses.at(-1)!.to } }
    return entries
  })
}

function describe(t: Translate, view: BoardView, card: CardView, event: KanbanEvent): Line | null {
  const actor = shortTitle(actorName(t, view, event.actor))
  switch (event.type) {
    case 'card_created':
      return { text: t('kanban.event.created', { actor }) }
    case 'card_edited':
      return { text: t('kanban.event.edited', { actor }) }
    case 'card_moved':
      return { text: t('kanban.event.moved', { actor, status: t(STATUS_LABEL[event.status]) }) }
    case 'status_changed':
      return { text: t('kanban.event.status', { actor, from: t(STATUS_LABEL[event.from]), to: t(STATUS_LABEL[event.to]) }), detail: event.reason }
    case 'dependency_added':
      return { text: t('kanban.event.dependencyAdded', { actor, card: `#${event.dependsOn}` }) }
    case 'dependency_removed':
      return { text: t('kanban.event.dependencyRemoved', { actor, card: `#${event.dependsOn}` }) }
    case 'assigned':
      return { text: t('kanban.event.assigned', { actor, target: targetName(t, view, event.sessionId), role: t(ROLE_LABEL[event.role]) }), detail: event.note }
    case 'assignment_revoked': {
      const revoked = card.assignments.find((candidate) => candidate.id === event.assignment)
      return { text: t('kanban.event.revoked', { actor, target: targetName(t, view, revoked?.sessionId) }), detail: event.reason }
    }
    case 'update_added':
      return { text: t(UPDATE_LABEL[event.kind], { actor }), detail: event.text, links: event.links }
    case 'delivery_submitted':
      return { text: t('kanban.event.delivered', { actor }) }
    case 'notification_failed':
      return { text: t('kanban.event.notificationFailed', { target: targetName(t, view, event.to) }), detail: event.error, ...(card.failedNotifications.includes(event.seq) ? { resend: event.seq } : {}) }
    case 'notification_sent':
      return event.resends ? { text: t('kanban.event.notificationResent', { target: targetName(t, view, event.to) }) } : null
    case 'card_archived':
      return { text: t('kanban.event.archived', { actor }) }
    case 'card_unarchived':
      return { text: t('kanban.event.unarchived', { actor }) }
    default:
      return null
  }
}

export function TaskTimeline({ panelId, board, view, card }: { panelId: string; board: string; view: BoardView; card: CardView }) {
  const t = useTranslation()
  const run = useKanbanCommand(board)
  const [events, setEvents] = useState<KanbanEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    kanbanApi.history(board, card.id)
      .then((result) => { if (!cancelled) { setEvents(result.events); setError(null) } })
      .catch((reason: unknown) => { if (!cancelled) setError(kanbanErrorMessage(t, reason)) })
    return () => { cancelled = true }
  }, [board, card.id, card.updatedAt, card.failedNotifications.length, t])

  if (error) return <p role="alert" className="text-xs text-destructive">{error}</p>
  if (!events) return <p className="text-xs text-subtle-foreground">{t('common.loading')}</p>
  const now = Date.now()
  const entries = entriesFor(t, view, card, events).reverse()

  return (
    <ol data-testid="kanban-timeline" className="flex flex-col gap-3">
      {entries.map(({ event, line, status }) => (
        <li key={event.seq} className={`flex flex-col gap-1 text-xs ${line.detail ? '' : 'border-l-2 border-border pl-3'}`}>
          <span className="flex items-baseline gap-2">
            <span className={`min-w-0 flex-1 ${line.detail ? 'text-muted-foreground' : 'text-subtle-foreground'}`}>{line.text}</span>
            <span className="shrink-0 text-2xs text-subtle-foreground">{relativeTimeLabel(t, now - Date.parse(event.at))}</span>
          </span>
          {status && (
            <span data-testid="kanban-timeline-status" className="flex items-center gap-1.5 text-2xs text-subtle-foreground">
              {t('kanban.detail.status')}
              <span>{t(STATUS_LABEL[status.from])}</span>
              <ArrowRight className="size-3" aria-hidden="true" />
              <span className="text-muted-foreground">{t(STATUS_LABEL[status.to])}</span>
            </span>
          )}
          {line.detail && (
            <div className="rounded-lg bg-muted px-2.5 py-1.5 text-sm text-foreground">
              <MarkdownRenderer content={line.detail} variant="compact" className="break-words" />
            </div>
          )}
          {line.links && <CardLinks panelId={panelId} projectRoot={view.project} links={line.links} author={event.actor} />}
          {line.resend !== undefined && (
            <Button variant="outline" size="sm" className="self-start" onClick={() => void run({ type: 'resend_notification', notification: line.resend! })}>
              {t('kanban.action.resend')}
            </Button>
          )}
        </li>
      ))}
    </ol>
  )
}
