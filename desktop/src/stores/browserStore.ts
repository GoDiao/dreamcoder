import { create } from 'zustand'
import type { BrowserRefusal } from '../lib/shell/electronBridge'

type BrowserPage = {
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type BrowserNotice =
  | { kind: 'refused'; reason: BrowserRefusal; url?: string }
  | { kind: 'loadFailed'; url: string; description: string }

type BrowserStore = {
  pageByTab: Record<string, BrowserPage | undefined>
  noticeByTab: Record<string, BrowserNotice | undefined>
  externalRequestUrl: string | null
  patchPage: (tabId: string, patch: Partial<BrowserPage>) => void
  setNotice: (tabId: string, notice: BrowserNotice | null) => void
  setExternalRequestUrl: (url: string | null) => void
  clearTab: (tabId: string) => void
}

export const EMPTY_BROWSER_PAGE: BrowserPage = {
  loading: false,
  canGoBack: false,
  canGoForward: false,
}

function withoutKey<T>(record: Record<string, T>, key: string) {
  const { [key]: _removed, ...rest } = record
  return rest
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  pageByTab: {},
  noticeByTab: {},
  externalRequestUrl: null,

  patchPage: (tabId, patch) =>
    set((state) => ({
      pageByTab: {
        ...state.pageByTab,
        [tabId]: { ...(state.pageByTab[tabId] ?? EMPTY_BROWSER_PAGE), ...patch },
      },
    })),

  setNotice: (tabId, notice) =>
    set((state) => ({
      noticeByTab: notice
        ? { ...state.noticeByTab, [tabId]: notice }
        : withoutKey(state.noticeByTab, tabId),
    })),

  setExternalRequestUrl: (url) => set({ externalRequestUrl: url }),

  clearTab: (tabId) =>
    set((state) => ({
      pageByTab: withoutKey(state.pageByTab, tabId),
      noticeByTab: withoutKey(state.noticeByTab, tabId),
    })),
}))
