import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as resumeAgent from '../AgentTool/resumeAgent.js'
import { useEnvFlag } from '../../utils/__tests__/hostRequesterFixture.js'
import { SendMessageTool } from './SendMessageTool.js'

const teams = useEnvFlag('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')

afterEach(() => {
  teams.restore()
})

const AGENT_ID = 'a1234567890abcdef'

type TestState = { agentNameRegistry: Map<string, string>; tasks: Record<string, unknown> }

const localAgent = (status: string) => ({
  id: AGENT_ID,
  type: 'local_agent',
  status,
  pendingMessages: [] as string[],
})

const validateWith = (
  to: string,
  registeredNames: Array<[string, string]> = [],
  message: string | { type: 'shutdown_request' } = 'hello',
) =>
  SendMessageTool.validateInput!(
    { to, summary: 'follow up', message } as never,
    {
      getAppState: () => ({ agentNameRegistry: new Map(registeredNames), tasks: {} }),
    } as never,
  )

const sendWith = async (to: string, state: TestState) => {
  let current = state
  const input = { to, summary: 'follow up', message: 'hello' }
  const context = {
    getAppState: () => current,
    setAppState: (update: (prev: TestState) => TestState) => {
      current = update(current)
    },
  }
  const validation = await SendMessageTool.validateInput!(input as never, context as never)
  const output =
    validation.result === true
      ? await SendMessageTool.call(input as never, context as never, undefined as never, undefined as never)
      : validation
  return { output, getState: () => current }
}

describe('SendMessage to a subagent with agent teams off', () => {
  test('accepts a well-formed agent id', async () => {
    teams.disable()
    expect(await validateWith(AGENT_ID)).toEqual({ result: true })
  })

  test('accepts a registered subagent name', async () => {
    teams.disable()
    expect(await validateWith('explorer', [['explorer', AGENT_ID]])).toEqual({ result: true })
  })

  test('still rejects a teammate name', async () => {
    teams.disable()
    expect(await validateWith('researcher')).toMatchObject({
      result: false,
      message: expect.stringContaining('registered background-agent name'),
    })
  })

  test('rejects a structured message to a subagent id', async () => {
    teams.disable()
    expect(await validateWith(AGENT_ID, [], { type: 'shutdown_request' })).toMatchObject({
      result: false,
    })
  })

  test('queues the message on a running subagent by agent id', async () => {
    teams.disable()
    const { output, getState } = await sendWith(AGENT_ID, {
      agentNameRegistry: new Map(),
      tasks: { [AGENT_ID]: localAgent('running') },
    })
    expect(output).toMatchObject({ data: { success: true } })
    expect(
      (getState().tasks[AGENT_ID] as { pendingMessages: string[] }).pendingMessages,
    ).toEqual(['hello'])
  })

  test('queues the message on a running subagent by registered name', async () => {
    teams.disable()
    const { output, getState } = await sendWith('explorer', {
      agentNameRegistry: new Map([['explorer', AGENT_ID]]),
      tasks: { [AGENT_ID]: localAgent('running') },
    })
    expect(output).toMatchObject({ data: { success: true } })
    expect(
      (getState().tasks[AGENT_ID] as { pendingMessages: string[] }).pendingMessages,
    ).toEqual(['hello'])
  })

  test('resumes a stopped subagent by agent id', async () => {
    teams.disable()
    const resume = spyOn(resumeAgent, 'resumeAgentBackground').mockResolvedValue({
      outputFile: '/tmp/agent-output',
    } as never)
    try {
      const { output } = await sendWith(AGENT_ID, {
        agentNameRegistry: new Map(),
        tasks: { [AGENT_ID]: localAgent('completed') },
      })
      expect(output).toMatchObject({ data: { success: true } })
      expect(resume).toHaveBeenCalledTimes(1)
      expect(resume.mock.calls[0]?.[0]).toMatchObject({ agentId: AGENT_ID, prompt: 'hello' })
    } finally {
      resume.mockRestore()
    }
  })

  test('resumes a subagent from its transcript when its task was evicted', async () => {
    teams.disable()
    const resume = spyOn(resumeAgent, 'resumeAgentBackground').mockResolvedValue({
      outputFile: '/tmp/agent-output',
    } as never)
    try {
      const { output } = await sendWith(AGENT_ID, {
        agentNameRegistry: new Map(),
        tasks: {},
      })
      expect(output).toMatchObject({ data: { success: true } })
      expect(resume).toHaveBeenCalledTimes(1)
      expect(resume.mock.calls[0]?.[0]).toMatchObject({ agentId: AGENT_ID, prompt: 'hello' })
    } finally {
      resume.mockRestore()
    }
  })
})
