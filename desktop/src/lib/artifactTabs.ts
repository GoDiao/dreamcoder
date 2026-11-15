import { artifactsApi } from '../api/artifacts'
import { useSettingsStore } from '../stores/settingsStore'
import { browserTabArtifact, useWorkspacePanelStore } from '../stores/workspacePanelStore'
import { artifactRoot } from './artifactDisplay'
import { resolveBrowserInput } from './shell'
import { PROJECT_PROTOCOL } from './shellBridge'

export function artifactFolderOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== PROJECT_PROTOCOL) return null
    return decodeURIComponent(parsed.pathname).split('/').filter(Boolean)[0] ?? null
  } catch {
    return null
  }
}

export function tabShowsArtifact<T extends { url: string; artifact?: { name: string } }>(tab: T): tab is T & { artifact: NonNullable<T['artifact']> } {
  return tab.artifact !== undefined && artifactFolderOf(tab.url) === tab.artifact.name
}

export function isExportableArtifact(artifact: { canvas?: boolean }): boolean {
  return artifact.canvas !== true
}

function isPlainBrowserTab(tabId: string) {
  const panels = useWorkspacePanelStore.getState().panelByTab
  const tab = Object.values(panels).flatMap((panel) => panel?.tabs ?? []).find((candidate) => candidate.id === tabId)
  return tab?.kind === 'browser' && tab.artifact === undefined && tab.template === undefined
}

function samePage(left: string, right: string) {
  try {
    const a = new URL(left)
    const b = new URL(right)
    return a.protocol === b.protocol && a.host === b.host && a.pathname === b.pathname
  } catch {
    return false
  }
}

export async function adoptArtifactTab(input: { sessionId: string; tabId: string; artifactId: string; currentUrl: () => string }) {
  const { sessionId, tabId, artifactId, currentUrl } = input
  if (!isPlainBrowserTab(tabId)) return
  const { artifacts } = await artifactsApi.list()
  const item = artifacts.find((candidate) => candidate.id === artifactId)
  if (!item?.id) return
  const root = artifactRoot(item)
  const opened = await artifactsApi.open(root, item.name)
  const entry = await resolveBrowserInput({
    input: opened.filePath,
    projectRoot: opened.rootDir,
    searchEngine: useSettingsStore.getState().browserSearchEngine,
  })
  if (!entry.ok || !samePage(entry.url, currentUrl()) || !isPlainBrowserTab(tabId)) return
  useWorkspacePanelStore.getState().patchTab(sessionId, tabId, { root, artifact: browserTabArtifact({ ...item, id: item.id }) })
}
