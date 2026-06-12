import { create } from 'zustand'
import { isThemeMode, THEME_MODES, type ThemeMode } from '../types/settings'

const THEME_STORAGE_KEY = 'dreamcoder-theme'
const SIDEBAR_WIDTH_STORAGE_KEY = 'dreamcoder-sidebar-width'
const MAX_LIVE_TERMINALS_STORAGE_KEY = 'dreamcoder-max-live-terminals'

export const SIDEBAR_MIN_WIDTH = 220
export const SIDEBAR_MAX_WIDTH = 400
export const SIDEBAR_DEFAULT_WIDTH = 280

// Allow 1..50 live terminals, or 0 = unlimited. Default 5 matches the
// previous hard-coded cap.
export const MAX_LIVE_TERMINALS_DEFAULT = 5
export const MAX_LIVE_TERMINALS_OPTIONS = [3, 5, 10, 0] as const // 0 = unlimited

function getStoredMaxLiveTerminals(): number {
  try {
    const stored = localStorage.getItem(MAX_LIVE_TERMINALS_STORAGE_KEY)
    if (stored !== null) {
      const val = Number(stored)
      if (Number.isFinite(val) && val >= 0 && val <= 50) {
        return Math.floor(val)
      }
    }
  } catch { /* localStorage unavailable */ }
  return MAX_LIVE_TERMINALS_DEFAULT
}

function getStoredSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (stored) {
      const val = Number(stored)
      if (Number.isFinite(val)) return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, val))
    }
  } catch { /* localStorage unavailable */ }
  return SIDEBAR_DEFAULT_WIDTH
}

function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemeMode(stored)) return stored
  } catch { /* localStorage unavailable */ }
  return 'white'
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = (theme === 'dark' || theme === 'midnight') ? 'dark' : 'light'
}

export function initializeTheme() {
  applyTheme(getStoredTheme())
}

export type Toast = {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
}

export type SettingsTab =
  | 'providers'
  | 'permissions'
  | 'activity'
  | 'general'
  | 'h5Access'
  | 'adapters'
  | 'terminal'
  | 'mcp'
  | 'agents'
  | 'skills'
  | 'memory'
  | 'plugins'
  | 'computerUse'
  | 'diagnostics'
  | 'about'

type ActiveView = 'code' | 'scheduled' | 'terminal' | 'history' | 'settings'

type UIStore = {
  theme: ThemeMode
  sidebarOpen: boolean
  sidebarWidth: number
  maxLiveTerminals: number
  activeView: ActiveView
  pendingSettingsTab: SettingsTab | null
  pendingMemoryPath: string | null
  activeModal: string | null
  toasts: Toast[]

  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSidebarWidth: (width: number) => void
  setMaxLiveTerminals: (value: number) => void
  setActiveView: (view: ActiveView) => void
  setPendingSettingsTab: (tab: SettingsTab | null) => void
  setPendingMemoryPath: (path: string | null) => void
  openModal: (id: string) => void
  closeModal: () => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

let toastCounter = 0

let sidebarWidthPersistTimer: ReturnType<typeof setTimeout> | null = null
const SIDEBAR_WIDTH_PERSIST_DEBOUNCE_MS = 300

export const useUIStore = create<UIStore>((set) => ({
  theme: getStoredTheme(),
  sidebarOpen: true,
  sidebarWidth: getStoredSidebarWidth(),
  maxLiveTerminals: getStoredMaxLiveTerminals(),
  activeView: 'code',
  pendingSettingsTab: null,
  pendingMemoryPath: null,
  activeModal: null,
  toasts: [],

  setTheme: (theme) => {
    applyTheme(theme)
    try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* noop */ }
    set({ theme })
  },

  toggleTheme: () => {
    set((state) => {
      const currentIndex = THEME_MODES.indexOf(state.theme)
      const next = THEME_MODES[(currentIndex + 1) % THEME_MODES.length] ?? 'white'
      applyTheme(next)
      try { localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* noop */ }
      return { theme: next }
    })
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (width) => {
    const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width))
    set({ sidebarWidth: clamped })
    // Debounce localStorage write: during a drag this fires ~60×/s.
    // We only need the final value persisted; the in-memory state above
    // already updates every frame for instant visual feedback.
    if (sidebarWidthPersistTimer) clearTimeout(sidebarWidthPersistTimer)
    sidebarWidthPersistTimer = setTimeout(() => {
      try { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped)) } catch { /* noop */ }
      sidebarWidthPersistTimer = null
    }, SIDEBAR_WIDTH_PERSIST_DEBOUNCE_MS)
  },
  setMaxLiveTerminals: (value) => {
    const clamped = value === 0 ? 0 : Math.max(1, Math.min(50, value))
    try { localStorage.setItem(MAX_LIVE_TERMINALS_STORAGE_KEY, String(clamped)) } catch { /* noop */ }
    set({ maxLiveTerminals: clamped })
  },
  setActiveView: (view) => set({ activeView: view }),
  setPendingSettingsTab: (tab) => set({ pendingSettingsTab: tab }),
  setPendingMemoryPath: (path) => set({ pendingMemoryPath: path }),
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),

  addToast: (toast) => {
    const id = `toast-${++toastCounter}`
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    // Auto-remove after duration
    const duration = toast.duration ?? 4000
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, duration)
    }
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
