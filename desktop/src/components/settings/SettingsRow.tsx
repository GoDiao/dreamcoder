import type { ReactNode } from 'react'

type SettingsRowProps = {
  title: ReactNode
  description?: ReactNode
  /** Control shown on the right (dropdown, switch, segmented control...). */
  control?: ReactNode
  /** Extra content shown under the row, e.g. an expanded form. */
  children?: ReactNode
  className?: string
}

/** Name and description on the left, control on the right. */
export function SettingsRow({ title, description, control, children, className = '' }: SettingsRowProps) {
  return (
    <div className={`border-b border-[var(--color-border-separator)] last:border-b-0 ${className}`}>
      <div className="flex min-h-[44px] flex-wrap items-center gap-x-6 gap-y-2 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-[var(--color-text-primary)]">{title}</div>
          {description ? (
            <div className="mt-px text-xs leading-[1.5] text-[var(--color-text-tertiary)]">{description}</div>
          ) : null}
        </div>
        {control ? <div className="flex flex-shrink-0 items-center gap-2">{control}</div> : null}
      </div>
      {children ? <div className="pb-3.5">{children}</div> : null}
    </div>
  )
}

type SettingsGroupProps = {
  title: ReactNode
  children: ReactNode
  className?: string
}

/** A titled group of settings rows. */
export function SettingsGroup({ title, children, className = '' }: SettingsGroupProps) {
  return (
    <section className={`mb-7 last:mb-0 ${className}`}>
      <h3 className="mb-1 text-[13px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
      <div>{children}</div>
    </section>
  )
}
