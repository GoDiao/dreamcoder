import { describe, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import { BrowserHostChannel, createBrowserHostSocketData, type BrowserHostSocketData } from './hostChannel.js'
import { BROWSER_HOST_PROTOCOL_VERSION } from './protocol.js'
import { readTokenLine, startBrowserHostTokenReader } from './stdinToken.js'

function streamOf(...chunks: string[]) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function fakeSocket() {
  const socket = {
    data: createBrowserHostSocketData(),
    readyState: 1,
    sent: [] as string[],
    send(payload: string) {
      this.sent.push(payload)
      return payload.length
    },
    close() {
      this.readyState = 3
    },
  }
  return socket as unknown as ServerWebSocket<BrowserHostSocketData> & { sent: string[] }
}

describe('reading the channel token from stdin', () => {
  const token = 'ab'.repeat(32)

  test('reads the first line when it is a 64 character hex token', async () => {
    expect(await readTokenLine(streamOf(`${token}\n`))).toBe(token)
  })

  test('reads a token that arrives in several chunks and ignores what follows', async () => {
    expect(await readTokenLine(streamOf(token.slice(0, 10), `${token.slice(10)}\nextra`))).toBe(token)
  })

  test('returns null for anything else', async () => {
    expect(await readTokenLine(streamOf('not a token\n'))).toBeNull()
    expect(await readTokenLine(streamOf(''))).toBeNull()
    expect(await readTokenLine(streamOf('x'.repeat(1000)))).toBeNull()
    expect(await readTokenLine(streamOf(`${token}`))).toBeNull()
  })

  test('hands a valid token to the channel', async () => {
    const channel = new BrowserHostChannel()
    await startBrowserHostTokenReader(channel, streamOf(`${token}\n`))
    const socket = fakeSocket()
    channel.open(socket)
    channel.message(socket, JSON.stringify({ type: 'hello', token, protocol: BROWSER_HOST_PROTOCOL_VERSION }))
    clearTimeout(socket.data.helloTimer ?? undefined)
    expect(socket.sent).toEqual([JSON.stringify({ type: 'ready' })])
  })

  test('leaves the channel without a token when stdin holds something else', async () => {
    const channel = new BrowserHostChannel()
    await startBrowserHostTokenReader(channel, streamOf('nope\n'))
    const socket = fakeSocket()
    channel.open(socket)
    channel.message(socket, JSON.stringify({ type: 'hello', token, protocol: BROWSER_HOST_PROTOCOL_VERSION }))
    clearTimeout(socket.data.helloTimer ?? undefined)
    expect(socket.sent).toEqual([])
    expect(socket.readyState).toBe(3)
  })

  test('does nothing when there is no stdin stream', async () => {
    await startBrowserHostTokenReader(new BrowserHostChannel(), null)
  })
})
