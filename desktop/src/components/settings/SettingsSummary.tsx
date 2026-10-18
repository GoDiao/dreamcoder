import type { ReactNode } from 'react'

export type SettingsSummaryItem = {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
}

/** A flat row of key numbers under a settings page title. */
export function SettingsSummary({ items, className = '' }: { items: SettingsSummaryItem[]; className?: string }) {
  return (
    <dl className={`mb-[22px] flex flex-wrap gap-7 border-b border-[var(--color-border-separator)] py-4 ${className}`}>
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="mb-[5px] text-[11px] text-[var(--color-text-secondary)]">{item.label}</dt>
          <dd className="text-[21px] font-medium leading-tight tracking-[-0.4px] text-[var(--color-text-primary)]">{item.value}</dd>
          {item.hint ? <dd className="text-[11px] text-[var(--color-text-secondary)]">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  )
}

/** A titled section inside a settings page, e.g. one source group. */
export function SettingsSection({
  title,
  count,
  children,
  className = '',
}: {
  title: ReactNode
  count?: number
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`mt-[25px] min-w-0 first:mt-0 ${className}`}>
      <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-secondary)]">
        {title}
        {typeof count === 'number' ? (
          <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-[var(--color-surface-hover)] px-1.5 py-px text-[11px] font-normal">
            {count}
          </span>
        ) : null}
      </h3>
      {children}
    </section>
  )
}

/** One list row: name and description on the left, actions on the right. */
export function SettingsListRow({
  title,
  description,
  actions,
  className = '',
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex min-w-0 items-center justify-between gap-[18px] border-b border-[var(--color-border-separator)] py-2.5 text-[13px] ${className}`}
    >
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <div className="font-medium text-[var(--color-text-primary)]">{title}</div>
        {description ? (
          <div className="mt-px text-xs leading-[1.5] text-[var(--color-text-secondary)]">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}
