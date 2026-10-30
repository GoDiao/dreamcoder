import { listUiPages } from '../../utils/uiPages.js'
import { diagnosticsService } from '../services/diagnosticsService.js'
import { sessionService } from '../services/sessionService.js'
import { conversationService } from '../services/conversationService.js'
import { SettingsService } from '../services/settingsService.js'
import type { SessionStateStore } from './state/store.js'
import type { RestoredSessionFields } from './state/types.js'

const settingsService = new SettingsService()

export async function restoreSessionFields(sessionId: string): Promise<RestoredSessionFields | null> {
  const info = await sessionService.getSessionRestoreInfo(sessionId).catch(() => null)
  const dataDir = await sessionService.getSessionDataDir(sessionId).catch(() => null)
  const uiPages = dataDir ? await listUiPages(dataDir) : []
  const permissionMode = info?.permissionMode ?? await settingsService.getPermissionMode().catch(() => 'default' as const)
  return {
    permissionMode,
    runtime: info?.runtime ?? null,
    title: info?.title ?? { text: null, source: null },
    workspace: {
      workDir: info?.workDir ?? '',
      projectRoot: info?.projectRoot ?? null,
      ...(info?.repository ? { repository: info.repository } : {}),
      workDirExists: info?.workDirExists ?? false,
    },
    uiPages,
  }
}

export function installSessionPersistence(store: SessionStateStore): () => void {
  store.setRestorer(restoreSessionFields)
  const stopWatchingExits = conversationService.onProcessExited(({ sessionId }) => {
    const title = store.peek(sessionId)?.title
    if (title?.source !== 'custom' || !title.text) return
    recordWrite(sessionId, 'title', sessionService.restoreCustomTitle(sessionId, title.text).then(() => {}))
  })
  const unsubscribe = store.subscribe(({ sessionId, event }) => {
    if (event.type === 'permission_desired_changed') {
      recordWrite(sessionId, 'permissionMode', sessionService.appendSessionPermissionMode(sessionId, event.mode))
    } else if (event.type === 'runtime_desired_changed') {
      recordWrite(sessionId, 'runtime', sessionService.appendSessionRuntimeConfig(sessionId, event.selection))
    }
  })
  return () => {
    stopWatchingExits()
    unsubscribe()
    store.setRestorer(null)
  }
}

function recordWrite(sessionId: string, field: string, write: Promise<void>): void {
  void write.catch((err) => {
    void diagnosticsService.recordEvent({
      type: 'session_state_write_failed',
      severity: 'warn',
      sessionId,
      summary: err instanceof Error ? err.message : String(err),
      details: { field, error: err },
    })
  })
}
