import { useWorkspaceChatContextStore } from '../stores/workspaceChatContextStore'
import { syncBrowserMarks, type BrowserMarkRequest } from './shell'

const DEBOUNCE_MS = 150

type Synced = { sessionId: string; signature: string }

const syncedByTab = new Map<string, Synced>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const queues = new Map<string, Promise<void>>()
let unsubscribe: (() => void) | null = null

function markRequestsByTab(sessionId: string) {
  const byTab = new Map<string, BrowserMarkRequest[]>()
  const references = useWorkspaceChatContextStore.getState().referencesBySession[sessionId] ?? []
  for (const reference of references) {
    const { browser } = reference
    const element = browser?.element
    if (!browser?.tabId || !element || element.stale || element.ref === undefined || element.generation === undefined) continue
    const requests = byTab.get(browser.tabId) ?? []
    requests.push({ ref: element.ref, generation: element.generation })
    byTab.set(browser.tabId, requests)
  }
  return byTab
}

function syncTab(sessionId: string, tabId: string, requests: BrowserMarkRequest[], force: boolean) {
  const signature = JSON.stringify(requests)
  const previous = syncedByTab.get(tabId)
  if (!force && (previous?.signature ?? '[]') === signature) return Promise.resolve()
  const run = async () => {
    try {
      const alive = await syncBrowserMarks({ tabId, refs: requests })
      if (requests.length === 0) syncedByTab.delete(tabId)
      else syncedByTab.set(tabId, { sessionId, signature })
      const gone = requests.map((request) => request.ref).filter((ref) => !alive.includes(ref))
      if (gone.length > 0) useWorkspaceChatContextStore.getState().markBrowserElementsStale(sessionId, tabId, gone)
    } catch (error) {
      syncedByTab.delete(tabId)
      console.warn('[browser] could not update the element marks', tabId, error)
    }
  }
  const queued = (queues.get(tabId) ?? Promise.resolve()).then(run)
  queues.set(tabId, queued)
  return queued
}

function syncSession(sessionId: string, force: boolean) {
  const current = markRequestsByTab(sessionId)
  const tabs = new Set(current.keys())
  for (const [tabId, synced] of syncedByTab) if (synced.sessionId === sessionId) tabs.add(tabId)
  return Promise.all([...tabs].map((tabId) => syncTab(sessionId, tabId, current.get(tabId) ?? [], force)))
}

function schedule(sessionId: string) {
  const existing = timers.get(sessionId)
  if (existing) clearTimeout(existing)
  timers.set(
    sessionId,
    setTimeout(() => {
      timers.delete(sessionId)
      void syncSession(sessionId, false)
    }, DEBOUNCE_MS),
  )
}

export function startBrowserMarkSync() {
  if (unsubscribe) return unsubscribe
  const stop = useWorkspaceChatContextStore.subscribe((state, previous) => {
    if (state.referencesBySession === previous.referencesBySession) return
    for (const sessionId of new Set([...Object.keys(state.referencesBySession), ...Object.keys(previous.referencesBySession)])) {
      if (state.referencesBySession[sessionId] !== previous.referencesBySession[sessionId]) schedule(sessionId)
    }
  })
  unsubscribe = () => {
    stop()
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    syncedByTab.clear()
    queues.clear()
    unsubscribe = null
  }
  return unsubscribe
}

export async function refreshBrowserMarksBeforeSend(sessionId: string) {
  const pending = timers.get(sessionId)
  if (pending) clearTimeout(pending)
  timers.delete(sessionId)
  await syncSession(sessionId, true)
}
