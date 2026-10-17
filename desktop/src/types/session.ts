import type { AgentTaskNotification, UIMessage } from './chat'

export type SessionListItem = {
  id: string
  title: string
  createdAt: string
  modifiedAt: string
  messageCount: number
  projectPath: string
  projectRoot?: string | null
  workDir: string | null
  workDirExists: boolean
  lastAssistantMessage?: string
}

export type MessageEntry = {
  id: string
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result'
  content: unknown
  toolUseResult?: unknown
  timestamp: string
  model?: string
  parentUuid?: string
  parentToolUseId?: string
  isSidechain?: boolean
}

/**
 * The server's reading of a CLI transcript, for a session or a team member:
 * display items plus what the desktop restores alongside them.
 */
export type SessionTranscript = {
  items: UIMessage[]
  /** Terminal task notifications keyed by the tool use id of the task's tool call. */
  agentNotifications: Record<string, AgentTaskNotification>
  lastTodos: Array<{ content: string; status: string; activeForm?: string }> | null
  hasMessagesAfterTaskCompletion: boolean
}

export type SessionDetail = SessionListItem & {
  messages: MessageEntry[]
}
