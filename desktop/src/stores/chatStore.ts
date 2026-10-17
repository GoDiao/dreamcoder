import { create } from 'zustand'
import { wsManager } from '../api/websocket'
import { sessionsApi } from '../api/sessions'
import { useTeamStore } from './teamStore'
import { useSessionStore } from './sessionStore'
import { useCLITaskStore } from './cliTaskStore'
import { useSessionRuntimeStore } from './sessionRuntimeStore'
import { useTabStore } from './tabStore'
import { randomSpinnerVerb } from '../config/spinnerVerbs'
import { notifyDesktop } from '../lib/desktopNotifications'
import { t } from '../i18n'
import { deriveSessionTitle, isPlaceholderSessionTitle } from '../lib/sessionTitle'
import type { ComposerAttachment } from '../lib/composerAttachments'
import type { PermissionMode } from '../types/settings'
import type { RuntimeSelection } from '../types/runtime'
import type {
  ActiveGoalState,
  AgentTaskNotification,
  ApiRetryState,
  AttachmentRef,
  BackgroundAgentTask,
  ChatState,
  ComputerUsePermissionRequest,
  ComputerUsePermissionResponse,
  UIAttachment,
  UIMessage,
  ServerMessage,
  TokenUsage,
} from '../types/chat'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type CompactSummaryMessage = Extract<UIMessage, { type: 'compact_summary' }>

export type ComposerDraftState = {
  input: string
  attachments: ComposerAttachment[]
}

export type ComposerReferenceInsertion = {
  text: string
  reference?: {
    kind: 'file'
    path: string
    absolutePath?: string
    name: string
    isDirectory?: boolean
  }
  nonce: number
}

export type PerSessionState = {
  messages: UIMessage[]
  chatState: ChatState
  connectionState: ConnectionState
  streamingText: string
  streamingToolInput: string
  activeToolUseId: string | null
  activeToolName: string | null
  activeThinkingId: string | null
  pendingPermission: {
    requestId: string
    toolName: string
    toolUseId?: string
    input: unknown
    description?: string
  } | null
  pendingComputerUsePermission: {
    requestId: string
    request: ComputerUsePermissionRequest
  } | null
  tokenUsage: TokenUsage
  elapsedSeconds: number
  statusVerb: string
  apiRetry?: ApiRetryState | null
  slashCommands: Array<{ name: string; description: string; argumentHint?: string }>
  agentTaskNotifications: Record<string, AgentTaskNotification>
  backgroundAgentTasks?: Record<string, BackgroundAgentTask>
  activeGoal?: ActiveGoalState | null
  elapsedTimer: ReturnType<typeof setInterval> | null
  composerPrefill?: {
    text: string
    attachments?: UIAttachment[]
    nonce: number
  } | null
  composerInsertion?: ComposerReferenceInsertion | null
  composerDraft?: ComposerDraftState | null
}

const DEFAULT_SESSION_STATE: PerSessionState = {
  messages: [],
  chatState: 'idle',
  connectionState: 'disconnected',
  streamingText: '',
  streamingToolInput: '',
  activeToolUseId: null,
  activeToolName: null,
  activeThinkingId: null,
  pendingPermission: null,
  pendingComputerUsePermission: null,
  tokenUsage: { input_tokens: 0, output_tokens: 0 },
  elapsedSeconds: 0,
  statusVerb: '',
  apiRetry: null,
  slashCommands: [],
  agentTaskNotifications: {},
  backgroundAgentTasks: {},
  activeGoal: null,
  elapsedTimer: null,
  composerPrefill: null,
  composerInsertion: null,
  composerDraft: null,
}

function createDefaultSessionState(): PerSessionState {
  return { ...DEFAULT_SESSION_STATE, messages: [], tokenUsage: { input_tokens: 0, output_tokens: 0 } }
}

type ChatStore = {
  sessions: Record<string, PerSessionState>

  getSession: (sessionId: string) => PerSessionState
  connectToSession: (sessionId: string) => void
  disconnectSession: (sessionId: string) => void
  sendMessage: (
    sessionId: string,
    content: string,
    attachments?: AttachmentRef[],
    options?: { displayContent?: string; displayAttachments?: AttachmentRef[] },
  ) => void
  respondToPermission: (
    sessionId: string,
    requestId: string,
    allowed: boolean,
    options?: {
      rule?: string
      updatedInput?: Record<string, unknown>
    },
  ) => void
  respondToComputerUsePermission: (
    sessionId: string,
    requestId: string,
    response: ComputerUsePermissionResponse,
  ) => void
  setSessionRuntime: (sessionId: string, selection: RuntimeSelection) => void
  setSessionPermissionMode: (sessionId: string, mode: PermissionMode) => void
  stopGeneration: (sessionId: string) => void
  loadHistory: (sessionId: string) => Promise<void>
  reloadHistory: (sessionId: string) => Promise<void>
  queueComposerPrefill: (
    sessionId: string,
    prefill: { text: string; attachments?: UIAttachment[] },
  ) => void
  queueComposerInsertion: (
    sessionId: string,
    insertion: Omit<ComposerReferenceInsertion, 'nonce'>,
  ) => void
  clearComposerInsertion: (sessionId: string, nonce?: number) => void
  setComposerDraft: (sessionId: string, draft: ComposerDraftState) => void
  clearComposerDraft: (sessionId: string) => void
  clearMessages: (sessionId: string) => void
  handleServerMessage: (sessionId: string, msg: ServerMessage) => void
}

const TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite'])
const TASK_STOP_TOOL_NAMES = new Set(['TaskStop', 'KillShell'])
const MAX_MESSAGES = 5000

function trimMessages(messages: UIMessage[], max: number = MAX_MESSAGES): UIMessage[] {
  if (messages.length <= max) return messages
  const trimCount = messages.length - max
  const keepHead = messages[0]?.type === 'system' ? 1 : 0
  return messages.slice(trimCount + keepHead)
}

function appendMessage(messages: UIMessage[], msg: UIMessage): UIMessage[] {
  return trimMessages([...messages, msg])
}
const pendingTaskToolUseIdsBySession = new Map<string, Set<string>>()

function addPendingTaskToolUseId(sessionId: string, toolUseId: string): void {
  const ids = pendingTaskToolUseIdsBySession.get(sessionId) ?? new Set<string>()
  ids.add(toolUseId)
  pendingTaskToolUseIdsBySession.set(sessionId, ids)
}

function consumePendingTaskToolUseId(sessionId: string, toolUseId: string): boolean {
  const ids = pendingTaskToolUseIdsBySession.get(sessionId)
  if (!ids?.has(toolUseId)) return false
  ids.delete(toolUseId)
  if (ids.size === 0) pendingTaskToolUseIdsBySession.delete(sessionId)
  return true
}

function clearPendingTaskToolUseIds(sessionId: string): void {
  pendingTaskToolUseIdsBySession.delete(sessionId)
}

const AGENT_COMPLETION_NOTIFICATION_PREVIEW_CHARS = 160

let msgCounter = 0
const nextId = () => `msg-${++msgCounter}-${Date.now()}`

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readJsonStringLiteral(source: string, quoteIndex: number): string | undefined {
  if (source[quoteIndex] !== '"') return undefined
  let value = ''
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\') {
      const escaped = source[index + 1]
      if (escaped === undefined) return undefined
      value += char + escaped
      index += 1
      continue
    }
    if (char === '"') {
      try {
        return JSON.parse(`"${value}"`) as string
      } catch {
        return value
      }
    }
    value += char
  }
  return undefined
}

function extractPartialJsonStringField(source: string, field: string): string | undefined {
  const key = `"${field}"`
  const keyIndex = source.indexOf(key)
  if (keyIndex < 0) return undefined
  const colonIndex = source.indexOf(':', keyIndex + key.length)
  if (colonIndex < 0) return undefined

  let valueIndex = colonIndex + 1
  while (valueIndex < source.length && /\s/.test(source[valueIndex] ?? '')) {
    valueIndex += 1
  }
  return readJsonStringLiteral(source, valueIndex)
}

function buildPartialToolInputPreview(
  partialInput: string,
  previousInput: unknown,
): Record<string, unknown> {
  const previous = isRecord(previousInput) ? previousInput : {}
  const preview: Record<string, unknown> = { ...previous }
  for (const field of ['file_path', 'filePath', 'path', 'command', 'pattern', 'url', 'query', 'description']) {
    const value = extractPartialJsonStringField(partialInput, field)
    if (value !== undefined) {
      preview[field] = value
    }
  }
  return preview
}

function upsertToolUseMessage(
  messages: UIMessage[],
  toolUseId: string,
  build: (existing?: ToolCall) => ToolCall,
): UIMessage[] {
  const existingIndex = messages.findIndex(
    (message): message is ToolCall =>
      message.type === 'tool_use' && message.toolUseId === toolUseId,
  )
  if (existingIndex < 0) {
    return appendMessage(messages, build())
  }

  const next = [...messages]
  next[existingIndex] = build(messages[existingIndex] as ToolCall)
  return next
}

const pendingDeltaBySession = new Map<string, string>()
const flushTimerBySession = new Map<string, ReturnType<typeof setTimeout>>()
const pendingToolInputDeltaBySession = new Map<string, string>()
const toolInputFlushTimerBySession = new Map<string, ReturnType<typeof setTimeout>>()

function consumePendingDelta(sessionId: string): string {
  const flushTimer = flushTimerBySession.get(sessionId)
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimerBySession.delete(sessionId)
  }
  const text = pendingDeltaBySession.get(sessionId) ?? ''
  pendingDeltaBySession.delete(sessionId)
  return text
}

function appendPendingDelta(sessionId: string, text: string): void {
  pendingDeltaBySession.set(
    sessionId,
    `${pendingDeltaBySession.get(sessionId) ?? ''}${text}`,
  )
}

function clearPendingDelta(sessionId: string): void {
  const flushTimer = flushTimerBySession.get(sessionId)
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimerBySession.delete(sessionId)
  }
  pendingDeltaBySession.delete(sessionId)
}

function consumePendingToolInputDelta(sessionId: string): string {
  const flushTimer = toolInputFlushTimerBySession.get(sessionId)
  if (flushTimer) {
    clearTimeout(flushTimer)
    toolInputFlushTimerBySession.delete(sessionId)
  }
  const text = pendingToolInputDeltaBySession.get(sessionId) ?? ''
  pendingToolInputDeltaBySession.delete(sessionId)
  return text
}

function appendPendingToolInputDelta(sessionId: string, text: string): void {
  pendingToolInputDeltaBySession.set(
    sessionId,
    `${pendingToolInputDeltaBySession.get(sessionId) ?? ''}${text}`,
  )
}

function clearPendingToolInputDelta(sessionId: string): void {
  const flushTimer = toolInputFlushTimerBySession.get(sessionId)
  if (flushTimer) {
    clearTimeout(flushTimer)
    toolInputFlushTimerBySession.delete(sessionId)
  }
  pendingToolInputDeltaBySession.delete(sessionId)
}

function appendAssistantTextMessage(
  messages: UIMessage[],
  content: string,
  timestamp: number,
  model?: string,
  transcriptMessageId?: string,
): UIMessage[] {
  const trimmedContent = content.trim()
  if (!trimmedContent) return messages

  const last = messages[messages.length - 1]
  if (
    last?.type === 'assistant_text' &&
    last.transcriptMessageId &&
    !transcriptMessageId &&
    last.content.trim().includes(trimmedContent)
  ) {
    return messages
  }

  const canMergeIntoLast =
    last?.type === 'assistant_text' &&
    (
      transcriptMessageId
        ? last.transcriptMessageId === transcriptMessageId
        : !last.transcriptMessageId
    )
  if (canMergeIntoLast) {
    const merged: UIMessage = {
      ...last,
      content: last.content + content,
      ...(model ?? last.model ? { model: model ?? last.model } : {}),
      ...(transcriptMessageId ?? last.transcriptMessageId
        ? { transcriptMessageId: transcriptMessageId ?? last.transcriptMessageId }
        : {}),
    }
    return [...messages.slice(0, -1), merged]
  }

  return appendMessage(messages, {
    id: nextId(),
    type: 'assistant_text',
    content,
    timestamp,
    ...(transcriptMessageId ? { transcriptMessageId } : {}),
    ...(model ? { model } : {}),
  })
}

function appendOrUpdateTailCompactSummary(
  messages: UIMessage[],
  update: Partial<Omit<CompactSummaryMessage, 'id' | 'type' | 'timestamp'>>,
  timestamp: number,
): UIMessage[] {
  const existingIndex = messages.length - 1
  const existingMessage = messages[existingIndex]
  if (existingMessage?.type === 'compact_summary') {
    const existing = existingMessage
    const next: CompactSummaryMessage = {
      ...existing,
      ...update,
      title: update.title ?? existing.title,
      timestamp: existing.timestamp,
    }
    return [
      ...messages.slice(0, existingIndex),
      next,
      ...messages.slice(existingIndex + 1),
    ]
  }

  return appendMessage(messages, {
    id: nextId(),
    type: 'compact_summary',
    title: update.title ?? 'Context compacted',
    ...update,
    timestamp,
  })
}

function dropTailCompactingCompactSummary(messages: UIMessage[]): UIMessage[] {
  const tail = messages[messages.length - 1]
  if (tail?.type === 'compact_summary' && tail.phase === 'compacting') {
    return messages.slice(0, -1)
  }
  return messages
}

function upsertBackgroundTaskMessage(
  messages: UIMessage[],
  task: BackgroundAgentTask,
  timestamp: number,
): UIMessage[] {
  const isSameTaskMessage = (message: UIMessage) =>
    message.type === 'background_task' &&
    (message.task.taskId === task.taskId ||
      (task.toolUseId && message.task.toolUseId === task.toolUseId))

  if (isAgentBackgroundTask(task)) {
    return messages.filter((message) => !isSameTaskMessage(message))
  }

  const existingIndex = messages.findIndex((message) =>
    isSameTaskMessage(message))
  if (existingIndex === -1) {
    return appendMessage(messages, {
      id: `background-task-${task.taskId}`,
      type: 'background_task',
      task,
      timestamp,
    })
  }

  return messages.map((message, index) =>
    index === existingIndex && message.type === 'background_task'
      ? { ...message, task: { ...message.task, ...task }, timestamp: message.timestamp || timestamp }
      : message)
}

function mergeBackgroundTaskMessages(
  messages: UIMessage[],
  tasks: Record<string, BackgroundAgentTask>,
): UIMessage[] {
  const merged = Object.values(tasks).reduce(
    (current, task) => upsertBackgroundTaskMessage(current, task, task.updatedAt),
    messages,
  )
  return [...merged].sort((a, b) => a.timestamp - b.timestamp)
}

function isAgentBackgroundTask(task: Pick<BackgroundAgentTask, 'taskType' | 'summary'>): boolean {
  if (task.taskType === 'local_agent' || task.taskType === 'remote_agent') {
    return true
  }
  return /^Agent (?:(?:"[^"]+" )?(completed|was stopped)|(?:"[^"]+" )?failed(?::|$))/.test(
    task.summary ?? '',
  )
}

function mergeRestoredTerminalGoalEvents(
  messages: UIMessage[],
  restoredMessages: UIMessage[],
): UIMessage[] {
  const existingKeys = new Set(messages
    .filter((message): message is Extract<UIMessage, { type: 'goal_event' }> =>
      message.type === 'goal_event')
    .map((message) => `${message.action}:${message.message ?? ''}:${message.objective ?? ''}`))

  const missingTerminalEvents = restoredMessages.filter((
    message,
  ): message is Extract<UIMessage, { type: 'goal_event' }> =>
    message.type === 'goal_event' &&
    (message.action === 'completed' || message.action === 'cleared') &&
    !existingKeys.has(`${message.action}:${message.message ?? ''}:${message.objective ?? ''}`))

  return missingTerminalEvents.length > 0
    ? [...messages, ...missingTerminalEvents]
    : messages
}

function mergeRestoredTranscriptMessageIds(
  messages: UIMessage[],
  restoredMessages: UIMessage[],
): UIMessage[] {
  const restoredCandidates = restoredMessages.filter((
    message,
  ): message is Extract<UIMessage, { type: 'user_text' | 'assistant_text' }> =>
    (message.type === 'user_text' || message.type === 'assistant_text') &&
    typeof message.transcriptMessageId === 'string' &&
    message.transcriptMessageId.length > 0)

  if (restoredCandidates.length === 0) return messages

  let restoredCursor = 0
  let changed = false
  const merged = messages.map((message) => {
    if (
      (message.type !== 'user_text' && message.type !== 'assistant_text') ||
      message.transcriptMessageId
    ) {
      return message
    }

    const matchIndex = restoredCandidates.findIndex((candidate, index) =>
      index >= restoredCursor &&
      candidate.type === message.type &&
      candidate.content.trim() === message.content.trim())

    if (matchIndex === -1) return message

    restoredCursor = matchIndex + 1
    changed = true
    return {
      ...message,
      transcriptMessageId: restoredCandidates[matchIndex]!.transcriptMessageId,
    }
  })

  return changed ? merged : messages
}

function dropDuplicateTranscriptTextMessages(messages: UIMessage[]): UIMessage[] {
  const seen = new Set<string>()
  const deduped: UIMessage[] = []
  let changed = false

  for (const message of messages) {
    if (
      (message.type === 'user_text' || message.type === 'assistant_text') &&
      message.transcriptMessageId
    ) {
      const key = `${message.type}:${message.transcriptMessageId}:${message.content.trim()}`
      if (seen.has(key)) {
        changed = true
        continue
      }
      seen.add(key)
    }

    deduped.push(message)
  }

  return changed ? deduped : messages
}

function mergeRestoredHistoryIntoLiveMessages(
  messages: UIMessage[],
  restoredMessages: UIMessage[],
): UIMessage[] {
  return mergeRestoredTerminalGoalEvents(
    dropDuplicateTranscriptTextMessages(
      mergeRestoredTranscriptMessageIds(messages, restoredMessages),
    ),
    restoredMessages,
  )
}

function needsTranscriptIdHydrationRetry(session: PerSessionState | undefined): boolean {
  if (!session || session.chatState !== 'idle') return false

  let currentTurnHasHydratedUser = false
  for (const message of session.messages) {
    if (message.type === 'user_text') {
      currentTurnHasHydratedUser = Boolean(message.transcriptMessageId)
      continue
    }
    if (
      currentTurnHasHydratedUser &&
      message.type === 'assistant_text' &&
      !message.transcriptMessageId
    ) {
      return true
    }
  }

  return false
}

function refreshCompletedTranscriptHistory(
  get: () => ChatStore,
  sessionId: string,
): void {
  void get().loadHistory(sessionId).then(() => {
    if (!needsTranscriptIdHydrationRetry(get().sessions[sessionId])) return
    setTimeout(() => {
      if (!needsTranscriptIdHydrationRetry(get().sessions[sessionId])) return
      void get().loadHistory(sessionId)
    }, 750)
  })
}

function normalizeNotificationPreview(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildAgentCompletionNotification(
  sessionId: string,
  messages: UIMessage[],
  text: string,
): { title: string; body: string; dedupeKey: string } | null {
  const preview = normalizeNotificationPreview(text)
  if (!preview) return null

  const lastAssistant = [...messages].reverse().find((message) => message.type === 'assistant_text')
  const suffix = preview.length > AGENT_COMPLETION_NOTIFICATION_PREVIEW_CHARS ? '...' : ''
  return {
    title: t('notifications.agentCompleted.title'),
    body: preview.slice(0, AGENT_COMPLETION_NOTIFICATION_PREVIEW_CHARS) + suffix,
    dedupeKey: `agent-completion:${sessionId}:${lastAssistant?.id ?? Date.now()}`,
  }
}

function updateSessionIn(
  sessions: Record<string, PerSessionState>,
  sessionId: string,
  updater: (s: PerSessionState) => Partial<PerSessionState>,
): Record<string, PerSessionState> {
  const session = sessions[sessionId]
  if (!session) return sessions
  return { ...sessions, [sessionId]: { ...session, ...updater(session) } }
}

type SlashCommandState = PerSessionState['slashCommands'][number]

function normalizeSlashCommand(command: unknown): SlashCommandState | null {
  if (!command || typeof command !== 'object') return null
  const candidate = command as { name?: unknown; description?: unknown; argumentHint?: unknown }
  if (typeof candidate.name !== 'string' || !candidate.name) return null
  return {
    name: candidate.name,
    description: typeof candidate.description === 'string' ? candidate.description : '',
    ...(typeof candidate.argumentHint === 'string' && candidate.argumentHint
      ? { argumentHint: candidate.argumentHint }
      : {}),
  }
}

function normalizeSlashCommandList(commands: ReadonlyArray<unknown>): SlashCommandState[] {
  return commands
    .map(normalizeSlashCommand)
    .filter((command): command is SlashCommandState => command !== null)
}

function mergeSlashCommandUpdates(
  current: ReadonlyArray<SlashCommandState>,
  incoming: ReadonlyArray<SlashCommandState>,
): SlashCommandState[] {
  const merged = new Map<string, SlashCommandState>()
  for (const command of current) {
    if (command.name) merged.set(command.name, command)
  }
  for (const command of incoming) {
    if (command.name) merged.set(command.name, command)
  }
  return [...merged.values()]
}

async function fetchAndMapSessionHistory(sessionId: string) {
  const t0 = performance.now()
  const transcript = await sessionsApi.getTranscript(sessionId)
  console.log(`[mem] loadHistory:fetched ${transcript.items.length} items in ${(performance.now()-t0).toFixed(0)}ms`)
  const uiMessages = transcript.items
  const restoredNotifications = transcript.agentNotifications
  return {
    uiMessages,
    activeGoal: deriveActiveGoalFromMessages(uiMessages),
    restoredNotifications,
    restoredBackgroundTasks: backgroundTaskRecordFromNotifications(Object.values(restoredNotifications)),
    lastTodos: transcript.lastTodos,
    hasMessagesAfterTaskCompletion: transcript.hasMessagesAfterTaskCompletion,
  }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: {},

  getSession: (sessionId) => get().sessions[sessionId] ?? createDefaultSessionState(),

  connectToSession: (sessionId) => {
    void useCLITaskStore.getState().fetchSessionTasks(sessionId)

    const existing = get().sessions[sessionId]
    if (existing && existing.connectionState !== 'disconnected') return

    set((s) => ({
      sessions: {
        ...s.sessions,
        [sessionId]: {
          ...createDefaultSessionState(),
          connectionState: 'connecting',
          messages: existing?.messages ?? [],
          activeGoal: existing?.activeGoal ?? null,
          composerDraft: existing?.composerDraft ?? null,
        },
      },
    }))

    wsManager.clearHandlers(sessionId)
    wsManager.connect(sessionId)
    wsManager.onMessage(sessionId, (msg) => {
      if (msg.type === 'connected') {
        set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, () => ({ connectionState: 'connected' })) }))
      }
      get().handleServerMessage(sessionId, msg)
    })

    const runtimeSelection = useSessionRuntimeStore.getState().selections[sessionId]
    if (runtimeSelection) {
      wsManager.send(sessionId, { type: 'set_runtime_config', ...runtimeSelection })
    }
    if (!sessionId.startsWith('__') && !useTeamStore.getState().getMemberBySessionId(sessionId)) {
      wsManager.send(sessionId, { type: 'prewarm_session' })
    }

    get().loadHistory(sessionId)
    console.log('[mem] connectToSession:loadHistory-called')
    sessionsApi.getSlashCommands(sessionId)
      .then(({ commands }) => {
        if (get().sessions[sessionId]) {
          set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, () => ({ slashCommands: commands })) }))
        }
      })
      .catch(() => {
        if (get().sessions[sessionId]) {
          set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, () => ({ slashCommands: [] })) }))
        }
      })
  },

  disconnectSession: (sessionId) => {
    const session = get().sessions[sessionId]
    if (session?.elapsedTimer) clearInterval(session.elapsedTimer)
    if (pendingDeltaBySession.has(sessionId)) {
      const text = consumePendingDelta(sessionId)
      set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, (sess) => ({ streamingText: sess.streamingText + text })) }))
    }
    clearPendingToolInputDelta(sessionId)
    clearPendingTaskToolUseIds(sessionId)
    wsManager.disconnect(sessionId)
    set((s) => {
      const { [sessionId]: _, ...rest } = s.sessions
      return { sessions: rest }
    })
  },

  sendMessage: (sessionId, content, attachments, options) => {
    const userFacingContent =
      options?.displayContent?.trim() || content.trim()
    const modelFacingContent = buildModelContent(content, attachments)
    const isMemberSession = !!useTeamStore.getState().getMemberBySessionId(sessionId)
    const visibleAttachments = options?.displayAttachments ?? attachments
    const uiAttachments: UIAttachment[] | undefined =
      visibleAttachments && visibleAttachments.length > 0
        ? visibleAttachments.map((a) => ({
            type: a.type,
            name: a.name || a.path || a.mimeType || a.type,
            path: a.path,
            data: a.data,
            mimeType: a.mimeType,
            lineStart: a.lineStart,
            lineEnd: a.lineEnd,
            note: a.note,
            quote: a.quote,
          }))
        : undefined

    const taskStore = useCLITaskStore.getState()
    const sessionTasks = taskStore.sessionId === sessionId ? taskStore.tasks : []
    const allTasksDone = sessionTasks.length > 0 && sessionTasks.every((t) => t.status === 'completed')
    const completedTaskSummary = allTasksDone
      ? sessionTasks.map((t) => ({ id: t.id, subject: t.subject, status: t.status, activeForm: t.activeForm }))
      : []

    if (!isMemberSession && allTasksDone) {
      void taskStore.resetCompletedTasks(sessionId)
    }

    if (!isMemberSession) {
      updateOptimisticSessionTitle(sessionId, userFacingContent)
    }

    set((s) => {
      const session = s.sessions[sessionId] ?? createDefaultSessionState()
      const bufferedDelta = consumePendingDelta(sessionId)
      const pendingAssistantText = `${session.streamingText}${bufferedDelta}`

      const newMessages = pendingAssistantText.trim()
        ? appendAssistantTextMessage(session.messages, pendingAssistantText, Date.now())
        : [...session.messages]
      if (!isMemberSession && allTasksDone) {
        newMessages.push({
          id: nextId(),
          type: 'task_summary',
          tasks: completedTaskSummary,
          timestamp: Date.now(),
        })
      }
      newMessages.push({
        id: nextId(),
        type: 'user_text',
        content: userFacingContent,
        ...(userFacingContent !== modelFacingContent ? { modelContent: modelFacingContent } : {}),
        attachments: isMemberSession ? undefined : uiAttachments,
        timestamp: Date.now(),
        ...(isMemberSession ? { pending: true } : {}),
      })

      if (!isMemberSession && session.elapsedTimer) clearInterval(session.elapsedTimer)

      const timer = !isMemberSession
        ? setInterval(() => {
            set((st) => ({ sessions: updateSessionIn(st.sessions, sessionId, (sess) => ({ elapsedSeconds: sess.elapsedSeconds + 1 })) }))
          }, 1000)
        : null

      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            messages: newMessages,
            chatState: 'thinking',
            elapsedSeconds: 0,
            streamingText: '',
            statusVerb: isMemberSession ? '' : randomSpinnerVerb(),
            apiRetry: null,
            elapsedTimer: timer,
            connectionState: isMemberSession ? 'connected' : session.connectionState,
          },
        },
      }
    })

    if (isMemberSession) {
      void useTeamStore.getState().sendMessageToMember(sessionId, userFacingContent)
        .catch((err) => {
          set((s) => ({
            sessions: updateSessionIn(s.sessions, sessionId, (session) => ({
              chatState: 'idle',
              messages: [
                ...session.messages,
                {
                  id: nextId(),
                  type: 'error',
                  message: err instanceof Error ? err.message : String(err),
                  code: 'TEAM_MEMBER_MESSAGE_FAILED',
                  timestamp: Date.now(),
                },
              ],
            })),
          }))
        })
      return
    }

    wsManager.send(sessionId, { type: 'user_message', content, attachments })
  },

  respondToPermission: (sessionId, requestId, allowed, options) => {
    wsManager.send(sessionId, {
      type: 'permission_response',
      requestId,
      allowed,
      ...(options?.rule ? { rule: options.rule } : {}),
      ...(options?.updatedInput ? { updatedInput: options.updatedInput } : {}),
    })
    set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, () => ({ pendingPermission: null, chatState: allowed ? 'tool_executing' : 'idle' })) }))
  },

  respondToComputerUsePermission: (sessionId, requestId, response) => {
    wsManager.send(sessionId, {
      type: 'computer_use_permission_response',
      requestId,
      response,
    })
    set((s) => ({
      sessions: updateSessionIn(s.sessions, sessionId, () => ({
        pendingComputerUsePermission: null,
        chatState: response.userConsented === false ? 'idle' : 'tool_executing',
      })),
    }))
  },

  setSessionRuntime: (sessionId, selection) => {
    wsManager.send(sessionId, {
      type: 'set_runtime_config',
      ...selection,
    })
  },

  setSessionPermissionMode: (sessionId, mode) => {
    if (!get().sessions[sessionId]) return
    wsManager.send(sessionId, { type: 'set_permission_mode', mode })
  },

  stopGeneration: (sessionId) => {
    wsManager.send(sessionId, { type: 'stop_generation' })
    if (pendingDeltaBySession.has(sessionId)) {
      const text = consumePendingDelta(sessionId)
      set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, (sess) => ({ streamingText: sess.streamingText + text })) }))
    }
    clearPendingToolInputDelta(sessionId)
    set((s) => {
      const session = s.sessions[sessionId]
      if (!session) return s
      if (session.elapsedTimer) clearInterval(session.elapsedTimer)
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            chatState: 'idle',
            pendingPermission: null,
            pendingComputerUsePermission: null,
            apiRetry: null,
            elapsedTimer: null,
          },
        },
      }
    })
  },

  loadHistory: async (sessionId) => {
    try {
      const {
        uiMessages,
        activeGoal,
        restoredNotifications,
        restoredBackgroundTasks,
        lastTodos,
        hasMessagesAfterTaskCompletion,
      } = await fetchAndMapSessionHistory(sessionId)
      set((state) => {
        const session = state.sessions[sessionId]
        if (!session) return state
        if (session.messages.length > 0) {
          return { sessions: updateSessionIn(state.sessions, sessionId, (s) => ({
            activeGoal: activeGoal ?? s.activeGoal ?? null,
            agentTaskNotifications: { ...s.agentTaskNotifications, ...restoredNotifications },
            backgroundAgentTasks: mergeBackgroundAgentTaskRecords(
              s.backgroundAgentTasks ?? {},
              restoredBackgroundTasks,
            ),
            messages: mergeRestoredHistoryIntoLiveMessages(
              mergeBackgroundTaskMessages(s.messages, restoredBackgroundTasks),
              uiMessages,
            ),
          })) }
        }
        return { sessions: updateSessionIn(state.sessions, sessionId, (s) => ({
          messages: mergeBackgroundTaskMessages(uiMessages, restoredBackgroundTasks),
          activeGoal,
          agentTaskNotifications: { ...s.agentTaskNotifications, ...restoredNotifications },
          backgroundAgentTasks: mergeBackgroundAgentTaskRecords(
            s.backgroundAgentTasks ?? {},
            restoredBackgroundTasks,
          ),
        })) }
      })
      if (lastTodos && lastTodos.length > 0) {
        const taskStore = useCLITaskStore.getState()
        if (taskStore.sessionId === sessionId && taskStore.tasks.length === 0) taskStore.setTasksFromTodos(lastTodos, sessionId)
      } else {
        useCLITaskStore.getState().setTasksFromTodos([], sessionId)
      }
      if (hasMessagesAfterTaskCompletion) {
        useCLITaskStore.getState().markCompletedAndDismissed(sessionId)
      }
    } catch {
    }
  },

  reloadHistory: async (sessionId) => {
    try {
      const {
        uiMessages,
        activeGoal,
        restoredNotifications,
        restoredBackgroundTasks,
        lastTodos,
        hasMessagesAfterTaskCompletion,
      } = await fetchAndMapSessionHistory(sessionId)

      set((state) => {
        const session = state.sessions[sessionId]
        if (!session) return state
        if (session.elapsedTimer) clearInterval(session.elapsedTimer)
        return {
          sessions: updateSessionIn(state.sessions, sessionId, () => ({
            messages: mergeBackgroundTaskMessages(uiMessages, restoredBackgroundTasks),
            activeGoal,
            agentTaskNotifications: restoredNotifications,
            backgroundAgentTasks: restoredBackgroundTasks,
            chatState: 'idle',
            activeThinkingId: null,
            activeToolUseId: null,
            activeToolName: null,
            streamingText: '',
            streamingToolInput: '',
            pendingPermission: null,
            pendingComputerUsePermission: null,
            elapsedTimer: null,
            statusVerb: '',
            apiRetry: null,
          })),
        }
      })

      if (lastTodos && lastTodos.length > 0) {
        useCLITaskStore.getState().setTasksFromTodos(lastTodos, sessionId)
      } else {
        useCLITaskStore.getState().setTasksFromTodos([], sessionId)
      }
      if (hasMessagesAfterTaskCompletion) {
        useCLITaskStore.getState().markCompletedAndDismissed(sessionId)
      }
    } catch {
    }
  },

  queueComposerPrefill: (sessionId, prefill) => {
    set((state) => ({
      sessions: updateSessionIn(state.sessions, sessionId, () => ({
        composerPrefill: {
          text: prefill.text,
          attachments: prefill.attachments,
          nonce: Date.now(),
        },
      })),
    }))
  },

  queueComposerInsertion: (sessionId, insertion) => {
    set((state) => ({
      sessions: updateSessionIn(state.sessions, sessionId, () => ({
        composerInsertion: {
          ...insertion,
          nonce: Date.now(),
        },
      })),
    }))
  },

  clearComposerInsertion: (sessionId, nonce) => {
    set((state) => ({
      sessions: updateSessionIn(state.sessions, sessionId, (session) => {
        if (nonce !== undefined && session.composerInsertion?.nonce !== nonce) return {}
        return { composerInsertion: null }
      }),
    }))
  },

  setComposerDraft: (sessionId, draft) => {
    set((state) => {
      const session = state.sessions[sessionId] ?? createDefaultSessionState()
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            composerDraft: draft,
          },
        },
      }
    })
  },

  clearComposerDraft: (sessionId) => {
    set((state) => ({
      sessions: updateSessionIn(state.sessions, sessionId, () => ({
        composerDraft: null,
      })),
    }))
  },

  clearMessages: (sessionId) => {
    clearPendingTaskToolUseIds(sessionId)
    clearPendingToolInputDelta(sessionId)
    set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, () => ({
      messages: [],
      activeGoal: null,
      streamingText: '',
      chatState: 'idle',
      apiRetry: null,
    })) }))
  },

  handleServerMessage: (sessionId, msg) => {
    const update = (updater: (session: PerSessionState) => Partial<PerSessionState>) => {
      set((s) => ({ sessions: updateSessionIn(s.sessions, sessionId, updater) }))
    }

    switch (msg.type) {
      case 'connected':
        break

      case 'status':
        update((session) => {
          const pendingText = `${session.streamingText}${consumePendingDelta(sessionId)}`
          const hasPendingStreamText =
            session.chatState === 'streaming' && pendingText.trim().length > 0
          const preserveStreamingTurn = hasPendingStreamText && msg.state !== 'idle' && msg.state !== 'compacting'
          const shouldFlush = hasPendingStreamText && (msg.state === 'idle' || msg.state === 'compacting')
          let nextMessages = session.messages
          if (shouldFlush) {
            nextMessages = appendAssistantTextMessage(nextMessages, pendingText, Date.now())
          }
          if (msg.state === 'compacting') {
            nextMessages = appendOrUpdateTailCompactSummary(
              nextMessages,
              {
                title: 'Context compacted',
                phase: 'compacting',
              },
              Date.now(),
            )
          } else {
            nextMessages = dropTailCompactingCompactSummary(nextMessages)
          }
          return {
            chatState: preserveStreamingTurn ? 'streaming' : msg.state,
            statusVerb: msg.state === 'idle'
              ? ''
              : msg.verb && msg.verb !== 'Thinking'
                ? msg.verb
                : '',
            ...(msg.tokens ? { tokenUsage: { ...session.tokenUsage, output_tokens: msg.tokens } } : {}),
            ...(msg.state === 'idle' ? { activeThinkingId: null } : {}),
            ...(msg.state === 'idle' ? { apiRetry: null } : {}),
            ...(nextMessages !== session.messages ? { messages: nextMessages } : {}),
            ...(shouldFlush ? {
              streamingText: '',
            } : pendingText !== session.streamingText ? { streamingText: pendingText } : {}),
          }
        })
        if (msg.state === 'idle') {
          const session = get().sessions[sessionId]
          if (session?.elapsedTimer) {
            clearInterval(session.elapsedTimer)
            update(() => ({ elapsedTimer: null }))
          }
        }
        useTabStore.getState().updateTabStatus(sessionId, msg.state === 'idle' ? 'idle' : 'running')
        break

      case 'content_start': {
        const session = get().sessions[sessionId]
        if (!session) break
        const pendingText = `${session.streamingText}${consumePendingDelta(sessionId)}`
        if (msg.blockType !== 'text' && pendingText.trim()) {
          update((s) => ({
            messages: appendAssistantTextMessage(s.messages, pendingText, Date.now()),
            streamingText: '',
          }))
        }
        if (msg.blockType === 'text') {
          update((s) => ({
            ...(pendingText !== s.streamingText ? { streamingText: pendingText } : {}),
            chatState: 'streaming',
            activeThinkingId: null,
            apiRetry: null,
          }))
        } else if (msg.blockType === 'tool_use') {
          clearPendingToolInputDelta(sessionId)
          const toolUseId = msg.toolUseId ?? null
          const toolName = msg.toolName ?? 'unknown'
          update((s) => ({
            ...(toolUseId
              ? {
                  messages: upsertToolUseMessage(s.messages, toolUseId, (existing) => ({
                    id: existing?.id ?? nextId(),
                    type: 'tool_use',
                    toolName,
                    toolUseId,
                    input: existing?.input ?? {},
                    timestamp: existing?.timestamp ?? Date.now(),
                    parentToolUseId: msg.parentToolUseId ?? existing?.parentToolUseId,
                    isPending: true,
                    partialInput: existing?.partialInput ?? '',
                  })),
                }
              : {}),
            activeToolUseId: toolUseId,
            activeToolName: toolName,
            streamingToolInput: '',
            chatState: 'tool_executing',
            activeThinkingId: null,
            apiRetry: null,
          }))
        }
        break
      }

      case 'api_retry': {
        const attempt = Math.max(1, Math.trunc(msg.attempt))
        const maxRetries = Math.max(attempt, Math.trunc(msg.maxRetries))
        const retryDelayMs = Math.max(0, Math.trunc(msg.retryDelayMs))
        update((session) => ({
          apiRetry: {
            attempt,
            maxRetries,
            retryDelayMs,
            errorStatus: msg.errorStatus ?? null,
            errorType: msg.errorType,
            errorMessage: msg.errorMessage,
            receivedAt: Date.now(),
          },
          chatState: session.chatState === 'idle' ? 'thinking' : session.chatState,
          activeThinkingId: null,
          statusVerb: '',
        }))
        useTabStore.getState().updateTabStatus(sessionId, 'running')
        break
      }

      case 'content_delta':
        if (msg.text !== undefined) {
          if (!get().sessions[sessionId]) break
          appendPendingDelta(sessionId, msg.text)
          if (!flushTimerBySession.has(sessionId)) {
            const timer = setTimeout(() => {
              const text = pendingDeltaBySession.get(sessionId) ?? ''
              pendingDeltaBySession.delete(sessionId)
              flushTimerBySession.delete(sessionId)
              update((s) => ({ streamingText: s.streamingText + text }))
            }, 50)
            flushTimerBySession.set(sessionId, timer)
          }
        }
        if (msg.toolInput !== undefined) {
          appendPendingToolInputDelta(sessionId, msg.toolInput)
          if (!toolInputFlushTimerBySession.has(sessionId)) {
            const timer = setTimeout(() => {
              const text = consumePendingToolInputDelta(sessionId)
              if (!text) return
              update((s) => {
                const partialInput = s.streamingToolInput + text
                const activeToolUseId = s.activeToolUseId
                return {
                  streamingToolInput: partialInput,
                  ...(activeToolUseId
                    ? {
                        messages: upsertToolUseMessage(s.messages, activeToolUseId, (existing) => {
                          const toolName = existing?.toolName ?? s.activeToolName ?? 'unknown'
                          return {
                            id: existing?.id ?? nextId(),
                            type: 'tool_use',
                            toolName,
                            toolUseId: activeToolUseId,
                            input: buildPartialToolInputPreview(partialInput, existing?.input),
                            timestamp: existing?.timestamp ?? Date.now(),
                            parentToolUseId: existing?.parentToolUseId,
                            isPending: true,
                            partialInput,
                          }
                        }),
                      }
                    : {}),
                }
              })
            }, 50)
            toolInputFlushTimerBySession.set(sessionId, timer)
          }
        }
        break

      case 'thinking':
        update((s) => {
          const pendingText = `${s.streamingText}${consumePendingDelta(sessionId)}`
          const base = pendingText.trim()
            ? appendAssistantTextMessage(s.messages, pendingText, Date.now())
            : s.messages
          const last = base[base.length - 1]
          if (last && last.type === 'thinking') {
            const updated = [...base]
            updated[updated.length - 1] = { ...last, content: last.content + msg.text }
            return { messages: updated, chatState: 'thinking', activeThinkingId: last.id, streamingText: '' }
          }
          const id = nextId()
          return {
            messages: appendMessage(base, { id, type: 'thinking', content: msg.text, timestamp: Date.now() }),
            chatState: 'thinking',
            activeThinkingId: id,
            streamingText: '',
          }
        })
        break

      case 'tool_use_complete': {
        clearPendingToolInputDelta(sessionId)
        const session = get().sessions[sessionId]
        const toolName = msg.toolName || session?.activeToolName || 'unknown'
        const toolUseId = msg.toolUseId || session?.activeToolUseId || ''
        update((s) => ({
          messages: toolUseId
            ? upsertToolUseMessage(s.messages, toolUseId, (existing) => ({
                id: existing?.id ?? nextId(),
                type: 'tool_use',
                toolName,
                toolUseId,
                input: msg.input,
                timestamp: existing?.timestamp ?? Date.now(),
                parentToolUseId: msg.parentToolUseId ?? existing?.parentToolUseId,
                isPending: false,
              }))
            : appendMessage(s.messages, {
                id: nextId(), type: 'tool_use', toolName,
                toolUseId,
                input: msg.input, timestamp: Date.now(), parentToolUseId: msg.parentToolUseId,
                isPending: false,
              }),
          activeToolUseId: null, activeToolName: null, activeThinkingId: null, streamingToolInput: '',
        }))
        if (toolName === 'TodoWrite' && Array.isArray((msg.input as any)?.todos)) {
          useCLITaskStore.getState().setTasksFromTodos((msg.input as any).todos, sessionId)
        } else if (TASK_TOOL_NAMES.has(toolName)) {
          const useId = msg.toolUseId || session?.activeToolUseId
          if (useId) addPendingTaskToolUseId(sessionId, useId)
        }
        break
      }

      case 'tool_result': {
        const now = Date.now()
        update((s) => {
          let messages: UIMessage[] = appendMessage(s.messages, {
            id: nextId(), type: 'tool_result', toolUseId: msg.toolUseId,
            content: msg.content, isError: msg.isError, timestamp: now, parentToolUseId: msg.parentToolUseId,
          })
          let backgroundAgentTasks = s.backgroundAgentTasks ?? {}
          const stoppedTask = msg.isError
            ? null
            : getStoppedBackgroundTaskFromToolResult(s.messages, msg.toolUseId, msg.content)
          if (stoppedTask) {
            backgroundAgentTasks = upsertBackgroundAgentTask(backgroundAgentTasks, stoppedTask, now)
            const task = backgroundAgentTasks[stoppedTask.taskId]
            if (task) {
              messages = upsertBackgroundTaskMessage(messages, task, now)
            }
          }
          return {
            messages,
            ...(stoppedTask ? { backgroundAgentTasks } : {}),
            chatState: 'thinking',
            activeThinkingId: null,
          }
        })
        if (consumePendingTaskToolUseId(sessionId, msg.toolUseId)) {
          useCLITaskStore.getState().refreshTasks(sessionId)
        }
        break
      }

      case 'permission_request':
        notifyDesktop({
          dedupeKey: `permission:${msg.requestId}`,
          cooldownScope: 'permission-prompt',
          requestAttention: true,
          title: t('notifications.permissionPrompt.title'),
          body: msg.toolName
            ? t('notifications.permissionPrompt.toolBody', { toolName: msg.toolName })
            : t('notifications.permissionPrompt.toolBody', { toolName: 'A tool' }),
          target: { type: 'session', sessionId },
        })
        update((s) => ({
          pendingPermission: {
            requestId: msg.requestId,
            toolName: msg.toolName,
            toolUseId: msg.toolUseId,
            input: msg.input,
            description: msg.description,
          },
          pendingComputerUsePermission: null,
          chatState: 'permission_pending',
          activeThinkingId: null,
          apiRetry: null,
          messages:
            msg.toolName === 'AskUserQuestion'
              ? s.messages
              : appendMessage(s.messages, {
                  id: nextId(),
                  type: 'permission_request',
                  requestId: msg.requestId,
                  toolName: msg.toolName,
                  toolUseId: msg.toolUseId,
                  input: msg.input,
                  description: msg.description,
                  timestamp: Date.now(),
                }),
        }))
        break

      case 'computer_use_permission_request':
        notifyDesktop({
          dedupeKey: `computer-use-permission:${msg.requestId}`,
          cooldownScope: 'permission-prompt',
          requestAttention: true,
          title: t('notifications.permissionPrompt.title'),
          body: msg.request.reason || t('notifications.permissionPrompt.computerUseBody'),
          target: { type: 'session', sessionId },
        })
        update(() => ({
          pendingComputerUsePermission: {
            requestId: msg.requestId,
            request: msg.request,
          },
          pendingPermission: null,
          chatState: 'permission_pending',
          activeThinkingId: null,
          apiRetry: null,
        }))
        break

      case 'message_complete': {
        const session = get().sessions[sessionId]
        if (!session) break
        const wasAgentRunning = session.chatState !== 'idle'
        const text = `${session.streamingText}${consumePendingDelta(sessionId)}`
        let completionMessages = session.messages
        if (text.trim()) {
          completionMessages = appendAssistantTextMessage(session.messages, text, Date.now())
          update(() => ({
            messages: completionMessages,
            streamingText: '',
          }))
        } else if (text !== session.streamingText) {
          update(() => ({ streamingText: text }))
        }
        if (session.elapsedTimer) clearInterval(session.elapsedTimer)
        update(() => ({
          tokenUsage: msg.usage,
          chatState: 'idle',
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          elapsedTimer: null,
          apiRetry: null,
        }))
        useTabStore.getState().updateTabStatus(sessionId, 'idle')
        const appendedCompletionMessage = completionMessages !== session.messages
        const notification = wasAgentRunning && appendedCompletionMessage
          ? buildAgentCompletionNotification(sessionId, completionMessages, text)
          : null
        if (notification) {
          void notifyDesktop({
            dedupeKey: notification.dedupeKey,
            cooldownScope: 'agent-completion',
            title: notification.title,
            body: notification.body,
            target: { type: 'session', sessionId },
          })
        }
        refreshCompletedTranscriptHistory(get, sessionId)
        break
      }

      case 'error':
        update((s) => {
          const pendingText = `${s.streamingText}${consumePendingDelta(sessionId)}`
          let newMessages = s.messages
          if (pendingText.trim()) {
            newMessages = appendAssistantTextMessage(newMessages, pendingText, Date.now())
          }
          newMessages = dropTailCompactingCompactSummary(newMessages)
          newMessages = [...newMessages, { id: nextId(), type: 'error', message: msg.message, code: msg.code, timestamp: Date.now() }]
          return {
            messages: newMessages,
            chatState: 'idle',
            activeThinkingId: null,
            streamingText: '',
            statusVerb: '',
            pendingPermission: null,
            pendingComputerUsePermission: null,
            apiRetry: null,
          }
        })
        useTabStore.getState().updateTabStatus(sessionId, 'error')
        {
          const session = get().sessions[sessionId]
          if (session?.elapsedTimer) {
            clearInterval(session.elapsedTimer)
            update(() => ({ elapsedTimer: null }))
          }
        }
        break

      case 'team_created':
        useTeamStore.getState().handleTeamCreated(msg.teamName)
        break
      case 'team_update':
        useTeamStore.getState().handleTeamUpdate(msg.teamName, msg.members)
        break
      case 'team_deleted':
        useTeamStore.getState().handleTeamDeleted(msg.teamName)
        break
      case 'task_update':
        break
      case 'session_title_updated':
        useSessionStore.getState().updateSessionTitle(msg.sessionId, msg.title)
        useTabStore.getState().updateTabTitle(msg.sessionId, msg.title)
        break
      case 'system_notification':
        if (msg.subtype === 'slash_commands' && Array.isArray(msg.data)) {
          const incomingCommands = normalizeSlashCommandList(msg.data)
          update((session) => ({
            slashCommands: mergeSlashCommandUpdates(session.slashCommands, incomingCommands),
          }))
          void sessionsApi.getSlashCommands(sessionId)
            .then(({ commands }) => {
              if (!get().sessions[sessionId]) return
              set((s) => ({
                sessions: updateSessionIn(s.sessions, sessionId, () => ({
                  slashCommands: normalizeSlashCommandList(commands),
                })),
              }))
            })
            .catch(() => {
            })
        }
        if (msg.subtype === 'session_cleared') {
          const session = get().sessions[sessionId]
          if (session?.elapsedTimer) clearInterval(session.elapsedTimer)
          update(() => ({
            messages: [],
            streamingText: '',
            streamingToolInput: '',
            activeToolUseId: null,
            activeToolName: null,
            activeThinkingId: null,
            pendingPermission: null,
            pendingComputerUsePermission: null,
            chatState: 'idle',
            elapsedTimer: null,
            elapsedSeconds: 0,
            statusVerb: '',
            apiRetry: null,
            tokenUsage: { input_tokens: 0, output_tokens: 0 },
            slashCommands: [],
            activeGoal: null,
            backgroundAgentTasks: {},
            agentTaskNotifications: {},
          }))
          clearPendingDelta(sessionId)
          clearPendingTaskToolUseIds(sessionId)
                useCLITaskStore.getState().clearTasks(sessionId)
          useSessionStore.getState().updateSessionTitle(sessionId, 'New Session')
          useTabStore.getState().updateTabTitle(sessionId, 'New Session')
          useTabStore.getState().updateTabStatus(sessionId, 'idle')
        }
        break
      case 'transcript_item': {
        const { item } = msg
        if (item.type === 'compact_summary') {
          const { id: _id, type: _type, timestamp, ...summaryUpdate } = item
          update((session) => ({
            chatState: session.chatState === 'compacting' ? 'thinking' : session.chatState,
            statusVerb: session.chatState === 'compacting' ? '' : session.statusVerb,
            messages: appendOrUpdateTailCompactSummary(session.messages, summaryUpdate, timestamp),
          }))
        } else if (item.type === 'goal_event') {
          update((session) => ({
            activeGoal: applyGoalEventToActiveGoal(session.activeGoal ?? null, item, item.timestamp),
            messages: [...session.messages, item],
          }))
        } else {
          update((session) => ({ messages: [...session.messages, item] }))
        }
        break
      }
      case 'background_task': {
        const { event, notification } = msg
        const now = Date.now()
        update((session) => {
          const backgroundAgentTasks = upsertBackgroundAgentTask(session.backgroundAgentTasks ?? {}, event, now)
          const task = backgroundAgentTasks[event.taskId]
          return {
            backgroundAgentTasks,
            ...(task ? { messages: upsertBackgroundTaskMessage(session.messages, task, now) } : {}),
            ...(notification
              ? { agentTaskNotifications: { ...session.agentTaskNotifications, [notification.toolUseId]: notification } }
              : {}),
          }
        })
        break
      }
      case 'pong':
        break
    }
  },
}))

function updateOptimisticSessionTitle(sessionId: string, content: string): void {
  const title = deriveSessionTitle(content)
  if (!title) return

  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId)
  if (!session || session.messageCount > 0 || !isPlaceholderSessionTitle(session.title)) return

  useSessionStore.getState().updateSessionTitle(sessionId, title)
  useTabStore.getState().updateTabTitle(sessionId, title)
}

function readNonEmptyString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  const record = readRecord(value)
  if (record) return record
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    return readRecord(JSON.parse(trimmed))
  } catch {
    return null
  }
}

function findToolUseMessage(messages: UIMessage[], toolUseId: string): ToolCall | null {
  return messages.find((
    message,
  ): message is ToolCall =>
    message.type === 'tool_use' &&
    message.toolUseId === toolUseId) ?? null
}

function getStoppedBackgroundTaskFromToolResult(
  messages: UIMessage[],
  toolUseId: string,
  content: unknown,
): (Partial<BackgroundAgentTask> & Pick<BackgroundAgentTask, 'taskId' | 'status'>) | null {
  const toolUse = findToolUseMessage(messages, toolUseId)
  if (!toolUse || !TASK_STOP_TOOL_NAMES.has(toolUse.toolName)) return null

  const input = readRecord(toolUse.input) ?? {}
  const output = parseJsonRecord(content) ?? {}
  const taskId = readNonEmptyString(output, 'task_id', 'taskId') ??
    readNonEmptyString(input, 'task_id', 'taskId', 'shell_id', 'shellId')
  if (!taskId) return null

  return {
    taskId,
    status: 'stopped',
    taskType: readNonEmptyString(output, 'task_type', 'taskType'),
    description: readNonEmptyString(output, 'command', 'description', 'message'),
    summary: readNonEmptyString(output, 'message'),
  }
}

function upsertBackgroundAgentTask(
  current: Record<string, BackgroundAgentTask>,
  event: Partial<BackgroundAgentTask> & Pick<BackgroundAgentTask, 'taskId' | 'status'>,
  now: number,
): Record<string, BackgroundAgentTask> {
  const existingKey = current[event.taskId]
    ? event.taskId
    : event.toolUseId
      ? Object.keys(current).find((key) =>
        key === event.toolUseId || current[key]?.toolUseId === event.toolUseId)
      : undefined
  const existing = existingKey ? current[existingKey] : undefined
  const next = { ...current }
  if (existingKey && existingKey !== event.taskId) {
    delete next[existingKey]
  }
  return {
    ...next,
    [event.taskId]: {
      taskId: event.taskId,
      toolUseId: event.toolUseId ?? existing?.toolUseId,
      status: event.status,
      description: event.description ?? existing?.description,
      taskType: event.taskType ?? existing?.taskType,
      workflowName: event.workflowName ?? existing?.workflowName,
      prompt: event.prompt ?? existing?.prompt,
      summary: event.summary ?? existing?.summary,
      lastToolName: event.lastToolName ?? existing?.lastToolName,
      outputFile: event.outputFile ?? existing?.outputFile,
      usage: event.usage ?? existing?.usage,
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
    },
  }
}

function applyGoalEventToActiveGoal(
  current: ActiveGoalState | null,
  event: Omit<Extract<UIMessage, { type: 'goal_event' }>, 'id' | 'type' | 'timestamp'>,
  updatedAt: number,
): ActiveGoalState | null {
  if (event.action === 'cleared') return null
  if (
    event.action === 'message' &&
    event.message &&
    /no (active )?goal/i.test(event.message)
  ) {
    return current
  }
  if (event.action === 'message') return current
  const baseGoal = event.action === 'created' || event.action === 'replaced' ? null : current

  return {
    action: event.action,
    status: event.status ?? (event.action === 'completed' ? 'complete' : baseGoal?.status),
    objective: event.objective ?? baseGoal?.objective,
    budget: event.budget ?? baseGoal?.budget,
    elapsed: event.elapsed ?? baseGoal?.elapsed,
    continuations: event.continuations ?? baseGoal?.continuations,
    message: event.message ?? baseGoal?.message,
    updatedAt,
  }
}

function deriveActiveGoalFromMessages(messages: UIMessage[]): ActiveGoalState | null {
  return messages.reduce<ActiveGoalState | null>((activeGoal, message) => {
    if (message.type !== 'goal_event') return activeGoal
    return applyGoalEventToActiveGoal(activeGoal, message, message.timestamp)
  }, null)
}

function backgroundTaskRecordFromNotifications(
  notifications: AgentTaskNotification[],
): Record<string, BackgroundAgentTask> {
  return notifications.reduce<Record<string, BackgroundAgentTask>>((tasks, notification) => {
    const parsedTimestamp = notification.timestamp ? new Date(notification.timestamp).getTime() : NaN
    const now = Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now()
    return upsertBackgroundAgentTask(tasks, {
      taskId: notification.taskId,
      toolUseId: notification.toolUseId,
      status: notification.status,
      summary: notification.summary,
      outputFile: notification.outputFile,
      usage: notification.usage,
    }, now)
  }, {})
}

function mergeBackgroundAgentTaskRecords(
  current: Record<string, BackgroundAgentTask>,
  restored: Record<string, BackgroundAgentTask>,
): Record<string, BackgroundAgentTask> {
  return Object.values(restored).reduce(
    (tasks, task) => upsertBackgroundAgentTask(tasks, task, task.updatedAt),
    current,
  )
}

function buildModelContent(content: string, attachments?: AttachmentRef[]): string {
  const paths = attachments
    ?.map((attachment) => attachment.path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0) ?? []
  const trimmed = content.trim()
  if (paths.length === 0) return trimmed
  const prefix = paths.map((path) => `@"${path}"`).join(' ')
  return `${prefix} ${trimmed || 'Please analyze the attached files.'}`.trim()
}
