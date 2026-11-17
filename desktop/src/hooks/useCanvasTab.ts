import { useEffect } from 'react'
import { toast } from 'sonner'
import { artifactsApi } from '../api/artifacts'
import { inArtifactTurn, markArtifactBusy, noteArtifactEdit, stopArtifactHold } from '../lib/artifactUserEdits'
import { setCanvasMessageHandler, submitBrowserInput } from '../lib/browserGuests'
import { errorMessage } from '../lib/errorMessage'
import type { CanvasAction } from '../lib/canvasBridge'
import { useWorkspacePanelStore, type BrowserTabArtifact } from '../stores/workspacePanelStore'

type CanvasTarget = {
  tabId: string
  sessionId: string | null
  root: string
  name: string
  title: string
  artifact?: BrowserTabArtifact
}

async function handle(target: CanvasTarget, message: CanvasAction) {
  const { tabId, sessionId, root, name } = target
  const editTarget = { tabId, sessionId, root, name, title: target.title }
  if (message.type === 'busy') {
    markArtifactBusy(editTarget, message.on)
    return
  }
  if (message.type === 'move') {
    await inArtifactTurn(editTarget, async () => {
      const { latestMtimeMs, ...written } = await artifactsApi.moveBoard({ dir: root, name, boardId: message.id, x: message.x, y: message.y, width: message.width, height: message.height })
      if (sessionId && target.artifact) {
        useWorkspacePanelStore.getState().patchTab(sessionId, tabId, { artifact: { ...target.artifact, mtimeMs: latestMtimeMs } })
      }
      noteArtifactEdit(editTarget, written)
    })
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
  const title = target?.title
  const artifact = target?.artifact

  useEffect(() => {
    if (tabId === undefined || sessionId === undefined || root === undefined || name === undefined || title === undefined) return
    const current: CanvasTarget = { tabId, sessionId, root, name, title, ...(artifact ? { artifact } : {}) }
    setCanvasMessageHandler(tabId, (message) => {
      handle(current, message).catch((error: unknown) => toast.error(errorMessage(error)))
    })
    return () => {
      setCanvasMessageHandler(tabId, null)
      stopArtifactHold(tabId)
    }
  }, [tabId, sessionId, root, name, title, artifact])
}
