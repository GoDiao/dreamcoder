import { useEffect, useState, type MouseEvent } from 'react'
import { Check, Copy, Split } from 'lucide-react'
import { copyTextToClipboard } from './clipboard'

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
  'inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--color-text-tertiary)] hover:border-[var(--color-border)]/70 hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35 disabled:cursor-wait disabled:opacity-60'

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
        {hasCopy ? <CopyIconButton text={copyText!} label={copyLabel} /> : null}
        {branchAction ? (
          <button
            type="button"
            onClick={(event) => {
              blurAfterClick(event)
              branchAction.onBranch()
            }}
            disabled={branchAction.loading}
            aria-label={branchAction.label}
            title={branchAction.label}
            className={ICON_BUTTON_CLASS}
          >
            <Split size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function CopyIconButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    blurAfterClick(event)
    setCopied(await copyTextToClipboard(text).catch(() => false))
  }

  const currentLabel = copied ? 'Copied' : label
  return (
    <button type="button" onClick={handleCopy} aria-label={currentLabel} title={currentLabel} className={ICON_BUTTON_CLASS}>
      {copied
        ? <Check size={14} strokeWidth={2} aria-hidden="true" />
        : <Copy size={14} strokeWidth={2} aria-hidden="true" />}
    </button>
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
    <time
      dateTime={sent.toISOString()}
      title={sent.toLocaleString()}
      className="mr-1 text-[11px] text-[var(--color-text-tertiary)]"
    >
      {label}
    </time>
  )
}
