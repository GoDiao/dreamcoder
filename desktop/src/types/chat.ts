import type {
  PermissionGuardrailDetails,
  TaskNotification,
  TaskUsage,
  TranscriptItem,
  UserMessageOrigin,
} from '@protocol'

export type {
  AttachmentRef,
  ChatState,
  ClientMessage,
  GoalEventAction,
  MemoryEventFile,
  BrowserActivity,
  PendingBrowserGrant,
  PendingPermission,
  ServerMessage,
  SessionState,
  SessionStatePatch,
  TeamMemberStatus,
  TokenUsage,
  UserMessageOrigin,
} from '@protocol'
export type { PermissionGuardrailDetails }
import type { ClientKind, GoalEventAction } from '@protocol'

export type SessionOrigin = Extract<UserMessageOrigin, { kind: 'session' }>
export type KanbanOrigin = Extract<UserMessageOrigin, { kind: 'kanban' }>

export type PermissionResolution = {
  outcome: 'allowed' | 'denied' | 'withdrawn'
  remote: boolean
  by?: ClientKind
}

export type AgentTaskNotification = TaskNotification
export type BackgroundAgentTaskUsage = TaskUsage

export type UIAttachment = {
  type: 'file' | 'image'
  name: string
  path?: string
  data?: string
  mimeType?: string
  isDirectory?: boolean
  lineStart?: number
  lineEnd?: number
  note?: string
  quote?: string
}

export type ApiRetryState = {
  attempt: number
  maxRetries: number
  retryDelayMs: number
  errorStatus: number | null
  errorType?: string
  errorMessage?: string
  receivedAt: number
}

export type BackgroundAgentTask = {
  taskId: string
  toolUseId?: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  description?: string
  taskType?: string
  workflowName?: string
  prompt?: string
  summary?: string
  lastToolName?: string
  outputFile?: string
  usage?: BackgroundAgentTaskUsage
  startedAt: number
  updatedAt: number
}

export type ActiveGoalState = {
  action: Exclude<GoalEventAction, 'cleared' | 'message'>
  status?: string
  objective?: string
  budget?: string
  elapsed?: string
  continuations?: string
  message?: string
  updatedAt: number
}

export type TaskSummaryItem = {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

/** Items the transcript yields as they are: shared with the server, so they cannot drift. */
type SharedItem<T extends TranscriptItem['type']> = Extract<TranscriptItem, { type: T }>

export type UIMessage =
  | { id: string; type: 'user_text'; content: string; modelContent?: string; transcriptMessageId?: string; origin?: UserMessageOrigin; timestamp: number; attachments?: UIAttachment[]; pending?: boolean }
  | SharedItem<'assistant_text'>
  | SharedItem<'thinking'>
  | {
      id: string
      type: 'tool_use'
      toolName: string
      toolUseId: string
      input: unknown
      timestamp: number
      parentToolUseId?: string
      isPending?: boolean
      partialInput?: string
    }
  | SharedItem<'tool_result'>
  | { id: string; type: 'background_task'; task: BackgroundAgentTask; timestamp: number }
  | { id: string; type: 'system'; content: string; timestamp: number }
  | SharedItem<'compact_summary'>
  | SharedItem<'goal_event'>
  | SharedItem<'memory_event'>
  | SharedItem<'permission_guardrail_decision'>
  | {
      id: string
      type: 'permission_request'
      requestId: string
      toolName: string
      toolUseId?: string
      input: unknown
      description?: string
      guardrail?: PermissionGuardrailDetails
      alwaysAsks?: true
      timestamp: number
      resolution?: PermissionResolution
    }
  | { id: string; type: 'error'; message: string; code: string; timestamp: number }
  | { id: string; type: 'task_summary'; tasks: TaskSummaryItem[]; timestamp: number }
