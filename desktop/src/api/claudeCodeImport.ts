import { api } from './client'

export type ClaudeCodeImportJob = {
  state: 'running' | 'done' | 'failed'
  total: number
  copied: number
  skipped: number
  error?: string
}

export type ClaudeCodeImportStatus = {
  claudeCodeDir: string | null
  claudeCodeHasData: boolean
  dreamcoderHasData: boolean
  decided: boolean
  incomplete: boolean
  offer: boolean
  job: ClaudeCodeImportJob | null
}

export const claudeCodeImportApi = {
  getStatus() {
    return api.get<ClaudeCodeImportStatus>('/api/claude-code-import')
  },

  start() {
    return api.post<{ job: ClaudeCodeImportJob }>('/api/claude-code-import/start')
  },

  skip() {
    return api.post<{ ok: true }>('/api/claude-code-import/skip')
  },
}
