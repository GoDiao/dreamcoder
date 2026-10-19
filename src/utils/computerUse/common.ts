import { normalizeNameForMCP } from '../../services/mcp/normalization.js'

/**
 * Name of the built-in Computer Use MCP server (cua-driver). Reserved: user
 * configs may not add a server with this name, and a user server with this
 * name in a config file is overridden by the built-in one.
 */
export const CUA_MCP_SERVER_NAME = 'cua'

export function isCuaMCPServer(name: string): boolean {
  return normalizeNameForMCP(name) === CUA_MCP_SERVER_NAME
}
