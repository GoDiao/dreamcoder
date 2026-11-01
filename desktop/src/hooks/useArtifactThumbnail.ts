import { useEffect } from 'react'
import { artifactsApi } from '../api/artifacts'
import { getBrowserGuestContentsId } from '../lib/browserGuests'
import { captureBrowserThumbnail } from '../lib/shell'
import { useBrowserStore } from '../stores/browserStore'

const SETTLE_MS = 1_000
const captured = new Set<string>()

export function resetCapturedThumbnails() {
  captured.clear()
}

export function useArtifactThumbnail(tabId: string, artifact: { id: string; mtimeMs: number } | undefined) {
  const loaded = useBrowserStore((state) => {
    const page = state.pageByTab[tabId]
    return page?.ready === true && page.loading === false
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
      captureBrowserThumbnail({ webContentsId })
        .then((data) => artifactsApi.putThumbnail(id, mtimeMs, data))
        .catch((error: unknown) => {
          captured.delete(key)
          console.warn('[artifacts] Failed to save a thumbnail', id, error)
        })
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [id, mtimeMs, loaded, tabId])
}
