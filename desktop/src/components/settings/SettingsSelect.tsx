import { ChevronDown } from 'lucide-react'
import { Dropdown } from '../shared/Dropdown'
import { Button } from '../shared/ui/button'

export type SettingsSelectOption<T extends string> = {
  value: T
  label: string
  description?: string
}

type SettingsSelectProps<T extends string> = {
  value: T
  options: SettingsSelectOption<T>[]
  onChange: (value: T) => void
  label: string
  disabled?: boolean
  className?: string
  menuWidth?: number
}

export function SettingsSelect<T extends string>({ value, options, onChange, label, disabled, className, menuWidth = 240 }: SettingsSelectProps<T>) {
  const selected = options.find((option) => option.value === value) ?? options[0]
  return (
    <Dropdown
      value={value}
      items={options}
      onChange={onChange}
      width={menuWidth}
      maxHeight={280}
      align="right"
      className={className}
      trigger={
        <Button variant="ghost" disabled={disabled} aria-label={label} className="min-w-[85px] max-w-[240px] justify-end">
          <span className="min-w-0 truncate">{selected?.label}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </Button>
      }
    />
  )
}
