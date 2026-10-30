import { Button } from '../shared/ui/button'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../shared/ui/collapsible'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

type SettingsDisclosureRowProps = {
  title: ReactNode
  summary?: ReactNode
  children: ReactNode
}

export function SettingsDisclosureRow({ title, summary, children }: SettingsDisclosureRowProps) {
  return (
    <Collapsible className="group border-b border-[var(--color-border-separator)] last:border-b-0">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="row" className="min-h-[44px] items-center gap-6 rounded-[6px] py-2.5">
          <span className="min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)]">{title}</span>
          <span className="flex min-w-0 items-center gap-2.5 text-xs text-[var(--color-text-secondary)]">
            {summary ? <span className="truncate">{summary}</span> : null}
            <ChevronRight
              aria-hidden="true"
              size={14}
              strokeWidth={1.8}
              className="flex-shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90"
            />
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3.5">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
