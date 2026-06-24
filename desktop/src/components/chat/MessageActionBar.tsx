import { GitFork } from 'lucide-react'
import { CopyButton } from '../shared/CopyButton'

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
}

export function MessageActionBar({
  copyText,
  copyLabel,
  branchAction,
  align = 'start',
}: Props) {
  const hasCopy = Boolean(copyText?.trim())

  if (!hasCopy && !branchAction) return null

  return (
    <div
      data-message-actions
      data-align={align}
      className={`flex w-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 ${
        align === 'end' ? 'justify-end' : 'justify-start'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {hasCopy ? (
          <CopyButton
            text={copyText!}
            label={copyLabel}
            displayLabel="Copy"
            displayCopiedLabel="Copied"
            className="inline-flex min-h-7 items-center rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] px-2.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)]/35 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
          />
        ) : null}
        {branchAction ? (
          <button
            type="button"
            onClick={branchAction.onBranch}
            disabled={branchAction.loading}
            aria-label={branchAction.label}
            title={branchAction.label}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)]/35 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35 disabled:cursor-wait disabled:opacity-60"
          >
            <GitFork size={13} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
