import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

type SegmentedControlProps<T extends string> = {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
  disabled?: boolean
  className?: string
}

export function SegmentedControl<T extends string>({ value, options, onChange, label, disabled, className }: SegmentedControlProps<T>) {
  return (
    <ToggleGroup type="single" value={value} onValueChange={(next) => {
      const option = options.find((candidate) => candidate.value === next)
      if (option) onChange(option.value)
    }} aria-label={label} disabled={disabled} className={className} spacing={1} size="sm">
      {options.map((option) => <ToggleGroupItem key={option.value} value={option.value} onFocus={() => { if (!disabled && value !== option.value) onChange(option.value) }}>{option.label}</ToggleGroupItem>)}
    </ToggleGroup>
  )
}
