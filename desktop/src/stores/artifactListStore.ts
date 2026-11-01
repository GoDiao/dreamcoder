import { create } from 'zustand'
import { artifactsApi } from '../api/artifacts'
import { errorMessage } from '../lib/errorMessage'
import type { ArtifactListItem } from '../types/artifact'

const CACHE_KEY = 'dreamcoder-artifacts-cache'

type ArtifactListStore = {
  items: ArtifactListItem[]
  loading: boolean
  error: string | null
  load: () => Promise<void>
}

function readCache(): ArtifactListItem[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as ArtifactListItem[]) : []
  } catch (error) {
    console.warn('[artifacts] Failed to read the cached list', error)
    return []
  }
}

function writeCache(items: ArtifactListItem[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(items))
  } catch (error) {
    console.warn('[artifacts] Failed to cache the list', error)
  }
}

let requestId = 0

export const useArtifactListStore = create<ArtifactListStore>((set) => ({
  items: readCache(),
  loading: false,
  error: null,

  load: async () => {
    const current = ++requestId
    set({ loading: true, error: null })
    try {
      const { artifacts } = await artifactsApi.list()
      if (current !== requestId) return
      writeCache(artifacts)
      set({ items: artifacts, loading: false })
    } catch (error) {
      if (current !== requestId) return
      set({ loading: false, error: errorMessage(error) })
    }
  },
}))
