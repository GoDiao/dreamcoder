import { create } from 'zustand'

const STORAGE_KEY = 'dreamcoder-artifact-view'

export type ViewedArtifact = { id: string; name: string; title: string }

export type StartScope = 'design' | 'slides'

type ArtifactViewStore = {
  viewing: ViewedArtifact | null
  starting: StartScope | null
  open: (artifact: ViewedArtifact) => void
  close: () => void
  openStart: (scope: StartScope) => void
  closeStart: () => void
}

function isViewedArtifact(value: unknown): value is ViewedArtifact {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.name === 'string' && typeof record.title === 'string'
}

function readStored(): ViewedArtifact | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return isViewedArtifact(parsed) ? parsed : null
  } catch (error) {
    console.warn('[artifacts] Failed to restore the viewed artifact', error)
    return null
  }
}

function store(artifact: ViewedArtifact | null) {
  try {
    if (artifact) localStorage.setItem(STORAGE_KEY, JSON.stringify(artifact))
    else localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.warn('[artifacts] Failed to save the viewed artifact', error)
  }
}

export const useArtifactViewStore = create<ArtifactViewStore>((set) => ({
  viewing: readStored(),
  starting: null,
  open: (artifact) => {
    store(artifact)
    set({ viewing: artifact, starting: null })
  },
  close: () => {
    store(null)
    set({ viewing: null })
  },
  openStart: (scope) => {
    store(null)
    set({ viewing: null, starting: scope })
  },
  closeStart: () => set({ starting: null }),
}))
