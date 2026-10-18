import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

type SettingsDisclosureRowProps = {
  title: ReactNode
  /** Short current value shown on the right while collapsed. */
  summary?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}

/** A settings row that is collapsed by default and expands to the full form. */
export function SettingsDisclosureRow({ title, summary, children, defaultOpen = false }: SettingsDisclosureRowProps) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <div className="border-b border-[var(--color-border-separator)] last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-[44px] w-full items-center gap-6 rounded-[6px] py-2.5 text-left focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
      >
        <span className="min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)]">{title}</span>
        <span className="flex min-w-0 items-center gap-2.5 text-xs text-[var(--color-text-secondary)]">
          {summary ? <span className="truncate">{summary}</span> : null}
          <ChevronRight
            aria-hidden="true"
            size={14}
            strokeWidth={1.8}
            className={`flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          />
        </span>
      </button>
      {open && (
        <div id={panelId} className="pb-3.5">
          {children}
        </div>
      )}
    </div>
  )
}
