import { useTranslation } from '../../i18n'
import { Button } from '../shared/ui/button'

export function PreviewLimitBar({ shown, total, expanded, onToggle }: {
  shown: number
  total: number
  expanded: boolean
  onToggle: () => void
}) {
  const t = useTranslation()
  return (
    <div className="sticky bottom-0 flex items-center gap-3 border-t border-ui-border bg-ui-background p-2 text-xs">
      <span>{expanded ? t('workspace.previewAllLines', { total }) : t('workspace.previewLineLimit', { count: shown, total })}</span>
      <Button variant="ghost" size="xs" onClick={onToggle}>{t(expanded ? 'workspace.collapsePreview' : 'workspace.showAllLoadedLines')}</Button>
    </div>
  )
}
