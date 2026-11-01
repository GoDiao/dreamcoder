import { create } from 'zustand'
import { errorMessage } from '../lib/errorMessage'

export type CatalogStore<T> = {
  items: T[]
  loaded: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
}

export function createCatalogStore<T>(fetchItems: () => Promise<T[]>) {
  return create<CatalogStore<T>>((set, get) => ({
    items: [],
    loaded: false,
    loading: false,
    error: null,

    load: async () => {
      if (get().loaded || get().loading) return
      set({ loading: true, error: null })
      try {
        set({ items: await fetchItems(), loaded: true, loading: false })
      } catch (error) {
        set({ loading: false, error: errorMessage(error) })
      }
    },
  }))
}
