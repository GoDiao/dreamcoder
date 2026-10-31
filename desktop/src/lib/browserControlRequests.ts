import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'
import { isBrowserGuestShown, openBrowserUrl } from './browserGuests'
import {
  finishBrowserActivate,
  finishBrowserOpenTab,
  type BrowserActivateRequest,
  type BrowserOpenTabRequest,
} from './shell'

const SHOWN_POLL_INTERVAL_MS = 50
const SHOWN_POLL_TIMEOUT_MS = 1000

function isKnownSession(sessionId: string) {
  return useSessionStore.getState().sessions.some((session) => session.id === sessionId)
    || useTabStore.getState().tabs.some((tab) => tab.sessionId === sessionId)
}

function findTabOwner(tabId: string) {
  const entries = Object.entries(useWorkspacePanelStore.getState().panelBySession)
  return entries.find(([, panel]) => panel?.tabs.some((tab) => tab.id === tabId))?.[0] ?? null
}

async function waitUntilShown(tabId: string) {
  const deadline = Date.now() + SHOWN_POLL_TIMEOUT_MS
  while (!isBrowserGuestShown(tabId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SHOWN_POLL_INTERVAL_MS))
  }
  return isBrowserGuestShown(tabId)
}

export async function handleOpenTabRequest({ requestId, sessionId, url }: BrowserOpenTabRequest) {
  if (!isKnownSession(sessionId)) {
    console.warn('[browser] open-tab request for an unknown session', sessionId)
    return
  }
  try {
    const tabId = useWorkspacePanelStore.getState().openTab(sessionId, { kind: 'browser', url: url ?? '' })
    if (url) openBrowserUrl(sessionId, tabId, url)
    await finishBrowserOpenTab({ requestId, tabId })
  } catch (error) {
    console.warn('[browser] open-tab request failed', sessionId, error)
  }
}

export async function handleActivateRequest({ requestId, tabId }: BrowserActivateRequest) {
  try {
    const sessionId = findTabOwner(tabId)
    let shown = false
    if (sessionId) {
      const panel = useWorkspacePanelStore.getState()
      panel.activateTab(sessionId, tabId)
      if (!panel.isPanelOpen(sessionId)) panel.togglePanel(sessionId)
      shown = await waitUntilShown(tabId)
    } else {
      console.warn('[browser] activate request for an unknown tab', tabId)
    }
    await finishBrowserActivate({ requestId, shown })
  } catch (error) {
    console.warn('[browser] activate request failed', tabId, error)
  }
}
