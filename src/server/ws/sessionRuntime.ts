import type { ServerWebSocket } from 'bun'
import type { WebSocketData } from './handler.js'

export type SessionSlashCommand = {
  name: string
  description: string
  argumentHint?: string
}

export type SessionTitleState = {
  userMessageCount: number
  hasCustomTitle: boolean
  firstUserMessage: string
  allUserMessages: string[]
  startedGenerationCounts: Set<number>
}

export type RuntimeOverride = {
  providerId: string | null
  modelId: string
  /** Per-session reasoning effort; falls back to the global setting when absent. */
  effort?: string
}

export function isSameRuntimeOverride(a: RuntimeOverride, b: RuntimeOverride): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId && a.effort === b.effort
}

export type SessionStreamState = {
  hasReceivedStreamEvents: boolean
  activeBlockTypes: Map<number, 'text' | 'tool_use' | 'thinking'>
  activeToolBlocks: Map<number, { toolName: string; toolUseId: string; inputJson: string; parentToolUseId?: string }>
  pendingLocalCommand?: { name: string; args: string }
  pendingToolBlocks: Map<string, { toolName: string; toolUseId: string; parentToolUseId?: string }>
  toolParentUseIds: Map<string, string>
  lastApiError?: {
    message: string
    code: string
  }
}

type Timer = ReturnType<typeof setTimeout>

/**
 * Everything the WebSocket layer remembers about one desktop session.
 *
 * The object outlives individual client sockets: it survives a disconnect
 * until the reconnect grace period expires, and `/clear` only resets the
 * conversation part of it. Dispose it to forget the session entirely.
 */
export type SessionRuntime = {
  clients: Set<ServerWebSocket<WebSocketData>>
  disconnectCleanupTimer?: Timer
  stopRequested: boolean
  slashCommands?: SessionSlashCommand[]
  title?: SessionTitleState
  stream?: SessionStreamState
  runtimeOverride?: RuntimeOverride
  runtimeTransition?: Promise<void>
  startup?: Promise<void>
  lastStartupWorkDir?: string
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
      stopRequested: false,
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

export function createStreamState(): SessionStreamState {
  return {
    hasReceivedStreamEvents: false,
    activeBlockTypes: new Map(),
    activeToolBlocks: new Map(),
    pendingLocalCommand: undefined,
    pendingToolBlocks: new Map(),
    toolParentUseIds: new Map(),
    lastApiError: undefined,
  }
}

/** Forgets the current conversation (`/clear`) while keeping runtime settings and clients. */
export function resetConversationState(runtime: SessionRuntime): void {
  runtime.slashCommands = undefined
  runtime.title = undefined
  runtime.stream = undefined
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
