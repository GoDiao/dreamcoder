import { useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '../../i18n'
import { replayBrowserShortcut, setBrowserGuestLayer, showBlockedNavigation } from '../../lib/browserGuests'
import {
  onBrowserBlocked,
  onBrowserExternalRequest,
  onBrowserShortcut,
  openBrowserExternalProtocol,
  type Unlisten,
} from '../../lib/shell'
import { useBrowserStore } from '../../stores/browserStore'
import { ConfirmDialog } from '../shared/ConfirmDialog'

function subscribe(listeners: Promise<Unlisten>[]) {
  const settled = Promise.all(listeners)
  return () => {
    void settled.then((unlisteners) => unlisteners.forEach((unlisten) => unlisten()))
  }
}

export function BrowserGuestLayer() {
  const t = useTranslation()
  const externalUrl = useBrowserStore((state) => state.externalRequestUrl)
  const setExternalRequestUrl = useBrowserStore((state) => state.setExternalRequestUrl)

  useEffect(() => subscribe([
    onBrowserBlocked(showBlockedNavigation),
    onBrowserShortcut(replayBrowserShortcut),
    onBrowserExternalRequest(({ url }) => {
      if (!useBrowserStore.getState().externalRequestUrl) setExternalRequestUrl(url)
    }),
  ]), [setExternalRequestUrl])

  const openExternal = async () => {
    const url = externalUrl
    setExternalRequestUrl(null)
    if (!url) return
    try {
      await openBrowserExternalProtocol(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <>
      <div
        ref={setBrowserGuestLayer}
        data-testid="browser-guest-layer"
        className="pointer-events-none absolute inset-0 z-20"
      />
      <ConfirmDialog
        open={externalUrl !== null}
        onClose={() => setExternalRequestUrl(null)}
        onConfirm={openExternal}
        title={t('browser.externalTitle')}
        body={
          <>
            <p>{t('browser.externalBody')}</p>
            <p className="mt-2 break-all font-mono text-ui-aux">{externalUrl}</p>
          </>
        }
        confirmLabel={t('browser.externalConfirm')}
        cancelLabel={t('common.cancel')}
        confirmVariant="default"
      />
    </>
  )
}
