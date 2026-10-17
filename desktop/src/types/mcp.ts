export type McpEditableConfig =
  | {
      type: 'stdio'
      command: string
      args: string[]
      env: Record<string, string>
    }
  | {
      type: 'http' | 'sse'
      url: string
      headers: Record<string, string>
      headersHelper?: string
      oauth?: {
        clientId?: string
        callbackPort?: number
      }
    }
  | {
      type: string
    }

export type McpServerRecord = {
  name: string
  scope: string
  transport: string
  enabled: boolean
  status: 'connected' | 'needs-auth' | 'failed' | 'disabled' | 'checking'
  statusLabel: string
  statusDetail?: string
  configLocation: string
  summary: string
  canEdit: boolean
  canRemove: boolean
  canReconnect: boolean
  canToggle: boolean
  config: McpEditableConfig
  projectPath?: string
}

export type McpWritableScope = 'local' | 'project' | 'user'

export type McpCatalogEnvironmentVariable = {
  name: string
  source: 'user' | 'system' | 'optional'
  description?: string
}

export type McpCatalogEntry = {
  id: string
  name: string
  description: string
  transport: 'stdio'
  command: string
  args: string[]
  env: McpCatalogEnvironmentVariable[]
  homepage: string
  tags: string[]
  runtime: 'node' | 'bun' | 'python' | 'uvx' | 'binary'
  version?: string
  notes?: string
}

export type McpCatalog = { version: number; servers: McpCatalogEntry[] }

export type McpUpsertPayload = {
  scope: McpWritableScope
  config: McpEditableConfig
}
