import { MousePointerClick } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '../../i18n'
import { stopBrowserControl } from '../../lib/shell'
import { useBrowserActivityTabId } from '../../stores/chatStore'
import { Button } from '../shared/ui/button'

export function BrowserActivityBar({ sessionId, tabId }: { sessionId: string; tabId: string }) {
  const t = useTranslation()
  const operatedTabId = useBrowserActivityTabId(sessionId)
  const [stopping, setStopping] = useState(false)

  if (operatedTabId !== tabId) return null

  const stop = async () => {
    setStopping(true)
    try {
      await stopBrowserControl({ sessionId })
    } catch (error) {
      toast.error(t('browserActivity.stopFailed', { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setStopping(false)
    }
  }

  return (
    <div
      role="status"
      data-testid="browser-activity"
      className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-info-container)] px-3 py-1.5 text-ui-aux text-[var(--color-text-primary)]"
    >
      <MousePointerClick className="size-3.5 shrink-0 text-[var(--color-info)]" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{t('browserActivity.operating')}</span>
      <Button type="button" variant="outline" size="xs" loading={stopping} onClick={stop}>
        {t(stopping ? 'browserActivity.stopping' : 'browserActivity.stop')}
      </Button>
    </div>
  )
}
