import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../shared/ui/collapsible'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '../shared/ui/button'

type SettingsDisclosureRowProps = {
  title: ReactNode
  summary?: ReactNode
  children: ReactNode
}

export function SettingsDisclosureRow({ title, summary, children }: SettingsDisclosureRowProps) {
  return (
    <Collapsible className="group border-b border-border last:border-b-0">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="row" className="min-h-11">
          <span className="min-w-0 flex-1 text-sm text-foreground">{title}</span>
          <span className="flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground">
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
