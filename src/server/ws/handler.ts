import type { ServerWebSocket } from 'bun'
import type { ClientKind, ClientMessage, PermissionMode, ServerMessage } from './protocol.js'
import { isPermissionMode } from '../services/permissionModes.js'
import type { ExternalPermissionMode } from '../../types/permissions.js'
import * as os from 'node:os'
import {
  ConversationStartupError,
  conversationService,
  type ProcessLifecycleEvent,
} from '../services/conversationService.js'
import { sessionService } from '../services/sessionService.js'
import { SettingsService } from '../services/settingsService.js'
import { ProviderService } from '../services/providerService.js'
import { diagnosticsService } from '../services/diagnosticsService.js'
import { deriveTitle, generateTitle, saveAiTitle } from '../services/titleService.js'
import { parseSlashCommand } from '../../utils/slashCommandParsing.js'
import {
  extractLocalCommandOutput,
  isGoalCommandOutput,
  parseLocalCommand,
} from '../transcript/classify.js'
import { shouldCreateWorktreeForSessionLaunch } from '../services/repositoryLaunchService.js'
import { EFFORT_LEVELS } from '../api/models.js'
import { resolveProviderDefaultModel } from '../services/providerRuntimeEnv.js'
import {
  clearPrewarmState,
  disposeAllSessionRuntimes,
  disposeSessionRuntime,
  getConnectedSessionIds,
  getSessionRuntime,
  peekSessionRuntime,
  resetConversationState,
  type SessionEndpoint,
  type SessionSlashCommand,
} from './sessionRuntime.js'
import { sessionStateStore, type SessionStateChange } from '../session/state/store.js'
import type { RestartReason, RuntimeSelection, SessionState } from '../session/state/types.js'
import { installSessionPersistence } from '../session/persistence.js'
import { OutputPipeline } from '../session/outputPipeline.js'
import { normalizeSessionSlashCommands, translateCliOutput } from '../session/translate.js'

const settingsService = new SettingsService()
const providerService = new ProviderService()
const store = sessionStateStore

export type { SessionSlashCommand } from './sessionRuntime.js'

const CLIENT_DISCONNECT_CLEANUP_MS = 30_000
const PENDING_PERMISSION_DISCONNECT_CLEANUP_MS = 30 * 60_000
const DEFAULT_PREWARM_IDLE_TIMEOUT_MS = 5 * 60_000
const MESSAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

installSessionPersistence(store)
store.subscribe(relayStateChange)
conversationService.onProcessEvent(handleProcessEvent)

async function sendRepositoryStartupStatus(
  sessionId: string,
  reason: 'user_message' | 'prewarm_session',
): Promise<void> {
  if (reason !== 'user_message') return

  const launchInfo = await sessionService.getSessionLaunchInfo(sessionId).catch(() => null)
  const repository = launchInfo?.repository
  if (!repository) return

  if (shouldCreateWorktreeForSessionLaunch(launchInfo)) {
    store.apply(sessionId, { type: 'process_detail_reported', detail: 'creating_worktree' })
  }
}

export function getSlashCommands(sessionId: string): SessionSlashCommand[] {
  return store.peek(sessionId)?.slashCommands ?? []
}

export function noteSessionRenamed(sessionId: string, title: string): void {
  const runtime = peekSessionRuntime(sessionId)
  if (runtime?.title) runtime.title.hasCustomTitle = true
  if (!store.peek(sessionId)) return
  store.apply(sessionId, { type: 'title_changed', text: title, source: 'custom' })
}

export function getSessionState(sessionId: string): SessionState | undefined {
  return store.peek(sessionId)
}

export type WebSocketData = {
  sessionId: string
  connectedAt: number
  channel: 'client' | 'sdk'
  clientKind: ClientKind
  sdkToken: string | null
  serverPort: number
  serverHost: string
}

export const handleWebSocket = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const { sessionId, channel, sdkToken } = ws.data

    if (channel === 'sdk') {
      if (!conversationService.authorizeSdkConnection(sessionId, sdkToken)) {
        console.warn(`[WS] Rejected SDK connection for session: ${sessionId}`)
        ws.close(1008, 'Invalid SDK token')
        return
      }

      conversationService.attachSdkConnection(sessionId, ws)
      console.log(`[WS] SDK connected for session: ${sessionId}`)
      return
    }

    console.log(`[WS] Client connected for session: ${sessionId}`)

    const runtime = getSessionRuntime(sessionId)
    if (runtime.disconnectCleanupTimer) {
      clearTimeout(runtime.disconnectCleanupTimer)
      runtime.disconnectCleanupTimer = undefined
    }

    sendMessage(ws, { type: 'connected', sessionId })
    runtime.clients.add(ws)
    runtime.endpoint = { serverHost: ws.data.serverHost, serverPort: ws.data.serverPort }
    store.apply(sessionId, { type: 'clients_changed', count: runtime.clients.size })
    ensurePipelineAttached(sessionId)
    void sendSnapshot(ws)
  },

  message(ws: ServerWebSocket<WebSocketData>, rawMessage: string | Buffer) {
    if (ws.data.channel === 'sdk') {
      const payload = typeof rawMessage === 'string' ? rawMessage : rawMessage.toString()
      conversationService.handleSdkPayload(ws.data.sessionId, payload, ws.data.sdkToken)
      return
    }

    try {
      const message = JSON.parse(
        typeof rawMessage === 'string' ? rawMessage : rawMessage.toString()
      ) as ClientMessage

      switch (message.type) {
        case 'user_message':
          handleUserMessage(ws, message).catch((err) => {
            void diagnosticsService.recordEvent({
              type: 'ws_user_message_failed',
              severity: 'error',
              sessionId: ws.data.sessionId,
              summary: err instanceof Error ? err.message : String(err),
              details: err,
            })
            console.error(`[WS] Unhandled error in handleUserMessage:`, err)
          })
          break

        case 'permission_response':
          handlePermissionResponse(ws, message)
          break

        case 'set_permission_mode':
          handleSetPermissionMode(ws, message)
          break

        case 'set_runtime_config':
          void handleSetRuntimeConfig(ws, message)
          break

        case 'request_snapshot':
          void sendSnapshot(ws)
          break

        case 'prewarm_session':
          void handlePrewarmSession(ws)
          break

        case 'stop_generation':
          handleStopGeneration(ws)
          break

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage))
          break

        default:
          sendError(ws, `Unknown message type: ${(message as any).type}`, 'UNKNOWN_TYPE')
      }
    } catch (error) {
      sendError(ws, `Invalid message format: ${error}`, 'PARSE_ERROR')
    }
  },

  close(ws: ServerWebSocket<WebSocketData>, code: number, reason: string) {
    const { sessionId, channel } = ws.data

    if (channel === 'sdk') {
      console.log(`[WS] SDK disconnected from session: ${sessionId} (${code}: ${reason})`)
      conversationService.detachSdkConnection(sessionId, ws.data.sdkToken)
      return
    }

    console.log(`[WS] Client disconnected from session: ${sessionId} (${code}: ${reason})`)
    if (!removeActiveClient(sessionId, ws)) {
      console.log(`[WS] Ignoring stale client disconnect for session: ${sessionId}`)
      return
    }
    store.apply(sessionId, { type: 'clients_changed', count: peekSessionRuntime(sessionId)?.clients.size ?? 0 })

    if (hasActiveClients(sessionId)) {
      return
    }

    const cleanupDelayMs = getDisconnectCleanupDelayMs(sessionId)
    const cleanupTimer = setTimeout(() => {
      const current = peekSessionRuntime(sessionId)
      if (current) current.disconnectCleanupTimer = undefined
      if (!hasActiveClients(sessionId)) {
        console.log(`[WS] Session ${sessionId} not reconnected after ${cleanupDelayMs}ms, stopping CLI subprocess`)
        conversationService.stopSession(sessionId)
        disposeSessionRuntime(sessionId)
        store.dispose(sessionId)
        conversationService.forgetSession(sessionId)
      }
    }, cleanupDelayMs)
    getSessionRuntime(sessionId).disconnectCleanupTimer = cleanupTimer
  },

  drain(ws: ServerWebSocket<WebSocketData>) {
  },
}

function getPipeline(sessionId: string): OutputPipeline {
  const runtime = getSessionRuntime(sessionId)
  runtime.pipeline ??= new OutputPipeline(sessionId, conversationService, {
    broadcast: broadcastToSession,
    apply: (id, event) => {
      store.apply(id, event)
    },
    onRawMessage: handleRawCliMessage,
    onTurnResult: triggerTitleGeneration,
  })
  return runtime.pipeline
}

function ensurePipelineAttached(sessionId: string): void {
  if (!conversationService.hasSession(sessionId)) return
  const generation = conversationService.getGeneration(sessionId)
  const pipeline = getPipeline(sessionId)
  if (pipeline.isAttached(generation)) return
  pipeline.attach(generation)
  if (!peekSessionRuntime(sessionId)?.prewarm.done) pipeline.gate = undefined
}

function handleProcessEvent(event: ProcessLifecycleEvent): void {
  const { sessionId, generation, phase } = event
  if (phase === 'starting') getPipeline(sessionId).attach(generation)
  const apply = phase === 'stopped' || phase === 'failed' ? store.applyIfPresent.bind(store) : store.apply.bind(store)
  apply(sessionId, {
    type: 'process_phase_changed',
    phase,
    generation,
    ...(event.error ? { error: event.error } : {}),
  })
  if ((phase === 'starting' || phase === 'running') && isPermissionMode(event.permissionMode)) {
    store.apply(sessionId, { type: 'permission_effective_reported', mode: event.permissionMode })
  }
  if (phase === 'stopped' || phase === 'failed') {
    peekSessionRuntime(sessionId)?.pendingModeRequests.clear()
  }
}

function handleRawCliMessage(sessionId: string, cliMsg: any): void {
  if (cliMsg.type === 'system' && cliMsg.subtype === 'init') {
    recordInitMetadata(sessionId, cliMsg)
    return
  }
  if (cliMsg.type !== 'control_response') return
  const requestId = cliMsg.response?.request_id
  const runtime = peekSessionRuntime(sessionId)
  const mode = typeof requestId === 'string' ? runtime?.pendingModeRequests.get(requestId) : undefined
  if (!runtime || !mode) return
  runtime.pendingModeRequests.delete(requestId)
  if (cliMsg.response?.subtype === 'error') {
    const message = String(cliMsg.response.error || `The CLI did not switch to ${mode}`)
    store.apply(sessionId, { type: 'permission_change_rejected', mode, message })
    void diagnosticsService.recordEvent({
      type: 'permission_mode_rejected',
      severity: 'warn',
      sessionId,
      summary: message,
      details: { mode },
    })
  }
}

function recordInitMetadata(sessionId: string, cliMsg: any): void {
  if (typeof cliMsg.cwd !== 'string' || !cliMsg.cwd.trim()) return
  conversationService.updateSessionWorkDir(sessionId, cliMsg.cwd)
  void sessionService.appendSessionMetadata(sessionId, { workDir: cliMsg.cwd }).catch(() => {})
}

async function sendSnapshot(ws: ServerWebSocket<WebSocketData>): Promise<void> {
  const { sessionId } = ws.data
  const state = await store.ensure(sessionId)
  if (!peekSessionRuntime(sessionId)?.clients.has(ws)) return
  sendMessage(ws, { type: 'session_snapshot', state: store.peek(sessionId) ?? state })
}

function relayStateChange({ sessionId, event, patch, previous, state }: SessionStateChange): void {
  if (event.type === 'permission_request_resolved' && patch.pendingPermissions) {
    broadcastToSession(sessionId, {
      type: 'permission_resolved',
      requestId: event.requestId,
      allowed: event.allowed,
      by: event.by,
    })
  }

  broadcastToSession(sessionId, { type: 'session_patch', version: state.version, changes: patch })

  if (patch.turn && previous.turn.phase !== 'idle' && state.turn.phase === 'idle') {
    peekSessionRuntime(sessionId)?.answeredPermissions.clear()
    runQueuedRestart(sessionId)
  }
}

async function handleUserMessage(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'user_message' }>
) {
  const { sessionId } = ws.data

  const runtime = peekSessionRuntime(sessionId)
  if (runtime) {
    if (runtime.pipeline) runtime.pipeline.stream.stopRequested = false
    clearPrewarmState(runtime)
  }

  const desktopSlashCommand = getDesktopSlashCommand(message.content)
  if (desktopSlashCommand?.commandName === 'clear' && desktopSlashCommand.args.trim()) {
    sendMessage(ws, {
      type: 'error',
      message: 'The /clear command does not accept arguments.',
      code: 'INVALID_SLASH_COMMAND_ARGS',
    })
    return
  }

  if (desktopSlashCommand?.commandName === 'clear') {
    await handleDesktopClearCommand(ws)
    return
  }

  const initialRuntimeTransition = await waitForRuntimeTransitionBeforeUserTurn(sessionId)
  if (!initialRuntimeTransition.ok) return

  let titleState = peekSessionRuntime(sessionId)?.title
  if (!titleState) {
    const restored = await store.ensure(sessionId)
    titleState = {
      userMessageCount: 0,
      hasCustomTitle: restored.title.source === 'custom',
      firstUserMessage: '',
      allUserMessages: [],
      startedGenerationCounts: new Set<number>(),
    }
    getSessionRuntime(sessionId).title = titleState
  }
  const titleInput = getTitleInputForUserMessage(message.content, desktopSlashCommand)
  if (titleInput) {
    titleState.userMessageCount++
    titleState.allUserMessages.push(titleInput)
    if (titleState.userMessageCount === 1) {
      titleState.firstUserMessage = titleInput
    }
    triggerTitleGeneration(sessionId)
  }

  try {
    await ensureCliSessionStarted(ws.data, sessionId, 'user_message')
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const code =
      err instanceof ConversationStartupError ? err.code : 'CLI_START_FAILED'
    console.error(`[WS] CLI start failed for ${sessionId}: ${errMsg}`)
    broadcastToSession(sessionId, {
      type: 'error',
      message: await buildSessionStartupDiagnosticMessage(sessionId, errMsg),
      code,
      retryable:
        err instanceof ConversationStartupError ? err.retryable : false,
    })
    return
  }

  const startupRuntimeTransition = await waitForRuntimeTransitionBeforeUserTurn(sessionId)
  if (!startupRuntimeTransition.ok) return

  const shouldForwardCurrentTurnLocalCommand =
    createCurrentTurnLocalCommandForwarder(desktopSlashCommand)

  ensurePipelineAttached(sessionId)
  const pipeline = getPipeline(sessionId)
  pipeline.gate = (cliMsg) =>
    (cliMsg.type === 'result' && cliMsg.is_error) || shouldForwardCurrentTurnLocalCommand(cliMsg)

  const sent = conversationService.sendMessage(
    sessionId,
    message.content,
    message.attachments,
    typeof message.id === 'string' && MESSAGE_ID_PATTERN.test(message.id) ? message.id : undefined,
  )
  if (!sent) {
    broadcastToSession(sessionId, {
      type: 'error',
      message: 'CLI process is not running. The session may have ended or the process crashed.',
      code: 'CLI_NOT_RUNNING',
    })
    return
  }

  pipeline.gate = undefined
  store.apply(sessionId, { type: 'turn_started', at: Date.now() })
}

async function handleDesktopClearCommand(
  ws: ServerWebSocket<WebSocketData>,
) {
  const { sessionId } = ws.data

  const workDir = conversationService.getSessionWorkDir(sessionId)
  conversationService.stopSession(sessionId)
  const runtime = peekSessionRuntime(sessionId)
  if (runtime) resetConversationState(runtime)
  store.apply(sessionId, { type: 'conversation_cleared' })

  try {
    await sessionService.clearSessionTranscript(sessionId, workDir || undefined)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    broadcastToSession(sessionId, {
      type: 'error',
      message: errMsg,
      code: 'SESSION_CLEAR_FAILED',
    })
    return
  }

  broadcastToSession(sessionId, {
    type: 'system_notification',
    subtype: 'session_cleared',
    message: 'Conversation cleared',
  })
  broadcastToSession(sessionId, {
    type: 'message_complete',
    usage: { input_tokens: 0, output_tokens: 0 },
  })
}

async function handlePrewarmSession(ws: ServerWebSocket<WebSocketData>) {
  const { sessionId } = ws.data
  if (conversationService.hasSession(sessionId) || peekSessionRuntime(sessionId)?.startup) {
    return
  }

  const launchInfo = await sessionService.getSessionLaunchInfo(sessionId).catch(() => null)
  if (launchInfo?.repository) {
    console.log(`[WS] Skipping prewarm for pending repository launch session ${sessionId}`)
    return
  }

  getSessionRuntime(sessionId).prewarm.pending = true
  void ensureCliSessionStarted(ws.data, sessionId, 'prewarm_session')
    .then(() => {
      const runtime = peekSessionRuntime(sessionId)
      if (!runtime?.prewarm.pending) return
      runtime.prewarm.pending = false
      markPrewarmed(sessionId)
    })
    .catch((err) => {
      const runtime = peekSessionRuntime(sessionId)
      if (runtime) runtime.prewarm.pending = false
      console.warn(
        `[WS] Prewarm failed for ${sessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    })
}

function handlePermissionResponse(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'permission_response' }>
) {
  const { sessionId } = ws.data
  const runtime = getSessionRuntime(sessionId)
  const pending = store.peek(sessionId)?.pendingPermissions.find((request) => request.requestId === message.requestId)
  if (!pending) {
    const answered = runtime.answeredPermissions.has(message.requestId)
    sendMessage(ws, {
      type: 'error',
      message: answered
        ? 'This permission request was already answered.'
        : 'This permission request is no longer active.',
      code: answered ? 'PERMISSION_ALREADY_RESOLVED' : 'PERMISSION_REQUEST_EXPIRED',
    })
    return
  }
  conversationService.respondToPermission(
    sessionId,
    message.requestId,
    message.allowed,
    message.rule,
    message.updatedInput,
    { toolName: pending.toolName, suggestions: pending.suggestions },
  )
  runtime.answeredPermissions.add(message.requestId)
  store.apply(sessionId, {
    type: 'permission_request_resolved',
    requestId: message.requestId,
    allowed: message.allowed,
    by: ws.data.clientKind,
  })
  console.log(`[WS] Permission response for ${message.requestId}: ${message.allowed}`)
}

// The wire type mirrors the CLI's modes; fail to compile if they drift apart.
type SameModes<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const permissionModesMatchCli: SameModes<PermissionMode, ExternalPermissionMode> = true
void permissionModesMatchCli

export async function resolveSessionPermissionMode(sessionId: string): Promise<PermissionMode> {
  return (await store.read(sessionId)).permission.desired
}

export async function resolveSessionRuntimeSelection(sessionId: string): Promise<RuntimeSelection | null> {
  return (await store.read(sessionId)).runtime.desired
}

function handleSetPermissionMode(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'set_permission_mode' }>
) {
  const { sessionId } = ws.data
  const mode = message.mode
  if (!isPermissionMode(mode)) {
    sendMessage(ws, {
      type: 'error',
      message: `Unknown permission mode: ${String(mode)}`,
      code: 'INVALID_PERMISSION_MODE',
    })
    return
  }

  const runtime = getSessionRuntime(sessionId)
  store.apply(sessionId, { type: 'permission_desired_changed', mode })

  const pendingStartup = runtime.startup
  if (!conversationService.hasSession(sessionId) && (pendingStartup || runtime.runtimeTransition)) {
    void enqueueRuntimeTransition(sessionId, async () => {
      await pendingStartup?.catch(() => undefined)
      await applyPermissionModeToCli(ws.data, sessionId, { inTransition: true })
    })
  } else {
    void applyPermissionModeToCli(ws.data, sessionId)
  }
}

async function applyPermissionModeToCli(
  endpoint: SessionEndpoint,
  sessionId: string,
  { inTransition = false } = {},
): Promise<void> {
  if (!conversationService.hasSession(sessionId)) return
  const { desired: mode, effective: cliMode } = store.get(sessionId).permission
  if (!cliMode || cliMode === mode) return

  if (mode === 'bypassPermissions' || cliMode === 'bypassPermissions') {
    if (deferRestartUntilTurnEnds(endpoint, sessionId, 'permission')) return
    if (inTransition) {
      await restartSession(endpoint, sessionId, 'permission')
    } else {
      await enqueueRuntimeTransition(sessionId, () =>
        applyPermissionModeToCli(endpoint, sessionId, { inTransition: true }),
      )
    }
    return
  }
  const requestId = conversationService.setPermissionMode(sessionId, mode)
  if (requestId) getSessionRuntime(sessionId).pendingModeRequests.set(requestId, mode)
}

function deferRestartUntilTurnEnds(endpoint: SessionEndpoint, sessionId: string, reason: RestartReason): boolean {
  if (store.get(sessionId).turn.phase === 'idle' || !conversationService.hasSession(sessionId)) return false
  getSessionRuntime(sessionId).endpoint = endpoint
  store.apply(sessionId, { type: 'restart_queued', reason })
  console.log(`[WS] Deferring CLI restart for ${sessionId} until the current turn ends`)
  return true
}

function runQueuedRestart(sessionId: string): void {
  const reason = store.peek(sessionId)?.process.pendingRestart
  const endpoint = peekSessionRuntime(sessionId)?.endpoint
  if (!reason || !endpoint) return
  void enqueueRuntimeTransition(sessionId, async () => {
    if (!store.peek(sessionId)?.process.pendingRestart) return
    const runtime = peekSessionRuntime(sessionId)
    const needed = queuedRestartStillNeeded(sessionId)
    if (runtime) runtime.queuedFromRuntime = undefined
    if (!needed) {
      store.apply(sessionId, { type: 'restart_cancelled' })
      return
    }
    await restartSession(endpoint, sessionId, reason)
  })
}

function queuedRestartStillNeeded(sessionId: string): boolean {
  const state = store.peek(sessionId)
  if (!state) return false
  const { desired, effective } = state.permission
  const permissionNeedsRestart = !!effective && desired !== effective &&
    (desired === 'bypassPermissions' || effective === 'bypassPermissions')
  const baseline = peekSessionRuntime(sessionId)?.queuedFromRuntime
  const runtimeNeedsRestart = !!baseline && !isSameOptionalRuntimeSelection(baseline.selection, state.runtime.desired)
  return permissionNeedsRestart || runtimeNeedsRestart
}

function isSameRuntimeSelection(a: RuntimeSelection, b: RuntimeSelection): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId && a.effort === b.effort
}

function isSameOptionalRuntimeSelection(a: RuntimeSelection | null, b: RuntimeSelection | null): boolean {
  if (!a || !b) return a === b
  return isSameRuntimeSelection(a, b)
}

async function handleSetRuntimeConfig(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'set_runtime_config' }>
) {
  const { sessionId } = ws.data
  const modelId = typeof message.modelId === 'string' ? message.modelId.trim() : ''
  const effort =
    typeof message.effort === 'string' &&
    (EFFORT_LEVELS as readonly string[]).includes(message.effort)
      ? message.effort
      : undefined
  // An empty model with an effort means "keep following the default provider
  // and model, only change the effort".
  if (!modelId && !effort) {
    sendMessage(ws, {
      type: 'error',
      message: 'Runtime model selection is invalid.',
      code: 'RUNTIME_CONFIG_INVALID',
    })
    return
  }

  const nextSelection: RuntimeSelection = {
    providerId: modelId ? message.providerId ?? null : null,
    modelId,
    ...(effort ? { effort } : {}),
  }
  const runtime = getSessionRuntime(sessionId)
  const previousSelection = store.get(sessionId).runtime.desired
  store.apply(sessionId, { type: 'runtime_desired_changed', selection: nextSelection })

  if (previousSelection && isSameRuntimeSelection(previousSelection, nextSelection)) {
    return
  }

  if (!conversationService.hasSession(sessionId)) {
    const pendingStartup = runtime.startup
    if (pendingStartup) {
      await enqueueRuntimeTransition(sessionId, async () => {
        await pendingStartup.catch(() => undefined)
        const current = store.peek(sessionId)?.runtime.desired
        if (
          !current ||
          !isSameRuntimeSelection(current, nextSelection) ||
          !conversationService.hasSession(sessionId)
        ) {
          return
        }
        await restartSession(ws.data, sessionId, 'runtime')
      })
    }
    return
  }

  if (store.get(sessionId).turn.phase !== 'idle' && !runtime.queuedFromRuntime) {
    runtime.queuedFromRuntime = { selection: previousSelection }
  }
  if (deferRestartUntilTurnEnds(ws.data, sessionId, 'runtime')) return

  await enqueueRuntimeTransition(sessionId, () =>
    restartSession(ws.data, sessionId, 'runtime'),
  )
}

async function restartSession(
  endpoint: SessionEndpoint,
  sessionId: string,
  reason: RestartReason,
): Promise<void> {
  try {
    const workDir = conversationService.getSessionWorkDir(sessionId) || store.get(sessionId).workspace.workDir
    const generation = conversationService.getGeneration(sessionId)
    conversationService.stopSession(sessionId)
    store.apply(sessionId, { type: 'process_phase_changed', phase: 'restarting', generation })

    const runtimeSettings = await getRuntimeSettings(sessionId)
    await conversationService.startSession(sessionId, workDir, buildSdkUrl(endpoint, sessionId), runtimeSettings)
    console.log(`[WS] Restarted CLI for ${sessionId} (${reason})`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const state = store.peek(sessionId)
    void diagnosticsService.recordEvent({
      type: reason === 'permission' ? 'permission_restart_failed' : 'runtime_config_restart_failed',
      severity: 'error',
      sessionId,
      summary: errMsg,
      details: {
        reason,
        permissionMode: state?.permission.desired,
        runtimeSelection: state?.runtime.desired,
        error: err,
      },
    })
    console.error(`[WS] Failed to restart CLI for ${sessionId} (${reason}): ${errMsg}`)
    broadcastToSession(sessionId, {
      type: 'error',
      message: await buildSessionStartupDiagnosticMessage(
        sessionId,
        reason === 'permission'
          ? `Failed to restart session with new permission mode: ${errMsg}`
          : `Failed to switch provider/model: ${errMsg}`,
      ),
      code: 'CLI_RESTART_FAILED',
    })
  }
}

function buildSdkUrl(endpoint: SessionEndpoint, sessionId: string): string {
  return `ws://${endpoint.serverHost}:${endpoint.serverPort}/sdk/${sessionId}` +
    `?token=${encodeURIComponent(crypto.randomUUID())}`
}

function handleStopGeneration(ws: ServerWebSocket<WebSocketData>) {
  const { sessionId } = ws.data
  console.log(`[WS] Stop generation requested for session: ${sessionId}`)

  getPipeline(sessionId).stream.stopRequested = true

  if (conversationService.hasSession(sessionId)) {
    const generation = conversationService.getGeneration(sessionId)
    conversationService.sendInterrupt(sessionId)
    store.apply(sessionId, { type: 'process_phase_changed', phase: 'stopping', generation })

    setTimeout(() => {
      if (conversationService.getGeneration(sessionId) === generation && conversationService.hasSession(sessionId)) {
        console.log(`[WS] Force-killing CLI subprocess for session: ${sessionId}`)
        conversationService.stopSession(sessionId, generation)
      }
    }, 3_000)
  }

  store.apply(sessionId, { type: 'turn_ended' })
}

function triggerTitleGeneration(sessionId: string): void {
  const runtime = peekSessionRuntime(sessionId)
  const state = runtime?.title
  if (!runtime || !state || state.hasCustomTitle) return

  const count = state.userMessageCount

  if (count !== 1 && count !== 3) return
  if (state.startedGenerationCounts.has(count)) return
  state.startedGenerationCounts.add(count)

  const text = count === 1
    ? state.firstUserMessage
    : state.allUserMessages.join('\n')
  const runtimeProviderId = store.peek(sessionId)?.runtime.desired?.providerId
  const runtimeModel = store.peek(sessionId)?.runtime.desired?.modelId

  void (async () => {
    try {
      if (count === 1) {
        const placeholder = deriveTitle(text)
        if (placeholder) {
          const saved = await saveAiTitle(sessionId, placeholder)
          if (!saved) {
            state.hasCustomTitle = true
            return
          }
          store.applyIfPresent(sessionId, { type: 'title_changed', text: placeholder, source: 'ai' })
        }
      }

      const aiTitle = await generateTitle(text, runtimeProviderId, runtimeModel)
      if (aiTitle) {
        const saved = await saveAiTitle(sessionId, aiTitle)
        if (!saved) {
          state.hasCustomTitle = true
          return
        }
        store.applyIfPresent(sessionId, { type: 'title_changed', text: aiTitle, source: 'ai' })
      }
    } catch (err) {
      console.error(`[Title] Failed to generate title for ${sessionId}:`, err)
    }
  })()
}

function getPrewarmIdleTimeoutMs(): number {
  const raw = process.env.DREAMCODER_PREWARM_IDLE_TIMEOUT_MS
  if (!raw) return DEFAULT_PREWARM_IDLE_TIMEOUT_MS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_PREWARM_IDLE_TIMEOUT_MS
}

function markPrewarmed(sessionId: string) {
  const runtime = getSessionRuntime(sessionId)
  runtime.prewarm.done = true
  const generation = conversationService.getGeneration(sessionId)
  if (generation > 0) {
    store.apply(sessionId, { type: 'process_phase_changed', phase: 'prewarmed', generation })
  }
  const timeoutMs = getPrewarmIdleTimeoutMs()
  if (timeoutMs === 0) return

  if (runtime.prewarm.idleTimer) clearTimeout(runtime.prewarm.idleTimer)

  runtime.prewarm.idleTimer = setTimeout(() => {
    const current = peekSessionRuntime(sessionId)
    if (!current) return
    current.prewarm.idleTimer = undefined
    if (!current.prewarm.done) return
    console.log(`[WS] Prewarmed session ${sessionId} idle for ${timeoutMs}ms, stopping CLI subprocess`)
    conversationService.stopSession(sessionId, generation)
    current.prewarm.done = false
  }, timeoutMs)
}

async function resolveSessionWorkDir(sessionId: string, fallback = os.homedir()): Promise<string> {
  let workDir = fallback
  try {
    const resolved = await sessionService.getSessionWorkDir(sessionId)
    if (resolved) workDir = resolved
    console.log(
      `[WS] resolveSessionWorkDir: sessionId=${sessionId}, resolved workDir=${JSON.stringify(
        resolved,
      )}, will spawn CLI with workDir=${workDir}`,
    )
  } catch (resolveErr) {
    console.warn(
      `[WS] resolveSessionWorkDir: failed to resolve workDir for ${sessionId}, using fallback=${workDir}: ${
        resolveErr instanceof Error ? resolveErr.message : String(resolveErr)
      }`,
    )
  }
  return workDir
}

async function ensureCliSessionStarted(
  endpoint: SessionEndpoint,
  sessionId: string,
  reason: 'user_message' | 'prewarm_session',
): Promise<void> {
  const pendingStartup = peekSessionRuntime(sessionId)?.startup
  if (pendingStartup) {
    await pendingStartup
    return
  }

  if (conversationService.hasSession(sessionId)) return

  const startup = (async () => {
    const workDir = await resolveSessionWorkDir(sessionId)
    store.apply(sessionId, { type: 'workspace_reported', workspace: { workDir } })
    const runtimeSettings = await getRuntimeSettings(sessionId)
    await sendRepositoryStartupStatus(sessionId, reason)
    console.log(`[WS] Starting CLI for ${sessionId} due to ${reason}`)
    await conversationService.startSession(sessionId, workDir, buildSdkUrl(endpoint, sessionId), runtimeSettings)
  })()

  getSessionRuntime(sessionId).startup = startup
  try {
    await startup
  } finally {
    const runtime = peekSessionRuntime(sessionId)
    if (runtime?.startup === startup) {
      runtime.startup = undefined
    }
  }
}

export function translateCliMessage(cliMsg: any, sessionId: string): ServerMessage[] {
  const { messages, events } = translateCliOutput(cliMsg, getPipeline(sessionId).stream)
  for (const event of events) store.apply(sessionId, event)
  return messages
}

function sendMessage(ws: ServerWebSocket<WebSocketData>, message: ServerMessage) {
  ws.send(JSON.stringify(message))
}

function sendError(ws: ServerWebSocket<WebSocketData>, message: string, code: string) {
  sendMessage(ws, { type: 'error', message, code })
}

function getDisconnectCleanupDelayMs(sessionId: string): number {
  return (store.peek(sessionId)?.pendingPermissions.length ?? 0) > 0
    ? PENDING_PERMISSION_DISCONNECT_CLEANUP_MS
    : CLIENT_DISCONNECT_CLEANUP_MS
}

function getDesktopSlashCommand(content: string): ReturnType<typeof parseSlashCommand> {
  const parsed = parseSlashCommand(content.trim())
  if (!parsed || parsed.isMcp) return null
  return parsed
}

function getTitleInputForUserMessage(
  content: string,
  command: ReturnType<typeof parseSlashCommand>,
): string | null {
  if (command?.commandName !== 'goal') return content

  const args = command.args.trim()
  if (!args || args === 'clear') return null
  return args
}

export function createCurrentTurnLocalCommandForwarder(
  command: ReturnType<typeof parseSlashCommand>,
): (cliMsg: any) => boolean {
  let awaitingCurrentTurnLocalCommandOutput = false

  return (cliMsg: any) => {
    if (command && isMatchingCurrentTurnLocalCommand(cliMsg, command)) {
      awaitingCurrentTurnLocalCommandOutput = true
      return true
    }
    if (command?.commandName === 'goal' && isLocalCommandOutputMessage(cliMsg)) {
      const output = extractLocalCommandOutput(
        cliMsg.content ?? cliMsg.message,
        { allowUntagged: cliMsg.subtype === 'local_command_output' },
      )
      if (output && isGoalCommandOutput(output)) {
        awaitingCurrentTurnLocalCommandOutput = false
        return true
      }
    }
    if (
      awaitingCurrentTurnLocalCommandOutput &&
      isLocalCommandOutputMessage(cliMsg)
    ) {
      awaitingCurrentTurnLocalCommandOutput = false
      return true
    }
    return false
  }
}

function isMatchingCurrentTurnLocalCommand(
  cliMsg: any,
  command: NonNullable<ReturnType<typeof parseSlashCommand>>,
): boolean {
  if (cliMsg?.type !== 'system' || cliMsg?.subtype !== 'local_command') {
    return false
  }
  const localCommand = parseLocalCommand(cliMsg.content ?? cliMsg.message)
  if (!localCommand) return false
  return (
    localCommand.name === command.commandName &&
    localCommand.args.trim() === command.args.trim()
  )
}

function isLocalCommandOutputMessage(cliMsg: any): boolean {
  if (
    cliMsg?.type !== 'system' ||
    (cliMsg?.subtype !== 'local_command' &&
      cliMsg?.subtype !== 'local_command_output')
  ) {
    return false
  }
  return extractLocalCommandOutput(
    cliMsg.content ?? cliMsg.message,
    { allowUntagged: cliMsg.subtype === 'local_command_output' },
  ) !== null
}

function removeActiveClient(
  sessionId: string,
  ws: ServerWebSocket<WebSocketData>,
): boolean {
  const clients = peekSessionRuntime(sessionId)?.clients
  if (!clients?.has(ws)) return false
  clients.delete(ws)
  return true
}

function hasActiveClients(sessionId: string): boolean {
  return (peekSessionRuntime(sessionId)?.clients.size ?? 0) > 0
}

type RuntimeSettings = {
  permissionMode?: string
  model?: string
  effort?: string
  thinking?: 'disabled'
  providerId?: string | null
}

function isKnownRuntimeProviderId(
  providerId: string,
  providers: Array<{ id: string }>,
): boolean {
  return providers.some((provider) => provider.id === providerId)
}

async function getRuntimeSettings(sessionId: string): Promise<RuntimeSettings> {
  await store.ensure(sessionId)
  const settings = await resolveRuntimeSettings(sessionId)
  const state = store.get(sessionId)
  // A per-session effort chosen in the composer wins over the global default.
  const overrideEffort = state.runtime.desired?.effort
  return {
    ...settings,
    permissionMode: state.permission.desired,
    ...(overrideEffort ? { effort: overrideEffort } : {}),
  }
}

async function resolveRuntimeSettings(sessionId?: string): Promise<RuntimeSettings> {
  const runtimeOverride = sessionId ? store.peek(sessionId)?.runtime.desired : undefined
  // A null provider used to mean the official sign-in, which is gone; such an
  // override falls back to the default settings.
  if (runtimeOverride?.providerId === null) {
    return getDefaultRuntimeSettings()
  }
  if (runtimeOverride) {
    if (typeof runtimeOverride.providerId === 'string') {
      const { providers } = await providerService.listProviders()
      const providerExists = isKnownRuntimeProviderId(runtimeOverride.providerId, providers)
      if (!providerExists) {
        console.warn(
          `[WS] Ignoring stale runtime provider id for ${sessionId}: ${runtimeOverride.providerId}`,
        )
        store.apply(sessionId!, { type: 'runtime_desired_changed', selection: null })
        return getDefaultRuntimeSettings()
      }
    }

    const userSettings = await settingsService.getUserSettings()
    const effort =
      typeof userSettings.effort === 'string' && userSettings.effort.trim()
        ? userSettings.effort
        : undefined
    const thinking = resolveDesktopThinkingMode(userSettings)

    return {
      model: runtimeOverride.modelId,
      effort,
      thinking,
      providerId: runtimeOverride.providerId,
    }
  }

  return getDefaultRuntimeSettings()
}

async function getDefaultRuntimeSettings(): Promise<RuntimeSettings> {
  const { providers, activeId } = await providerService.listProviders()
  const resolvedActiveId =
    activeId && isKnownRuntimeProviderId(activeId, providers) ? activeId : null

  const userSettings = await settingsService.getUserSettings()
  const effort =
    typeof userSettings.effort === 'string' && userSettings.effort.trim()
      ? userSettings.effort
      : undefined
  const thinking = resolveDesktopThinkingMode(userSettings)

  let model: string | undefined
  const activeProvider = resolvedActiveId
    ? providers.find((provider) => provider.id === resolvedActiveId)
    : undefined
  if (activeProvider) {
    model = resolveProviderDefaultModel(activeProvider, await providerService.getManagedSettings())
  } else {
    const modelContext =
      typeof userSettings.modelContext === 'string' && userSettings.modelContext.trim()
        ? userSettings.modelContext
        : undefined
    const baseModel =
      typeof userSettings.model === 'string' && userSettings.model.trim()
        ? userSettings.model
        : undefined
    model = baseModel ? (modelContext ? `${baseModel}:${modelContext}` : baseModel) : undefined
  }

  return {
    model,
    effort,
    thinking,
    providerId: resolvedActiveId,
  }
}

function resolveDesktopThinkingMode(
  settings: Record<string, unknown>,
): 'disabled' | undefined {
  return settings.alwaysThinkingEnabled === false ? 'disabled' : undefined
}

async function buildSessionStartupDiagnosticMessage(
  sessionId: string,
  cause: string,
): Promise<string> {
  const lines = [
    cause,
    '',
    'Desktop service diagnostics:',
    `- sessionId: ${sessionId}`,
  ]

  try {
    const workDir =
      store.peek(sessionId)?.workspace.workDir ||
      conversationService.getSessionWorkDir(sessionId) ||
      await sessionService.getSessionWorkDir(sessionId)
    lines.push(`- workDir: ${workDir ?? '(unknown)'}`)
  } catch (err) {
    lines.push(`- workDir: failed to resolve (${err instanceof Error ? err.message : String(err)})`)
  }

  const runtimeOverride = store.peek(sessionId)?.runtime.desired
  if (runtimeOverride) {
    lines.push(`- runtimeOverride.providerId: ${runtimeOverride.providerId ?? '(none)'}`)
    lines.push(`- runtimeOverride.modelId: ${runtimeOverride.modelId}`)
    if (runtimeOverride.effort) lines.push(`- runtimeOverride.effort: ${runtimeOverride.effort}`)
  } else {
    lines.push('- runtimeOverride: (none)')
  }

  try {
    const { providers, activeId } = await providerService.listProviders()
    lines.push(`- activeProviderId: ${activeId ?? '(none)'}`)
    lines.push(`- configuredProviders: ${providers.length}`)
    if (providers.length > 0) {
      lines.push(
        `- providerIndex: ${providers
          .map((provider) => `${provider.name} (${provider.id})`)
          .join(', ')}`,
      )
    }
  } catch (err) {
    lines.push(`- providers: failed to read (${err instanceof Error ? err.message : String(err)})`)
  }

  return lines.join('\n')
}

function enqueueRuntimeTransition(
  sessionId: string,
  transition: () => Promise<void>,
): Promise<void> {
  const previous = peekSessionRuntime(sessionId)?.runtimeTransition ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(transition)
    .finally(() => {
      const runtime = peekSessionRuntime(sessionId)
      if (runtime?.runtimeTransition === next) {
        runtime.runtimeTransition = undefined
      }
    })
  getSessionRuntime(sessionId).runtimeTransition = next
  return next
}

async function waitForRuntimeTransitionBeforeUserTurn(
  sessionId: string,
): Promise<{ ok: boolean; waited: boolean }> {
  let waited = false
  let pendingRuntimeTransition = peekSessionRuntime(sessionId)?.runtimeTransition
  while (pendingRuntimeTransition) {
    waited = true
    try {
      await pendingRuntimeTransition
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      void diagnosticsService.recordEvent({
        type: 'runtime_transition_failed',
        severity: 'error',
        sessionId,
        summary: errMsg,
        details: err,
      })
      console.error(`[WS] Runtime transition failed before handling user message for ${sessionId}: ${errMsg}`)
      broadcastToSession(sessionId, {
        type: 'error',
        message: `Failed to switch provider/model: ${errMsg}`,
        code: 'CLI_RESTART_FAILED',
      })
      return { ok: false, waited }
    }

    const nextTransition = peekSessionRuntime(sessionId)?.runtimeTransition
    pendingRuntimeTransition =
      nextTransition && nextTransition !== pendingRuntimeTransition
        ? nextTransition
        : undefined
  }

  return { ok: true, waited }
}

function broadcastToSession(sessionId: string, message: ServerMessage): void {
  sendToSession(sessionId, message)
}

export function sendToSession(sessionId: string, message: ServerMessage): boolean {
  const clients = peekSessionRuntime(sessionId)?.clients
  if (!clients || clients.size === 0) return false
  const payload = JSON.stringify(message)
  for (const ws of clients) {
    ws.send(payload)
  }
  return true
}

export function updateSessionSlashCommands(
  sessionId: string,
  commands: unknown[],
  options: { notifyClient?: boolean } = {},
): SessionSlashCommand[] {
  const normalized = normalizeSessionSlashCommands(commands)

  store.apply(sessionId, { type: 'slash_commands_reported', commands: normalized })

  if (options.notifyClient !== false) {
    sendToSession(sessionId, {
      type: 'system_notification',
      subtype: 'slash_commands',
      data: normalized,
    })
  }

  return normalized
}

export function closeSessionConnection(sessionId: string, reason = 'session closed'): boolean {
  // Dispose before closing sockets so their close events find no session and are ignored.
  const clients = disposeSessionRuntime(sessionId)?.clients
  store.dispose(sessionId)
  conversationService.forgetSession(sessionId)
  if (!clients || clients.size === 0) return false

  for (const ws of clients) {
    ws.close(1000, reason)
  }
  return true
}

export type TeamRole = 'lead' | 'member'

export function setTeamMembership(teamName: string, roles: ReadonlyMap<string, TeamRole>): void {
  const known = [...roles.keys()].filter((sessionId) => store.peek(sessionId))
  for (const sessionId of new Set([...getConnectedSessionIds(), ...known])) {
    const role = roles.get(sessionId)
    if (role) {
      store.apply(sessionId, { type: 'team_changed', team: { name: teamName, role } })
    } else if (store.peek(sessionId)?.team?.name === teamName) {
      store.apply(sessionId, { type: 'team_changed', team: null })
    }
  }
}

export function sendToTeam(teamName: string, message: ServerMessage): void {
  for (const sessionId of getConnectedSessionIds()) {
    if (store.peek(sessionId)?.team?.name === teamName) sendToSession(sessionId, message)
  }
}

export function getActiveSessionIds(): string[] {
  return getConnectedSessionIds()
}

export function __resetWebSocketHandlerStateForTests(): void {
  disposeAllSessionRuntimes()
  store.clear()
}
