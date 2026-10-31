/**
 * The WebSocket protocol between the server and the desktop. The desktop
 * imports this file type-only (`@protocol`), so it must not import anything
 * that needs Node or the SDK.
 */
import type { BackgroundTaskEvent, TaskNotification, TaskUsage } from '../transcript/classify.js'
import type { TranscriptItem } from '../transcript/items.js'
import type { SessionState, SessionStatePatch } from '../session/state/types.js'

export type { BackgroundTaskEvent, TaskNotification, TaskUsage }
export type { GoalEventAction } from '../transcript/classify.js'
export type { MemoryEventFile, TranscriptAttachment, TranscriptItem } from '../transcript/items.js'
export type {
  ActiveGoal,
  BackgroundTaskSummary,
  BrowserActivity,
  PendingBrowserGrant,
  PendingPermission,
  ProcessDetail,
  ProcessPhase,
  RuntimeSelection,
  SessionState,
  SessionStateKey,
  SessionStatePatch,
  TurnActivity,
  TurnPhase,
  UiPageSummary,
} from '../session/state/types.js'

/** The permission modes a client may set; mirrors the CLI's `ExternalPermissionMode`. */
export type PermissionMode = 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan'

export const PERMISSION_MODES: readonly PermissionMode[] = ['acceptEdits', 'bypassPermissions', 'default', 'dontAsk', 'plan']

export type ClientKind = 'desktop' | 'h5'

export type DefaultPermissionMode = Exclude<PermissionMode, 'dontAsk'>

export const DEFAULT_PERMISSION_MODES: readonly DefaultPermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']

export const BROWSER_SEARCH_ENGINE_IDS = ['bing', 'google', 'duckduckgo', 'baidu'] as const

export type BrowserSearchEngineId = (typeof BROWSER_SEARCH_ENGINE_IDS)[number]

export const DEFAULT_BROWSER_SEARCH_ENGINE: BrowserSearchEngineId = 'bing'

export function isBrowserSearchEngineId(value: unknown): value is BrowserSearchEngineId {
  return typeof value === 'string' && (BROWSER_SEARCH_ENGINE_IDS as readonly string[]).includes(value)
}

export type ClientMessage =
  | { type: 'prewarm_session' }
  | { type: 'user_message'; content: string; attachments?: AttachmentRef[]; id?: string }
  | { type: 'request_snapshot' }
  | {
      type: 'permission_response'
      requestId: string
      allowed: boolean
      rule?: string
      updatedInput?: Record<string, unknown>
    }
  | { type: 'set_permission_mode'; mode: PermissionMode }
  | { type: 'set_runtime_config'; providerId: string | null; modelId: string; effort?: string }
  | { type: 'stop_generation' }
  | { type: 'ping' }

export type AttachmentRef = {
  type: 'file' | 'image'
  name?: string
  path?: string
  data?: string
  mimeType?: string
  isDirectory?: boolean
  lineStart?: number
  lineEnd?: number
  note?: string
  quote?: string
}

/** Transcript items the server recognizes in a live conversation and sends as they are. */
export type LiveTranscriptItem = Extract<TranscriptItem, { type: 'goal_event' | 'compact_summary' | 'memory_event' }>

export type ServerMessage =
  | { type: 'connected'; sessionId: string }
  | { type: 'session_snapshot'; state: SessionState }
  | { type: 'session_patch'; version: number; changes: SessionStatePatch }
  | { type: 'user_message'; id: string; content: string }
  | { type: 'message_id'; id: string }
  | { type: 'content_start'; blockType: 'text' | 'tool_use'; toolName?: string; toolUseId?: string; parentToolUseId?: string }
  | { type: 'content_delta'; text?: string; toolInput?: string }
  | { type: 'tool_use_complete'; toolName: string; toolUseId: string; input: unknown; parentToolUseId?: string }
  | { type: 'tool_result'; toolUseId: string; content: unknown; isError: boolean; parentToolUseId?: string }
  | { type: 'permission_resolved'; requestId: string; allowed: boolean; by: ClientKind }
  | { type: 'message_complete'; usage: TokenUsage }
  | { type: 'thinking'; text: string }
  | {
      type: 'api_retry'
      attempt: number
      maxRetries: number
      retryDelayMs: number
      errorStatus: number | null
      errorType?: string
      errorMessage?: string
    }
  | { type: 'error'; message: string; code: string; retryable?: boolean }
  | { type: 'system_notification'; subtype: string; message?: string; data?: unknown }
  | { type: 'transcript_item'; item: LiveTranscriptItem }
  | { type: 'background_task'; event: BackgroundTaskEvent; notification?: TaskNotification }
  | { type: 'pong' }
  | { type: 'team_update'; teamName: string; members: TeamMemberStatus[] }
  | { type: 'team_created'; teamName: string }
  | { type: 'team_deleted'; teamName: string }
  | { type: 'task_update'; taskId: string; status: string; progress?: string }

export type TokenUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
}

export type ChatState = 'idle' | 'thinking' | 'compacting' | 'tool_executing' | 'streaming' | 'permission_pending'

export type TeamMemberStatus = {
  agentId: string
  role: string
  status: 'running' | 'idle' | 'completed' | 'error'
  currentTask?: string
}
