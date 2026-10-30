import { lazy, Suspense } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useUIStore } from '../stores/uiStore'
import { useOverlayReturnFocus } from '../hooks/useOverlayReturnFocus'
import { Dialog, DialogContent, DialogTitle } from '../components/shared/ui/dialog'
import { Button } from '../components/shared/ui/button'
import { Spinner } from '../components/shared/ui/spinner'
import { Tooltip } from '../components/shared/Tooltip'

const Settings = lazy(() => import('./Settings').then((module) => ({ default: module.Settings })))

export function SettingsModal() {
  const settingsOpen = useUIStore((state) => state.settingsOpen)
  const closeSettings = useUIStore((state) => state.closeSettings)
  const focus = useOverlayReturnFocus()
  const t = useTranslation()

  return (
    <Dialog open={settingsOpen} onOpenChange={(open) => { if (!open) closeSettings() }}>
      <DialogContent
        {...focus}
        onOpenAutoFocus={(event) => {
          focus.onOpenAutoFocus()
          event.preventDefault()
          if (event.target instanceof HTMLElement) event.target.focus()
        }}
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex h-[min(700px,calc(100dvh-64px))] w-[min(1000px,calc(100vw-64px))] gap-0 overflow-hidden border border-ui-border p-0 sm:max-w-none max-[700px]:h-[calc(100dvh-20px)] max-[700px]:w-[calc(100vw-20px)]"
      >
        <DialogTitle className="sr-only">{t('settings.title')}</DialogTitle>
        <Tooltip content={t('settings.close')}>
          <Button variant="ghost" size="icon" onClick={closeSettings} aria-label={t('settings.close')} className="absolute right-3 top-3 z-10">
            <X size={16} aria-hidden="true" />
          </Button>
        </Tooltip>
        <Suspense fallback={<SettingsLoading />}>
          <Settings />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}

function SettingsLoading() {
  const t = useTranslation()
  return (
    <div role="status" aria-label={t('common.loading')} className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-ui-background text-ui-muted-foreground">
      <Spinner aria-hidden="true" />
    </div>
  )
}
