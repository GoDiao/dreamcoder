import type { LucideIcon } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '../shared/ui/empty'
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
  const toneClass = tone === 'error' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-tertiary)]'

  if (compact) {
    return (
      <Empty role={tone === 'error' ? 'alert' : 'status'} className={`flex-row justify-start gap-2 rounded-none p-0 px-4 py-2 text-left text-[11px] ${toneClass}`}>
        <Icon className="shrink-0" aria-hidden="true" size={16} />
        <EmptyDescription className={`min-w-0 text-[11px] leading-relaxed ${toneClass}`}>{message}</EmptyDescription>
      </Empty>
    )
  }

  return (
    <Empty role={tone === 'error' ? 'alert' : 'status'} className="gap-2 px-4 py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon" className={toneClass}><Icon aria-hidden="true" /></EmptyMedia>
        <EmptyDescription className={`text-xs ${toneClass}`}>{message}</EmptyDescription>
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
