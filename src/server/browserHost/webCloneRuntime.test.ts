import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import { conversationService } from '../services/conversationService.js'
import { browserHostChannel, createBrowserHostSocketData, type BrowserHostSocketData } from './hostChannel.js'
import { BROWSER_HOST_PROTOCOL_VERSION } from './protocol.js'
import { getBrowserRuntime } from './runtime.js'

type LifecycleEmitter = { emitProcessEvent(event: { sessionId: string; generation: number; phase: string }): void }

const emit = (event: { sessionId: string; phase: 'stopped' | 'failed' }) =>
  (conversationService as unknown as LifecycleEmitter).emitProcessEvent({ ...event, generation: 1 })

function connectHost(token: string) {
  const socket = {
    data: createBrowserHostSocketData(),
    readyState: 1,
    sent: [] as unknown[],
    send(payload: string) {
      this.sent.push(JSON.parse(payload))
      return payload.length
    },
    close() {
      this.readyState = 3
    },
  } as unknown as ServerWebSocket<BrowserHostSocketData>
  browserHostChannel.setToken(token)
  browserHostChannel.open(socket)
  browserHostChannel.message(socket, JSON.stringify({ type: 'hello', token, protocol: BROWSER_HOST_PROTOCOL_VERSION }))
  return socket
}

let host: ServerWebSocket<BrowserHostSocketData> | null

beforeEach(() => {
  host = null
})

afterEach(() => {
  if (host) browserHostChannel.close(host)
  browserHostChannel.setToken(null)
})

async function openSession(owner: string) {
  const { webClone } = getBrowserRuntime()
  const token = webClone.tokens.issue(owner)
  const id = await webClone.create(owner)
  return { webClone, token, id }
}

describe('ending clone browser sessions with the CLI session', () => {
  for (const phase of ['stopped', 'failed'] as const) {
    test(`revokes the token and drops the browser sessions when the CLI session ${phase}`, async () => {
      const { webClone, token, id } = await openSession(`owner-${phase}`)
      emit({ sessionId: `owner-${phase}`, phase })
      await Promise.resolve()
      expect(webClone.tokens.resolve(token)).toBeNull()
      expect(webClone.has(id, `owner-${phase}`)).toBe(false)
    })
  }

  test('leaves the token and the sessions of another CLI session alone', async () => {
    const mine = await openSession('owner-a')
    const other = await openSession('owner-b')
    emit({ sessionId: 'owner-a', phase: 'stopped' })
    await Promise.resolve()
    expect(mine.webClone.has(mine.id, 'owner-a')).toBe(false)
    expect(other.webClone.tokens.resolve(other.token)).toBe('owner-b')
    expect(other.webClone.has(other.id, 'owner-b')).toBe(true)
    emit({ sessionId: 'owner-b', phase: 'stopped' })
  })

  test('drops the browser sessions when the user stops the session, and keeps the token for the next turn', async () => {
    const { webClone, token, id } = await openSession('owner-stop')
    host = connectHost('host-token')
    browserHostChannel.message(host, JSON.stringify({ type: 'stop', sessionId: 'owner-stop' }))
    await Promise.resolve()
    expect(webClone.has(id, 'owner-stop')).toBe(false)
    expect(webClone.tokens.resolve(token)).toBe('owner-stop')
    emit({ sessionId: 'owner-stop', phase: 'stopped' })
  })
})
