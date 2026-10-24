import { create } from 'zustand'
import type { RuntimeSelection } from '../types/runtime'
import type { EffortLevel } from '../types/settings'

const STORAGE_KEY = 'dreamcoder-session-runtime'

export const DRAFT_RUNTIME_SELECTION_KEY = '__draft__'

/** Mirrors the server's EFFORT_LEVELS (src/server/api/models.ts). */
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'max']

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value)
}

function sanitizeSelection(selection: RuntimeSelection): RuntimeSelection {
  if (selection.effort === undefined || isEffortLevel(selection.effort)) return selection
  const { effort: _invalid, ...rest } = selection
  return rest
}

type SessionRuntimeStore = {
  selections: Record<string, RuntimeSelection>
  setSelection: (key: string, selection: RuntimeSelection) => void
  clearSelection: (key: string) => void
}

function loadSelections(): Record<string, RuntimeSelection> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, RuntimeSelection>
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, selection]) => selection && typeof selection === 'object')
        .map(([key, selection]) => [key, sanitizeSelection(selection)]),
    )
  } catch {
    return {}
  }
}

function persistSelections(selections: Record<string, RuntimeSelection>) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections))
  } catch {
  }
}

export const useSessionRuntimeStore = create<SessionRuntimeStore>((set) => ({
  selections: loadSelections(),

  setSelection: (key, selection) =>
    set((state) => {
      const selections = {
        ...state.selections,
        [key]: sanitizeSelection(selection),
      }
      persistSelections(selections)
      return { selections }
    }),

  clearSelection: (key) =>
    set((state) => {
      if (!(key in state.selections)) return state
      const { [key]: _removed, ...rest } = state.selections
      persistSelections(rest)
      return { selections: rest }
    }),
}))
