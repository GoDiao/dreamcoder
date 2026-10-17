import type { FileReference, GoalEventAction, TaskNotification } from './classify.js'

export type TranscriptAttachment =
  | FileReference
  | { type: 'image'; name: string; data?: string; mimeType?: string }
  | { type: 'file'; name: string }

export type MemoryEventFile = {
  path: string
  action?: 'saved' | 'updated' | 'created' | 'deleted' | 'loaded' | 'failed'
  summary?: string
}

/**
 * One displayable entry derived from a transcript. These are the transcript
 * part of the desktop's `UIMessage`; ids are derived from transcript uuids so
 * the same transcript always yields the same ids.
 */
export type TranscriptItem =
  | {
      id: string
      type: 'user_text'
      content: string
      modelContent?: string
      transcriptMessageId?: string
      timestamp: number
      attachments?: TranscriptAttachment[]
    }
  | { id: string; type: 'assistant_text'; content: string; transcriptMessageId?: string; timestamp: number; model?: string }
  | { id: string; type: 'thinking'; content: string; timestamp: number }
  | {
      id: string
      type: 'tool_use'
      toolName: string
      toolUseId: string
      input: unknown
      timestamp: number
      parentToolUseId?: string
    }
  | {
      id: string
      type: 'tool_result'
      toolUseId: string
      content: unknown
      isError: boolean
      timestamp: number
      parentToolUseId?: string
    }
  | {
      id: string
      type: 'compact_summary'
      title: string
      phase?: 'compacting' | 'complete'
      summary?: string
      timestamp: number
    }
  | {
      id: string
      type: 'goal_event'
      action: GoalEventAction
      status?: string
      objective?: string
      budget?: string
      elapsed?: string
      continuations?: string
      message?: string
      timestamp: number
    }
  | {
      id: string
      type: 'memory_event'
      event: 'saved'
      files: MemoryEventFile[]
      message?: string
      teamCount?: number
      timestamp: number
    }

export type TodoItem = { content: string; status: string; activeForm?: string }

/** Everything the desktop needs to restore a session from its transcript. */
export type SessionTranscript = {
  items: TranscriptItem[]
  /** Terminal task notifications keyed by the tool use id of the task's tool call. */
  agentNotifications: Record<string, TaskNotification>
  /** The latest TodoWrite list, unless it was finished and the user moved on. */
  lastTodos: TodoItem[] | null
  hasMessagesAfterTaskCompletion: boolean
}
