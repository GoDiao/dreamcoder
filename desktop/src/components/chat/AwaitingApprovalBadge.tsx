import { useTranslation } from '../../i18n'

export function AwaitingApprovalBadge() {
  const t = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-3xs font-bold uppercase tracking-wider text-warning">
      <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-warning" />
      {t('permission.awaitingApproval')}
    </span>
  )
}
