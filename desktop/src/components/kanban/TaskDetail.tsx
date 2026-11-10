import { useCallback, useId, useState, type ReactNode } from 'react'
import { ArrowUpRight, MoreHorizontal, X } from 'lucide-react'
import type { BoardView, CardView, KanbanAssignment } from '@protocol'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useVisiblePolling } from '../../hooks/useVisiblePolling'
import { openSessionTab } from '../../lib/sessionNavigation'
import { useKanbanStore } from '../../stores/kanbanStore'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { ActionMenu, type MenuAction } from '../shared/ActionMenu'
import { Button } from '../shared/ui/button'
import { Checkbox } from '../shared/ui/checkbox'
import { Input } from '../shared/ui/input'
import { Spinner } from '../shared/ui/spinner'
import { Textarea } from '../shared/ui/textarea'
import { AcceptanceEditor, AcceptanceMarker, acceptanceItems } from './AcceptanceEditor'
import { AssigneePicker } from './AssigneePicker'
import { CardLinks } from './CardLinks'
import { ClampedMarkdown } from './ClampedMarkdown'
import {
  ALL_STATUSES,
  PRIORITY_LABEL,
  STATUS_LABEL,
  cardStatus,
  cardTitle,
  actorName,
  moveIntent,
  ROLE_LABEL,
  assigneeState,
  assignmentInstructions,
  waitedBy,
  KANBAN_POLLING,
} from './board'
import { CreateTaskDialog } from './CreateTaskDialog'
import { StatusIcon } from './StatusIcon'
import { TaskTimeline } from './TaskTimeline'
import { useKanbanCommand } from './useKanbanCommand'
import { useMoveCard } from './useReasonPrompt'

type Props = { panelId: string; board: string; card: number; poll: boolean }

function BoardPoller({ board }: { board: string }) {
  const refresh = useKanbanStore((state) => state.refresh)
  useVisiblePolling(useCallback(() => refresh(board), [board, refresh]), KANBAN_POLLING)
  return null
}

export function TaskDetail({ panelId, board, card: id, poll }: Props) {
  const t = useTranslation()
  const view = useKanbanStore((state) => state.views[board])
  const loadError = useKanbanStore((state) => state.loadErrors[board])
  const card = view?.cards.find((candidate) => candidate.id === id)
  return (
    <div data-testid="kanban-task-detail" className="flex min-h-0 flex-1 flex-col">
      {poll && <BoardPoller board={board} />}
      {!view ? (
        loadError ? <p role="alert" className="p-4 text-[13px] text-[var(--color-error)]">{loadError}</p> : <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      ) : !card ? (
        <p className="p-4 text-[13px] text-[var(--color-text-secondary)]">{t('kanban.detail.notFound', { card: `#${id}` })}</p>
      ) : (
        <TaskDetailBody panelId={panelId} board={board} view={view} card={card} />
      )}
    </div>
  )
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2 text-[13px]">
      <span className="text-[var(--color-text-tertiary)]">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1">{children}</div>
    </div>
  )
}

const EMPTY_ASSIGNEE: Record<KanbanAssignment['role'], TranslationKey> = {
  owner: 'kanban.owner.none',
  reviewer: 'kanban.detail.noReviewer',
}

function AssigneeRow({ board, view, card, role }: { board: string; view: BoardView; card: CardView; role: KanbanAssignment['role'] }) {
  const t = useTranslation()
  const state = assigneeState(view, card[role])
  const instructions = assignmentInstructions(card, role) ?? (role === 'reviewer' && card.reviewer ? t('kanban.detail.defaultReviewInstructions') : null)
  return (
    <>
      <Property label={t(ROLE_LABEL[role])}>
        <div data-testid={`kanban-${role}`} className="flex min-w-0 flex-1 flex-nowrap items-center gap-1">
          <AssigneePicker board={board} view={view} card={card} slot={role} trigger={
            <Button variant="ghost" size="sm" className="min-w-0 max-w-full" title={state.kind === 'session' ? state.title : undefined}>
              <span className={`truncate ${state.kind === 'missing' ? 'text-[var(--color-error)]' : state.kind === 'none' ? 'text-[var(--color-text-tertiary)]' : ''}`}>
                {state.kind === 'session' ? state.title || t('session.untitled') : t(state.kind === 'missing' ? 'kanban.owner.missing' : EMPTY_ASSIGNEE[role])}
              </span>
            </Button>
          } />
          {state.kind === 'session' && (
            <>
              <span className="flex shrink-0 items-center gap-1 text-[12px] text-[var(--color-text-tertiary)]">
                {state.running ? <Spinner className="size-3 text-[var(--color-success)]" aria-hidden="true" /> : <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--color-text-tertiary)]" />}
                {t(state.running ? 'kanban.owner.running' : 'kanban.owner.idle')}
              </span>
              <Button variant="ghost" size="icon-xs" className="shrink-0" aria-label={t('kanban.detail.openSession')} title={t('kanban.detail.openSession')} onClick={() => openSessionTab(state.sessionId, state.title)}>
                <ArrowUpRight aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </Property>
      {instructions && (
        <div data-testid={`kanban-${role}-instructions`} className="pl-[92px] text-[12px] text-[var(--color-text-secondary)]">
          <ClampedMarkdown content={instructions} />
        </div>
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-[var(--color-border-separator)] pt-4">
      <h3 className="text-[12px] font-medium text-[var(--color-text-tertiary)]">{title}</h3>
      {children}
    </section>
  )
}

function TaskDetailBody({ panelId, board, view, card }: { panelId: string; board: string; view: BoardView; card: CardView }) {
  const t = useTranslation()
  const run = useKanbanCommand(board)
  const { move, dialog } = useMoveCard(board)
  const commentId = useId()
  const [editing, setEditing] = useState<'title' | 'description' | 'acceptance' | null>(null)
  const [draft, setDraft] = useState('')
  const [acceptanceDraft, setAcceptanceDraft] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [alsoCreator, setAlsoCreator] = useState(false)
  const [sending, setSending] = useState(false)
  const [creatingChild, setCreatingChild] = useState(false)
  const owner = assigneeState(view, card.owner)
  const open = (target: number) => useWorkspacePanelStore.getState().openTab(panelId, { kind: 'task', board, card: target })

  const startEdit = (field: 'title' | 'description' | 'acceptance') => {
    if (field === 'acceptance') setAcceptanceDraft(card.acceptance)
    else setDraft(field === 'title' ? card.title : card.description)
    setEditing(field)
  }

  const saveEdit = async () => {
    if (!editing) return
    const value = draft.trim()
    const ok = await run(
      editing === 'acceptance'
        ? { type: 'edit_card', card: card.id, acceptance: acceptanceItems(acceptanceDraft) }
        : editing === 'title'
          ? { type: 'edit_card', card: card.id, title: value }
          : { type: 'edit_card', card: card.id, description: value },
    )
    if (ok) setEditing(null)
  }

  const sendComment = async () => {
    setSending(true)
    const ok = await run({ type: 'add_update', card: card.id, kind: 'comment', text: comment.trim(), ...(alsoCreator && canAlsoNotifyCreator ? { notify: ['creator' as const] } : {}) })
    setSending(false)
    if (ok) setComment('')
  }

  const statusActions: MenuAction[] = ALL_STATUSES.filter((status) => moveIntent(card, status) !== null).map((status) => ({
    id: status,
    label: t(STATUS_LABEL[status]),
    onSelect: () => move(card, status),
  }))
  const moreActions: MenuAction[] = [
    { id: 'child', label: t('kanban.action.addChild'), onSelect: () => setCreatingChild(true) },
    ...(card.status === 'done' || card.status === 'cancelled' ? [{ id: 'reopen', label: t('kanban.action.reopen'), onSelect: () => move(card, 'todo') }] : []),
    { id: 'archive', label: t(card.archived ? 'kanban.action.unarchive' : 'kanban.action.archive'), onSelect: () => void run({ type: card.archived ? 'unarchive' : 'archive', card: card.id }) },
  ]
  const dependencyOptions: MenuAction[] = view.cards
    .filter((candidate) => candidate.id !== card.id && !card.dependsOn.includes(candidate.id) && candidate.status !== 'cancelled')
    .map((candidate) => ({ id: String(candidate.id), label: `#${candidate.id} ${candidate.title}`, onSelect: () => void run({ type: 'add_dependency', card: card.id, dependsOn: candidate.id }) }))
  const creatorName = actorName(t, view, card.createdBy)
  const canAlsoNotifyCreator = card.createdBy.kind === 'session' && card.createdBy.sessionId !== card.owner
  const relationRow = (target: number) => {
    const status = cardStatus(view, target)
    return (
      <li key={target}>
        <button type="button" onClick={() => open(target)} className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-[13px] hover:bg-[var(--color-surface-hover)]">
          {status && <StatusIcon status={status} label={t(STATUS_LABEL[status])} />}
          <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">#{target}</span>
          <span className="truncate">{cardTitle(view, target) ?? ''}</span>
        </button>
      </li>
    )
  }
  const relations: Array<{ label: string; ids: number[] }> = [
    { label: t('kanban.detail.parent'), ids: card.parent === null ? [] : [card.parent] },
    { label: t('kanban.detail.children'), ids: card.children },
    { label: t('kanban.detail.waitsOn'), ids: card.dependsOn },
    { label: t('kanban.detail.waitedBy'), ids: waitedBy(view, card.id) },
  ]

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]">
            <StatusIcon status={card.status} />
            <span className="font-mono">#{card.id}</span>
            {card.archived && <span>{t('kanban.detail.archived')}</span>}
            <span className="flex-1" />
            <ActionMenu label={t('kanban.card.actions', { card: `#${card.id}` })} actions={moreActions} trigger={
              <Button variant="ghost" size="icon-sm" aria-label={t('kanban.card.actions', { card: `#${card.id}` })}><MoreHorizontal aria-hidden="true" /></Button>
            } />
          </div>

          {editing === 'title' ? (
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void saveEdit() }}>
              <Input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={t('kanban.create.taskTitle')} autoFocus />
              <Button type="submit" size="sm" disabled={!draft.trim()}>{t('common.save')}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            </form>
          ) : (
            <h2 className="text-[17px] font-semibold leading-snug">
              <button type="button" onClick={() => startEdit('title')} aria-label={t('kanban.detail.editTitle')} className="cursor-text rounded-md text-left hover:bg-[var(--color-surface-hover)]">{card.title}</button>
            </h2>
          )}

          {editing === 'description' ? (
            <div className="flex flex-col gap-2">
              <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={6} aria-label={t('kanban.create.description')} autoFocus />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
                <Button size="sm" onClick={() => void saveEdit()}>{t('common.save')}</Button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => startEdit('description')} className="rounded-lg text-left text-[13px] hover:bg-[var(--color-surface-hover)]" aria-label={t('kanban.detail.editDescription')}>
              {card.description
                ? <MarkdownRenderer content={card.description} />
                : <span className="text-[var(--color-text-tertiary)]">{t('kanban.detail.addDescription')}</span>}
            </button>
          )}
          {owner.kind === 'missing' && <p className="rounded-lg bg-[var(--color-error-container)] px-3 py-2 text-[12px] text-[var(--color-error)]">{t('kanban.detail.ownerMissing')}</p>}

          <div className="flex flex-col gap-1.5">
            <Property label={t('kanban.detail.status')}>
              <ActionMenu label={t('kanban.detail.changeStatus')} actions={statusActions} trigger={
                <Button variant="ghost" size="sm" className="gap-1.5" aria-label={t('kanban.detail.changeStatus')}>
                  <StatusIcon status={card.status} />{t(STATUS_LABEL[card.status])}
                </Button>
              } />
            </Property>
            <Property label={t('kanban.detail.priority')}>
              <ActionMenu label={t('kanban.detail.changePriority')} actions={(['high', 'normal', 'low'] as const).map((priority) => ({
                id: priority,
                label: t(PRIORITY_LABEL[priority]),
                onSelect: () => void run({ type: 'edit_card', card: card.id, priority }),
              }))} trigger={<Button variant="ghost" size="sm" aria-label={t('kanban.detail.changePriority')}>{t(PRIORITY_LABEL[card.priority])}</Button>} />
            </Property>
            <AssigneeRow board={board} view={view} card={card} role="owner" />
            <AssigneeRow board={board} view={view} card={card} role="reviewer" />
            <Property label={t('kanban.detail.creator')}>
              <span className="truncate px-2.5 text-[13px]" title={creatorName}>{creatorName}</span>
            </Property>
            <Property label={t('kanban.detail.dependencies')}>
              {card.dependsOn.map((dependency) => {
                const status = cardStatus(view, dependency)
                return (
                  <span key={dependency} className="inline-flex h-6 items-center gap-1 rounded-lg border border-[var(--color-border)] pl-2 text-[12px]">
                    {status && <StatusIcon status={status} size={12} />}#{dependency}
                    <Button variant="ghost" size="icon-xs" aria-label={t('kanban.create.removeDependency', { card: `#${dependency}` })} onClick={() => void run({ type: 'remove_dependency', card: card.id, dependsOn: dependency })}>
                      <X aria-hidden="true" />
                    </Button>
                  </span>
                )
              })}
              {card.dependsOn.length === 0 && <span className="px-2.5 text-[var(--color-text-tertiary)]">{t('kanban.detail.none')}</span>}
              {dependencyOptions.length > 0 && (
                <ActionMenu label={t('kanban.create.addDependency')} actions={dependencyOptions} trigger={<Button variant="ghost" size="sm">{t('kanban.create.addDependency')}</Button>} />
              )}
            </Property>
          </div>

          {(card.deliveries.length > 0 || card.status === 'review') && (
            <Section title={t('kanban.detail.deliveries')}>
              {card.deliveries.map((delivery) => (
                <div key={delivery.id} className="flex flex-col gap-1 text-[13px]">
                  <ClampedMarkdown content={delivery.summary} />
                  <CardLinks panelId={panelId} board={board} projectRoot={view.project} links={delivery.links} author={delivery.actor} />
                </div>
              ))}
              {card.status === 'review' && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => move(card, 'done')}>{t('kanban.action.accept')}</Button>
                  <Button variant="outline" size="sm" onClick={() => move(card, 'in_progress')}>{t('kanban.action.requestChanges')}</Button>
                </div>
              )}
            </Section>
          )}

          <Section title={t('kanban.detail.acceptance')}>
            {editing === 'acceptance' ? (
              <div className="flex flex-col gap-2">
                <AcceptanceEditor items={acceptanceDraft} onChange={setAcceptanceDraft} label={t('kanban.detail.acceptance')} autoFocus />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
                  <Button size="sm" onClick={() => void saveEdit()}>{t('common.save')}</Button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => startEdit('acceptance')} aria-label={t('kanban.detail.editAcceptance')} className="flex flex-col gap-1 rounded-lg text-left text-[13px] hover:bg-[var(--color-surface-hover)]">
                {card.acceptance.length === 0 && <span className="text-[var(--color-text-tertiary)]">{t('kanban.detail.addAcceptance')}</span>}
                {card.acceptance.map((item) => (
                  <span key={item} className="flex items-start gap-2">
                    <AcceptanceMarker className="mt-[7px]" />
                    {item}
                  </span>
                ))}
              </button>
            )}
          </Section>

          <Section title={t('kanban.detail.relations')}>
            {relations.filter((relation) => relation.ids.length > 0).map((relation) => (
              <div key={relation.label} className="flex flex-col gap-0.5">
                <span className="text-[11px] text-[var(--color-text-tertiary)]">{relation.label}</span>
                <ul>{relation.ids.map(relationRow)}</ul>
              </div>
            ))}
            {relations.every((relation) => relation.ids.length === 0) && <span className="text-[13px] text-[var(--color-text-tertiary)]">{t('kanban.detail.none')}</span>}
          </Section>

          <Section title={t('kanban.detail.activity')}>
            <TaskTimeline panelId={panelId} board={board} view={view} card={card} />
          </Section>
        </div>
      </div>
      <form className="flex shrink-0 flex-col gap-2 border-t border-[var(--color-border)] px-4 py-3" onSubmit={(event) => { event.preventDefault(); void sendComment() }}>
        <Textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} placeholder={t('kanban.detail.commentPlaceholder')} aria-label={t('kanban.detail.comment')} />
        <div className="flex items-center gap-2">
          {canAlsoNotifyCreator && (
            <>
              <Checkbox id={commentId} checked={alsoCreator} onCheckedChange={(checked) => setAlsoCreator(checked === true)} />
              <label htmlFor={commentId} className="text-[12px] text-[var(--color-text-secondary)]">{t('kanban.detail.alsoCreator', { name: creatorName })}</label>
            </>
          )}
          <span className="flex-1" />
          <Button type="submit" size="sm" disabled={!comment.trim()} loading={sending}>{t('common.send')}</Button>
        </div>
      </form>
      {dialog}
      {creatingChild && (
        <CreateTaskDialog board={board} view={view} defaults={{ status: 'backlog', parent: card.id }} onClose={() => setCreatingChild(false)} onCreated={(created) => open(created.id)} />
      )}
    </>
  )
}
