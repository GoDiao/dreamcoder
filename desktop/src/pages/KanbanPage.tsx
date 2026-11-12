import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { BoardView, CardStatus, CardView } from '@protocol'
import { useTranslation } from '../i18n'
import { useMobileViewport } from '../hooks/useMobileViewport'
import { useVisiblePolling } from '../hooks/useVisiblePolling'
import { isDesktopRuntime } from '../lib/desktopRuntime'
import { boardForProject, useInboxCount, useKanbanStore } from '../stores/kanbanStore'
import { kanbanTabProject, useTabStore } from '../stores/tabStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'
import { FormSelect } from '../components/shared/FormSelect'
import { SearchField } from '../components/shared/SearchField'
import { SegmentedControl } from '../components/shared/SegmentedControl'
import { Button } from '../components/shared/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/shared/ui/collapsible'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '../components/shared/ui/empty'
import { Spinner } from '../components/shared/ui/spinner'
import { WorkspaceSplit, useWorkspaceSplitState } from '../components/workspace/WorkspaceSplit'
import { BoardColumns } from '../components/kanban/BoardColumns'
import { CreateTaskDialog, type CreateDefaults } from '../components/kanban/CreateTaskDialog'
import { RunMarker } from '../components/kanban/RunMarker'
import { StatusIcon } from '../components/kanban/StatusIcon'
import { AssigneeName } from '../components/kanban/TaskCard'
import { TaskTree } from '../components/kanban/TaskTree'
import { ALL_STATUSES, KANBAN_POLLING, STATUS_LABEL, cardNote, kanbanErrorMessage } from '../components/kanban/board'
import { matchesQuery } from '../lib/textMatch'
import { useMoveCard } from '../components/kanban/useReasonPrompt'
import { useKanbanCommand } from '../components/kanban/useKanbanCommand'

type Mode = 'board' | 'tree'
const ALL = '__all__'
const UNASSIGNED = '__unassigned__'

function projectName(project: string) {
  return project.split(/[\\/]/).filter(Boolean).pop() ?? project
}

export function KanbanPage() {
  const t = useTranslation()
  const tabId = useTabStore((state) => state.activeTabId)
  const project = kanbanTabProject(tabId)
  const boards = useKanbanStore((state) => state.boards)
  const loadBoards = useKanbanStore((state) => state.loadBoards)
  const [listError, setListError] = useState<string | null>(null)

  useEffect(() => {
    if (boards) return
    loadBoards().catch((error: unknown) => setListError(kanbanErrorMessage(t, error)))
  }, [boards, loadBoards, t])

  if (!tabId || !project) return null
  if (!boards) {
    return listError
      ? <p role="alert" className="p-10 text-[13px] text-[var(--color-error)]">{listError}</p>
      : <div className="flex flex-1 items-center justify-center"><Spinner /></div>
  }
  const listing = boardForProject(boards, project)
  if (!listing) return <CreateBoard project={project} />
  return <BoardPage key={listing.key} tabId={tabId} project={project} board={listing.key} />
}

function PageHeader({ project, aside }: { project: string; aside?: React.ReactNode }) {
  const t = useTranslation()
  return (
    <div className="window-drag-region flex shrink-0 select-none items-start justify-between gap-4 px-10 pb-3 pt-8 max-[700px]:px-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('kanban.title')}</h1>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--color-text-secondary)]">
          <span className="truncate">{projectName(project)}</span>
        </p>
      </div>
      {aside}
    </div>
  )
}

function CreateBoard({ project }: { project: string }) {
  const t = useTranslation()
  const createBoard = useKanbanStore((state) => state.createBoard)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await createBoard(project)
    } catch (error) {
      toast.error(kanbanErrorMessage(t, error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="kanban-create-board" className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader project={project} />
      <Empty className="flex-none py-16">
        <EmptyHeader>
          <EmptyTitle>{t('kanban.empty.title')}</EmptyTitle>
          <EmptyDescription>{t('kanban.empty.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="w-full max-w-sm">
          <Button onClick={() => void submit()} loading={busy}>{t('kanban.empty.create')}</Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

function BoardPage({ tabId, project, board }: { tabId: string; project: string; board: string }) {
  const t = useTranslation()
  const view = useKanbanStore((state) => state.views[board])
  const loadError = useKanbanStore((state) => state.loadErrors[board])
  const refresh = useKanbanStore((state) => state.refresh)
  useVisiblePolling(useCallback(() => refresh(board), [board, refresh]), KANBAN_POLLING)
  const mobile = useMobileViewport() && !isDesktopRuntime()
  const { showPanel, panelExpanded } = useWorkspaceSplitState(tabId, true)
  const activePanelTab = useWorkspacePanelStore((state) => {
    const panel = state.panelByTab[tabId]
    return panel?.tabs.find((tab) => tab.id === panel.activeTabId) ?? null
  })
  const selectedCard = showPanel && activePanelTab?.kind === 'task' && activePanelTab.board === board ? activePanelTab.card : null
  const inboxCount = useInboxCount(board)
  const run = useKanbanCommand(board)
  const { move, dialog } = useMoveCard(board)
  const [mode, setMode] = useState<Mode>('board')
  const [query, setQuery] = useState('')
  const [ownerFilter, setOwnerFilter] = useState(ALL)
  const [includeClosed, setIncludeClosed] = useState(false)
  const [creating, setCreating] = useState<CreateDefaults | null>(null)

  const owners = useMemo(() => view ? Object.entries(view.sessions).filter(([id]) => view.cards.some((card) => card.owner === id)) : [], [view])
  const owner = ownerFilter === ALL || ownerFilter === UNASSIGNED || owners.some(([id]) => id === ownerFilter) ? ownerFilter : ALL
  const cards = useMemo(() => (view?.cards ?? []).filter((card) =>
    (includeClosed || (!card.archived && card.status !== 'cancelled'))
    && matchesQuery([`#${card.id}`, card.title, card.description], query)
    && (owner === ALL || (owner === UNASSIGNED ? card.owner === null : card.owner === owner))), [includeClosed, owner, query, view])

  const open = useCallback((card: CardView) => useWorkspacePanelStore.getState().openTab(tabId, { kind: 'task', board, card: card.id }), [tabId, board])
  const archive = useCallback((card: CardView) => void run({ type: card.archived ? 'unarchive' : 'archive', card: card.id }), [run])

  if (!view) {
    return loadError
      ? <p role="alert" className="p-10 text-[13px] text-[var(--color-error)]">{loadError}</p>
      : <div className="flex flex-1 items-center justify-center"><Spinner /></div>
  }

  return (
    <div data-testid="kanban-page" className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      <WorkspaceSplit
        showPanel={showPanel}
        panelExpanded={panelExpanded}
        testId="kanban-content-row"
        panel={{ panelId: tabId, sessionTitle: t('kanban.title'), tasksOnly: true }}
      >
        <div hidden={panelExpanded} className="flex min-w-0 flex-1 flex-col">
          <PageHeader
            project={project}
            aside={!mobile && (
              <SegmentedControl
                value={mode}
                onChange={setMode}
                label={t('kanban.view.label')}
                options={[{ value: 'board', label: t('kanban.view.board') }, { value: 'tree', label: t('kanban.view.tree') }]}
              />
            )}
          />
          {loadError && (
            <p role="alert" className="mx-10 mb-3 rounded-lg bg-[var(--color-error-container)] px-3 py-2 text-[12px] text-[var(--color-error)] max-[700px]:mx-4">
              {t('kanban.error.refreshFailed', { message: loadError })}
            </p>
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-10 pb-3 max-[700px]:px-4">
            <SearchField value={query} onChange={setQuery} placeholder={t('kanban.search')} aria-label={t('kanban.search')} className="w-60 max-[700px]:w-full" />
            {!mobile && (
              <>
                <div className="w-44">
                  <FormSelect
                    label={t('kanban.filter.owner')}
                    value={owner}
                    onChange={setOwnerFilter}
                    options={[
                      { value: ALL, label: t('kanban.filter.allOwners') },
                      { value: UNASSIGNED, label: t('kanban.owner.none') },
                      ...owners.map(([id, info]) => ({ value: id, label: info.title || t('session.untitled') })),
                    ]}
                  />
                </div>
                <div className="w-44">
                  <FormSelect
                    label={t('kanban.filter.scope')}
                    value={includeClosed ? 'all' : 'open'}
                    onChange={(value) => setIncludeClosed(value === 'all')}
                    options={[{ value: 'open', label: t('kanban.filter.open') }, { value: 'all', label: t('kanban.filter.withClosed') }]}
                  />
                </div>
              </>
            )}
            <span className="flex-1" />
            <Button variant="ghost" className="whitespace-nowrap" onClick={() => useWorkspacePanelStore.getState().openTab(tabId, { kind: 'inbox', board })}>
              {t('kanban.inbox.button', { count: inboxCount })}
            </Button>
            <Button className="whitespace-nowrap" onClick={() => setCreating({ status: 'backlog', parent: null })}>
              <Plus aria-hidden="true" />{t('kanban.create.button')}
            </Button>
          </div>
          {mobile ? (
            <MobileTaskList view={view} cards={cards} onOpen={open} />
          ) : mode === 'board' ? (
            <div className="flex min-h-0 flex-1 border-t border-[var(--color-border)]">
              <BoardColumns
                view={view}
                cards={cards}
                compact={showPanel}
                showCancelled={includeClosed}
                selectedCard={selectedCard}
                draggable
                onOpen={open}
                onMove={move}
                onArchive={archive}
                onCreate={(status) => setCreating({ status, parent: null })}
              />
            </div>
          ) : (
            <TaskTree view={view} cards={cards} selectedCard={selectedCard} onOpen={open} />
          )}
        </div>
      </WorkspaceSplit>
      {dialog}
      {creating && <CreateTaskDialog board={board} view={view} defaults={creating} onClose={() => setCreating(null)} onCreated={open} />}
    </div>
  )
}

function MobileTaskList({ view, cards, onOpen }: { view: BoardView; cards: CardView[]; onOpen: (card: CardView) => void }) {
  const t = useTranslation()
  const [closed, setClosed] = useState<ReadonlySet<CardStatus>>(new Set(['done', 'cancelled']))
  return (
    <div data-testid="kanban-mobile-list" className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--color-border)]">
      {ALL_STATUSES.map((status) => {
        const group = cards.filter((card) => card.status === status)
        if (group.length === 0) return null
        const isOpen = !closed.has(status)
        return (
          <Collapsible key={status} open={isOpen} onOpenChange={(next) => setClosed((current) => {
            const updated = new Set(current)
            if (next) updated.delete(status)
            else updated.add(status)
            return updated
          })}>
            <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2 px-4 text-[13px] font-medium">
              {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              <StatusIcon status={status} />
              {t(STATUS_LABEL[status])}
              <span className="text-[var(--color-text-tertiary)]">{group.length}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul>
                {group.map((card) => (
                  <li key={card.id}>
                    <button type="button" onClick={() => onOpen(card)} className="flex min-h-11 w-full min-w-0 flex-col gap-0.5 border-b border-[var(--color-border-separator)] px-4 py-2 text-left">
                      <span className="flex w-full min-w-0 items-center gap-2 text-[14px]">
                        <span className="min-w-0 flex-1 truncate">{card.title}</span>
                        <RunMarker view={view} card={card} />
                      </span>
                      <span className="flex w-full min-w-0 gap-2 text-[12px] text-[var(--color-text-tertiary)]">
                        <span className="font-mono">#{card.id}</span>
                        {card.status === 'blocked' ? <span className="truncate">{cardNote(t, card)}</span> : <AssigneeName view={view} card={card} />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )
}
