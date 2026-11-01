import { useEffect } from 'react'
import { toast } from 'sonner'
import { artifactsApi } from '../api/artifacts'
import { setCanvasMessageHandler, submitBrowserInput } from '../lib/browserGuests'
import { errorMessage } from '../lib/errorMessage'
import type { CanvasMessage } from '../lib/canvasBridge'
import { useWorkspacePanelStore, type BrowserTabArtifact } from '../stores/workspacePanelStore'

type CanvasTarget = {
  tabId: string
  sessionId: string | null
  root: string
  name: string
  artifact?: BrowserTabArtifact
}

async function handle(target: CanvasTarget, message: CanvasMessage) {
  const { tabId, sessionId, root, name } = target
  if (message.type === 'move') {
    const { latestMtimeMs } = await artifactsApi.moveBoard({ dir: root, name, boardId: message.id, x: message.x, y: message.y, width: message.width, height: message.height })
    if (sessionId && target.artifact) {
      useWorkspacePanelStore.getState().patchTab(sessionId, tabId, { artifact: { ...target.artifact, mtimeMs: latestMtimeMs } })
    }
    return
  }
  const opened = await artifactsApi.open(root, name, message.id)
  if (!sessionId) {
    await submitBrowserInput(null, tabId, opened.filePath, opened.rootDir)
    return
  }
  const store = useWorkspacePanelStore.getState()
  const boardTab = store.openTab(sessionId, {
    kind: 'browser',
    url: '',
    root,
    ...(target.artifact && { artifact: { id: target.artifact.id, name, mtimeMs: target.artifact.mtimeMs, board: message.id } }),
  })
  await submitBrowserInput(sessionId, boardTab, opened.filePath, opened.rootDir)
}

export function useCanvasTab(target: CanvasTarget | null) {
  const tabId = target?.tabId
  const sessionId = target?.sessionId
  const root = target?.root
  const name = target?.name
  const artifact = target?.artifact

  useEffect(() => {
    if (tabId === undefined || sessionId === undefined || root === undefined || name === undefined) return
    const current: CanvasTarget = { tabId, sessionId, root, name, ...(artifact ? { artifact } : {}) }
    setCanvasMessageHandler(tabId, (message) => {
      handle(current, message).catch((error: unknown) => toast.error(errorMessage(error)))
    })
    return () => setCanvasMessageHandler(tabId, null)
  }, [tabId, sessionId, root, name, artifact])
}
