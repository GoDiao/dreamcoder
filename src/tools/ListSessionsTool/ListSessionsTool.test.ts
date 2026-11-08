import { afterEach, describe, expect, test } from 'bun:test'
import { setHostRequester } from '../../utils/hostRequests.js'
import { installFakeHost } from '../../utils/__tests__/hostRequesterFixture.js'
import { ListSessionsTool } from './ListSessionsTool.js'

afterEach(() => setHostRequester(null))

const sessions = [
  { sessionId: 'a', title: 'A', project: '/p', relation: 'child', running: true, parentSessionId: 'me' },
  { sessionId: 'b', title: 'B', project: '/q', relation: 'none', running: false },
]
const run = (input: Record<string, unknown>) =>
  ListSessionsTool.call(ListSessionsTool.inputSchema.parse(input), {} as never, undefined as never, undefined as never)

describe('ListSessions', () => {
  test('is read-only and needs no permission prompt', async () => {
    expect(ListSessionsTool.isReadOnly({})).toBe(true)
    expect((await ListSessionsTool.checkPermissions({}, {} as never)).behavior).toBe('allow')
  })

  test('sends session_list without a project and returns the rows', async () => {
    const requests = installFakeHost(() => ({ sessions }))
    const result = await run({})
    expect(requests).toEqual([{ subtype: 'session_list' }])
    expect(result.data.sessions).toEqual(sessions)
  })

  test('passes the project filter', async () => {
    const requests = installFakeHost(() => ({ sessions: [] }))
    await run({ project: '/p' })
    expect(requests).toEqual([{ subtype: 'session_list', project: '/p' }])
  })

  test('rejects a row the host shapes wrongly', async () => {
    installFakeHost(() => ({ sessions: [{ sessionId: 'a' }] }))
    await expect(run({})).rejects.toThrow()
  })

  test('fails clearly when no host requester is registered', async () => {
    await expect(run({})).rejects.toThrow('not connected')
  })
})
