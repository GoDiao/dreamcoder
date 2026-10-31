import { useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '../../i18n'
import { handleActivateRequest, handleOpenTabRequest } from '../../lib/browserControlRequests'
import { startBrowserMarkSync } from '../../lib/browserMarks'
import { handleBrowserPickDone, handleBrowserPickStarted, handleBrowserPickState } from '../../lib/browserPicks'
import {
  addBrowserSelectionToChat,
  replayBrowserShortcut,
  setBrowserGuestLayer,
  showBlockedNavigation,
} from '../../lib/browserGuests'
import {
  onBrowserActivateRequest,
  onBrowserBlocked,
  onBrowserExternalRequest,
  onBrowserOpenTabRequest,
  onBrowserPickDone,
  onBrowserPickStarted,
  onBrowserPickState,
  onBrowserSelection,
  onBrowserShortcut,
  openBrowserExternalProtocol,
  setBrowserMenuLabels,
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

  const addToChatLabel = t('workspace.addToChat')
  const copyLabel = t('common.copy')
  useEffect(() => {
    setBrowserMenuLabels({ addToChat: addToChatLabel, copy: copyLabel }).catch((error: unknown) => {
      console.warn('[browser] setting the page menu labels failed', error)
    })
  }, [addToChatLabel, copyLabel])

  useEffect(() => subscribe([
    onBrowserBlocked(showBlockedNavigation),
    onBrowserSelection(addBrowserSelectionToChat),
    onBrowserPickState(handleBrowserPickState),
    onBrowserPickStarted(handleBrowserPickStarted),
    onBrowserPickDone(handleBrowserPickDone),
    onBrowserShortcut(replayBrowserShortcut),
    onBrowserOpenTabRequest(handleOpenTabRequest),
    onBrowserActivateRequest(handleActivateRequest),
    onBrowserExternalRequest(({ url }) => {
      if (!useBrowserStore.getState().externalRequestUrl) setExternalRequestUrl(url)
    }),
  ]), [setExternalRequestUrl])

  useEffect(() => startBrowserMarkSync(), [])

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
