import { buildMcpToolName, getMcpPrefix } from '../../services/mcp/mcpStringUtils.js'
import { normalizeNameForMCP } from '../../services/mcp/normalization.js'
import {
  BROWSER_MCP_SERVER_NAME,
  BROWSER_TOOL_NAMES,
  type BrowserToolName,
} from '../../server/browserHost/names.js'

export { BROWSER_MCP_SERVER_NAME }

export function isBrowserControlMCPServer(name: string): boolean {
  return normalizeNameForMCP(name) === normalizeNameForMCP(BROWSER_MCP_SERVER_NAME)
}

export function browserToolName(tool: BrowserToolName): string {
  return buildMcpToolName(BROWSER_MCP_SERVER_NAME, tool)
}

export const BROWSER_TOOLS_PATTERN = `${getMcpPrefix(BROWSER_MCP_SERVER_NAME)}*`

export function allBrowserToolNames(): string[] {
  return BROWSER_TOOL_NAMES.map(browserToolName)
}
