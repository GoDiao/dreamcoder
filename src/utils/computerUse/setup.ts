import { buildMcpToolName } from '../../services/mcp/mcpStringUtils.js'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import { CUA_MCP_SERVER_NAME } from './common.js'

/**
 * cua-driver 0.34.0 tools that only read state and are allowed without a
 * prompt (ADR-0002). Every one is annotated `readOnlyHint: true` by cua.
 *
 * Deliberately left out, although annotated read-only:
 * - `get_window_state`, `get_desktop_state`: `screenshot_out_file` writes a
 *   PNG to any path the model names (checked against 0.34.0: a write to
 *   ~/Library succeeded without any authorization).
 * - `clipboard_read`: privacy.
 * - `check_for_update`: network access.
 * - `parse_visual_regions`: depends on the visual-region model (non-goal).
 * Tools added by newer cua-driver versions are not listed, so they prompt.
 */
export const CUA_READONLY_TOOLS = [
  'get_screen_size',
  'get_cursor_position',
  'list_apps',
  'list_windows',
  'get_accessibility_tree',
  'zoom',
  'get_browser_state',
  'verify_state',
  'health_report',
  'get_config',
  'get_session',
  'list_sessions',
  'get_session_state',
  'get_recording_state',
  'get_agent_cursor_state',
] as const

export type CuaDriverMcpSetup = {
  mcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
}

/**
 * Builds the dynamic `cua` stdio MCP server entry for a resolved cua-driver
 * path. A plain stdio server: the MCP client spawns `cua-driver mcp`.
 */
export function setupCuaDriverMCP(
  driverPath: string,
  env: Record<string, string>,
): CuaDriverMcpSetup {
  return {
    mcpConfig: {
      [CUA_MCP_SERVER_NAME]: {
        type: 'stdio',
        command: driverPath,
        args: ['mcp'],
        env: { ...env },
        scope: 'dynamic',
      },
    },
    allowedTools: CUA_READONLY_TOOLS.map(tool =>
      buildMcpToolName(CUA_MCP_SERVER_NAME, tool),
    ),
  }
}
