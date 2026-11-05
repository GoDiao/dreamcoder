import { afterEach, describe, expect, test } from 'bun:test'
import { getSessionId } from '../../bootstrap/state.js'
import { setHostRequester } from '../../utils/hostRequests.js'
import { installFakeHost, useEnvFlag } from '../../utils/__tests__/hostRequesterFixture.js'
import { SESSION_LINKS_ENABLED_ENV } from '../StartSessionTool/constants.js'
import { getPrompt } from './prompt.js'
import { SendMessageTool } from './SendMessageTool.js'

const env = useEnvFlag(SESSION_LINKS_ENABLED_ENV)
const teams = useEnvFlag('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')

afterEach(() => {
  setHostRequester(null)
  env.restore()
  teams.restore()
})

const validate = (input: Record<string, unknown>) => SendMessageTool.validateInput!(input as never, {} as never)
const run = (input: Record<string, unknown>) =>
  SendMessageTool.call(input as never, {} as never, undefined as never, undefined as never)

describe('SendMessage to a session', () => {
  test('sends session_send with the bare id and reports delivery', async () => {
    env.enable()
    const requests = installFakeHost(() => ({ delivered: true }))
    const result = await run({ to: 'session:abc', summary: 'ping', message: 'hello' })
    expect(requests).toEqual([{ subtype: 'session_send', to: 'abc', message: 'hello', summary: 'ping' }])
    expect(result.data).toMatchObject({ success: true })
  })

  test('sends the mode with the request when one is given', async () => {
    env.enable()
    const requests = installFakeHost(() => ({ delivered: true }))
    await run({ to: 'session:abc', summary: 'half way', message: 'hello', mode: 'report' })
    expect(requests).toEqual([{ subtype: 'session_send', to: 'abc', message: 'hello', summary: 'half way', mode: 'report' }])
  })

  test('accepts a report to a session address', async () => {
    env.enable()
    expect(await validate({ to: 'session:abc', summary: 'half way', message: 'hello', mode: 'report' })).toEqual({ result: true })
  })

  test('rejects a report to a teammate', async () => {
    teams.enable()
    env.enable()
    const result = await validate({ to: 'researcher', summary: 'half way', message: 'hello', mode: 'report' })
    expect(result).toMatchObject({ result: false })
    expect((result as { message: string }).message).toContain('report')
  })

  test('passes the host error through', async () => {
    env.enable()
    installFakeHost(() => ({ delivered: false, error: 'Session abc is not running' }))
    const result = await run({ to: 'session:abc', summary: 'ping', message: 'hello' })
    expect(result.data).toEqual({ success: false, message: 'Session abc is not running' })
  })

  test('accepts a plain message with a summary', async () => {
    env.enable()
    expect(await validate({ to: 'session:abc', summary: 'ping', message: 'hello' })).toEqual({ result: true })
  })

  test('accepts a session message without a summary', async () => {
    env.enable()
    expect(await validate({ to: 'session:abc', message: 'hello' })).toEqual({ result: true })
  })

  test('uses the first line of the message when the summary is missing', async () => {
    env.enable()
    const requests = installFakeHost(() => ({ delivered: true }))
    const long = 'x'.repeat(100)
    await run({ to: 'session:abc', message: '\n  first   line here\nsecond line' })
    await run({ to: 'session:abc', message: long })
    await run({ to: 'session:abc', summary: 'own words', message: 'body' })
    expect(requests.map((request) => (request as { summary: string }).summary)).toEqual([
      'first line here',
      `${'x'.repeat(80)}…`,
      'own words',
    ])
  })

  test('still requires a summary for a teammate', async () => {
    teams.enable()
    env.enable()
    expect((await validate({ to: 'researcher', message: 'hello' })).result).toBe(false)
  })

  test('rejects an empty id', async () => {
    env.enable()
    const result = await validate({ to: 'session:  ', summary: 's', message: 'hello' })
    expect(result).toMatchObject({ result: false, message: 'session id must not be empty' })
  })

  test('rejects the own session id', async () => {
    env.enable()
    const result = await validate({ to: `session:${getSessionId()}`, summary: 's', message: 'hello' })
    expect(result).toMatchObject({ result: false, message: 'cannot send a message to your own session' })
  })

  test('rejects a structured message', async () => {
    env.enable()
    const result = await validate({ to: 'session:abc', message: { type: 'shutdown_request' } })
    expect(result).toMatchObject({ result: false })
    expect((result as { message: string }).message).toContain('structured messages')
  })

  test('is enabled by session links alone', () => {
    teams.disable()
    env.disable()
    expect(SendMessageTool.isEnabled()).toBe(false)
    env.enable()
    expect(SendMessageTool.isEnabled()).toBe(true)
  })

  test('accepts only session addresses without agent teams', async () => {
    teams.disable()
    env.enable()
    const result = await validate({ to: 'researcher', summary: 's', message: 'hello' })
    expect(result).toMatchObject({ result: false })
    expect((result as { message: string }).message).toContain('session:<id>')
  })

  test('without the env var the address is not a session address', async () => {
    teams.enable()
    env.disable()
    const requests = installFakeHost(() => ({ delivered: true }))
    expect(await validate({ to: 'session:abc', message: { type: 'shutdown_request' } })).toEqual({ result: true })
    expect(requests).toEqual([])
  })

  test('the prompt documents session addresses only when enabled', () => {
    teams.enable()
    env.disable()
    expect(getPrompt()).not.toContain('session:<id>')
    env.enable()
    expect(getPrompt()).toContain('session:<id>')
  })

  test('the prompt explains both modes', () => {
    env.enable()
    expect(getPrompt()).toContain('"report"')
    expect(getPrompt()).toContain('does not interrupt or wake')
  })

  test('the prompt says where the id comes from and how a started session reports', () => {
    env.enable()
    expect(getPrompt()).toContain('result of StartSession')
    expect(getPrompt()).toContain('contacts you with this tool')
    expect(getPrompt()).toContain('arrives with your next turn')
  })

  test('the prompt tells the sender to end its turn instead of predicting the reply', () => {
    env.enable()
    expect(getPrompt()).toContain('end your turn')
    expect(getPrompt()).toContain('Never fabricate or predict another session')
  })

  test('the prompt leaves out teammates without agent teams', () => {
    teams.disable()
    env.enable()
    expect(getPrompt()).toContain('session:<id>')
    expect(getPrompt()).not.toContain('Teammate by name')
  })
})
