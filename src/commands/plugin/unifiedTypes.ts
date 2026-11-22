import type {
  ConfigScope,
  MCPServerConnection,
} from '../../services/mcp/types.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import type { PluginScope } from '../../utils/plugins/schemas.js'

export type UnifiedInstalledItem =
  | {
      type: 'plugin'
      id: string
      name: string
      description: string | undefined
      marketplace: string
      scope: PluginScope | 'builtin'
      isEnabled: boolean
      errorCount: number
      errors: PluginError[]
      plugin: LoadedPlugin
      pendingEnable?: boolean
      pendingUpdate?: boolean
      pendingToggle?: 'will-enable' | 'will-disable'
    }
  | {
      type: 'failed-plugin'
      id: string
      name: string
      marketplace: string
      scope: PluginScope
      errorCount: number
      errors: PluginError[]
    }
  | {
      type: 'mcp'
      id: string
      name: string
      description: undefined
      scope: ConfigScope
      status: 'connected' | 'disabled' | 'pending' | 'needs-auth' | 'failed'
      client: MCPServerConnection
      indented?: boolean
    }
  | {
      type: 'flagged-plugin'
      id: string
      name: string
      marketplace: string
      scope: 'flagged'
      reason: 'delisted'
      text: string
      flaggedAt: string
    }
