import { useBrowserStore } from '../stores/browserStore'
import { useWorkspaceChatContextStore } from '../stores/workspaceChatContextStore'
import { browserReferenceName, normalizeBrowserSelection, type BrowserReferenceData } from './browserReferences'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'
import { registerGuestView, reportViewState, unregisterGuestView } from './browserViewReporter'
import { artifactsApi } from '../api/artifacts'
import { designApi } from '../api/design'
import { GLOBAL_ARTIFACTS_ROOT } from './artifactRoots'
import { resolveBrowserInput, type BrowserBlockedEvent, type BrowserSelectionEvent, type BrowserShortcutEvent } from './shell'
import { BROWSER_PARTITION } from './shell/electronBridge'
import { adoptArtifactTab, artifactFolderOf } from './artifactTabs'
import { canvasBoardTitleCall, parseCanvasMessage, type CanvasAction } from './canvasBridge'
import { DECK_STAGE_RECT_CALL, DECK_TAKE_EDIT_CALL, deckModeCall, isDeckEdit, isDeckRect, parseDeckMessage, slideFile, type DeckEdit, type DeckRect, type DeckRequest } from './deckBridge'
import { SHELL_REFRESH_CALL, shellSchemeCall } from './shellBridge'
import { useUIStore } from '../stores/uiStore'
import { themeColorScheme } from '../theme/colorScheme'

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
  executeJavaScript: (code: string) => Promise<unknown>
  focus: () => void
}

type Guest = {
  sessionId: string | null
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

const PROJECT_URL_PREFIX = 'dreamcoder-project://'
const ERROR_PAGE_PROTOCOL = 'chrome-error:'
const ABORTED_LOAD = -3

const guests = new Map<string, Guest>()
const placements = new Map<string, Placement>()
const canvasHandlers = new Map<string, (message: CanvasAction) => void>()
const deckHandlers = new Map<string, (message: DeckRequest) => void>()
let layer: HTMLElement | null = null
let layerObserver: ResizeObserver | null = null
let gestureActive = false
let dismissingHostPopups = false
let gestureListenersInstalled = false
let themeSyncInstalled = false
let presentationSyncInstalled = false

export function setBrowserGuestLayer(element: HTMLElement | null) {
  if (element === layer) return
  layerObserver?.disconnect()
  layerObserver = null
  layer = element
  if (!element) return
  installGestureListeners()
  installThemeSync()
  installPresentationSync()
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
    if (guest.sessionId) useWorkspacePanelStore.getState().patchTab(guest.sessionId, guest.tabId, { url, title: webview.getTitle() })
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

function createGuest(sessionId: string | null, tabId: string, url: string) {
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
    applyShellScheme(guest)
    if (guest.ready) return
    guest.ready = true
    guest.webContentsId = webview.getWebContentsId()
    store.patchPage(tabId, { ready: true })
    if (sessionId) registerGuestView(sessionId, tabId, guest.webContentsId, () => isBrowserGuestShown(tabId))
    syncPage(guest)
  })
  webview.addEventListener('did-start-loading', () => store.patchPage(tabId, { loading: true }))
  webview.addEventListener('did-stop-loading', () => syncPage(guest))
  webview.addEventListener('page-title-updated', () => syncPage(guest))
  webview.addEventListener('did-navigate-in-page', () => syncPage(guest))
  webview.addEventListener('did-navigate', (event) => {
    const { url: navigatedUrl } = event as Event & { url: string }
    if (sessionId) useWorkspaceChatContextStore.getState().markBrowserElementsStale(sessionId, tabId)
    store.patchPage(tabId, { deck: null })
    if (navigatedUrl.startsWith(ERROR_PAGE_PROTOCOL)) return
    store.setNotice(tabId, null)
    if (sessionId) useWorkspacePanelStore.getState().patchTab(sessionId, tabId, { url: navigatedUrl })
    syncPage(guest)
  })
  webview.addEventListener('did-fail-load', (event) => {
    const failure = event as Event & { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean }
    if (!failure.isMainFrame || failure.errorCode === ABORTED_LOAD) return
    store.setNotice(tabId, { kind: 'loadFailed', url: failure.validatedURL, description: failure.errorDescription })
    store.patchPage(tabId, { loading: false })
  })
  webview.addEventListener('console-message', (event) => {
    const { message, sourceId } = event as Event & { message: string; sourceId: string }
    const canvas = parseCanvasMessage(message, sourceId)
    if (canvas?.type === 'ready') adopt(guest, canvas.artifact)
    else if (canvas) canvasHandlers.get(tabId)?.(canvas)
    const deck = canvas ? null : parseDeckMessage(message, sourceId)
    if (deck?.type === 'exit') leavePresentation(guest)
    if (deck?.type !== 'state') {
      if (deck && deck.type !== 'exit') deckHandlers.get(tabId)?.(deck)
      return
    }
    const { type: _type, ...state } = deck
    const known = useBrowserStore.getState().pageByTab[tabId]?.deck?.artifact
    store.patchPage(tabId, { deck: state })
    if (state.artifact && state.artifact !== known) adopt(guest, state.artifact)
  })
  webview.addEventListener('focus', dismissHostPopups)
  guests.set(tabId, guest)
  return guest
}

function adopt(guest: Guest, artifactId: string) {
  if (!guest.sessionId) return
  adoptArtifactTab({ sessionId: guest.sessionId, tabId: guest.tabId, artifactId, currentUrl: () => guest.webview.getURL() }).catch((error: unknown) => {
    console.warn('[browser] could not recognise the artifact a tab shows', artifactId, error)
  })
}

type ArtifactReferenceLabel = { name: string; title?: string }

export async function artifactReferenceLabel(tabId: string, documentUrl: string): Promise<ArtifactReferenceLabel | null> {
  const guest = readyGuest(tabId)
  if (!guest) return null
  const artifact = artifactFolderOf(guest.webview.getURL())
  if (!artifact) return null
  const deck = useBrowserStore.getState().pageByTab[tabId]?.deck
  if (deck?.slide) {
    const slide = deck.title ?? deck.slide
    return { name: `${artifact} / ${slide}`, title: `${slideFile(deck.slide)} · ${slide}` }
  }
  try {
    const board = await guest.webview.executeJavaScript(canvasBoardTitleCall(documentUrl))
    return typeof board === 'string' && board !== '' ? { name: `${artifact} / ${board}` } : null
  } catch (error) {
    console.warn('[browser] could not read the board of a selection', error)
    return null
  }
}

function applyShellScheme(guest: Guest) {
  if (!isProjectPageUrl(guest.webview.getURL())) return
  const call = shellSchemeCall(themeColorScheme(useUIStore.getState().theme))
  guest.webview.executeJavaScript(call).catch((error: unknown) => console.warn('[browser] could not set the color scheme of the artifact shell', error))
}

function installThemeSync() {
  if (themeSyncInstalled) return
  themeSyncInstalled = true
  useUIStore.subscribe((state, previous) => {
    if (state.theme === previous.theme) return
    for (const guest of guests.values()) if (guest.ready) applyShellScheme(guest)
  })
}

export function setCanvasMessageHandler(tabId: string, handler: ((message: CanvasAction) => void) | null) {
  if (handler) canvasHandlers.set(tabId, handler)
  else canvasHandlers.delete(tabId)
}

export function setDeckMessageHandler(tabId: string, handler: ((message: DeckRequest) => void) | null) {
  if (handler) deckHandlers.set(tabId, handler)
  else deckHandlers.delete(tabId)
}

export async function takeDeckEdit(tabId: string): Promise<DeckEdit | null> {
  const edit = await readyGuest(tabId)?.webview.executeJavaScript(DECK_TAKE_EDIT_CALL)
  return isDeckEdit(edit) ? edit : null
}

export async function refreshArtifactShell(tabId: string): Promise<boolean> {
  const guest = readyGuest(tabId)
  if (!guest) return false
  try {
    return (await guest.webview.executeJavaScript(SHELL_REFRESH_CALL)) !== false
  } catch (error) {
    console.warn('[browser] could not refresh the artifact shell of a tab', tabId, error)
    return false
  }
}

function runInPage(guest: Guest, code: string) {
  return guest.webview.executeJavaScript(code).then(
    () => undefined,
    (error: unknown) => console.warn('[browser] a call into the deck failed', error),
  )
}

export async function runDeckCall(tabId: string, code: string) {
  const guest = readyGuest(tabId)
  if (guest) await runInPage(guest, code)
}

export async function deckStageRect(tabId: string): Promise<DeckRect | null> {
  const rect = await readyGuest(tabId)?.webview.executeJavaScript(DECK_STAGE_RECT_CALL)
  return isDeckRect(rect) ? rect : null
}

export async function presentDeck(tabId: string) {
  const guest = readyGuest(tabId)
  if (!guest) return
  await guest.slot.requestFullscreen()
  guest.webview.focus()
  await runInPage(guest, deckModeCall('present'))
}

function leavePresentation(guest: Guest) {
  if (document.fullscreenElement === guest.slot) {
    document.exitFullscreen().catch((error: unknown) => console.warn('[browser] could not leave full screen', error))
    return
  }
  void runInPage(guest, deckModeCall('browse'))
}

function installPresentationSync() {
  if (presentationSyncInstalled) return
  presentationSyncInstalled = true
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) return
    const pages = useBrowserStore.getState().pageByTab
    for (const guest of guests.values()) {
      if (guest.ready && pages[guest.tabId]?.deck?.mode === 'present') void runInPage(guest, deckModeCall('browse'))
    }
  })
}

export function browserGuestSize(tabId: string) {
  const rect = guests.get(tabId)?.slot.getBoundingClientRect()
  return rect && rect.width > 0 && rect.height > 0 ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null
}

export function hasBrowserGuest(tabId: string) {
  return guests.get(tabId)?.slot.isConnected ?? false
}

export function isBrowserGuestShown(tabId: string) {
  return guests.get(tabId)?.slot.dataset.shown === 'true'
}

export function openBrowserUrl(sessionId: string | null, tabId: string, url: string) {
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

export async function submitBrowserInput(sessionId: string | null, tabId: string, input: string, projectRoot: string | null) {
  const store = useBrowserStore.getState()
  const result = await resolveBrowserInput({ input, projectRoot, searchEngine: useSettingsStore.getState().browserSearchEngine })
  if (!result.ok) {
    store.setNotice(tabId, { kind: 'refused', reason: result.reason, url: input })
    return
  }
  store.setNotice(tabId, null)
  openBrowserUrl(sessionId, tabId, result.url)
}

export function getBrowserGuestContentsId(tabId: string) {
  return guests.get(tabId)?.webContentsId ?? null
}

export function isProjectPageUrl(url: string) {
  return url.startsWith(PROJECT_URL_PREFIX)
}

async function resolveUnderRoot(root: string, relative: string) {
  return resolveBrowserInput({
    input: `${root.replace(/[\\/]+$/, '')}/${relative}`,
    projectRoot: root,
    searchEngine: useSettingsStore.getState().browserSearchEngine,
  })
}

export async function resolveStoredBrowserUrl(
  tab: { url: string; root?: string; artifact?: { id: string }; template?: { id: string } },
  projectRoot: string | null,
): Promise<string> {
  if (!isProjectPageUrl(tab.url)) return tab.url
  const stored = new URL(tab.url)
  const relative = decodeURIComponent(stored.pathname).replace(/^\/+/, '')
  if (!relative) return tab.url
  const reopened = async (rootDir: string, path: string) => {
    const result = await resolveUnderRoot(rootDir, path)
    return result.ok ? `${result.url}${stored.hash}` : null
  }
  const root = tab.root === undefined ? projectRoot : tab.root === GLOBAL_ARTIFACTS_ROOT ? null : tab.root
  const underRoot = root ? await reopened(root, relative) : null
  if (underRoot) return underRoot
  if (tab.template) {
    const located = await designApi.preview(tab.template.id)
    return (await reopened(located.rootDir, relative)) ?? tab.url
  }
  if (!tab.artifact) return tab.url
  const located = await artifactsApi.openById(tab.artifact.id)
  const folder = located.filePath.slice(located.rootDir.length).split(/[\\/]/).filter(Boolean)[0]
  if (!folder) return tab.url
  return (await reopened(located.rootDir, [folder, ...relative.split('/').slice(1)].join('/'))) ?? tab.url
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
  if (guest) {
    if (guest.sessionId) useWorkspaceChatContextStore.getState().markBrowserElementsStale(guest.sessionId, tabId)
    disposeGuest(guest)
  }
  placements.get(tabId)?.observer?.disconnect()
  placements.delete(tabId)
  useBrowserStore.getState().clearTab(tabId)
}

function disposeGuest(guest: Guest) {
  if (guests.get(guest.tabId) === guest) unregisterGuestView(guest.tabId)
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
  const tabId = slot.dataset.browserSlot
  if (tabId) reportViewState(tabId)
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

export async function addBrowserSelectionToChat(event: BrowserSelectionEvent) {
  const guest = [...guests.values()].find((candidate) => candidate.webContentsId === event.guestId)
  const capture = normalizeBrowserSelection(event)
  if (!guest?.sessionId || !capture) return
  const browser: BrowserReferenceData = {
    url: capture.url,
    title: capture.title,
    tabId: guest.tabId,
    text: capture.text,
    truncated: capture.truncated,
  }
  const label = await artifactReferenceLabel(guest.tabId, capture.url)
  if (label?.title) browser.title = label.title
  useWorkspaceChatContextStore.getState().addReference(guest.sessionId, {
    kind: 'browser',
    path: capture.url,
    name: label?.name ?? browserReferenceName(browser),
    browser,
  })
}
