import { useCallback, useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { CardStatus, CardView, KanbanCommand } from '@protocol'
import { useTranslation, type TranslationKey } from '../../i18n'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Checkbox } from '../shared/ui/checkbox'
import { Textarea } from '../shared/ui/textarea'
import { STATUS_LABEL, cancelImpact, moveIntent } from './board'
import { useKanbanStore } from '../../stores/kanbanStore'
import { useKanbanCommand } from './useKanbanCommand'

type Prompt = {
  title: string
  label: string
  confirmLabel: string
  required: boolean
  destructive?: boolean
  cancel?: { dependents: number[]; children: number[] }
  command: (text: string, choices: CancelChoices) => KanbanCommand
}

type CancelChoices = { dependents: boolean; children: boolean }

function useReasonPrompt(board: string): { ask: (prompt: Prompt) => void; dialog: ReactNode } {
  const t = useTranslation()
  const run = useKanbanCommand(board)
  const fieldId = useId()
  const dependentsId = useId()
  const childrenId = useId()
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<CancelChoices>({ dependents: false, children: false })
  const [busy, setBusy] = useState(false)

  const ask = useCallback((next: Prompt) => {
    setText('')
    setChoices({ dependents: false, children: false })
    setPrompt(next)
  }, [])

  const confirm = async () => {
    if (!prompt) return
    setBusy(true)
    const ok = await run(prompt.command(text.trim(), choices))
    setBusy(false)
    if (ok) setPrompt(null)
  }

  const dialog = (
    <ConfirmDialog
      open={prompt !== null}
      onClose={() => setPrompt(null)}
      onConfirm={confirm}
      title={prompt?.title ?? ''}
      body={(
        <div className="flex flex-col gap-2 pt-1">
          {prompt?.cancel?.dependents.length ? (
            <div className="flex items-start gap-2 rounded-lg bg-[var(--color-warning-container)] px-3 py-2 text-[12px] text-[var(--color-text-primary)]">
              <Checkbox id={dependentsId} checked={choices.dependents} onCheckedChange={(checked) => setChoices((current) => ({ ...current, dependents: checked === true }))} />
              <label htmlFor={dependentsId}>{t('kanban.prompt.cancelDependents', { cards: prompt.cancel.dependents.map((id) => `#${id}`).join(' ') })}</label>
            </div>
          ) : null}
          {prompt?.cancel?.children.length ? (
            <div className="flex items-start gap-2 rounded-lg bg-[var(--color-warning-container)] px-3 py-2 text-[12px] text-[var(--color-text-primary)]">
              <Checkbox id={childrenId} checked={choices.children} onCheckedChange={(checked) => setChoices((current) => ({ ...current, children: checked === true }))} />
              <label htmlFor={childrenId}>{t('kanban.prompt.cancelChildren', { cards: prompt.cancel.children.map((id) => `#${id}`).join(' ') })}</label>
            </div>
          ) : null}
          <label htmlFor={fieldId} className="text-[12px] text-[var(--color-text-secondary)]">{prompt?.label}</label>
          <Textarea id={fieldId} value={text} onChange={(event) => setText(event.target.value)} rows={3} />
        </div>
      )}
      confirmLabel={prompt?.confirmLabel ?? ''}
      cancelLabel={t('common.cancel')}
      confirmVariant={prompt?.destructive ? 'destructive' : 'default'}
      confirmDisabled={prompt?.required === true && text.trim() === ''}
      loading={busy}
    />
  )
  return { ask, dialog }
}

const REPORT_PROMPTS: Record<'submit' | 'accept', { title: TranslationKey; label: TranslationKey; confirm: TranslationKey }> = {
  submit: { title: 'kanban.prompt.submitTitle', label: 'kanban.prompt.submitLabel', confirm: 'kanban.action.submit' },
  accept: { title: 'kanban.prompt.acceptTitle', label: 'kanban.prompt.acceptLabel', confirm: 'kanban.action.accept' },
}

const REASON_PROMPTS: Record<'block' | 'cancel' | 'request_changes' | 'reopen', { title: TranslationKey; label: TranslationKey; confirm: TranslationKey }> = {
  block: { title: 'kanban.prompt.blockTitle', label: 'kanban.prompt.blockLabel', confirm: 'kanban.action.block' },
  cancel: { title: 'kanban.prompt.cancelTitle', label: 'kanban.prompt.optionalReason', confirm: 'kanban.action.cancelTask' },
  request_changes: { title: 'kanban.prompt.requestChangesTitle', label: 'kanban.prompt.requestChangesLabel', confirm: 'kanban.action.requestChanges' },
  reopen: { title: 'kanban.prompt.reopenTitle', label: 'kanban.prompt.optionalReason', confirm: 'kanban.action.reopen' },
}

export function useMoveCard(board: string) {
  const t = useTranslation()
  const run = useKanbanCommand(board)
  const { ask, dialog } = useReasonPrompt(board)

  const move = useCallback((card: CardView, to: CardStatus): void => {
    const intent = moveIntent(card, to)
    if (!intent) {
      toast.error(t('kanban.move.notAllowed', { from: t(STATUS_LABEL[card.status]), to: t(STATUS_LABEL[to]) }))
      return
    }
    if (intent.kind === 'command') {
      void run(intent.command)
      return
    }
    if (intent.kind === 'report') {
      const copy = REPORT_PROMPTS[intent.type]
      ask({
        title: t(copy.title, { card: `#${card.id}` }),
        label: t(copy.label),
        confirmLabel: t(copy.confirm),
        required: true,
        command: (summary) => ({ type: intent.type, card: card.id, summary }),
      })
      return
    }
    const copy = REASON_PROMPTS[intent.type]
    const view = useKanbanStore.getState().views[board]
    const impact = intent.type === 'cancel' && view ? cancelImpact(view, card) : null
    ask({
      cancel: impact ?? undefined,
      title: t(copy.title, { card: `#${card.id}` }),
      label: t(copy.label),
      confirmLabel: t(copy.confirm),
      required: intent.required,
      destructive: intent.type === 'cancel',
      command: (reason, choices) => intent.type === 'cancel'
        ? { type: 'cancel', card: card.id, cancelDependents: choices.dependents, cancelChildren: choices.children, ...(reason ? { reason } : {}) }
        : intent.type === 'reopen'
          ? { type: intent.type, card: card.id, ...(reason ? { reason } : {}) }
        : { type: intent.type, card: card.id, reason },
    })
  }, [ask, board, run, t])

  return { move, dialog }
}
