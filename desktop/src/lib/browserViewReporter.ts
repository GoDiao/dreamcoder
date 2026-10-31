import { useTabStore } from '../stores/tabStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'
import { registerBrowserView, unregisterBrowserView, updateBrowserView, type BrowserViewState } from './shell'

type ViewEntry = {
  sessionId: string
  readShown: () => boolean
  registered: boolean
  sent: BrowserViewState | null
}

const views = new Map<string, ViewEntry>()
let unsubscribers: Array<() => void> = []

function isForeground(sessionId: string) {
  const { activeTabId, tabs } = useTabStore.getState()
  return activeTabId === sessionId && tabs.some((tab) => tab.sessionId === sessionId && tab.type === 'session')
}

function currentState(tabId: string, entry: ViewEntry): BrowserViewState {
  const panel = useWorkspacePanelStore.getState().panelBySession[entry.sessionId]
  return {
    tabId,
    shown: entry.readShown(),
    active: panel?.activeTabId === tabId,
    foreground: isForeground(entry.sessionId),
  }
}

function sameState(a: BrowserViewState | null, b: BrowserViewState) {
  return a !== null && a.shown === b.shown && a.active === b.active && a.foreground === b.foreground
}

function sendIfChanged(tabId: string, entry: ViewEntry) {
  if (!entry.registered) return
  const state = currentState(tabId, entry)
  if (sameState(entry.sent, state)) return
  entry.sent = state
  updateBrowserView(state).catch((error: unknown) => {
    if (views.get(tabId) === entry) entry.sent = null
    console.warn('[browser] failed to report view state', tabId, error)
  })
}

function reportAll() {
  for (const [tabId, entry] of views) sendIfChanged(tabId, entry)
}

function startWatching() {
  if (unsubscribers.length > 0) return
  unsubscribers = [
    useWorkspacePanelStore.subscribe((state, previous) => {
      if (state.panelBySession !== previous.panelBySession) reportAll()
    }),
    useTabStore.subscribe((state, previous) => {
      if (state.activeTabId !== previous.activeTabId || state.tabs !== previous.tabs) reportAll()
    }),
  ]
}

function stopWatching() {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers = []
}

export function registerGuestView(sessionId: string, tabId: string, webContentsId: number, readShown: () => boolean) {
  const entry: ViewEntry = { sessionId, readShown, registered: false, sent: null }
  views.set(tabId, entry)
  startWatching()
  registerBrowserView({ sessionId, tabId, webContentsId }).then(
    () => {
      if (views.get(tabId) !== entry) return
      entry.registered = true
      sendIfChanged(tabId, entry)
    },
    (error: unknown) => {
      if (views.get(tabId) === entry) removeView(tabId)
      console.warn('[browser] failed to register view', tabId, error)
    },
  )
}

function removeView(tabId: string) {
  views.delete(tabId)
  if (views.size === 0) stopWatching()
}

export function unregisterGuestView(tabId: string) {
  if (!views.has(tabId)) return
  removeView(tabId)
  unregisterBrowserView({ tabId }).catch((error: unknown) => {
    console.warn('[browser] failed to unregister view', tabId, error)
  })
}

export function reportViewState(tabId: string) {
  const entry = views.get(tabId)
  if (entry) sendIfChanged(tabId, entry)
}
