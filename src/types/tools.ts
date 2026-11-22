import type { TaskType } from '../Task.js'
import type { AgentId } from './ids.js'
import type {
  NormalizedAssistantMessage,
  NormalizedUserMessage,
} from './message.js'

export type BashProgress = {
  type: 'bash_progress'
  output: string
  fullOutput: string
  elapsedTimeSeconds: number
  totalLines: number
  totalBytes?: number
  taskId?: string
  timeoutMs?: number
}

export type PowerShellProgress = {
  type: 'powershell_progress'
  output: string
  fullOutput: string
  elapsedTimeSeconds: number
  totalLines: number
  totalBytes: number
  taskId?: string
  timeoutMs?: number
}

export type ShellProgress = BashProgress | PowerShellProgress

export type AgentToolProgress = {
  type: 'agent_progress'
  message: NormalizedAssistantMessage | NormalizedUserMessage
  prompt: string
  agentId: AgentId
}

export type SkillToolProgress = {
  type: 'skill_progress'
  message: NormalizedAssistantMessage | NormalizedUserMessage
  prompt: string
  agentId: AgentId
}

export type MCPProgress = {
  type: 'mcp_progress'
  status: 'started' | 'completed' | 'failed' | 'progress'
  serverName: string
  toolName: string
  elapsedTimeMs?: number
  progress?: number
  total?: number
  progressMessage?: string
}

export type WebSearchProgress =
  | { type: 'query_update'; query: string }
  | { type: 'search_results_received'; resultCount: number; query: string }

export type TaskOutputProgress = {
  type: 'waiting_for_task'
  taskDescription: string
  taskType: TaskType
}

export type ToolProgressData =
  | AgentToolProgress
  | BashProgress
  | MCPProgress
  | PowerShellProgress
  | SkillToolProgress
  | TaskOutputProgress
  | WebSearchProgress
