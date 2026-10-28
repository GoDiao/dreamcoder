import { Tooltip as HintTooltip } from '../shared/Tooltip'
import type { MouseEvent } from 'react'
import { Split } from 'lucide-react'
import { CopyButton } from '../shared/CopyButton'
import { Button } from '../shared/ui/button'

export type MessageBranchAction = {
  label: string
  loading?: boolean
  onBranch: () => void
}

type Props = {
  copyText?: string
  copyLabel: string
  branchAction?: MessageBranchAction
  align?: 'start' | 'end'
  /** When the message was sent, shown before the buttons. */
  timestamp?: number
}

// Icon buttons whose frame shows only while the pointer is on them. Focus never
// draws the frame or keeps the bar visible: a clicked button can keep focus in
// the desktop webview, and the frame would stay after the pointer leaves.
// Keyboard focus gets a ring instead.
//
// No CSS transitions here: in the macOS WKWebView a faded-out bar or button
// can stay painted after the pointer leaves (the DOM already says opacity 0
// and no hover, but the composited layer is not redrawn). Show and hide at once.
const blurAfterClick = (event: MouseEvent<HTMLButtonElement>) => event.currentTarget.blur()

const ICON_BUTTON_CLASS =
  'rounded-md text-[var(--color-text-tertiary)] transition-none hover:border-[var(--color-border)]/70 hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]'

export function MessageActionBar({
  copyText,
  copyLabel,
  branchAction,
  align = 'start',
  timestamp,
}: Props) {
  const hasCopy = Boolean(copyText?.trim())

  if (!hasCopy && !branchAction) return null

  return (
    <div
      data-message-actions
      data-align={align}
      className={`flex w-full opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 ${
        align === 'end' ? 'justify-end' : 'justify-start'
      }`}
    >
      <div className="flex items-center gap-0.5">
        {timestamp ? <MessageTime timestamp={timestamp} /> : null}
        {hasCopy ? <CopyButton text={copyText!} label={copyLabel} iconOnly size="icon-sm" onClick={blurAfterClick} className={ICON_BUTTON_CLASS} /> : null}
        {branchAction ? (
          <HintTooltip content={branchAction.label}><Button variant="ghost" size="icon-sm"
            type="button"
            onClick={(event) => {
              blurAfterClick(event)
              branchAction.onBranch()
            }}
            disabled={branchAction.loading}
            aria-label={branchAction.label}
            className={ICON_BUTTON_CLASS}
          >
            <Split size={14} strokeWidth={2} aria-hidden="true" />
          </Button></HintTooltip>
        ) : null}
      </div>
    </div>
  )
}

// The bar stays mounted and only shows on hover, so a relative time ("just
// now") would go stale; show the clock time, with the date on another day.
function MessageTime({ timestamp }: { timestamp: number }) {
  const sent = new Date(timestamp)
  const sameDay = sent.toDateString() === new Date().toDateString()
  const label = sameDay
    ? sent.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : sent.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <HintTooltip content={sent.toLocaleString()}><time
      dateTime={sent.toISOString()}
      className="mr-1 text-[11px] text-[var(--color-text-tertiary)]"
    >
      {label}
    </time></HintTooltip>
  )
}
