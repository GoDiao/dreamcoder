import type { ServerWebSocket } from 'bun'
import type { WebSocketData } from './handler.js'
import type { PermissionMode } from './protocol.js'
import type { OutputPipeline } from '../session/outputPipeline.js'
import type { RuntimeSelection } from '../session/state/types.js'

export type { SessionSlashCommand } from '../session/state/types.js'

export type SessionTitleState = {
  userMessageCount: number
  hasCustomTitle: boolean
  firstUserMessage: string
  allUserMessages: string[]
  startedGenerationCounts: Set<number>
}

type Timer = ReturnType<typeof setTimeout>

export type SessionEndpoint = {
  serverHost: string
  serverPort: number
}

/**
 * Everything the WebSocket layer remembers about one desktop session.
 *
 * The object outlives individual client sockets: it survives a disconnect
 * until the reconnect grace period expires, and `/clear` only resets the
 * conversation part of it. Dispose it to forget the session entirely.
 */
export type SessionRuntime = {
  clients: Set<ServerWebSocket<WebSocketData>>
  pipeline?: OutputPipeline
  endpoint?: SessionEndpoint
  pendingModeRequests: Map<string, PermissionMode>
  answeredPermissions: Set<string>
  disconnectCleanupTimer?: Timer
  title?: SessionTitleState
  runtimeTransition?: Promise<void>
  queuedFromRuntime?: { selection: RuntimeSelection | null }
  startup?: Promise<void>
  prewarm: {
    pending: boolean
    done: boolean
    idleTimer?: Timer
  }
}

const sessionRuntimes = new Map<string, SessionRuntime>()

/** Returns the session's runtime, creating it on first write. */
export function getSessionRuntime(sessionId: string): SessionRuntime {
  let runtime = sessionRuntimes.get(sessionId)
  if (!runtime) {
    runtime = {
      clients: new Set(),
      pendingModeRequests: new Map(),
      answeredPermissions: new Set(),
      prewarm: { pending: false, done: false },
    }
    sessionRuntimes.set(sessionId, runtime)
  }
  return runtime
}

/** Returns the session's runtime without creating one, for read-only callers. */
export function peekSessionRuntime(sessionId: string): SessionRuntime | undefined {
  return sessionRuntimes.get(sessionId)
}

/** Forgets the current conversation (`/clear`) while keeping runtime settings and clients. */
export function resetConversationState(runtime: SessionRuntime): void {
  runtime.title = undefined
  runtime.answeredPermissions.clear()
  runtime.pipeline?.resetStream()
}

export function clearPrewarmState(runtime: SessionRuntime): void {
  runtime.prewarm.pending = false
  runtime.prewarm.done = false
  if (runtime.prewarm.idleTimer) {
    clearTimeout(runtime.prewarm.idleTimer)
    runtime.prewarm.idleTimer = undefined
  }
}

/** Stops the session's timers and forgets it. Returns the disposed runtime, if any. */
export function disposeSessionRuntime(sessionId: string): SessionRuntime | undefined {
  const runtime = sessionRuntimes.get(sessionId)
  if (!runtime) return undefined
  if (runtime.disconnectCleanupTimer) clearTimeout(runtime.disconnectCleanupTimer)
  clearPrewarmState(runtime)
  runtime.pipeline?.detach()
  sessionRuntimes.delete(sessionId)
  return runtime
}

export function getConnectedSessionIds(): string[] {
  return Array.from(sessionRuntimes)
    .filter(([, runtime]) => runtime.clients.size > 0)
    .map(([sessionId]) => sessionId)
}

export function disposeAllSessionRuntimes(): void {
  for (const sessionId of Array.from(sessionRuntimes.keys())) {
    disposeSessionRuntime(sessionId)
  }
}
