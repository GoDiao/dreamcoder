import { create } from 'zustand'
import type { BoardListing, BoardView, InboxItem, KanbanCommand } from '@protocol'
import { kanbanApi } from '../api/kanban'

const SNOOZED_STORAGE_KEY = 'dreamcoder-kanban-snoozed'

type KanbanStore = {
  boards: BoardListing[] | null
  views: Record<string, BoardView | undefined>
  loadErrors: Record<string, string | undefined>
  snoozed: Record<string, string[] | undefined>

  loadBoards: () => Promise<BoardListing[]>
  refresh: (key: string) => Promise<void>
  refreshAll: () => Promise<void>
  execute: (key: string, command: KanbanCommand) => Promise<{ warnings: string[]; card?: number }>
  createBoard: (project: string) => Promise<BoardView>
  setSnoozed: (key: string, item: string, snoozed: boolean) => void
}

export function inboxItemKey(item: InboxItem): string {
  return `${item.kind}:${item.card}`
}

export function boardForProject(boards: BoardListing[] | null, project: string | null | undefined): BoardListing | null {
  if (!boards || !project) return null
  return boards.find((board) => board.project === project) ?? null
}

function readSnoozed(): Record<string, string[] | undefined> {
  try {
    const raw = localStorage.getItem(SNOOZED_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []]),
    )
  } catch (error) {
    console.warn('[kanban] Failed to restore snoozed items', error)
    return {}
  }
}

function writeSnoozed(snoozed: Record<string, string[] | undefined>) {
  try {
    localStorage.setItem(SNOOZED_STORAGE_KEY, JSON.stringify(snoozed))
  } catch (error) {
    console.warn('[kanban] Failed to save snoozed items', error)
  }
}

export const useKanbanStore = create<KanbanStore>((set, get) => {
  const storeView = (key: string, view: BoardView) => {
    if (view.version < (get().views[key]?.version ?? 0)) return
    const current = get().snoozed[key] ?? []
    const open = new Set((view.inbox ?? []).map(inboxItemKey))
    const kept = current.filter((item) => open.has(item))
    const snoozed = kept.length === current.length ? null : { ...get().snoozed, [key]: kept }
    set((state) => ({ views: { ...state.views, [key]: view }, ...(snoozed ? { snoozed } : {}) }))
    if (snoozed) writeSnoozed(snoozed)
  }

  return {
    boards: null,
    views: {},
    loadErrors: {},
    snoozed: readSnoozed(),

    loadBoards: async () => {
      const { boards } = await kanbanApi.listBoards()
      set({ boards })
      return boards
    },

    refresh: async (key) => {
      const since = get().views[key]?.etag
      try {
        const result = await kanbanApi.view(key, since)
        if (get().loadErrors[key]) set((state) => ({ loadErrors: { ...state.loadErrors, [key]: undefined } }))
        if (result.changed && get().views[key]?.etag === since) storeView(key, result.view)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (get().loadErrors[key] !== message) set((state) => ({ loadErrors: { ...state.loadErrors, [key]: message } }))
      }
    },

    refreshAll: async () => {
      const boards = await get().loadBoards()
      await Promise.all(boards.map((board) => get().refresh(board.key)))
    },

    execute: async (key, command) => {
      const { view, warnings, card } = await kanbanApi.command(key, command)
      storeView(key, view)
      return { warnings, ...(card === undefined ? {} : { card }) }
    },

    createBoard: async (project) => {
      const { view } = await kanbanApi.createBoard(project)
      set((state) => ({
        views: { ...state.views, [view.key]: view },
        boards: [...(state.boards ?? []).filter((board) => board.key !== view.key), { key: view.key, project: view.project }],
      }))
      return view
    },

    setSnoozed: (key, item, snoozed) => {
      const current = get().snoozed[key] ?? []
      if (current.includes(item) === snoozed) return
      const next = { ...get().snoozed, [key]: snoozed ? [...current, item] : current.filter((candidate) => candidate !== item) }
      set({ snoozed: next })
      writeSnoozed(next)
    },
  }
})

export function useInboxCount(board: string | null): number {
  return useKanbanStore((state) => {
    if (!board) return 0
    const snoozed = new Set(state.snoozed[board] ?? [])
    return (state.views[board]?.inbox ?? []).filter((item) => !snoozed.has(inboxItemKey(item))).length
  })
}
