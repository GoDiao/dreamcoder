import { afterEach, describe, expect, test } from 'bun:test'
import { ALL_AGENT_DISALLOWED_TOOLS } from '../../constants/tools.js'
import { getAllBaseTools } from '../../tools.js'
import { setHostRequester } from '../../utils/hostRequests.js'
import { installFakeHost, useEnvFlag } from '../../utils/__tests__/hostRequesterFixture.js'
import { SESSION_LINKS_ENABLED_ENV } from '../StartSessionTool/constants.js'
import { RENAME_SESSION_TOOL_NAME } from './constants.js'
import { RenameSessionTool } from './RenameSessionTool.js'

const env = useEnvFlag(SESSION_LINKS_ENABLED_ENV)

afterEach(() => {
  setHostRequester(null)
  env.restore()
})

const parse = (input: Record<string, unknown>) => RenameSessionTool.inputSchema.parse(input)
const run = (input: Record<string, unknown>) =>
  RenameSessionTool.call(parse(input), {} as never, undefined as never, undefined as never)

describe('RenameSession', () => {
  test('sends session_rename with the title and returns the stored one', async () => {
    const requests = installFakeHost(() => ({ title: 'Project manager' }))
    const result = await run({ title: 'Project manager' })
    expect(requests).toEqual([{ subtype: 'session_rename', title: 'Project manager' }])
    expect(result.data).toEqual({ title: 'Project manager' })
  })

  test('requires a non-empty title and nothing else', () => {
    expect(() => parse({ title: '' })).toThrow()
    expect(() => parse({})).toThrow()
    expect(() => parse({ title: 'T', sessionId: 'other' })).toThrow()
  })

  test('surfaces a rejection from the host', async () => {
    installFakeHost(() => {
      throw new Error('A session title cannot be empty')
    })
    await expect(run({ title: ' ' })).rejects.toThrow('A session title cannot be empty')
  })

  test('allows the call without a prompt', async () => {
    const input = parse({ title: 'T' })
    const result = await RenameSessionTool.checkPermissions(input, {} as never)
    expect(result.behavior).toBe('allow')
  })

  test('result text states the new title', () => {
    const block = RenameSessionTool.mapToolResultToToolResultBlockParam({ title: 'Project manager' }, 'tu')
    expect(block.content).toBe('Renamed this session to "Project manager".')
  })

  test('is enabled only with session links', () => {
    const find = () => getAllBaseTools().find(tool => tool.name === RENAME_SESSION_TOOL_NAME)
    expect(find()).toBeDefined()
    env.disable()
    expect(find()?.isEnabled()).toBe(false)
    env.enable()
    expect(find()?.isEnabled()).toBe(true)
  })

  test('subagents cannot rename the session', () => {
    expect(ALL_AGENT_DISALLOWED_TOOLS.has(RENAME_SESSION_TOOL_NAME)).toBe(true)
  })
})
