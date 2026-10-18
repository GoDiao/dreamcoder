import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export type SettingsSelectOption<T extends string> = {
  value: T
  label: string
  description?: string
}

type SettingsSelectProps<T extends string> = {
  value: T
  options: SettingsSelectOption<T>[]
  onChange: (value: T) => void
  /** Accessible name of the trigger button. */
  label: string
  disabled?: boolean
  className?: string
  menuWidth?: number
}

/** Borderless dropdown for a settings row: an in-page menu with a check on the current option. */
export function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  className = '',
  menuWidth = 240,
}: SettingsSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()
  const selected = options.find((option) => option.value === value) ?? options[0]

  const close = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close(true)
      }
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const index = Math.max(0, options.findIndex((option) => option.value === value))
    itemRefs.current[index]?.focus()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => !!item)
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home' ? 0
        : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowDown' ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div ref={rootRef} className={`relative inline-flex max-w-[240px] ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={`flex h-8 min-w-[85px] max-w-full items-center justify-end gap-2.5 rounded-[6px] py-1.5 pl-2 pr-1.5 text-right text-[13px] text-[var(--color-text-primary)] transition-colors duration-150 hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? 'bg-[var(--color-surface-hover)]' : ''
        }`}
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <ChevronDown aria-hidden="true" size={13} strokeWidth={1.8} className="flex-shrink-0 text-[var(--color-text-secondary)]" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={moveFocus}
          className="motion-menu absolute right-0 top-full z-50 mt-1 max-h-[280px] overflow-y-auto overscroll-contain rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]"
          data-state="open"
          style={{ width: menuWidth }}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                ref={(node) => { itemRefs.current[index] = node }}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  onChange(option.value)
                  close(true)
                }}
                className="flex min-h-[34px] w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)] focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.description && (
                    <span className="mt-px block text-xs leading-[1.5] text-[var(--color-text-tertiary)]">{option.description}</span>
                  )}
                </span>
                <Check
                  aria-hidden="true"
                  size={14}
                  strokeWidth={2}
                  className={`flex-shrink-0 text-[var(--color-brand)] ${isSelected ? '' : 'invisible'}`}
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
