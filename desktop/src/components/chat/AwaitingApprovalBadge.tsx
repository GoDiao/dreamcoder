import { useTranslation } from '../../i18n'

export function AwaitingApprovalBadge() {
  const t = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-warning)]">
      <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-[var(--color-warning)]" />
      {t('permission.awaitingApproval')}
    </span>
  )
}
