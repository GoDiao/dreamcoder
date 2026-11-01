import { create } from 'zustand'

const STORAGE_KEY = 'dreamcoder-artifact-view'

export type ViewedArtifact = { id: string; name: string; title: string }

type ArtifactViewStore = {
  viewing: ViewedArtifact | null
  designing: boolean
  open: (artifact: ViewedArtifact) => void
  close: () => void
  openDesign: () => void
  closeDesign: () => void
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
  designing: false,
  open: (artifact) => {
    store(artifact)
    set({ viewing: artifact, designing: false })
  },
  close: () => {
    store(null)
    set({ viewing: null })
  },
  openDesign: () => {
    store(null)
    set({ viewing: null, designing: true })
  },
  closeDesign: () => set({ designing: false }),
}))
