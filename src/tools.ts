// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { toolMatchesName, type Tool, type Tools } from './Tool.js'

// Lazy-loaded tool modules - loaded on first use to reduce cold start time
let _AgentTool: typeof import('./tools/AgentTool/AgentTool.js').AgentTool | null = null
let _SkillTool: typeof import('./tools/SkillTool/SkillTool.js').SkillTool | null = null
let _BashTool: typeof import('./tools/BashTool/BashTool.js').BashTool | null = null
let _FileEditTool: typeof import('./tools/FileEditTool/FileEditTool.js').FileEditTool | null = null
let _FileReadTool: typeof import('./tools/FileReadTool/FileReadTool.js').FileReadTool | null = null
let _FileWriteTool: typeof import('./tools/FileWriteTool/FileWriteTool.js').FileWriteTool | null = null
let _GlobTool: typeof import('./tools/GlobTool/GlobTool.js').GlobTool | null = null
let _NotebookEditTool: typeof import('./tools/NotebookEditTool/NotebookEditTool.js').NotebookEditTool | null = null
let _WebFetchTool: typeof import('./tools/WebFetchTool/WebFetchTool.js').WebFetchTool | null = null
let _TaskStopTool: typeof import('./tools/TaskStopTool/TaskStopTool.js').TaskStopTool | null = null
let _BriefTool: typeof import('./tools/BriefTool/BriefTool.js').BriefTool | null = null

function lazyLoadTools() {
  if (!_AgentTool) {
    _AgentTool = require('./tools/AgentTool/AgentTool.js').AgentTool
    _SkillTool = require('./tools/SkillTool/SkillTool.js').SkillTool
    _BashTool = require('./tools/BashTool/BashTool.js').BashTool
    _FileEditTool = require('./tools/FileEditTool/FileEditTool.js').FileEditTool
    _FileReadTool = require('./tools/FileReadTool/FileReadTool.js').FileReadTool
    _FileWriteTool = require('./tools/FileWriteTool/FileWriteTool.js').FileWriteTool
    _GlobTool = require('./tools/GlobTool/GlobTool.js').GlobTool
    _NotebookEditTool = require('./tools/NotebookEditTool/NotebookEditTool.js').NotebookEditTool
    _WebFetchTool = require('./tools/WebFetchTool/WebFetchTool.js').WebFetchTool
    _TaskStopTool = require('./tools/TaskStopTool/TaskStopTool.js').TaskStopTool
    _BriefTool = require('./tools/BriefTool/BriefTool.js').BriefTool
  }
}

// Getter functions for lazy-loaded tools
const getAgentTool = () => { lazyLoadTools(); return _AgentTool! }
const getSkillTool = () => { lazyLoadTools(); return _SkillTool! }
const getBashTool = () => { lazyLoadTools(); return _BashTool! }
const getFileEditTool = () => { lazyLoadTools(); return _FileEditTool! }
const getFileReadTool = () => { lazyLoadTools(); return _FileReadTool! }
const getFileWriteTool = () => { lazyLoadTools(); return _FileWriteTool! }
const getGlobTool = () => { lazyLoadTools(); return _GlobTool! }
const getNotebookEditTool = () => { lazyLoadTools(); return _NotebookEditTool! }
const getWebFetchTool = () => { lazyLoadTools(); return _WebFetchTool! }
const getTaskStopTool = () => { lazyLoadTools(); return _TaskStopTool! }
const getBriefTool = () => { lazyLoadTools(); return _BriefTool! }
// Dead code elimination: conditional import for ant-only tools
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const REPLTool =
  process.env.USER_TYPE === 'ant'
    ? require('./tools/REPLTool/REPLTool.js').REPLTool
    : null
const SuggestBackgroundPRTool =
  process.env.USER_TYPE === 'ant'
    ? require('./tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.js')
        .SuggestBackgroundPRTool
    : null
const SleepTool =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('./tools/SleepTool/SleepTool.js').SleepTool
    : null
const cronTools = feature('AGENT_TRIGGERS')
  ? [
      require('./tools/ScheduleCronTool/CronCreateTool.js').CronCreateTool,
      require('./tools/ScheduleCronTool/CronUpdateTool.js').CronUpdateTool,
      require('./tools/ScheduleCronTool/CronDeleteTool.js').CronDeleteTool,
      require('./tools/ScheduleCronTool/CronListTool.js').CronListTool,
    ]
  : []
const RemoteTriggerTool = feature('AGENT_TRIGGERS_REMOTE')
  ? require('./tools/RemoteTriggerTool/RemoteTriggerTool.js').RemoteTriggerTool
  : null
const MonitorTool = feature('MONITOR_TOOL')
  ? require('./tools/MonitorTool/MonitorTool.js').MonitorTool
  : null
const SendUserFileTool = feature('KAIROS')
  ? require('./tools/SendUserFileTool/SendUserFileTool.js').SendUserFileTool
  : null
const PushNotificationTool =
  feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION')
    ? require('./tools/PushNotificationTool/PushNotificationTool.js')
        .PushNotificationTool
    : null
const SubscribePRTool = feature('KAIROS_GITHUB_WEBHOOKS')
  ? require('./tools/SubscribePRTool/SubscribePRTool.js').SubscribePRTool
  : null
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */

// Lazy-loaded tool modules (continued)
let _TaskOutputTool: typeof import('./tools/TaskOutputTool/TaskOutputTool.js').TaskOutputTool | null = null
let _WebSearchTool: typeof import('./tools/WebSearchTool/WebSearchTool.js').WebSearchTool | null = null
let _TodoWriteTool: typeof import('./tools/TodoWriteTool/TodoWriteTool.js').TodoWriteTool | null = null
let _ExitPlanModeV2Tool: typeof import('./tools/ExitPlanModeTool/ExitPlanModeV2Tool.js').ExitPlanModeV2Tool | null = null
let _TestingPermissionTool: typeof import('./tools/testing/TestingPermissionTool.js').TestingPermissionTool | null = null
let _GrepTool: typeof import('./tools/GrepTool/GrepTool.js').GrepTool | null = null
let _TungstenTool: typeof import('./tools/TungstenTool/TungstenTool.js').TungstenTool | null = null

function lazyLoadMoreTools() {
  if (!_TaskOutputTool) {
    _TaskOutputTool = require('./tools/TaskOutputTool/TaskOutputTool.js').TaskOutputTool
    _WebSearchTool = require('./tools/WebSearchTool/WebSearchTool.js').WebSearchTool
    _TodoWriteTool = require('./tools/TodoWriteTool/TodoWriteTool.js').TodoWriteTool
    _ExitPlanModeV2Tool = require('./tools/ExitPlanModeTool/ExitPlanModeV2Tool.js').ExitPlanModeV2Tool
    _TestingPermissionTool = require('./tools/testing/TestingPermissionTool.js').TestingPermissionTool
    _GrepTool = require('./tools/GrepTool/GrepTool.js').GrepTool
    _TungstenTool = require('./tools/TungstenTool/TungstenTool.js').TungstenTool
  }
}

const getTaskOutputTool = () => { lazyLoadMoreTools(); return _TaskOutputTool! }
const getWebSearchTool = () => { lazyLoadMoreTools(); return _WebSearchTool! }
const getTodoWriteTool = () => { lazyLoadMoreTools(); return _TodoWriteTool! }
const getExitPlanModeV2Tool = () => { lazyLoadMoreTools(); return _ExitPlanModeV2Tool! }
const getTestingPermissionTool = () => { lazyLoadMoreTools(); return _TestingPermissionTool! }
const getGrepTool = () => { lazyLoadMoreTools(); return _GrepTool! }
const getTungstenTool = () => { lazyLoadMoreTools(); return _TungstenTool! }
// Lazy require to break circular dependency: tools.ts -> TeamCreateTool/TeamDeleteTool -> ... -> tools.ts
/* eslint-disable @typescript-eslint/no-require-imports */
const getTeamCreateTool = () =>
  require('./tools/TeamCreateTool/TeamCreateTool.js')
    .TeamCreateTool as typeof import('./tools/TeamCreateTool/TeamCreateTool.js').TeamCreateTool
const getTeamDeleteTool = () =>
  require('./tools/TeamDeleteTool/TeamDeleteTool.js')
    .TeamDeleteTool as typeof import('./tools/TeamDeleteTool/TeamDeleteTool.js').TeamDeleteTool
const getSendMessageTool = () =>
  require('./tools/SendMessageTool/SendMessageTool.js')
    .SendMessageTool as typeof import('./tools/SendMessageTool/SendMessageTool.js').SendMessageTool
/* eslint-enable @typescript-eslint/no-require-imports */

// Lazy-loaded tool modules (continued)
let _AskUserQuestionTool: typeof import('./tools/AskUserQuestionTool/AskUserQuestionTool.js').AskUserQuestionTool | null = null
let _LSPTool: typeof import('./tools/LSPTool/LSPTool.js').LSPTool | null = null
let _ListMcpResourcesTool: typeof import('./tools/ListMcpResourcesTool/ListMcpResourcesTool.js').ListMcpResourcesTool | null = null
let _ReadMcpResourceTool: typeof import('./tools/ReadMcpResourceTool/ReadMcpResourceTool.js').ReadMcpResourceTool | null = null
let _ToolSearchTool: typeof import('./tools/ToolSearchTool/ToolSearchTool.js').ToolSearchTool | null = null
let _EnterPlanModeTool: typeof import('./tools/EnterPlanModeTool/EnterPlanModeTool.js').EnterPlanModeTool | null = null
let _EnterWorktreeTool: typeof import('./tools/EnterWorktreeTool/EnterWorktreeTool.js').EnterWorktreeTool | null = null
let _ExitWorktreeTool: typeof import('./tools/ExitWorktreeTool/ExitWorktreeTool.js').ExitWorktreeTool | null = null
let _ConfigTool: typeof import('./tools/ConfigTool/ConfigTool.js').ConfigTool | null = null
let _TaskCreateTool: typeof import('./tools/TaskCreateTool/TaskCreateTool.js').TaskCreateTool | null = null
let _TaskGetTool: typeof import('./tools/TaskGetTool/TaskGetTool.js').TaskGetTool | null = null
let _TaskUpdateTool: typeof import('./tools/TaskUpdateTool/TaskUpdateTool.js').TaskUpdateTool | null = null
let _TaskListTool: typeof import('./tools/TaskListTool/TaskListTool.js').TaskListTool | null = null

function lazyLoadEvenMoreTools() {
  if (!_AskUserQuestionTool) {
    _AskUserQuestionTool = require('./tools/AskUserQuestionTool/AskUserQuestionTool.js').AskUserQuestionTool
    _LSPTool = require('./tools/LSPTool/LSPTool.js').LSPTool
    _ListMcpResourcesTool = require('./tools/ListMcpResourcesTool/ListMcpResourcesTool.js').ListMcpResourcesTool
    _ReadMcpResourceTool = require('./tools/ReadMcpResourceTool/ReadMcpResourceTool.js').ReadMcpResourceTool
    _ToolSearchTool = require('./tools/ToolSearchTool/ToolSearchTool.js').ToolSearchTool
    _EnterPlanModeTool = require('./tools/EnterPlanModeTool/EnterPlanModeTool.js').EnterPlanModeTool
    _EnterWorktreeTool = require('./tools/EnterWorktreeTool/EnterWorktreeTool.js').EnterWorktreeTool
    _ExitWorktreeTool = require('./tools/ExitWorktreeTool/ExitWorktreeTool.js').ExitWorktreeTool
    _ConfigTool = require('./tools/ConfigTool/ConfigTool.js').ConfigTool
    _TaskCreateTool = require('./tools/TaskCreateTool/TaskCreateTool.js').TaskCreateTool
    _TaskGetTool = require('./tools/TaskGetTool/TaskGetTool.js').TaskGetTool
    _TaskUpdateTool = require('./tools/TaskUpdateTool/TaskUpdateTool.js').TaskUpdateTool
    _TaskListTool = require('./tools/TaskListTool/TaskListTool.js').TaskListTool
  }
}

const getAskUserQuestionTool = () => { lazyLoadEvenMoreTools(); return _AskUserQuestionTool! }
const getLSPTool = () => { lazyLoadEvenMoreTools(); return _LSPTool! }
const getListMcpResourcesTool = () => { lazyLoadEvenMoreTools(); return _ListMcpResourcesTool! }
const getReadMcpResourceTool = () => { lazyLoadEvenMoreTools(); return _ReadMcpResourceTool! }
const getToolSearchTool = () => { lazyLoadEvenMoreTools(); return _ToolSearchTool! }
const getEnterPlanModeTool = () => { lazyLoadEvenMoreTools(); return _EnterPlanModeTool! }
const getEnterWorktreeTool = () => { lazyLoadEvenMoreTools(); return _EnterWorktreeTool! }
const getExitWorktreeTool = () => { lazyLoadEvenMoreTools(); return _ExitWorktreeTool! }
const getConfigTool = () => { lazyLoadEvenMoreTools(); return _ConfigTool! }
const getTaskCreateTool = () => { lazyLoadEvenMoreTools(); return _TaskCreateTool! }
const getTaskGetTool = () => { lazyLoadEvenMoreTools(); return _TaskGetTool! }
const getTaskUpdateTool = () => { lazyLoadEvenMoreTools(); return _TaskUpdateTool! }
const getTaskListTool = () => { lazyLoadEvenMoreTools(); return _TaskListTool! }

import uniqBy from 'lodash-es/uniqBy.js'
import { isToolSearchEnabledOptimistic } from './utils/toolSearch.js'
import { isTodoV2Enabled } from './utils/tasks.js'
// Dead code elimination: conditional import for CLAUDE_CODE_VERIFY_PLAN
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const VerifyPlanExecutionTool =
  process.env.CLAUDE_CODE_VERIFY_PLAN === 'true'
    ? require('./tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.js')
        .VerifyPlanExecutionTool
    : null
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
import { SYNTHETIC_OUTPUT_TOOL_NAME } from './tools/SyntheticOutputTool/SyntheticOutputTool.js'
export {
  ALL_AGENT_DISALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  COORDINATOR_MODE_ALLOWED_TOOLS,
} from './constants/tools.js'
import { feature } from 'bun:bundle'
// Dead code elimination: conditional import for OVERFLOW_TEST_TOOL
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const OverflowTestTool = feature('OVERFLOW_TEST_TOOL')
  ? require('./tools/OverflowTestTool/OverflowTestTool.js').OverflowTestTool
  : null
const CtxInspectTool = feature('CONTEXT_COLLAPSE')
  ? require('./tools/CtxInspectTool/CtxInspectTool.js').CtxInspectTool
  : null
const TerminalCaptureTool = feature('TERMINAL_PANEL')
  ? require('./tools/TerminalCaptureTool/TerminalCaptureTool.js')
      .TerminalCaptureTool
  : null
const WebBrowserTool = feature('WEB_BROWSER_TOOL')
  ? require('./tools/WebBrowserTool/WebBrowserTool.js').WebBrowserTool
  : null
const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? (require('./coordinator/coordinatorMode.js') as typeof import('./coordinator/coordinatorMode.js'))
  : null
const SnipTool = feature('HISTORY_SNIP')
  ? require('./tools/SnipTool/SnipTool.js').SnipTool
  : null
const ListPeersTool = feature('UDS_INBOX')
  ? require('./tools/ListPeersTool/ListPeersTool.js').ListPeersTool
  : null
const WorkflowTool = feature('WORKFLOW_SCRIPTS')
  ? (() => {
      require('./tools/WorkflowTool/bundled/index.js').initBundledWorkflows()
      return require('./tools/WorkflowTool/WorkflowTool.js').WorkflowTool
    })()
  : null
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
import type { ToolPermissionContext } from './Tool.js'
import { getDenyRuleForTool } from './utils/permissions/permissions.js'
import { hasEmbeddedSearchTools } from './utils/embeddedTools.js'
import { isEnvTruthy } from './utils/envUtils.js'
import { isPowerShellToolEnabled } from './utils/shell/shellToolUtils.js'
import { isAgentSwarmsEnabled } from './utils/agentSwarmsEnabled.js'
import { isWorktreeModeEnabled } from './utils/worktreeModeEnabled.js'
import {
  REPL_TOOL_NAME,
  REPL_ONLY_TOOLS,
  isReplModeEnabled,
} from './tools/REPLTool/constants.js'
export { REPL_ONLY_TOOLS }
/* eslint-disable @typescript-eslint/no-require-imports */
const getPowerShellTool = () => {
  if (!isPowerShellToolEnabled()) return null
  return (
    require('./tools/PowerShellTool/PowerShellTool.js') as typeof import('./tools/PowerShellTool/PowerShellTool.js')
  ).PowerShellTool
}
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Predefined tool presets that can be used with --tools flag
 */
export const TOOL_PRESETS = ['default'] as const

export type ToolPreset = (typeof TOOL_PRESETS)[number]

export function parseToolPreset(preset: string): ToolPreset | null {
  const presetString = preset.toLowerCase()
  if (!TOOL_PRESETS.includes(presetString as ToolPreset)) {
    return null
  }
  return presetString as ToolPreset
}

/**
 * Get the list of tool names for a given preset
 * Filters out tools that are disabled via isEnabled() check
 * @param preset The preset name
 * @returns Array of tool names
 */
export function getToolsForDefaultPreset(): string[] {
  const tools = getAllBaseTools()
  const isEnabled = tools.map(tool => tool.isEnabled())
  return tools.filter((_, i) => isEnabled[i]).map(tool => tool.name)
}

/**
 * Get the complete exhaustive list of all tools that could be available
 * in the current environment (respecting process.env flags).
 * This is the source of truth for ALL tools.
 */
/**
 * NOTE: This MUST stay in sync with https://console.statsig.com/4aF3Ewatb6xPVpCwxb5nA3/dynamic_configs/claude_code_global_system_caching, in order to cache the system prompt across users.
 */
export function getAllBaseTools(): Tools {
  return [
    getAgentTool(),
    getTaskOutputTool(),
    getBashTool(),
    // Ant-native builds have bfs/ugrep embedded in the bun binary (same ARGV0
    // trick as ripgrep). When available, find/grep in Claude's shell are aliased
    // to these fast tools, so the dedicated Glob/Grep tools are unnecessary.
    ...(hasEmbeddedSearchTools() ? [] : [getGlobTool(), getGrepTool()]),
    getExitPlanModeV2Tool(),
    getFileReadTool(),
    getFileEditTool(),
    getFileWriteTool(),
    getNotebookEditTool(),
    getWebFetchTool(),
    getTodoWriteTool(),
    getWebSearchTool(),
    getTaskStopTool(),
    getAskUserQuestionTool(),
    getSkillTool(),
    getEnterPlanModeTool(),
    ...(process.env.USER_TYPE === 'ant' ? [getConfigTool()] : []),
    ...(process.env.USER_TYPE === 'ant' ? [getTungstenTool()] : []),
    ...(SuggestBackgroundPRTool ? [SuggestBackgroundPRTool] : []),
    ...(WebBrowserTool ? [WebBrowserTool] : []),
    ...(isTodoV2Enabled()
      ? [getTaskCreateTool(), getTaskGetTool(), getTaskUpdateTool(), getTaskListTool()]
      : []),
    ...(OverflowTestTool ? [OverflowTestTool] : []),
    ...(CtxInspectTool ? [CtxInspectTool] : []),
    ...(TerminalCaptureTool ? [TerminalCaptureTool] : []),
    ...(isEnvTruthy(process.env.ENABLE_LSP_TOOL) ? [getLSPTool()] : []),
    ...(isWorktreeModeEnabled() ? [getEnterWorktreeTool(), getExitWorktreeTool()] : []),
    getSendMessageTool(),
    ...(ListPeersTool ? [ListPeersTool] : []),
    ...(isAgentSwarmsEnabled()
      ? [getTeamCreateTool(), getTeamDeleteTool()]
      : []),
    ...(VerifyPlanExecutionTool ? [VerifyPlanExecutionTool] : []),
    ...(process.env.USER_TYPE === 'ant' && REPLTool ? [REPLTool] : []),
    ...(WorkflowTool ? [WorkflowTool] : []),
    ...(SleepTool ? [SleepTool] : []),
    ...cronTools,
    ...(RemoteTriggerTool ? [RemoteTriggerTool] : []),
    ...(MonitorTool ? [MonitorTool] : []),
    getBriefTool(),
    ...(SendUserFileTool ? [SendUserFileTool] : []),
    ...(PushNotificationTool ? [PushNotificationTool] : []),
    ...(SubscribePRTool ? [SubscribePRTool] : []),
    ...(getPowerShellTool() ? [getPowerShellTool()] : []),
    ...(SnipTool ? [SnipTool] : []),
    ...(process.env.NODE_ENV === 'test' ? [getTestingPermissionTool()] : []),
    getListMcpResourcesTool(),
    getReadMcpResourceTool(),
    // Include ToolSearchTool when tool search might be enabled (optimistic check)
    // The actual decision to defer tools happens at request time in claude.ts
    ...(isToolSearchEnabledOptimistic() ? [getToolSearchTool()] : []),
  ]
}

/**
 * Filters out tools that are blanket-denied by the permission context.
 * A tool is filtered out if there's a deny rule matching its name with no
 * ruleContent (i.e., a blanket deny for that tool).
 *
 * Uses the same matcher as the runtime permission check (step 1a), so MCP
 * server-prefix rules like `mcp__server` strip all tools from that server
 * before the model sees them — not just at call time.
 */
export function filterToolsByDenyRules<
  T extends {
    name: string
    mcpInfo?: { serverName: string; toolName: string }
  },
>(tools: readonly T[], permissionContext: ToolPermissionContext): T[] {
  return tools.filter(tool => !getDenyRuleForTool(permissionContext, tool))
}

export const getTools = (permissionContext: ToolPermissionContext): Tools => {
  // Simple mode: only Bash, Read, and Edit tools
  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    // --bare + REPL mode: REPL wraps Bash/Read/Edit/etc inside the VM, so
    // return REPL instead of the raw primitives. Matches the non-bare path
    // below which also hides REPL_ONLY_TOOLS when REPL is enabled.
    if (isReplModeEnabled() && REPLTool) {
      const replSimple: Tool[] = [REPLTool]
      if (
        feature('COORDINATOR_MODE') &&
        coordinatorModeModule?.isCoordinatorMode()
      ) {
        replSimple.push(getTaskStopTool(), getSendMessageTool())
      }
      return filterToolsByDenyRules(replSimple, permissionContext)
    }
    const simpleTools: Tool[] = [getBashTool(), getFileReadTool(), getFileEditTool()]
    // When coordinator mode is also active, include AgentTool and TaskStopTool
    // so the coordinator gets Task+TaskStop (via useMergedTools filtering) and
    // workers get Bash/Read/Edit (via filterToolsForAgent filtering).
    if (
      feature('COORDINATOR_MODE') &&
      coordinatorModeModule?.isCoordinatorMode()
    ) {
      simpleTools.push(getAgentTool(), getTaskStopTool(), getSendMessageTool())
    }
    return filterToolsByDenyRules(simpleTools, permissionContext)
  }

  // Get all base tools and filter out special tools that get added conditionally
  const specialTools = new Set([
    getListMcpResourcesTool().name,
    getReadMcpResourceTool().name,
    SYNTHETIC_OUTPUT_TOOL_NAME,
  ])

  const tools = getAllBaseTools().filter(tool => !specialTools.has(tool.name))

  // Filter out tools that are denied by the deny rules
  let allowedTools = filterToolsByDenyRules(tools, permissionContext)

  // When REPL mode is enabled, hide primitive tools from direct use.
  // They're still accessible inside REPL via the VM context.
  if (isReplModeEnabled()) {
    const replEnabled = allowedTools.some(tool =>
      toolMatchesName(tool, REPL_TOOL_NAME),
    )
    if (replEnabled) {
      allowedTools = allowedTools.filter(
        tool => !REPL_ONLY_TOOLS.has(tool.name),
      )
    }
  }

  const isEnabled = allowedTools.map(_ => _.isEnabled())
  return allowedTools.filter((_, i) => isEnabled[i])
}

/**
 * Assemble the full tool pool for a given permission context and MCP tools.
 *
 * This is the single source of truth for combining built-in tools with MCP tools.
 * Both REPL.tsx (via useMergedTools hook) and runAgent.ts (for coordinator workers)
 * use this function to ensure consistent tool pool assembly.
 *
 * The function:
 * 1. Gets built-in tools via getTools() (respects mode filtering)
 * 2. Filters MCP tools by deny rules
 * 3. Deduplicates by tool name (built-in tools take precedence)
 *
 * @param permissionContext - Permission context for filtering built-in tools
 * @param mcpTools - MCP tools from appState.mcp.tools
 * @returns Combined, deduplicated array of built-in and MCP tools
 */
export function assembleToolPool(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext)

  // Filter out MCP tools that are in the deny list
  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)

  // Sort each partition for prompt-cache stability, keeping built-ins as a
  // contiguous prefix. The server's claude_code_system_cache_policy places a
  // global cache breakpoint after the last prefix-matched built-in tool; a flat
  // sort would interleave MCP tools into built-ins and invalidate all downstream
  // cache keys whenever an MCP tool sorts between existing built-ins. uniqBy
  // preserves insertion order, so built-ins win on name conflict.
  // Avoid Array.toSorted (Node 20+) — we support Node 18. builtInTools is
  // readonly so copy-then-sort; allowedMcpTools is a fresh .filter() result.
  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
  return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name',
  )
}

/**
 * Get all tools including both built-in tools and MCP tools.
 *
 * This is the preferred function when you need the complete tools list for:
 * - Tool search threshold calculations (isToolSearchEnabled)
 * - Token counting that includes MCP tools
 * - Any context where MCP tools should be considered
 *
 * Use getTools() only when you specifically need just built-in tools.
 *
 * @param permissionContext - Permission context for filtering built-in tools
 * @param mcpTools - MCP tools from appState.mcp.tools
 * @returns Combined array of built-in and MCP tools
 */
export function getMergedTools(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext)
  return [...builtInTools, ...mcpTools]
}
