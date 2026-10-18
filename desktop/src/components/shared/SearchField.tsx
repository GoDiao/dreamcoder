import { Search } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'

type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string
  onChange: (value: string) => void
  /** Class for the outer box; the inner input stays borderless. */
  className?: string
}

/** Search input whose focus highlight sits on the outer box only. */
export function SearchField({ value, onChange, className = '', ...props }: SearchFieldProps) {
  return (
    <label
      className={`flex h-8 items-center gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2.5 transition-[border-color,box-shadow] duration-150 focus-within:border-[var(--color-border-focus)] focus-within:shadow-[var(--shadow-focus-ring)] ${className}`}
    >
      <Search aria-hidden="true" size={14} strokeWidth={1.8} className="flex-shrink-0 text-[var(--color-text-tertiary)]" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus-visible:outline-none"
        {...props}
      />
    </label>
  )
}
