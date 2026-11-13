import { useId, useMemo, useState, type ReactElement } from 'react'
import { Check, ChevronRight, Plus } from 'lucide-react'
import type { BoardView, CardView } from '@protocol'
import { useTranslation, type TranslationKey } from '../../i18n'
import { ResponsivePopover } from '../shared/ResponsivePopover'
import { Button } from '../shared/ui/button'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '../shared/ui/command'
import { Input } from '../shared/ui/input'
import { Spinner } from '../shared/ui/spinner'
import { RunningSpinner } from './RunMarker'
import { Switch } from '../shared/ui/switch'
import { Textarea } from '../shared/ui/textarea'
import { useKanbanCommand } from './useKanbanCommand'
import { useProjectSessions } from './useProjectSessions'

export type PickerSlot = 'owner' | 'reviewer'

type Props = {
  board: string
  view: BoardView
  card: CardView
  slot: PickerSlot
  trigger: ReactElement
}

type Choice = { sessionId: string } | { newSession: true }

function blockedReason(card: CardView, slot: PickerSlot, sessionId: string): TranslationKey | null {
  if (slot === 'owner') return card.reviewer === sessionId ? 'kanban.assign.isReviewer' : null
  return card.owner === sessionId ? 'kanban.assign.isOwner' : null
}

export function AssigneePicker({ board, view, card, slot, trigger }: Props) {
  const t = useTranslation()
  const run = useKanbanCommand(board)
  const worktreeId = useId()
  const instructionsId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const current = card[slot]
  const [pending, setPending] = useState<Choice | null>(null)
  const [instructions, setInstructions] = useState('')
  const [worktree, setWorktree] = useState(false)
  const [branch, setBranch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sessions = useProjectSessions(view.project)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? sessions.filter((session) => session.title.toLowerCase().includes(needle)) : sessions
  }, [query, sessions])

  const reset = (next: boolean) => {
    setOpen(next)
    if (next) {
      setQuery('')
      setPending(null)
      setInstructions('')
      setError(null)
      setWorktree(false)
      setBranch('')
    }
  }

  const choose = async (choice: Choice) => {
    if ('sessionId' in choice && current === choice.sessionId) {
      setOpen(false)
      return
    }
    setBusy(true)
    setError(null)
    const repository = 'newSession' in choice && (worktree || branch.trim()) ? { worktree, ...(branch.trim() ? { branch: branch.trim() } : {}) } : undefined
    const note = slot === 'reviewer' ? instructions.trim() : ''
    const assigned = await run({ type: 'assign', card: card.id, role: slot, target: choice, ...(note ? { note } : {}), ...(repository ? { repository } : {}) }, setError)
    setBusy(false)
    if (assigned) setOpen(false)
  }

  const select = (choice: Choice) => {
    if ('sessionId' in choice && (slot === 'owner' || current === choice.sessionId)) void choose(choice)
    else setPending(choice)
  }

  const title = t(slot === 'owner' ? 'kanban.assign.ownerTitle' : 'kanban.assign.reviewerTitle')

  return (
    <ResponsivePopover open={open} onOpenChange={reset} title={title} trigger={trigger} contentClassName="w-[300px]" testId="kanban-assignee-picker">
      {pending ? (
        <div className="flex flex-col gap-3 p-2">
          {'newSession' in pending ? (
            <>
              <p className="text-xs text-muted-foreground">{t('kanban.assign.newSessionHint')}</p>
              <label htmlFor={worktreeId} className="flex items-center justify-between gap-3 text-sm">
                {t('kanban.assign.worktree')}
                <Switch id={worktreeId} checked={worktree} onCheckedChange={setWorktree} />
              </label>
              <Input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder={t('kanban.assign.branchPlaceholder')} aria-label={t('kanban.assign.branch')} />
            </>
          ) : (
            <p className="truncate text-sm font-medium">{view.sessions[pending.sessionId]?.title || t('session.untitled')}</p>
          )}
          {slot === 'reviewer' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={instructionsId} className="text-xs text-muted-foreground">{t('kanban.assign.instructions')}</label>
              <Textarea id={instructionsId} value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={5} placeholder={t('kanban.assign.instructionsPlaceholder')} />
            </div>
          )}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>{t('kanban.assign.back')}</Button>
            <Button size="sm" disabled={busy} onClick={() => void choose(pending)}>
              {busy && <Spinner data-icon="inline-start" aria-hidden="true" />}
              {t('newSession' in pending ? 'kanban.assign.start' : 'kanban.assign.confirm')}
            </Button>
          </div>
        </div>
      ) : (
        <Command label={title} shouldFilter={false} loop>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t('kanban.assign.search')} />
          <CommandList aria-label={title} className="max-h-[320px]">
            <CommandGroup heading={t('kanban.assign.newGroup')}>
              <CommandItem value="new-session" onSelect={() => setPending({ newSession: true })}>
                <Plus aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{t('kanban.assign.newSession')}</span>
                  <span className="truncate text-xs text-muted-foreground">{t('kanban.assign.newSessionNote')}</span>
                </span>
                <ChevronRight aria-hidden="true" />
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading={t('kanban.assign.projectSessions')}>
              {filtered.length === 0 && <p role="status" className="px-2 py-3 text-xs text-muted-foreground">{t('kanban.assign.noSessions')}</p>}
              {filtered.map((session) => {
                const reason = blockedReason(card, slot, session.id)
                const running = view.sessions[session.id]?.running ?? false
                return (
                  <CommandItem key={session.id} value={session.id} disabled={reason !== null || busy} onSelect={() => select({ sessionId: session.id })}>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{session.title || t('session.untitled')}</span>
                      {reason && <span className="text-xs text-muted-foreground">{t(reason)}</span>}
                    </span>
                    {running && <RunningSpinner className="size-3.5" role="img" aria-label={t('kanban.marker.running')} />}
                    {current === session.id && <Check aria-label={t('kanban.assign.current')} role="img" />}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
          {error && <p role="alert" className="px-2 pb-2 text-xs text-destructive">{error}</p>}
          <p className="px-2 pb-2 text-2xs text-muted-foreground">{t('kanban.assign.footnote')}</p>
        </Command>
      )}
    </ResponsivePopover>
  )
}
