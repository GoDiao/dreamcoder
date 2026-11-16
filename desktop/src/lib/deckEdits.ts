import { artifactsApi } from '../api/artifacts'
import { ApiError } from '../api/client'
import { inArtifactTurn, markArtifactBusy, noteArtifactEdit, type ArtifactEditTarget } from './artifactUserEdits'
import { refreshArtifactShell, takeDeckEdit } from './browserGuests'
import type { DeckEditMessage } from './deckBridge'

async function writeEdits(target: ArtifactEditTarget) {
  const { tabId, root: dir, name } = target
  try {
    for (let edit = await takeDeckEdit(tabId); edit; edit = await takeDeckEdit(tabId)) {
      noteArtifactEdit(target, await artifactsApi.writeSlide({ dir, name, id: edit.id, html: edit.html, previous: edit.previous }))
    }
  } catch (error) {
    while (await takeDeckEdit(tabId)) continue
    throw error
  }
}

export function isDeckConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}

export function flushDeckEdits(target: ArtifactEditTarget): Promise<void> {
  return inArtifactTurn(target, () => writeEdits(target))
}

export function applyDeckEdit(target: ArtifactEditTarget, message: DeckEditMessage): Promise<void> {
  if (message.type === 'busy') {
    markArtifactBusy(target, message.on)
    return Promise.resolve()
  }
  if (message.type === 'edit') return flushDeckEdits(target)
  return inArtifactTurn(target, async () => {
    noteArtifactEdit(target, { ...(await artifactsApi.reorderSlides({ dir: target.root, name: target.name, slides: message.slides })), slides: true })
  })
}

export function deleteDeckSlide(target: ArtifactEditTarget, id: string): Promise<void> {
  markArtifactBusy(target, true)
  const deleting = inArtifactTurn(target, async () => {
    const deleted = await artifactsApi.deleteSlide(target.root, target.name, id)
    await refreshArtifactShell(target.tabId)
    noteArtifactEdit(target, { ...deleted, slides: true })
  })
  markArtifactBusy(target, false)
  return deleting
}
