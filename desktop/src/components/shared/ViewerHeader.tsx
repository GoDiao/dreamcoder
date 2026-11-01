import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTitleRow } from '../../hooks/useTitleRow'
import { useTranslation } from '../../i18n'
import { Button } from './ui/button'

export function ViewerHeader({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  const t = useTranslation()
  const titleRow = useTitleRow()
  return (
    <div
      data-testid="viewer-header"
      style={titleRow.style(true)}
      className={`window-drag-region flex shrink-0 select-none items-center gap-2 border-b border-[var(--color-border)] px-4 ${titleRow.className}`}
    >
      <Button variant="ghost" size="sm" onClick={onBack} aria-label={t('artifactsPage.back')}>
        <ArrowLeft aria-hidden="true" />
        {t('artifactsPage.back')}
      </Button>
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text-primary)]">{title}</h2>
      {children}
    </div>
  )
}
