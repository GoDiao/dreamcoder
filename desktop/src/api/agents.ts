import { api } from './client'

export type AgentSource =
  | 'built-in'
  | 'plugin'
  | 'userSettings'
  // Display-only: a user agent inherited read-only from Claude Code's directory
  | 'claudeCode'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'

export type AgentDefinition = {
  agentType: string
  description?: string
  model?: string
  modelDisplay?: string
  tools?: string[]
  systemPrompt?: string
  color?: string
  source: AgentSource
  baseDir?: string
  overriddenBy?: AgentSource
  inheritedFromClaudeCode?: boolean
  isActive: boolean
}

function withDisplaySource(agent: AgentDefinition): AgentDefinition {
  return agent.inheritedFromClaudeCode ? { ...agent, source: 'claudeCode' } : agent
}

export type AgentListResponse = {
  activeAgents: AgentDefinition[]
  allAgents: AgentDefinition[]
}

export const agentsApi = {
  list: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<AgentListResponse>(`/api/agents${query}`).then((response) => ({
      activeAgents: response.activeAgents.map(withDisplaySource),
      allAgents: response.allAgents.map(withDisplaySource),
    }))
  },
}
