import { useId, type ReactNode } from 'react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select'

type Props<T extends string> = {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
  id?: string
  description?: ReactNode
}

export function FormSelect<T extends string>({ value, options, onChange, label, id, description }: Props<T>) {
  const generatedId = useId()
  const descriptionId = `${id ?? generatedId}-description`
  return (
    <>
      <Select value={`option:${value}`} onValueChange={(next) => {
        const option = options.find((candidate) => `option:${candidate.value}` === next)
        if (option) onChange(option.value)
      }}>
        <SelectTrigger id={id} aria-label={id ? undefined : label} aria-describedby={description ? descriptionId : undefined} className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start" collisionPadding={8}>
          <SelectGroup>
            {options.map((option) => <SelectItem key={option.value} value={`option:${option.value}`}>{option.label}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      {description && <p id={descriptionId} className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{description}</p>}
    </>
  )
}
