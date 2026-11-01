import { toast } from 'sonner'
import { t } from '../i18n'
import { useBrowserStore } from '../stores/browserStore'
import { useWorkspaceChatContextStore } from '../stores/workspaceChatContextStore'
import { browserReferenceFromPick, browserReferenceName } from './browserReferences'
import {
  setBrowserPickMode,
  type BrowserPickDone,
  type BrowserPickStarted,
  type BrowserPickState,
} from './shell'

function pendingReferenceId(pickId: string) {
  return `browser-pick:${pickId}`
}

export function toggleBrowserPick(tabId: string) {
  const active = useBrowserStore.getState().pickActiveByTab[tabId] === true
  return setBrowserPickMode({ tabId, active: !active }).catch((error: unknown) => {
    console.warn('[browser] could not change pick mode', tabId, error)
    toast.error(t('browser.pickStartFailed'))
  })
}

export function stopBrowserPick(tabId: string) {
  if (useBrowserStore.getState().pickActiveByTab[tabId] !== true) return Promise.resolve()
  return setBrowserPickMode({ tabId, active: false }).catch((error: unknown) => {
    console.warn('[browser] could not leave pick mode', tabId, error)
  })
}

export function handleBrowserPickState({ tabId, active }: BrowserPickState) {
  useBrowserStore.getState().setPickActive(tabId, active)
}

export function handleBrowserPickStarted({ tabId, sessionId, pickId }: BrowserPickStarted) {
  useWorkspaceChatContextStore.getState().addReference(sessionId, {
    id: pendingReferenceId(pickId),
    kind: 'browser',
    path: '',
    name: '',
    browser: { url: '', title: '', tabId, text: '', truncated: false, pendingPickId: pickId },
  })
}

export function handleBrowserPickDone(event: BrowserPickDone) {
  const store = useWorkspaceChatContextStore.getState()
  const id = pendingReferenceId(event.pickId)
  if (!event.ok) {
    store.replaceReference(event.sessionId, id, null)
    if (!event.cancelled) {
      console.warn('[browser] picking an element failed', event.error)
      toast.error(t('browser.pickFailed'))
    }
    return
  }
  const browser = browserReferenceFromPick(event.value, { tabId: event.tabId, generation: event.generation })
  if (!browser) {
    store.replaceReference(event.sessionId, id, null)
    console.warn('[browser] the page described the picked element in a way that cannot be used')
    toast.error(t('browser.pickFailed'))
    return
  }
  store.replaceReference(event.sessionId, id, {
    kind: 'browser',
    path: browser.url,
    name: browserReferenceName(browser),
    browser,
  })
}
