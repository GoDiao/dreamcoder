import { useBrowserStore } from '../stores/browserStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'
import { resolveBrowserInput, type BrowserBlockedEvent, type BrowserShortcutEvent } from './shell'
import { BROWSER_PARTITION } from './shell/electronBridge'

type WebviewElement = HTMLElement & {
  loadURL: (url: string) => Promise<void>
  goBack: () => void
  goForward: () => void
  reload: () => void
  stop: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  getTitle: () => string
  isLoading: () => boolean
  getWebContentsId: () => number
}

type Guest = {
  sessionId: string
  tabId: string
  slot: HTMLDivElement
  webview: WebviewElement
  ready: boolean
  webContentsId: number | null
}

type Placement = {
  stage: HTMLElement
  visible: boolean
  observer: ResizeObserver | null
}

const ERROR_PAGE_PROTOCOL = 'chrome-error:'
const ABORTED_LOAD = -3

const guests = new Map<string, Guest>()
const placements = new Map<string, Placement>()
let layer: HTMLElement | null = null
let layerObserver: ResizeObserver | null = null
let gestureActive = false
let dismissingHostPopups = false
let gestureListenersInstalled = false

export function setBrowserGuestLayer(element: HTMLElement | null) {
  if (element === layer) return
  layerObserver?.disconnect()
  layerObserver = null
  layer = element
  if (!element) return
  installGestureListeners()
  if (typeof ResizeObserver !== 'undefined') {
    layerObserver = new ResizeObserver(applyAllPlacements)
    layerObserver.observe(element)
  }
}

function readyGuest(tabId: string) {
  const guest = guests.get(tabId)
  return guest?.ready ? guest : null
}

function syncPage(guest: Guest) {
  if (!guest.ready) return
  const { webview } = guest
  const url = webview.getURL()
  if (!url.startsWith(ERROR_PAGE_PROTOCOL)) {
    useWorkspacePanelStore.getState().patchTab(guest.sessionId, guest.tabId, { url, title: webview.getTitle() })
  }
  useBrowserStore.getState().patchPage(guest.tabId, {
    loading: webview.isLoading(),
    canGoBack: webview.canGoBack(),
    canGoForward: webview.canGoForward(),
  })
}

function dismissHostPopups() {
  dismissingHostPopups = true
  try {
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  } finally {
    dismissingHostPopups = false
  }
}

function createGuest(sessionId: string, tabId: string, url: string) {
  const slot = document.createElement('div')
  slot.dataset.browserSlot = tabId
  Object.assign(slot.style, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    width: '0px',
    height: '0px',
    overflow: 'hidden',
    visibility: 'hidden',
    pointerEvents: 'none',
  })
  const webview = document.createElement('webview') as WebviewElement
  webview.setAttribute('partition', BROWSER_PARTITION)
  webview.setAttribute('allowpopups', '')
  webview.setAttribute('src', url)
  Object.assign(webview.style, { display: 'flex', width: '100%', height: '100%', border: '0' })
  slot.appendChild(webview)

  const guest: Guest = { sessionId, tabId, slot, webview, ready: false, webContentsId: null }
  const store = useBrowserStore.getState()
  webview.addEventListener('dom-ready', () => {
    if (guest.ready) return
    guest.ready = true
    guest.webContentsId = webview.getWebContentsId()
    syncPage(guest)
  })
  webview.addEventListener('did-start-loading', () => store.patchPage(tabId, { loading: true }))
  webview.addEventListener('did-stop-loading', () => syncPage(guest))
  webview.addEventListener('page-title-updated', () => syncPage(guest))
  webview.addEventListener('did-navigate-in-page', () => syncPage(guest))
  webview.addEventListener('did-navigate', (event) => {
    const { url: navigatedUrl } = event as Event & { url: string }
    if (navigatedUrl.startsWith(ERROR_PAGE_PROTOCOL)) return
    store.setNotice(tabId, null)
    useWorkspacePanelStore.getState().patchTab(sessionId, tabId, { url: navigatedUrl })
    syncPage(guest)
  })
  webview.addEventListener('did-fail-load', (event) => {
    const failure = event as Event & { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean }
    if (!failure.isMainFrame || failure.errorCode === ABORTED_LOAD) return
    store.setNotice(tabId, { kind: 'loadFailed', url: failure.validatedURL, description: failure.errorDescription })
    store.patchPage(tabId, { loading: false })
  })
  webview.addEventListener('focus', dismissHostPopups)
  guests.set(tabId, guest)
  return guest
}

export function hasBrowserGuest(tabId: string) {
  return guests.get(tabId)?.slot.isConnected ?? false
}

export function openBrowserUrl(sessionId: string, tabId: string, url: string) {
  const existing = guests.get(tabId)
  if (existing?.slot.isConnected) {
    if (existing.ready) {
      existing.webview.loadURL(url).catch((error: unknown) => console.warn('[browser] load failed', url, error))
    } else {
      existing.webview.setAttribute('src', url)
    }
    return
  }
  if (!layer) throw new Error('Browser layer is not mounted')
  if (existing) disposeGuest(existing)
  const guest = createGuest(sessionId, tabId, url)
  layer.appendChild(guest.slot)
  applyPlacement(tabId)
}

export async function submitBrowserInput(sessionId: string, tabId: string, input: string, projectRoot: string | null) {
  const store = useBrowserStore.getState()
  const result = await resolveBrowserInput({ input, projectRoot })
  if (!result.ok) {
    store.setNotice(tabId, { kind: 'refused', reason: result.reason, url: input })
    return
  }
  store.setNotice(tabId, null)
  openBrowserUrl(sessionId, tabId, result.url)
}

export function browserGoBack(tabId: string) {
  readyGuest(tabId)?.webview.goBack()
}

export function browserGoForward(tabId: string) {
  readyGuest(tabId)?.webview.goForward()
}

export function browserReload(tabId: string) {
  readyGuest(tabId)?.webview.reload()
}

export function browserStop(tabId: string) {
  readyGuest(tabId)?.webview.stop()
}

export function reloadAllBrowsers() {
  for (const guest of guests.values()) if (guest.ready) guest.webview.reload()
}

export function placeBrowserGuest(tabId: string, stage: HTMLElement, visible: boolean) {
  placements.get(tabId)?.observer?.disconnect()
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => applyPlacement(tabId))
  if (observer) {
    for (let node: HTMLElement | null = stage; node; node = node.parentElement) observer.observe(node)
  }
  const placement: Placement = { stage, visible, observer }
  placements.set(tabId, placement)
  applyPlacement(tabId)
  return () => {
    if (placements.get(tabId) !== placement) return
    observer?.disconnect()
    placements.delete(tabId)
    applyPlacement(tabId)
  }
}

export function closeBrowser(tabId: string) {
  const guest = guests.get(tabId)
  if (guest) disposeGuest(guest)
  placements.get(tabId)?.observer?.disconnect()
  placements.delete(tabId)
  useBrowserStore.getState().clearTab(tabId)
}

function disposeGuest(guest: Guest) {
  guest.slot.remove()
  if (guests.get(guest.tabId) === guest) guests.delete(guest.tabId)
}

function applyAllPlacements() {
  for (const tabId of guests.keys()) applyPlacement(tabId)
}

function setShown(slot: HTMLElement, shown: boolean) {
  slot.dataset.shown = shown ? 'true' : 'false'
  slot.style.visibility = shown ? 'visible' : 'hidden'
  slot.style.pointerEvents = shown && !gestureActive ? 'auto' : 'none'
}

function applyPlacement(tabId: string) {
  const guest = guests.get(tabId)
  if (!guest) return
  const placement = placements.get(tabId)
  if (!placement || !layer || !placement.stage.isConnected) {
    setShown(guest.slot, false)
    return
  }
  const stage = placement.stage.getBoundingClientRect()
  const origin = layer.getBoundingClientRect()
  Object.assign(guest.slot.style, {
    left: `${Math.round(stage.left - origin.left)}px`,
    top: `${Math.round(stage.top - origin.top)}px`,
    width: `${Math.round(stage.width)}px`,
    height: `${Math.round(stage.height)}px`,
  })
  setShown(guest.slot, placement.visible && stage.width > 0 && stage.height > 0)
}

function setGesture(active: boolean) {
  if (gestureActive === active) return
  gestureActive = active
  for (const guest of guests.values()) setShown(guest.slot, guest.slot.dataset.shown === 'true')
}

function installGestureListeners() {
  if (gestureListenersInstalled) return
  gestureListenersInstalled = true
  document.addEventListener('pointerdown', () => {
    if (!dismissingHostPopups) setGesture(true)
  }, true)
  window.addEventListener('pointerup', () => setGesture(false), true)
  window.addEventListener('pointercancel', () => setGesture(false), true)
  window.addEventListener('blur', () => setGesture(false))
  document.addEventListener('pointermove', (event) => {
    if (gestureActive && event.buttons === 0) setGesture(false)
  }, true)
}

export function showBlockedNavigation(event: BrowserBlockedEvent) {
  for (const guest of guests.values()) {
    if (guest.webContentsId === event.guestId) {
      useBrowserStore.getState().setNotice(guest.tabId, { kind: 'refused', reason: event.reason, url: event.url })
    }
  }
}

export function replayBrowserShortcut(event: BrowserShortcutEvent) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { ...event, bubbles: true, cancelable: true }))
}
