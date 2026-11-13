import type { LucideIcon } from 'lucide-react'
import { Empty, EmptyHeader, EmptyMedia } from '../shared/ui/empty'
import { Skeleton } from '../shared/ui/skeleton'

export function PanelMessage({
  icon: Icon,
  message,
  tone = 'muted',
  compact = false,
}: {
  icon: LucideIcon
  message: string
  tone?: 'muted' | 'error'
  compact?: boolean
}) {
  const toneClass = tone === 'error' ? 'text-destructive' : 'text-subtle-foreground'

  if (compact) {
    return (
      <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 px-4 py-2 text-left text-2xs ${toneClass}`}>
        <Icon className="shrink-0" aria-hidden="true" size={16} />
        <p className="min-w-0 leading-relaxed">{message}</p>
      </div>
    )
  }

  return (
    <Empty role={tone === 'error' ? 'alert' : 'status'}>
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon aria-hidden="true" className={toneClass} /></EmptyMedia>
        <p className={`text-xs ${toneClass}`}>{message}</p>
      </EmptyHeader>
    </Empty>
  )
}

export function PanelLoading({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div role="status" className={`flex flex-col gap-2 px-4 ${compact ? 'py-2' : 'py-4'}`}>
      <span className="sr-only">{label}</span>
      <Skeleton className="h-3 w-40" />
      {!compact && (
        <>
          <Skeleton className="h-3 w-56" />
          <Skeleton className="h-3 w-32" />
        </>
      )}
    </div>
  )
}
