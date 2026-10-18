import { moveRovingFocus } from '../../lib/rovingFocus'

type SegmentedOption<T extends string> = {
  value: T
  label: string
}

type SegmentedControlProps<T extends string> = {
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  label: string
  disabled?: boolean
  className?: string
}

/** A row of mutually exclusive options on one light background. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  className = '',
}: SegmentedControlProps<T>) {
  const hasSelection = options.some((option) => option.value === value)
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (disabled) return
        const target = moveRovingFocus(event, '[role="radio"]')
        const next = options.find((option) => option.value === target?.dataset.value)
        if (next && next.value !== value) onChange(next.value)
      }}
      className={`inline-flex items-center gap-0.5 rounded-[8px] bg-[var(--color-surface-container-high)] p-0.5 ${className}`}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        const tabbable = hasSelection ? selected : index === 0
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={tabbable ? 0 : -1}
            data-value={option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`h-7 rounded-[6px] px-2.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50 ${
              selected
                ? 'bg-[var(--color-surface-container-lowest)] text-[var(--color-text-primary)] shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
