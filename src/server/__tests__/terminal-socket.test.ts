import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { startServer } from '../index.js'
import { H5AccessService } from '../services/h5AccessService.js'
import { ProviderService } from '../services/providerService.js'
import type { TerminalServerMessage } from '../ws/terminalSocket.js'

const posix = process.platform !== 'win32'

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

async function writeTerminalSettings(desktopTerminal: Record<string, unknown>) {
  await fs.writeFile(path.join(tmpDir, 'settings.json'), JSON.stringify({ desktopTerminal }), 'utf-8')
}

function openTerminal(query: string) {
  const messages: TerminalServerMessage[] = []
  const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/terminal?${query}`)
  const closed = new Promise<number>((resolve) => ws.addEventListener('close', (event) => resolve(event.code)))
  ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data)) as TerminalServerMessage))
  const output = () => messages.filter((message) => message.type === 'output').map((message) => message.data).join('')
  async function waitFor(check: () => boolean) {
    for (let attempt = 0; attempt < 150 && !check(); attempt += 1) await Bun.sleep(20)
    expect(check()).toBe(true)
  }
  return { ws, messages, closed, output, waitFor }
}

beforeEach(async () => {
  tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-socket-test-')))
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  originalServerPort = ProviderService.getServerPort()
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
  const port = 18000 + Math.floor(Math.random() * 10000)
  server = startServer(port, '127.0.0.1')
  baseUrl = `http://127.0.0.1:${port}`
  await waitForServer(`${baseUrl}/health`)
})

afterEach(async () => {
  server?.stop(true)
  server = undefined
  ProviderService.setServerPort(originalServerPort)
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('terminal API', () => {
  test('reports the default shell and platform', async () => {
    const response = await fetch(`${baseUrl}/api/terminal/default-shell`)
    expect(response.status).toBe(200)
    const body = await response.json() as { shell: string; platform: string }
    expect(body.shell.length).toBeGreaterThan(0)
    expect(['windows', 'macos', 'linux']).toContain(body.platform)
  })

  test('validates the bash path', async () => {
    const bash = path.join(tmpDir, 'bash.exe')
    await fs.writeFile(bash, '')
    const post = (body: unknown) => fetch(`${baseUrl}/api/terminal/validate-bash-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(await (await post({ path: ` ${bash} ` })).json()).toEqual({ path: bash })
    expect(await (await post({ path: '  ' })).json()).toEqual({ path: null })
    const missing = await post({ path: path.join(tmpDir, 'missing') })
    expect(missing.status).toBe(400)
    expect(JSON.stringify(await missing.json())).toContain('terminal bash path does not exist')
  })

  test('rejects requests from a non-local origin', async () => {
    const headers = { Origin: 'https://phone.example' }
    expect((await fetch(`${baseUrl}/api/terminal/default-shell`, { headers })).status).toBe(403)
    const upgrade = await fetch(`${baseUrl}/terminal`, {
      headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket' },
    })
    expect(upgrade.status).toBe(403)
  })

  test('stays desktop-only for authorized H5 clients when H5 access is enabled', async () => {
    const origin = 'https://phone.example'
    const service = new H5AccessService()
    await service.updateSettings({ allowedOrigins: [origin] })
    const { token } = await service.enable()
    const headers = { Origin: origin, Authorization: `Bearer ${token}` }

    expect((await fetch(`${baseUrl}/api/sessions`, { headers })).status).toBe(200)
    for (const request of [
      fetch(`${baseUrl}/api/terminal/default-shell`, { headers }),
      fetch(`${baseUrl}/api/terminal/validate-bash-path`, { method: 'POST', headers, body: JSON.stringify({ path: null }) }),
      fetch(`${baseUrl}/terminal?token=${token}`, { headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket' } }),
    ]) {
      const response = await request
      expect(response.status).toBe(403)
      expect(JSON.stringify(await response.json())).toContain('only available in the local desktop app')
    }
  })
})

describe.skipIf(!posix)('terminal socket', () => {
  test('runs the shell from the saved settings, relays input, resize and exit', async () => {
    await writeTerminalSettings({ startupShell: 'custom', customShellPath: '/bin/sh' })
    const terminal = openTerminal(`cols=80&rows=24&cwd=${encodeURIComponent(tmpDir)}`)

    await terminal.waitFor(() => terminal.messages.some((message) => message.type === 'started'))
    expect(terminal.messages.find((message) => message.type === 'started')).toEqual({
      type: 'started',
      shell: '/bin/sh',
      cwd: tmpDir,
      warning: null,
    })

    terminal.ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }))
    terminal.ws.send(JSON.stringify({ type: 'input', data: 'stty size; pwd; exit 4\n' }))

    expect(await terminal.closed).toBe(1000)
    expect(terminal.output()).toContain('30 100')
    expect(terminal.output()).toContain(tmpDir)
    expect(terminal.messages.at(-1)).toEqual({ type: 'exit', code: 4, signal: null })
  })

  test('reports a start failure and closes the socket', async () => {
    const terminal = openTerminal(`cwd=${encodeURIComponent(path.join(tmpDir, 'missing'))}`)
    expect(await terminal.closed).toBe(1011)
    expect(terminal.messages).toEqual([
      { type: 'error', message: `terminal cwd does not exist: ${path.join(tmpDir, 'missing')}` },
    ])
  })

  test('closing the socket ends the shell', async () => {
    await writeTerminalSettings({ startupShell: 'custom', customShellPath: '/bin/sh' })
    const terminal = openTerminal(`cwd=${encodeURIComponent(tmpDir)}`)
    await terminal.waitFor(() => terminal.messages.some((message) => message.type === 'started'))

    terminal.ws.send(JSON.stringify({ type: 'input', data: 'echo "pid=$$"\n' }))
    await terminal.waitFor(() => /pid=(\d+)/.test(terminal.output()))
    const pid = Number(/pid=(\d+)/.exec(terminal.output())![1])

    terminal.ws.close()
    const isRunning = () => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    await terminal.waitFor(() => !isRunning())
  })
})
