import { artifactsApi } from '../api/artifacts'
import { useArtifactStore } from '../stores/artifactStore'
import { useWorkspaceChatContextStore } from '../stores/workspaceChatContextStore'
import { artifactEditReference } from './artifactEditReference'
import { refreshArtifactShell } from './browserGuests'

export type ArtifactEditTarget = { tabId: string; root: string; name: string; title: string; sessionId: string | null }

export const ARTIFACT_HOLD_RENEW_MS = 5_000

const tasks = new Map<string, Promise<unknown>>()
const renewals = new Map<string, ReturnType<typeof setInterval>>()

function queue(tabId: string, task: () => Promise<void>): Promise<void> {
  const next = (tasks.get(tabId) ?? Promise.resolve()).then(task)
  tasks.set(tabId, next.catch(() => undefined))
  return next
}

export function inArtifactTurn(target: ArtifactEditTarget, task: () => Promise<void>): Promise<void> {
  return queue(target.tabId, async () => {
    try {
      await task()
    } catch (error) {
      await refreshArtifactShell(target.tabId)
      throw error
    }
  })
}

function hold(target: ArtifactEditTarget) {
  artifactsApi.holdEdit(target.root, target.name, target.tabId).catch((error: unknown) => {
    console.warn('[artifacts] could not hold the artifact while the user edits it', target.name, error)
  })
}

export function stopArtifactHold(tabId: string) {
  clearInterval(renewals.get(tabId))
  renewals.delete(tabId)
}

export function markArtifactBusy(target: ArtifactEditTarget, on: boolean) {
  stopArtifactHold(target.tabId)
  if (on) {
    hold(target)
    renewals.set(target.tabId, setInterval(() => hold(target), ARTIFACT_HOLD_RENEW_MS))
    return
  }
  queue(target.tabId, async () => {
    if (renewals.has(target.tabId)) return
    await artifactsApi.releaseEdit(target.root, target.name, target.tabId)
  }).catch((error: unknown) => {
    console.warn('[artifacts] could not release the artifact after the user edited it', target.name, error)
  })
}

export function noteArtifactEdit(target: ArtifactEditTarget, change: { dir: string; files: string[]; slides?: boolean }) {
  useArtifactStore.getState().noteArtifactActivity()
  if (!target.sessionId) return
  const store = useWorkspaceChatContextStore.getState()
  const earlier = store.referencesBySession[target.sessionId]?.find((reference) => reference.kind === 'artifact-edit' && reference.path === change.dir)
  store.addReference(target.sessionId, artifactEditReference({ ...change, title: target.title }, earlier?.artifactEdit))
}
