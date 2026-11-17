import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../index.js'
import { REMOTE_SERVING_ENV } from '../remoteServing.js'
import { conversationService } from '../services/conversationService.js'
import { H5AccessService } from '../services/h5AccessService.js'
import { ManagedSettingsService } from '../services/managedSettingsService.js'
import { ProviderService } from '../services/providerService.js'
import { peekSessionRuntime } from '../ws/sessionRuntime.js'

type Booted = { http: string; ws: string; port: number }

const ENV_KEYS = [REMOTE_SERVING_ENV, 'SERVER_AUTH_REQUIRED', 'DREAMCODER_CONFIG_DIR', 'CLAUDE_CLI_PATH', 'CLAUDE_H5_DIST_DIR', 'ANTHROPIC_API_KEY'] as const
const FORWARDING_HEADERS = ['Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'X-Real-IP', 'Via']

let server: ReturnType<typeof Bun.serve> | undefined
let tmpDir = ''
let booted: Booted
let token = ''
let savedEnv: Record<string, string | undefined> = {}
let savedServerPort = 3456

async function waitForHealth(url: string, attempts = 60): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) return
    } catch {}
    await Bun.sleep(50)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function boot(options: { remoteServing: boolean; enableH5?: boolean; host?: string; rawEnv?: string }): Promise<Booted> {
  if (options.rawEnv !== undefined) process.env[REMOTE_SERVING_ENV] = options.rawEnv
  else if (options.remoteServing) process.env[REMOTE_SERVING_ENV] = '1'
  else delete process.env[REMOTE_SERVING_ENV]
  if (options.enableH5 !== false) token = (await new H5AccessService().enable()).token
  server = startServer(0, options.host ?? '127.0.0.1')
  const port = server.port as number
  booted = { http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}`, port }
  await waitForHealth(booted.http)
  return booted
}

function bearer(value: string): Record<string, string> {
  return { Authorization: `Bearer ${value}` }
}

function upgradeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Connection: 'Upgrade', Upgrade: 'websocket', ...extra }
}

function request(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${booted.http}${pathname}`, init)
}

type SocketOutcome = { opened: boolean; closeCode: number | null; messages: Array<Record<string, unknown>> }

function observeSocket(
  url: string,
  options: { onOpen?: (ws: WebSocket) => void; settleMs?: number; until?: (messages: Array<Record<string, unknown>>) => boolean } = {},
): Promise<SocketOutcome> {
  return new Promise((resolve) => {
    const outcome: SocketOutcome = { opened: false, closeCode: null, messages: [] }
    const ws = new WebSocket(url)
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try { ws.close() } catch {}
      resolve(outcome)
    }
    const timer = setTimeout(finish, options.settleMs ?? 1500)
    ws.addEventListener('open', () => {
      outcome.opened = true
      options.onOpen?.(ws)
    })
    ws.addEventListener('message', (event) => {
      try { outcome.messages.push(JSON.parse(String(event.data))) } catch {}
      if (options.until?.(outcome.messages)) finish()
    })
    ws.addEventListener('close', (event) => {
      outcome.closeCode = event.code
      finish()
    })
    ws.addEventListener('error', finish)
  })
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') })
  const port = probe.port as number
  probe.stop(true)
  return port
}

function spawnServerProcess(args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env, DREAMCODER_CONFIG_DIR: tmpDir }
  delete env[REMOTE_SERVING_ENV]
  delete env.SERVER_AUTH_REQUIRED
  return Bun.spawn(['bun', 'run', 'src/server/index.ts', ...args], { cwd: process.cwd(), env, stdout: 'ignore', stderr: 'ignore' })
}

async function storedTokenHash(): Promise<string> {
  const settings = await new ManagedSettingsService().readSettings()
  return String((settings.h5Access as { tokenHash: string }).tokenHash)
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-serving-test-'))
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  savedServerPort = ProviderService.getServerPort()
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
  delete process.env.SERVER_AUTH_REQUIRED
  delete process.env.ANTHROPIC_API_KEY
  const dist = path.join(tmpDir, 'dist')
  process.env.CLAUDE_H5_DIST_DIR = dist
  await fs.mkdir(path.join(dist, 'assets'), { recursive: true })
  await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html><html><body>H5 Shell</body></html>', 'utf-8')
  await fs.writeFile(path.join(dist, 'assets/app.js'), 'window.__h5 = true', 'utf-8')
})

afterEach(async () => {
  server?.stop(true)
  server = undefined
  for (const sessionId of conversationService.getActiveSessions()) conversationService.stopSession(sessionId)
  ProviderService.setServerPort(savedServerPort)
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('default mode is unchanged', () => {
  test('loopback requests without a token keep working, which is what the deployment probe detects', async () => {
    await boot({ remoteServing: false })
    expect((await request('/api/status')).status).toBe(200)
    const outcome = await observeSocket(`${booted.ws}/ws/default-mode-session`)
    expect(outcome.opened).toBe(true)
  })
})

describe('remote-serving operator surfaces', () => {
  beforeEach(async () => {
    await boot({ remoteServing: true })
  })

  test('deployment probe: a tokenless request is refused on /api and /ws', async () => {
    expect((await request('/api/status')).status).toBe(401)
    expect((await request('/ws/probe-session', { headers: upgradeHeaders() })).status).toBe(401)
  })

  test.each([
    ['no Origin', {}],
    ['desktop app origin', { Origin: 'dreamcoder://localhost' }],
    ['loopback dev server origin', { Origin: 'http://localhost:5173' }],
    ['loopback ip origin', { Origin: 'http://127.0.0.1:9' }],
    ['foreign origin', { Origin: 'https://evil.example' }],
  ])('a tokenless request is refused with %s', async (_label, headers) => {
    expect((await request('/api/sessions', { headers })).status).toBe(401)
    expect((await request('/api/status', { headers })).status).toBe(401)
    expect((await request('/ws/some-session', { headers: upgradeHeaders(headers) })).status).toBe(401)
  })

  test('a valid operator token is accepted for HTTP and WebSocket', async () => {
    expect((await request('/api/status', { headers: bearer(token) })).status).toBe(200)
    const outcome = await observeSocket(`${booted.ws}/ws/operator-session?token=${token}`)
    expect(outcome.opened).toBe(true)
    expect(outcome.messages.some((message) => message.type === 'connected')).toBe(true)
  })

  test('a valid token with a loopback or desktop origin is accepted', async () => {
    for (const origin of ['dreamcoder://localhost', 'http://127.0.0.1:4000']) {
      const response = await request('/api/status', { headers: { ...bearer(token), Origin: origin } })
      expect(response.status).toBe(200)
    }
  })

  test('wrong, empty, stored-hash and malformed credentials are refused', async () => {
    const hash = await storedTokenHash()
    const attempts: Array<Record<string, string>> = [
      bearer('wrong-token'),
      bearer(hash),
      { Authorization: 'Bearer' },
      { Authorization: 'Bearer ' },
      { Authorization: 'bearer' },
      { Authorization: token },
      { Authorization: `Basic ${token}` },
      { Authorization: `Bearer  ${token}` },
    ]
    for (const headers of attempts) {
      expect((await request('/api/status', { headers })).status).toBe(401)
    }
    expect((await request(`/ws/x?token=${hash}`, { headers: upgradeHeaders() })).status).toBe(401)
    expect((await request('/ws/x?token=', { headers: upgradeHeaders() })).status).toBe(401)
    expect((await request('/api/status', { headers: bearer(token) })).status).toBe(200)
  })

  test('a regenerated token revokes the previous one', async () => {
    const previous = token
    const next = (await new H5AccessService().regenerateToken()).token
    expect((await request('/api/status', { headers: bearer(previous) })).status).toBe(401)
    expect((await request('/api/status', { headers: bearer(next) })).status).toBe(200)
  })

  test('the operator token is not stored in plaintext', async () => {
    const settings = JSON.stringify(await new ManagedSettingsService().readSettings())
    expect(settings.includes(token)).toBe(false)
  })

  test('the H5 control plane cannot be used over HTTP, even with a valid token', async () => {
    const hashBefore = await storedTokenHash()
    for (const [method, pathname] of [
      ['GET', '/api/h5-access'],
      ['PUT', '/api/h5-access'],
      ['POST', '/api/h5-access/enable'],
      ['POST', '/api/h5-access/regenerate'],
      ['POST', '/api/h5-access/disable'],
    ] as const) {
      const response = await request(pathname, { method, headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: method === 'PUT' ? '{}' : undefined })
      expect(`${method} ${pathname} ${response.status}`).toBe(`${method} ${pathname} 403`)
    }
    expect(await storedTokenHash()).toBe(hashBefore)
    expect((await request('/api/h5-access/verify', { method: 'POST', headers: bearer(token) })).status).toBe(200)
    expect((await request('/api/h5-access/verify', { method: 'POST' })).status).toBe(401)
  })

  test('the terminal socket is not served', async () => {
    expect((await request('/terminal?cols=80&rows=24', { headers: upgradeHeaders(bearer(token)) })).status).toBe(403)
    expect((await request(`/terminal?token=${token}`, { headers: upgradeHeaders() })).status).toBe(403)
  })

  test('browser host endpoints are not served', async () => {
    expect((await request('/browser-host', { headers: upgradeHeaders() })).status).toBe(403)
    expect((await request('/browser-mcp', { method: 'POST', headers: bearer(token) })).status).toBe(403)
    expect((await request('/web-clone-browser', { method: 'POST', headers: bearer(token) })).status).toBe(403)
  })

  test('requests that carry forwarding headers are refused', async () => {
    for (const header of FORWARDING_HEADERS) {
      expect((await request('/health', { headers: { [header]: '203.0.113.9' } })).status).toBe(403)
      expect((await request('/api/status', { headers: { ...bearer(token), [header]: '203.0.113.9' } })).status).toBe(403)
      expect((await request('/', { headers: { [header]: '203.0.113.9' } })).status).toBe(403)
    }
  })

  test('requests whose Host header is not a loopback name are refused', async () => {
    const hostile = ['evil.example', 'evil.example:80', 'localhost.evil.example', '127.0.0.1.evil.example', '127.0.0.1@evil.example', 'evil.example@127.0.0.1', '127.0.0.1/evil']
    for (const host of hostile) {
      expect(`${host} ${(await request('/health', { headers: { Host: host } })).status}`).toBe(`${host} 403`)
      expect(`${host} ${(await request('/api/status', { headers: { ...bearer(token), Host: host } })).status}`).toBe(`${host} 403`)
      expect(`${host} ${(await request('/proxy/v1/messages', { method: 'POST', headers: { Host: host }, body: '{}' })).status}`).toBe(`${host} 403`)
    }
  })

  test.each([['127.0.0.1'], ['localhost'], ['[::1]']])('a loopback Host header (%s) is accepted', async (name) => {
    const response = await request('/api/status', { headers: { ...bearer(token), Host: `${name}:${booted.port}` } })
    expect(response.status).toBe(200)
  })

  test('public bootstrap routes stay public and carry no operator data', async () => {
    expect((await request('/health')).status).toBe(200)
    const shell = await request('/')
    expect(shell.status).toBe(200)
    expect(await shell.text()).toContain('H5 Shell')
    expect((await request('/assets/app.js')).status).toBe(200)
  })

  test('state-changing requests to unknown paths are refused', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await request('/not-a-route', { method, headers: bearer(token) })
      expect(response.status).toBe(403)
    }
  })

  test('encoded and case-varied paths do not reach operator handlers', async () => {
    for (const pathname of ['/%61pi/status', '//api/status', '/API/status', '/api%2Fstatus', '/./api/status']) {
      const body = await (await request(pathname)).text()
      expect(body.includes('"version"')).toBe(false)
    }
  })

  test('a refused WebSocket upgrade allocates no session runtime', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_, index) => observeSocket(`${booted.ws}/ws/flood-${index}`, { settleMs: 500 })),
    )
    expect(outcomes.every((outcome) => !outcome.opened)).toBe(true)
    for (let index = 0; index < 20; index += 1) {
      expect(peekSessionRuntime(`flood-${index}`)).toBeUndefined()
    }
  })

  test('a permission response cannot resolve a request from another session', async () => {
    const outcome = await observeSocket(`${booted.ws}/ws/session-b?token=${token}`, {
      onOpen: (ws) => ws.send(JSON.stringify({ type: 'permission_response', requestId: 'request-from-session-a', allowed: true })),
    })
    const error = outcome.messages.find((message) => message.type === 'error')
    expect(error?.code).toBe('PERMISSION_REQUEST_EXPIRED')
  })

  test('a disallowed browser origin is still refused by CORS', async () => {
    const preflight = await request('/api/status', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } })
    expect(preflight.status).toBe(403)
  })

  test('tokens never reach the server log', async () => {
    const captured: string[] = []
    const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info }
    const capture = (...args: unknown[]) => { captured.push(args.map(String).join(' ')) }
    console.log = capture
    console.warn = capture
    console.error = capture
    console.info = capture
    try {
      await request('/api/status', { headers: bearer(token) })
      await request('/api/status', { headers: bearer('wrong-token') })
      await observeSocket(`${booted.ws}/ws/log-session?token=${token}`)
      await observeSocket(`${booted.ws}/ws/log-session?token=wrong-token`)
    } finally {
      Object.assign(console, originals)
    }
    const joined = captured.join('\n')
    expect(joined.includes(token)).toBe(false)
    expect(joined.includes('wrong-token')).toBe(false)
  })
})

describe('remote-serving internal principals', () => {
  beforeEach(async () => {
    await boot({ remoteServing: true })
  })

  test('/sdk needs no operator token but still needs a session token', async () => {
    const withoutToken = await observeSocket(`${booted.ws}/sdk/no-such-session`)
    expect(withoutToken.opened).toBe(true)
    expect(withoutToken.closeCode).toBe(1008)
    const withOperatorToken = await observeSocket(`${booted.ws}/sdk/no-such-session?token=${token}`)
    expect(withOperatorToken.closeCode).toBe(1008)
  })

  test('/sdk refuses browser origins', async () => {
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:5173', 'dreamcoder://localhost', 'https://evil.example']) {
      expect((await request('/sdk/some-session', { headers: upgradeHeaders({ Origin: origin }) })).status).toBe(403)
    }
  })

  test('/proxy accepts only credential-less non-browser callers', async () => {
    const post = (headers: Record<string, string>) => request('/proxy/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' })
    expect((await post({})).status).not.toBe(403)
    for (const origin of ['http://127.0.0.1:5173', 'http://localhost:3000', 'dreamcoder://localhost', 'https://evil.example']) {
      expect((await post({ Origin: origin })).status).toBe(403)
    }
  })

  test('a CLI session streams a turn using only its own session token', async () => {
    process.env.CLAUDE_CLI_PATH = fileURLToPath(new URL('./fixtures/mock-sdk-cli.ts', import.meta.url))
    const providers = new ProviderService()
    const provider = await providers.addProvider({
      presetId: 'custom',
      name: 'Remote Serving Test Provider',
      apiKey: 'key-remote-serving',
      baseUrl: 'http://127.0.0.1:1/anthropic',
      apiFormat: 'anthropic',
      runtimeKind: 'anthropic_compatible',
      models: [{ id: 'main' }, { id: 'sonnet' }, { id: 'opus' }, { id: 'haiku' }],
      fastModel: 'haiku',
    })
    await providers.activateProvider(provider.id)

    const outcome = await observeSocket(`${booted.ws}/ws/remote-serving-turn?token=${token}`, {
      settleMs: 12000,
      onOpen: (ws) => ws.send(JSON.stringify({ type: 'user_message', content: 'Hello from a remote operator' })),
      until: (messages) => messages.some((message) => message.type === 'message_complete'),
    })
    const types = outcome.messages.map((message) => message.type)
    expect(types).toContain('content_delta')
    expect(types).toContain('message_complete')
  }, 20000)
})

describe('remote-serving command line', () => {
  test('the --remote-serving flag turns the mode on', async () => {
    token = (await new H5AccessService().enable()).token
    const port = await freePort()
    const child = spawnServerProcess(['--host', '127.0.0.1', '--port', String(port), '--remote-serving'])
    try {
      await waitForHealth(`http://127.0.0.1:${port}`, 200)
      expect((await fetch(`http://127.0.0.1:${port}/api/status`)).status).toBe(401)
      expect((await fetch(`http://127.0.0.1:${port}/api/status`, { headers: bearer(token) })).status).toBe(200)
    } finally {
      child.kill()
      await child.exited
    }
  }, 30000)

  test('the flag with a non-loopback --host exits with an error and never listens', async () => {
    const port = await freePort()
    const child = spawnServerProcess(['--host', '0.0.0.0', '--port', String(port), '--remote-serving'])
    const outcome = await Promise.race([child.exited, Bun.sleep(15000).then(() => 'timeout' as const)])
    if (outcome === 'timeout') child.kill()
    expect(outcome).toBe(1)
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow()
  }, 30000)
})

describe('remote-serving startup guards', () => {
  test('refuses to listen on a non-loopback address', async () => {
    process.env[REMOTE_SERVING_ENV] = '1'
    for (const host of ['0.0.0.0', '::', '192.168.1.10', 'example.com']) {
      expect(() => startServer(0, host)).toThrow(/loopback/i)
    }
  })

  test.each([['true'], ['yes'], ['on'], ['2'], [' 1']])('an unrecognized SERVER_REMOTE_SERVING value (%p) is an error, never a silent off', (value) => {
    process.env[REMOTE_SERVING_ENV] = value
    expect(() => startServer(0, '127.0.0.1')).toThrow(/SERVER_REMOTE_SERVING must be 1 or 0/)
  })

  test.each([['0'], ['']])('SERVER_REMOTE_SERVING=%p leaves the mode off', async (value) => {
    await boot({ remoteServing: false, rawEnv: value })
    expect((await request('/api/status')).status).toBe(200)
  })

  test('refuses to combine with explicit server auth', async () => {
    process.env[REMOTE_SERVING_ENV] = '1'
    process.env.SERVER_AUTH_REQUIRED = '1'
    expect(() => startServer(0, '127.0.0.1')).toThrow(/auth-required|SERVER_AUTH_REQUIRED/i)
  })

  test('refuses every operator request while H5 access is not enabled', async () => {
    await boot({ remoteServing: true, enableH5: false })
    expect((await request('/api/status')).status).toBe(503)
    expect((await request('/api/status', { headers: bearer('anything') })).status).toBe(503)
    expect((await request('/ws/not-ready', { headers: upgradeHeaders() })).status).toBe(503)
    expect((await request('/health')).status).toBe(200)
  })

  test('disabling H5 access closes the surface at once', async () => {
    await boot({ remoteServing: true })
    expect((await request('/api/status', { headers: bearer(token) })).status).toBe(200)
    await new H5AccessService().disable()
    expect((await request('/api/status', { headers: bearer(token) })).status).toBe(503)
  })
})

describe('rollback', () => {
  test('restarting without the flag restores default behavior and leaves settings untouched', async () => {
    await boot({ remoteServing: true })
    const before = JSON.stringify(await new ManagedSettingsService().readSettings())
    await request('/api/status')
    await request('/api/status', { headers: bearer(token) })
    server?.stop(true)
    server = undefined
    expect(JSON.stringify(await new ManagedSettingsService().readSettings())).toBe(before)
    await boot({ remoteServing: false, enableH5: false })
    expect((await request('/api/status')).status).toBe(200)
  })
})
