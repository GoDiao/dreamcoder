import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { browserHostChannel } from '../browserHost/hostChannel.js'
import { BROWSER_MCP_PATH } from '../browserHost/names.js'
import {
  BROWSER_HOST_CLOSE_UNAUTHORIZED,
  BROWSER_HOST_PATH,
  BROWSER_HOST_PROTOCOL_VERSION,
} from '../browserHost/protocol.js'
import { startServer } from '../index.js'
import { ProviderService } from '../services/providerService.js'

const TOKEN = 'b'.repeat(64)

let server: ReturnType<typeof startServer> | undefined
let baseUrl = ''
let tmpDir = ''
let originalConfigDir: string | undefined
let originalServerPort = 3456

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      await Bun.sleep(50)
    }
  }
  throw new Error(`Timed out waiting for server at ${url}`)
}

function openHost() {
  const messages: unknown[] = []
  const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}${BROWSER_HOST_PATH}`)
  const closed = new Promise<number>((resolve) => ws.addEventListener('close', (event) => resolve(event.code)))
  ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))))
  const hello = (token: string) =>
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', token, protocol: BROWSER_HOST_PROTOCOL_VERSION })))
  return { ws, messages, closed, hello }
}

beforeEach(async () => {
  tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'browser-host-socket-test-')))
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  originalServerPort = ProviderService.getServerPort()
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
  browserHostChannel.setToken(TOKEN)
  const port = 18000 + Math.floor(Math.random() * 10000)
  server = startServer(port, '127.0.0.1')
  baseUrl = `http://127.0.0.1:${port}`
  await waitForServer(`${baseUrl}/health`)
})

afterEach(async () => {
  server?.stop(true)
  server = undefined
  browserHostChannel.setToken(null)
  ProviderService.setServerPort(originalServerPort)
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('browser host channel endpoint', () => {
  test('rejects a request that carries an Origin header', async () => {
    const response = await fetch(`${baseUrl}${BROWSER_HOST_PATH}`, { headers: { Origin: 'http://evil.example' } })
    expect(response.status).toBe(403)
  })

  test('accepts an upgrade followed by a hello with the channel token', async () => {
    const host = openHost()
    host.hello(TOKEN)
    try {
      for (let attempt = 0; attempt < 100 && host.messages.length === 0; attempt += 1) await Bun.sleep(20)
      expect(host.messages).toEqual([{ type: 'ready' }])
      expect(browserHostChannel.isConnected()).toBe(true)
    } finally {
      host.ws.close()
      await host.closed
    }
  })

  test('closes a connection whose hello carries the wrong token', async () => {
    const host = openHost()
    host.hello('c'.repeat(64))
    expect(await host.closed).toBe(BROWSER_HOST_CLOSE_UNAUTHORIZED)
    expect(host.messages).toEqual([])
  })
})

describe('browser MCP endpoint', () => {
  test('rejects a request that carries an Origin header', async () => {
    const response = await fetch(`${baseUrl}${BROWSER_MCP_PATH}`, {
      method: 'POST',
      headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(403)
  })

  test('rejects a request without a session token', async () => {
    const response = await fetch(`${baseUrl}${BROWSER_MCP_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
  })

  test('rejects a request with an unknown session token', async () => {
    const response = await fetch(`${baseUrl}${BROWSER_MCP_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'d'.repeat(64)}` },
      body: '{}',
    })
    expect(response.status).toBe(401)
  })
})
