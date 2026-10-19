// Runs the CLI's own permission pipeline (hasPermissionsToUseTool) on a tool
// call: the permission mode, user allow/deny/ask rules, then the tool's own
// checks (for Bash: the read-only allow list, shell-structure checks and path
// checks). No prompts, hooks, classifiers or provider calls are involved.
//
// The CLI reads settings from its config directories, so they are pointed at
// an empty temporary directory before any src/ module loads. Only rules passed
// in explicitly apply.
import { mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import type { Decision } from './lib'

const isolated = mkdtempSync(join(tmpdir(), 'system1-rules-'))
process.on('exit', () => rmSync(isolated, { recursive: true, force: true }))
process.env.CLAUDE_CONFIG_DIR = join(isolated, 'claude')
process.env.DREAMCODER_CONFIG_DIR = join(isolated, 'dreamcoder')

const { getEmptyToolPermissionContext } = await import('../../../src/Tool.js')
const { hasPermissionsToUseTool } = await import(
  '../../../src/utils/permissions/permissions.js'
)
const { getAllBaseTools } = await import('../../../src/tools.js')
const { MCPTool } = await import('../../../src/tools/MCPTool/MCPTool.js')
const { setCwdState, setOriginalCwd, setProjectRoot } = await import(
  '../../../src/bootstrap/state.js'
)

type Tool = Parameters<typeof hasPermissionsToUseTool>[0]
type PermissionMode = ReturnType<typeof getEmptyToolPermissionContext>['mode']

export type RulesConfig = {
  mode: PermissionMode
  /** Rule strings as in settings.json `permissions`, e.g. "Bash(git status)". */
  allow: string[]
  deny: string[]
  ask: string[]
  /**
   * Path prefixes to rewrite in cwd, project root and input before checking,
   * as [from, to]. On macOS /home is an automount point, so every check of a
   * SABER path under /home/user waits on the automounter; moving the whole
   * tree to a plain missing directory keeps the decisions and drops the wait.
   * HOME must then point at the moved /home/user (see rulesDecision).
   */
  pathMap: [string, string][]
}

export const DEFAULT_RULES_CONFIG: RulesConfig = {
  mode: 'default',
  allow: [],
  deny: [],
  ask: [],
  pathMap: [],
}

function rewrite<T>(value: T, pathMap: [string, string][]): T {
  if (pathMap.length === 0) return value
  if (typeof value === 'string') {
    let out: string = value
    for (const [from, to] of pathMap) out = out.split(from).join(to)
    return out as T
  }
  if (Array.isArray(value)) return value.map(v => rewrite(v, pathMap)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rewrite(v, pathMap)]),
    ) as T
  }
  return value
}

const baseTools = new Map<string, Tool>()
for (const tool of getAllBaseTools()) {
  baseTools.set(tool.name, tool)
  for (const alias of tool.aliases ?? []) baseTools.set(alias, tool)
}

function findTool(name: string): Tool | undefined {
  if (name.startsWith('mcp__')) return { ...MCPTool, name } as Tool
  return baseTools.get(name)
}

/** One-line summary of why the pipeline decided as it did. */
function describeReason(reason: unknown): string | null {
  if (!reason || typeof reason !== 'object') return null
  const r = reason as Record<string, any>
  switch (r.type) {
    case 'rule':
      return `rule:${r.rule?.ruleBehavior}:${r.rule?.ruleValue?.toolName}${r.rule?.ruleValue?.ruleContent ? `(${r.rule.ruleValue.ruleContent})` : ''}`
    case 'mode':
      return `mode:${r.mode}`
    case 'subcommandResults':
      return 'subcommands'
    case 'safetyCheck':
    case 'other':
    case 'workingDir':
      return `${r.type}:${String(r.reason ?? '').slice(0, 120)}`
    default:
      return String(r.type)
  }
}

export async function rulesDecision(
  call: { tool: string; input: Record<string, unknown>; cwd: string; project_root: string },
  config: RulesConfig = DEFAULT_RULES_CONFIG,
): Promise<{ decision: Decision | null; reason: string | null }> {
  const tool = findTool(call.tool)
  if (!tool) return { decision: null, reason: 'unknown-tool' }
  // `~` in a command resolves through os.homedir(), which Bun reads from
  // HOME once at startup. Under a path map it has to be the mapped home.
  const mappedHome = rewrite('/home/user', config.pathMap)
  if (config.pathMap.some(([from]) => from === '/home/user') && homedir() !== mappedHome) {
    throw new Error(`run with HOME=${mappedHome} so ~ resolves to SABER's home`)
  }

  const projectRoot = rewrite(call.project_root, config.pathMap)
  setOriginalCwd(projectRoot)
  setProjectRoot(projectRoot)
  setCwdState(rewrite(call.cwd, config.pathMap))
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    mode: config.mode,
    alwaysAllowRules: { userSettings: config.allow },
    alwaysDenyRules: { userSettings: config.deny },
    alwaysAskRules: { userSettings: config.ask },
  }
  const context = {
    options: {
      isNonInteractiveSession: true,
      tools: [],
      commands: [],
      mcpClients: [],
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => ({ toolPermissionContext }),
    setAppState: () => {},
  } as unknown as Parameters<typeof hasPermissionsToUseTool>[2]

  const result = await hasPermissionsToUseTool(
    tool,
    rewrite(call.input, config.pathMap),
    context,
    undefined as never,
    'system1-rules',
  )
  return {
    decision: result.behavior as Decision,
    reason: describeReason(result.decisionReason),
  }
}
