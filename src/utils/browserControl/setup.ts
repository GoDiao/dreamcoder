import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import {
  BROWSER_MCP_SERVER_NAME,
  BROWSER_MCP_TOKEN_ENV,
  BROWSER_MCP_URL_ENV,
} from '../../server/browserHost/names.js'
import { allBrowserToolNames } from './common.js'

export type BrowserControlMcpSetup = {
  mcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
}

export function setupBrowserControlMCP(
  env: Record<string, string | undefined>,
): BrowserControlMcpSetup | null {
  const url = env[BROWSER_MCP_URL_ENV]
  const token = env[BROWSER_MCP_TOKEN_ENV]
  if (!url || !token) return null
  delete env[BROWSER_MCP_URL_ENV]
  delete env[BROWSER_MCP_TOKEN_ENV]
  return {
    mcpConfig: {
      [BROWSER_MCP_SERVER_NAME]: {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${token}` },
        scope: 'dynamic',
      },
    },
    allowedTools: allBrowserToolNames(),
  }
}
