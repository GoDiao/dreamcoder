import type { CardStatus } from '@protocol'

const COLOR: Record<CardStatus, string> = {
  backlog: 'var(--subtle-foreground)',
  todo: 'var(--muted-foreground)',
  in_progress: 'var(--warning)',
  blocked: 'var(--destructive)',
  review: 'var(--info)',
  done: 'var(--success)',
  cancelled: 'var(--subtle-foreground)',
}

export function StatusIcon({ status, size = 14, label }: { status: CardStatus; size?: number; label?: string }) {
  const color = COLOR[status]
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="shrink-0" data-status={status} {...a11y}>
      {status === 'backlog' && <circle cx="8" cy="8" r="6" stroke={color} strokeWidth="1.6" strokeDasharray="2.4 2.2" />}
      {status === 'todo' && <circle cx="8" cy="8" r="6" stroke={color} strokeWidth="1.6" />}
      {status === 'in_progress' && (
        <>
          <circle cx="8" cy="8" r="6" stroke={color} strokeWidth="1.6" />
          <path d="M8 4a4 4 0 0 1 0 8Z" fill={color} />
        </>
      )}
      {status === 'review' && (
        <>
          <circle cx="8" cy="8" r="6" stroke={color} strokeWidth="1.6" />
          <path d="M8 4a4 4 0 1 1-4 4h4Z" fill={color} />
        </>
      )}
      {status === 'blocked' && (
        <>
          <circle cx="8" cy="8" r="6" stroke={color} strokeWidth="1.6" />
          <path d="M8 5v3.5M8 10.8v.2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
      {status === 'done' && (
        <>
          <circle cx="8" cy="8" r="6.8" fill={color} />
          <path d="m5.2 8.2 1.9 1.9 3.7-3.9" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === 'cancelled' && (
        <>
          <circle cx="8" cy="8" r="6" stroke={color} strokeWidth="1.6" />
          <path d="m5.8 5.8 4.4 4.4m0-4.4-4.4 4.4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
