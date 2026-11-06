import { afterEach, describe, expect, test } from 'bun:test'
import { ALL_AGENT_DISALLOWED_TOOLS } from '../../constants/tools.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { getAllBaseTools } from '../../tools.js'
import { hasPermissionsToUseTool } from '../../utils/permissions/permissions.js'
import { setHostRequester } from '../../utils/hostRequests.js'
import { installFakeHost, useEnvFlag } from '../../utils/__tests__/hostRequesterFixture.js'
import { LIST_SESSIONS_TOOL_NAME } from '../ListSessionsTool/constants.js'
import { PROMPT } from './prompt.js'
import { SESSION_LINKS_ENABLED_ENV, START_SESSION_TOOL_NAME } from './constants.js'
import { StartSessionTool } from './StartSessionTool.js'

const env = useEnvFlag(SESSION_LINKS_ENABLED_ENV)

afterEach(() => {
  setHostRequester(null)
  env.restore()
})

const parse = (input: Record<string, unknown>) => StartSessionTool.inputSchema.parse(input)
const run = (input: Record<string, unknown>) =>
  StartSessionTool.call(parse(input), {} as never, undefined as never, undefined as never)

describe('StartSession permission', () => {
  test('asks with a safety check the classifier cannot approve', async () => {
    const input = parse({ prompt: 'go', title: 'T', context: 'fresh' })
    const result = await StartSessionTool.checkPermissions(input, {} as never)
    expect(result.behavior).toBe('ask')
    expect(result.decisionReason).toMatchObject({ type: 'safetyCheck', classifierApprovable: false })
  })

  test.each(['bypassPermissions', 'auto', 'acceptEdits'] as const)('still asks in %s mode', async mode => {
    const context = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { ...getEmptyToolPermissionContext(), mode } }),
      options: { tools: [StartSessionTool] },
    }
    const input = parse({ prompt: 'go', title: 'T', context: 'fresh' })
    const decision = await hasPermissionsToUseTool(StartSessionTool, input, context as never, undefined as never, 'id')
    expect(decision.behavior).toBe('ask')
  })
})

describe('StartSession call', () => {
  test('sends session_start with the input and returns the id and title', async () => {
    const requests = installFakeHost(() => ({ sessionId: 's-1', title: 'Research' }))
    const result = await run({ prompt: 'investigate', title: 'Research', context: 'fork', worktree: true })
    expect(requests).toEqual([
      { subtype: 'session_start', prompt: 'investigate', title: 'Research', context: 'fork', worktree: true },
    ])
    expect(result.data).toEqual({ sessionId: 's-1', title: 'Research' })
  })

  test('defaults worktree to false', async () => {
    const requests = installFakeHost(() => ({ sessionId: 's-2', title: 'T' }))
    await run({ prompt: 'p', title: 'T', context: 'fresh' })
    expect(requests[0]).toEqual({ subtype: 'session_start', prompt: 'p', title: 'T', context: 'fresh', worktree: false })
  })

  test('has no name input', () => {
    expect(() => parse({ prompt: 'p', title: 'T', name: 'short', context: 'fresh' })).toThrow()
    expect('name' in StartSessionTool.inputSchema.shape).toBe(false)
  })

  test('fails clearly when no host requester is registered', async () => {
    await expect(run({ prompt: 'p', title: 'T', context: 'fresh' })).rejects.toThrow('not connected')
  })

  test('result text only states what was started', () => {
    const block = StartSessionTool.mapToolResultToToolResultBlockParam({ sessionId: 's-1', title: 'Research' }, 'tu')
    expect(block.content).toBe('Started session "Research" (id s-1).')
    expect(block.content).not.toContain('SendMessage')
  })
})

describe('session links registration', () => {
  const enabledNames = () =>
    getAllBaseTools()
      .filter(tool => [START_SESSION_TOOL_NAME, LIST_SESSIONS_TOOL_NAME].includes(tool.name) && tool.isEnabled())
      .map(tool => tool.name)

  test('both tools are in the base tool list', () => {
    const base = getAllBaseTools().map(tool => tool.name)
    expect(base).toContain(START_SESSION_TOOL_NAME)
    expect(base).toContain(LIST_SESSIONS_TOOL_NAME)
  })

  test('tools are enabled only when the env var is set', () => {
    env.disable()
    expect(enabledNames()).not.toContain(START_SESSION_TOOL_NAME)
    expect(enabledNames()).not.toContain(LIST_SESSIONS_TOOL_NAME)
    env.enable()
    expect(enabledNames()).toContain(START_SESSION_TOOL_NAME)
    expect(enabledNames()).toContain(LIST_SESSIONS_TOOL_NAME)
  })
})

test('subagents cannot start sessions', () => {
  expect(ALL_AGENT_DISALLOWED_TOOLS.has(START_SESSION_TOOL_NAME)).toBe(true)
})

describe('StartSession prompt', () => {
  test('tells the caller to end its turn and not predict the results', () => {
    expect(PROMPT).toContain('end your turn')
    expect(PROMPT).toContain('Never fabricate or predict')
  })
})
