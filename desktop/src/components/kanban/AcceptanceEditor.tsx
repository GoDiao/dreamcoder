import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/ui/button'
import { Textarea } from '../shared/ui/textarea'

type Props = {
  items: string[]
  onChange: (items: string[]) => void
  label: string
  autoFocus?: boolean
}

export function acceptanceItems(items: readonly string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean)
}

export function AcceptanceMarker({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full bg-[var(--color-text-tertiary)] ${className}`} />
}

export function AcceptanceEditor({ items, onChange, label, autoFocus = false }: Props) {
  const t = useTranslation()
  const rows = items.length ? items : ['']
  const inputs = useRef<Array<HTMLTextAreaElement | null>>([])
  const focusRow = useRef<number | null>(autoFocus ? 0 : null)

  useEffect(() => {
    if (focusRow.current === null) return
    inputs.current[focusRow.current]?.focus()
    focusRow.current = null
  })

  const replace = (next: string[], focus: number) => {
    focusRow.current = focus
    onChange(next)
  }

  const add = () => {
    if (rows[rows.length - 1] === '') inputs.current[rows.length - 1]?.focus()
    else replace([...rows, ''], rows.length)
  }

  const remove = (index: number) => replace(rows.filter((_, each) => each !== index), Math.max(0, Math.min(index, rows.length - 2)))

  const handleKeyDown = (index: number) => (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      replace([...rows.slice(0, index + 1), '', ...rows.slice(index + 1)], index + 1)
      return
    }
    if (event.key === 'Backspace' && rows[index] === '' && rows.length > 1) {
      event.preventDefault()
      replace(rows.filter((_, each) => each !== index), Math.max(0, index - 1))
    }
  }

  const handlePaste = (index: number) => (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const lines = event.clipboardData.getData('text').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (lines.length < 2) return
    event.preventDefault()
    const kept = rows[index]!.trim() ? [rows[index]!] : []
    replace([...rows.slice(0, index), ...kept, ...lines, ...rows.slice(index + 1)], index + kept.length + lines.length - 1)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ul aria-label={label} className="flex flex-col gap-1.5">
        {rows.map((item, index) => (
          <li key={index} className="flex items-start gap-2">
            <AcceptanceMarker className="mt-[11px]" />
            <Textarea
              rows={1}
              ref={(element) => { inputs.current[index] = element }}
              value={item}
              aria-label={t('kanban.acceptance.item', { index: index + 1 })}
              placeholder={index === rows.length - 1 ? t('kanban.acceptance.placeholder') : undefined}
              onChange={(event) => onChange(rows.map((row, each) => each === index ? event.target.value : row))}
              onKeyDown={handleKeyDown(index)}
              onPaste={handlePaste(index)}
              className="min-h-7 resize-none py-1 text-[13px] md:text-[13px]"
            />
            <Button
              variant="ghost"
              size="icon-xs"
              className="mt-0.5 shrink-0"
              aria-label={t('kanban.acceptance.remove', { index: index + 1 })}
              disabled={rows.length === 1 && item === ''}
              onClick={() => remove(index)}
            >
              <X aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" className="self-start" onClick={add}>
        <Plus data-icon="inline-start" aria-hidden="true" />
        {t('kanban.acceptance.add')}
      </Button>
    </div>
  )
}
