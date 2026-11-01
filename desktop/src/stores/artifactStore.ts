import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import { browserReload, refreshCanvas } from '../lib/browserGuests'
import { useWorkspacePanelStore, type BrowserTabArtifact, type WorkspaceTab } from './workspacePanelStore'

const REFRESH_DEBOUNCE_MS = 300

type ArtifactTab = Extract<WorkspaceTab, { kind: 'browser' }> & { root: string; artifact: BrowserTabArtifact }

type ArtifactStore = {
  writeVersion: number
  noteArtifactActivity: () => void
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null

function isArtifactTab(tab: WorkspaceTab): tab is ArtifactTab {
  return tab.kind === 'browser' && tab.root !== undefined && tab.artifact !== undefined
}

function sessionsWithArtifactTabs() {
  const panels = useWorkspacePanelStore.getState().panelBySession
  return Object.entries(panels).flatMap(([sessionId, panel]) => {
    const tabs = panel?.tabs.filter(isArtifactTab) ?? []
    return tabs.length > 0 ? [{ sessionId, tabs }] : []
  })
}

async function reloadTab(tab: ArtifactTab) {
  if (tab.artifact.canvas && tab.artifact.board === undefined && (await refreshCanvas(tab.id))) return
  browserReload(tab.id)
}

export async function reloadChangedArtifactTabs() {
  for (const { sessionId, tabs } of sessionsWithArtifactTabs()) {
    try {
      const { current, others } = await sessionsApi.getWorkspaceArtifacts(sessionId)
      const items = [...current, ...others]
      for (const tab of tabs) {
        const item = items.find((candidate) => candidate.id === tab.artifact.id)
        if (!item || item.latestMtimeMs <= tab.artifact.mtimeMs) continue
        useWorkspacePanelStore.getState().patchTab(sessionId, tab.id, { artifact: { ...tab.artifact, mtimeMs: item.latestMtimeMs } })
        await reloadTab(tab)
      }
    } catch (error) {
      console.warn('[artifacts] Failed to refresh artifact tabs', sessionId, error)
    }
  }
}

function scheduleReload() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void reloadChangedArtifactTabs()
  }, REFRESH_DEBOUNCE_MS)
}

export const useArtifactStore = create<ArtifactStore>((set) => ({
  writeVersion: 0,
  noteArtifactActivity: () => {
    set((state) => ({ writeVersion: state.writeVersion + 1 }))
    scheduleReload()
  },
}))
