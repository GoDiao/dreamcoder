import { useEffect } from 'react'
import { artifactsApi } from '../api/artifacts'
import { deckStageRect, getBrowserGuestContentsId } from '../lib/browserGuests'
import { captureBrowserThumbnail } from '../lib/shell'
import { useBrowserStore } from '../stores/browserStore'

const SETTLE_MS = 1_000
const captured = new Set<string>()

export function resetCapturedThumbnails() {
  captured.clear()
}

async function capture(tabId: string, webContentsId: number, deck: boolean) {
  if (!deck) return captureBrowserThumbnail({ webContentsId })
  const clip = await deckStageRect(tabId)
  if (!clip) throw new Error('the deck has no slide to capture')
  return captureBrowserThumbnail({ webContentsId, clip })
}

export function useArtifactThumbnail(tabId: string, artifact: { id: string; mtimeMs: number; deck?: boolean } | undefined) {
  const deck = artifact?.deck === true
  const loaded = useBrowserStore((state) => {
    const page = state.pageByTab[tabId]
    if (page?.ready !== true || page.loading) return false
    return !deck || (page.deck?.mode === 'browse' && page.deck.index === 0)
  })
  const id = artifact?.id
  const mtimeMs = artifact?.mtimeMs

  useEffect(() => {
    if (id === undefined || mtimeMs === undefined || !loaded) return
    const key = `${id}:${mtimeMs}`
    if (captured.has(key)) return
    const timer = setTimeout(() => {
      const webContentsId = getBrowserGuestContentsId(tabId)
      if (webContentsId === null) return
      captured.add(key)
      capture(tabId, webContentsId, deck)
        .then((data) => artifactsApi.putThumbnail(id, mtimeMs, data))
        .catch((error: unknown) => {
          captured.delete(key)
          console.warn('[artifacts] Failed to save a thumbnail', id, error)
        })
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [id, mtimeMs, loaded, tabId, deck])
}
