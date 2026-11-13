import type { ReactNode } from 'react'

type SettingsPageHeaderProps = {
  title: ReactNode
  description?: ReactNode
  /** Buttons on the right, e.g. refresh or add. */
  actions?: ReactNode
  className?: string
  /** id for the title, so a page region can be labelled by it. */
  titleId?: string
}

/** Small, consistent title block at the top of a settings page. */
export function SettingsPageHeader({ title, description, actions, className = '', titleId }: SettingsPageHeaderProps) {
  return (
    <div className={`mb-6 flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h2 id={titleId} className="mb-1.5 text-xl font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="max-w-[60ch] text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}
