import type { AdapterHttpClient } from './http-client.js'
import type { SessionEntry, SessionStore } from './session-store.js'
import type { ServerMessage, WsBridge } from './ws-bridge.js'

type BridgeSessionOps = Pick<
  WsBridge,
  | 'connectSession'
  | 'getSessionId'
  | 'hasSession'
  | 'isSessionOpen'
  | 'onServerMessage'
  | 'resetSession'
  | 'waitForOpen'
>

type RestoreStoredSessionBindingOptions = {
  chatId: string
  bridge: BridgeSessionOps
  sessionStore: Pick<SessionStore, 'delete' | 'get'>
  httpClient: Pick<AdapterHttpClient, 'sessionExists'>
  onServerMessage: (msg: ServerMessage) => void | Promise<void>
  logPrefix: string
  clearTransientState?: () => void
}

function resetStaleBridge(
  chatId: string,
  bridge: BridgeSessionOps,
  clearTransientState?: () => void,
): void {
  if (!bridge.hasSession(chatId)) return
  bridge.resetSession(chatId)
  clearTransientState?.()
}

export async function restoreStoredSessionBinding({
  chatId,
  bridge,
  sessionStore,
  httpClient,
  onServerMessage,
  logPrefix,
  clearTransientState,
}: RestoreStoredSessionBindingOptions): Promise<SessionEntry | null> {
  const stored = sessionStore.get(chatId)
  if (!stored) {
    resetStaleBridge(chatId, bridge, clearTransientState)
    return null
  }

  const currentSessionId = bridge.getSessionId(chatId)
  if (currentSessionId && currentSessionId !== stored.sessionId) {
    resetStaleBridge(chatId, bridge, clearTransientState)
  }

  if (bridge.isSessionOpen(chatId, stored.sessionId)) {
    return stored
  }

  let exists = true
  try {
    exists = await httpClient.sessionExists(stored.sessionId)
  } catch (err) {
    console.warn(
      `${logPrefix} Failed to verify stored session ${stored.sessionId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  if (!exists) {
    sessionStore.delete(chatId)
    const hadBridgeSession = bridge.hasSession(chatId)
    resetStaleBridge(chatId, bridge, clearTransientState)
    if (!hadBridgeSession) clearTransientState?.()
    return null
  }

  bridge.connectSession(chatId, stored.sessionId)
  bridge.onServerMessage(chatId, onServerMessage)
  const opened = await bridge.waitForOpen(chatId)
  return opened ? stored : null
}
