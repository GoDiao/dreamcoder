import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import { dropSession as dropVirtualHeightSession } from '../components/chat/virtualHeightCache'

const TAB_STORAGE_KEY = 'dreamcoder-open-tabs'

const memLog = (label: string) => {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const m = process.memoryUsage()
    console.log(`[mem] ${label}: rss=${(m.rss/1024/1024).toFixed(1)}MB heapUsed=${(m.heapUsed/1024/1024).toFixed(1)}MB heapTotal=${(m.heapTotal/1024/1024).toFixed(1)}MB external=${(m.external/1024/1024).toFixed(1)}MB`)
  }
}

export const SCHEDULED_TAB_ID = '__scheduled__'

/** Tabs are the internal current-page router; there is no visible tab bar. */
export type TabType = 'session' | 'scheduled'

export type Tab = {
  sessionId: string
  title: string
  type: TabType
  status: 'idle' | 'running' | 'error'
}

type TabPersistence = {
  // Older builds also persisted 'settings' and 'terminal' tabs; restore drops them.
  openTabs: Array<{ sessionId: string; title: string; type?: TabType | 'settings' | 'terminal' }>
  activeTabId: string | null
}

type TabStore = {
  tabs: Tab[]
  activeTabId: string | null

  openTab: (sessionId: string, title: string, type?: TabType) => void
  closeTab: (sessionId: string) => void
  /** Drop tabs without changing the active page (used to release idle sessions). */
  dropTabs: (sessionIds: string[]) => void
  setActiveTab: (sessionId: string) => void
  updateTabTitle: (sessionId: string, title: string) => void
  updateTabStatus: (sessionId: string, status: Tab['status']) => void
  replaceTabSession: (oldSessionId: string, newSessionId: string) => void

  saveTabs: () => void
  restoreTabs: () => Promise<void>
}

const RETIRED_TAB_IDS = new Set(['__settings__'])
const RETIRED_TAB_PREFIXES = ['__terminal__']

function isRetiredTab(tab: { sessionId: string; type?: string }) {
  if (tab.type === 'settings' || tab.type === 'terminal') return true
  return RETIRED_TAB_IDS.has(tab.sessionId) || RETIRED_TAB_PREFIXES.some((prefix) => tab.sessionId.startsWith(prefix))
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (sessionId, title, type = 'session') => {
    const { tabs } = get()
    const existing = tabs.find((t) => t.sessionId === sessionId)
    if (existing) {
      // Move it to the end so tab order is most-recently-opened last.
      const updated = {
        ...existing,
        title,
        ...(!(existing as Partial<Tab>).type ? { type } : {}),
      }
      set({
        tabs: [...tabs.filter((tab) => tab.sessionId !== sessionId), updated],
        activeTabId: sessionId,
      })
    } else {
      set({
        tabs: [...tabs, { sessionId, title, type, status: 'idle' }],
        activeTabId: sessionId,
      })
    }
    get().saveTabs()
  },

  closeTab: (sessionId) => {
    const { tabs, activeTabId } = get()
    const index = tabs.findIndex((t) => t.sessionId === sessionId)
    if (index < 0) return

    const newTabs = tabs.filter((t) => t.sessionId !== sessionId)
    // There is no visible tab bar, so a neighbouring tab means nothing to the
    // user; closing the current page lands on the empty new-session page.
    const newActiveId = activeTabId === sessionId ? null : activeTabId

    set({ tabs: newTabs, activeTabId: newActiveId })
    get().saveTabs()
    dropVirtualHeightSession(sessionId)
  },

  dropTabs: (sessionIds) => {
    if (sessionIds.length === 0) return
    const drop = new Set(sessionIds)
    const { activeTabId } = get()
    set((s) => ({ tabs: s.tabs.filter((t) => !drop.has(t.sessionId) || t.sessionId === activeTabId) }))
    get().saveTabs()
    for (const id of drop) {
      if (id !== activeTabId) dropVirtualHeightSession(id)
    }
  },

  setActiveTab: (sessionId) => {
    set({ activeTabId: sessionId })
    get().saveTabs()
  },

  updateTabTitle: (sessionId, title) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, title } : t)),
    }))
    get().saveTabs()
  },

  updateTabStatus: (sessionId, status) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, status } : t)),
    }))
  },

  replaceTabSession: (oldSessionId, newSessionId) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.sessionId === oldSessionId ? { ...t, sessionId: newSessionId } : t,
      ),
      activeTabId: activeTabId === oldSessionId ? newSessionId : activeTabId,
    }))
    get().saveTabs()
  },

  saveTabs: () => {
    const { tabs, activeTabId } = get()
    const data: TabPersistence = {
      openTabs: tabs.map((t) => ({ sessionId: t.sessionId, title: t.title, type: t.type })),
      activeTabId: activeTabId && tabs.some((tab) => tab.sessionId === activeTabId)
        ? activeTabId
        : (tabs[0]?.sessionId ?? null),
    }
    try {
      localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(data))
    } catch { }
  },

  restoreTabs: async () => {
    try {
      const raw = localStorage.getItem(TAB_STORAGE_KEY)
      if (!raw) return

      const data = JSON.parse(raw) as TabPersistence
      if (!data.openTabs || data.openTabs.length === 0) {
        set({ tabs: [], activeTabId: null })
        localStorage.removeItem(TAB_STORAGE_KEY)
        return
      }

      memLog('restoreTabs:start')
      const restorableTabs = data.openTabs.filter((tab) => !isRetiredTab(tab))
      const pendingSessionIds = new Set(restorableTabs
        .filter((tab) => tab.type !== 'scheduled')
        .map((tab) => tab.sessionId))
      const sessionTitles = new Map<string, string>()
      const pageSize = 200
      let offset = 0
      while (pendingSessionIds.size > 0) {
        const { sessions, total } = await sessionsApi.list({ limit: pageSize, offset })
        for (const session of sessions) {
          if (pendingSessionIds.delete(session.id)) sessionTitles.set(session.id, session.title)
        }
        offset += pageSize
        if (offset >= total) break
      }
      memLog(`restoreTabs:after-list (resolved ${sessionTitles.size} sessions)`)

      const validTabs: Tab[] = restorableTabs
        .filter((t) => t.type === 'scheduled' || sessionTitles.has(t.sessionId))
        .map((t) => {
          if (t.type === 'scheduled') {
            return { sessionId: t.sessionId, title: t.title, type: 'scheduled' as const, status: 'idle' as const }
          }
          return {
            sessionId: t.sessionId,
            title: sessionTitles.get(t.sessionId) || t.title,
            type: 'session' as const,
            status: 'idle' as const,
          }
        })

      if (validTabs.length === 0) {
        set({ tabs: [], activeTabId: null })
        localStorage.removeItem(TAB_STORAGE_KEY)
        return
      }

      const activeId = data.activeTabId && validTabs.some((t) => t.sessionId === data.activeTabId)
        ? data.activeTabId
        : validTabs[0]!.sessionId

      set({ tabs: validTabs, activeTabId: activeId })
    } catch { }
  },
}))
