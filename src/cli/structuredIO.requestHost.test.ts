import { describe, expect, test } from 'bun:test'
import { SDKControlSessionListResponseSchema } from '../entrypoints/sdk/controlSchemas.js'
import { StructuredIO } from './structuredIO.js'

function connect() {
  let deliver!: (line: string) => void
  const line = new Promise<string>(resolve => {
    deliver = resolve
  })
  const io = new StructuredIO(
    (async function* () {
      yield await line
    })(),
  )
  void io.structuredInput.next()
  return { io, deliver }
}

describe('StructuredIO.requestHost', () => {
  test('sends the request as a control_request and resolves with the parsed response', async () => {
    const { io, deliver } = connect()
    const pending = io.requestHost({ subtype: 'session_list', project: '/p' }, SDKControlSessionListResponseSchema())
    const sent = (await io.outbound.next()).value as { type: string; request_id: string; request: unknown }
    expect(sent.type).toBe('control_request')
    expect(sent.request).toEqual({ subtype: 'session_list', project: '/p' })
    deliver(
      JSON.stringify({
        type: 'control_response',
        response: { subtype: 'success', request_id: sent.request_id, response: { sessions: [] } },
      }) + '\n',
    )
    expect(await pending).toEqual({ sessions: [] })
  })

  test('rejects when the host answers with an error', async () => {
    const { io, deliver } = connect()
    const pending = io.requestHost({ subtype: 'session_list' }, SDKControlSessionListResponseSchema())
    const sent = (await io.outbound.next()).value as { request_id: string }
    deliver(
      JSON.stringify({
        type: 'control_response',
        response: { subtype: 'error', request_id: sent.request_id, error: 'no such project' },
      }) + '\n',
    )
    await expect(pending).rejects.toThrow('no such project')
  })
})

describe('StructuredIO permission prompts', () => {
  async function promptFor(decisionReason: Record<string, unknown>) {
    const { io } = connect()
    const abortController = new AbortController()
    const canUseTool = io.createCanUseTool()
    void canUseTool(
      { name: 'StartSession' } as never,
      {},
      { abortController, getAppState: () => ({ toolPermissionContext: {} }), options: {} } as never,
      {} as never,
      'tool-1',
      { behavior: 'ask', message: 'Start a new session?', decisionReason } as never,
    ).catch(() => undefined)
    const sent = (await io.outbound.next()).value as { request: Record<string, unknown> }
    abortController.abort()
    return sent.request
  }

  test('tells the host when a tool asks every time, so it does not offer to remember the answer', async () => {
    expect(await promptFor({ type: 'safetyCheck', reason: 'always asks', classifierApprovable: false })).toMatchObject({
      subtype: 'can_use_tool',
      tool_name: 'StartSession',
      always_asks: true,
    })
    expect(await promptFor({ type: 'other', reason: 'ask' })).not.toHaveProperty('always_asks')
  })
})
