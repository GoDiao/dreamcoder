import { useId, useState } from 'react'
import { X } from 'lucide-react'
import type { BoardView, CardView } from '@protocol'
import { useTranslation } from '../../i18n'
import { useKanbanStore } from '../../stores/kanbanStore'
import { FormSelect } from '../shared/FormSelect'
import { LabeledInput } from '../shared/LabeledInput'
import { Modal } from '../shared/Modal'
import { SegmentedControl } from '../shared/SegmentedControl'
import { Button } from '../shared/ui/button'
import { Field, FieldLabel } from '../shared/ui/field'
import { Textarea } from '../shared/ui/textarea'
import { AcceptanceEditor, acceptanceItems } from './AcceptanceEditor'
import { PRIORITY_LABEL } from './board'
import { useKanbanCommand } from './useKanbanCommand'

export type CreateDefaults = { status: 'backlog' | 'todo'; parent: number | null }

const NONE = 'none'

type Props = {
  board: string
  view: BoardView
  defaults: CreateDefaults
  onClose: () => void
  onCreated: (card: CardView) => void
}

export function CreateTaskDialog({ board, view, defaults, onClose, onCreated }: Props) {
  const t = useTranslation()
  const run = useKanbanCommand(board)
  const descriptionId = useId()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [acceptance, setAcceptance] = useState<string[]>([])
  const [priority, setPriority] = useState<CardView['priority']>('normal')
  const [status, setStatus] = useState(defaults.status)
  const [parent, setParent] = useState(defaults.parent === null ? NONE : String(defaults.parent))
  const [dependsOn, setDependsOn] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const candidates = view.cards.filter((card) => !card.archived && card.status !== 'cancelled')
  const cardOption = (card: CardView) => ({ value: String(card.id), label: `#${card.id} ${card.title}` })

  const submit = async () => {
    setBusy(true)
    const result = await run({
      type: 'create_card',
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      acceptance: acceptanceItems(acceptance),
      priority,
      status,
      ...(parent !== NONE ? { parent: Number(parent) } : {}),
      ...(dependsOn.length ? { dependsOn } : {}),
    })
    setBusy(false)
    if (!result) return
    const created = useKanbanStore.getState().views[board]?.cards.find((card) => card.id === result.card)
    onClose()
    if (created) onCreated(created)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('kanban.create.title')}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => void submit()} disabled={!title.trim()} loading={busy}>{t('kanban.create.submit')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <LabeledInput label={t('kanban.create.taskTitle')} required value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        <Field>
          <FieldLabel htmlFor={descriptionId}>{t('kanban.create.description')}</FieldLabel>
          <Textarea id={descriptionId} value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
        </Field>
        <Field>
          <FieldLabel>{t('kanban.create.acceptance')}</FieldLabel>
          <AcceptanceEditor items={acceptance} onChange={setAcceptance} label={t('kanban.create.acceptance')} />
        </Field>
        <div className="flex flex-wrap items-end gap-4">
          <Field className="w-auto">
            <FieldLabel>{t('kanban.create.status')}</FieldLabel>
            <SegmentedControl
              value={status}
              onChange={setStatus}
              label={t('kanban.create.status')}
              options={[{ value: 'backlog', label: t('kanban.status.backlog') }, { value: 'todo', label: t('kanban.status.todo') }]}
            />
          </Field>
          <Field className="min-w-[140px] flex-1">
            <FieldLabel>{t('kanban.create.priority')}</FieldLabel>
            <FormSelect
              label={t('kanban.create.priority')}
              value={priority}
              onChange={setPriority}
              options={(['high', 'normal', 'low'] as const).map((value) => ({ value, label: t(PRIORITY_LABEL[value]) }))}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel>{t('kanban.create.parent')}</FieldLabel>
          <FormSelect label={t('kanban.create.parent')} value={parent} onChange={setParent} options={[{ value: NONE, label: t('kanban.create.noParent') }, ...candidates.map(cardOption)]} />
        </Field>
        <Field>
          <FieldLabel>{t('kanban.create.dependsOn')}</FieldLabel>
          {dependsOn.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {dependsOn.map((id) => (
                <li key={id} className="inline-flex h-6 items-center gap-1 rounded-lg border border-border pl-2 text-xs">
                  #{id} {candidates.find((card) => card.id === id)?.title}
                  <Button variant="ghost" size="icon-xs" aria-label={t('kanban.create.removeDependency', { card: `#${id}` })} onClick={() => setDependsOn((current) => current.filter((candidate) => candidate !== id))}>
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <FormSelect
            label={t('kanban.create.addDependency')}
            value={NONE}
            onChange={(value) => { if (value !== NONE) setDependsOn((current) => [...current, Number(value)]) }}
            options={[{ value: NONE, label: t('kanban.create.addDependency') }, ...candidates.filter((card) => !dependsOn.includes(card.id)).map(cardOption)]}
          />
        </Field>
      </div>
    </Modal>
  )
}
