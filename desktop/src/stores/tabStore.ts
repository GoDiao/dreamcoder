import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import { dropSession as dropVirtualHeightSession } from '../components/chat/virtualHeightCache'
import { destroyTerminalRuntime } from '../lib/terminalRuntime'

const TAB_STORAGE_KEY = 'dreamcoder-open-tabs'

export const SETTINGS_TAB_ID = '__settings__'
export const SCHEDULED_TAB_ID = '__scheduled__'
export const TERMINAL_TAB_PREFIX = '__terminal__'

// Cap concurrent terminal runtimes (each owns a PTY + xterm.js + addons).
// 5 covers the realistic "many terminals open" power-user case while
// preventing unbounded RAM growth (~30-60 MB per terminal in our setup).
const MAX_LIVE_TERMINALS = 5

export type TabType = 'session' | 'settings' | 'scheduled' | 'terminal'

export type Tab = {
  sessionId: string
  title: string
  type: TabType
  status: 'idle' | 'running' | 'error'
  terminalCwd?: string
  terminalRuntimeId?: string
}

type TabPersistence = {
  openTabs: Array<{ sessionId: string; title: string; type?: TabType }>
  activeTabId: string | null
}

type TabStore = {
  tabs: Tab[]
  activeTabId: string | null
  liveTerminalIds: string[]

  openTab: (sessionId: string, title: string, type?: TabType) => void
  openTerminalTab: (cwd?: string, terminalRuntimeId?: string) => string
  closeTab: (sessionId: string) => void
  setActiveTab: (sessionId: string) => void
  updateTabTitle: (sessionId: string, title: string) => void
  updateTabStatus: (sessionId: string, status: Tab['status']) => void
  replaceTabSession: (oldSessionId: string, newSessionId: string) => void
  moveTab: (fromIndex: number, toIndex: number) => void
  /** Promote a terminal to most-recently-used and evict LRU if over the cap. */
  touchTerminal: (sessionId: string) => void
  /** True iff this terminal currently has a live xterm runtime. */
  isTerminalLive: (sessionId: string) => boolean

  saveTabs: () => void
  restoreTabs: () => Promise<void>
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  liveTerminalIds: [],

  openTab: (sessionId, title, type = 'session') => {
    const { tabs } = get()
    const existing = tabs.find((t) => t.sessionId === sessionId)
    if (existing) {
      set({
        tabs: tabs.map((tab) =>
          tab.sessionId === sessionId
            ? {
                ...tab,
                title,
                ...(!(tab as Partial<Tab>).type ? { type } : {}),
              }
            : tab,
        ),
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

  openTerminalTab: (cwd, terminalRuntimeId) => {
    const { tabs } = get()
    const nextIndex = Math.max(
      0,
      ...tabs
        .filter((tab) => tab.type === 'terminal')
        .map((tab) => {
          const match = /^Terminal (\d+)$/.exec(tab.title)
          return match ? Number(match[1]) : 0
        }),
    ) + 1
    const sessionId = `${TERMINAL_TAB_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set({
      tabs: [...tabs, { sessionId, title: `Terminal ${nextIndex}`, type: 'terminal', status: 'idle', terminalCwd: cwd, terminalRuntimeId }],
      activeTabId: sessionId,
    })
    get().touchTerminal(sessionId)
    get().saveTabs()
    return sessionId
  },

  closeTab: (sessionId) => {
    const { tabs, activeTabId, liveTerminalIds } = get()
    const index = tabs.findIndex((t) => t.sessionId === sessionId)
    if (index < 0) return

    const newTabs = tabs.filter((t) => t.sessionId !== sessionId)
    let newActiveId = activeTabId

    if (activeTabId === sessionId) {
      if (newTabs.length === 0) {
        newActiveId = null
      } else if (index >= newTabs.length) {
        newActiveId = newTabs[newTabs.length - 1]!.sessionId
      } else {
        newActiveId = newTabs[index]!.sessionId
      }
    }

    set({
      tabs: newTabs,
      activeTabId: newActiveId,
      liveTerminalIds: liveTerminalIds.filter((id) => id !== sessionId),
    })
    get().saveTabs()
    const closedTab = tabs[index]
    if (closedTab?.type === 'terminal') {
      destroyTerminalRuntime(closedTab.terminalRuntimeId ?? closedTab.sessionId)
    }
    dropVirtualHeightSession(sessionId)
  },

  setActiveTab: (sessionId) => {
    set({ activeTabId: sessionId })
    // If we're switching to a terminal tab, promote it in the LRU. This must
    // run BEFORE the next render so ContentRouter sees it in liveTerminalIds.
    const tab = get().tabs.find((t) => t.sessionId === sessionId)
    if (tab?.type === 'terminal') {
      get().touchTerminal(sessionId)
    }
    get().saveTabs()
  },

  touchTerminal: (sessionId) => {
    const { tabs, liveTerminalIds } = get()
    const tab = tabs.find((t) => t.sessionId === sessionId)
    if (!tab || tab.type !== 'terminal') return

    // Already at the tail of the LRU — nothing to do.
    if (liveTerminalIds[liveTerminalIds.length - 1] === sessionId) return

    const without = liveTerminalIds.filter((id) => id !== sessionId)
    const next = [...without, sessionId]
    let evicted: string | null = null
    if (next.length > MAX_LIVE_TERMINALS) {
      // Evict least-recently-used (head). Buffer state is forfeited; the
      // xterm runtime owns it and we don't currently serialize across
      // hibernation. Trade-off documented in perf-optimization-plan-v2.md.
      evicted = next.shift() ?? null
    }
    set({ liveTerminalIds: next })
    if (evicted) {
      const evictedTab = tabs.find((t) => t.sessionId === evicted)
      destroyTerminalRuntime(evictedTab?.terminalRuntimeId ?? evicted)
    }
  },

  isTerminalLive: (sessionId) => get().liveTerminalIds.includes(sessionId),

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

  moveTab: (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return
    const { tabs } = get()
    if (fromIndex < 0 || fromIndex >= tabs.length || toIndex < 0 || toIndex >= tabs.length) return
    const newTabs = [...tabs]
    const [moved] = newTabs.splice(fromIndex, 1)
    newTabs.splice(toIndex, 0, moved!)
    set({ tabs: newTabs })
    get().saveTabs()
  },

  saveTabs: () => {
    const { tabs, activeTabId } = get()
    const persistableTabs = tabs.filter((tab) => tab.type !== 'terminal')
    const data: TabPersistence = {
      openTabs: persistableTabs.map((t) => ({ sessionId: t.sessionId, title: t.title, type: t.type })),
      activeTabId: activeTabId && persistableTabs.some((tab) => tab.sessionId === activeTabId)
        ? activeTabId
        : (persistableTabs[0]?.sessionId ?? null),
    }
    try {
      localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(data))
    } catch { /* noop */ }
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

      const { sessions } = await sessionsApi.list({ limit: 200 })
      const existingIds = new Set(sessions.map((s) => s.id))

      const validTabs: Tab[] = data.openTabs
        .filter((t) => {
          // Special tabs are always valid
          if (t.type === 'settings' || t.type === 'scheduled') return true
          if (t.type === 'terminal') return false
          // Session tabs must exist on server
          return existingIds.has(t.sessionId)
        })
        .map((t) => {
          if (t.type === 'settings' || t.type === 'scheduled') {
            return { sessionId: t.sessionId, title: t.title, type: t.type, status: 'idle' as const }
          }
          return {
            sessionId: t.sessionId,
            title: sessions.find((s) => s.id === t.sessionId)?.title || t.title,
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
    } catch { /* noop */ }
  },
}))
