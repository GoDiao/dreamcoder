import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTerminalSocketUrl, TerminalDisconnectedError, terminalApi, type OpenTerminalInput, type TerminalServerMessage } from './terminal'
import { setAuthToken, setBaseUrl } from './client'

const runtime = vi.hoisted(() => ({ desktop: true, get: vi.fn(), post: vi.fn() }))
vi.mock('../lib/desktopRuntime', () => ({ isDesktopRuntime: () => runtime.desktop }))
vi.mock('./client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./client')>()
  return { ...original, api: { ...original.api, get: runtime.get, post: runtime.post } }
})

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 0
  sent: string[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.onclose?.()
  }

  serverSends(message: TerminalServerMessage) {
    this.readyState = FakeWebSocket.OPEN
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

function openInput(overrides: Partial<OpenTerminalInput> = {}): OpenTerminalInput {
  return { cols: 80, rows: 24, onOutput: vi.fn(), onExit: vi.fn(), onError: vi.fn(), onDisconnect: vi.fn(), ...overrides }
}

describe('terminal API', () => {
  beforeEach(() => {
    runtime.desktop = true
    runtime.get.mockReset()
    runtime.post.mockReset()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    setBaseUrl('http://127.0.0.1:4100')
    setAuthToken(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setAuthToken(null)
  })

  it('builds the terminal socket URL from the server URL', () => {
    expect(buildTerminalSocketUrl({ cols: 100, rows: 30, cwd: '/work dir' }))
      .toBe('ws://127.0.0.1:4100/terminal?cols=100&rows=30&cwd=%2Fwork+dir')
    setAuthToken('secret')
    expect(buildTerminalSocketUrl({ cols: 80, rows: 24 })).toBe('ws://127.0.0.1:4100/terminal?cols=80&rows=24&token=secret')
  })

  it('resolves once the shell starts and relays input, resize, output and exit', async () => {
    const input = openInput()
    const opening = terminalApi.open(input)
    const socket = FakeWebSocket.instances[0]!

    socket.serverSends({ type: 'output', data: 'prompt$ ' })
    socket.serverSends({ type: 'started', shell: '/bin/zsh', cwd: '/work', warning: 'fallback' })
    const connection = await opening

    expect(connection).toMatchObject({ shell: '/bin/zsh', cwd: '/work', warning: 'fallback' })
    expect(input.onOutput).toHaveBeenCalledWith('prompt$ ')

    connection.write('ls\r')
    connection.resize(120, 40)
    expect(socket.sent.map((data) => JSON.parse(data))).toEqual([
      { type: 'input', data: 'ls\r' },
      { type: 'resize', cols: 120, rows: 40 },
    ])

    socket.serverSends({ type: 'exit', code: 0, signal: null })
    socket.close()
    expect(input.onExit).toHaveBeenCalledWith({ code: 0, signal: null })
    expect(input.onError).not.toHaveBeenCalled()
  })

  it('rejects with the server error when the shell cannot start', async () => {
    const opening = terminalApi.open(openInput())
    const socket = FakeWebSocket.instances[0]!
    socket.serverSends({ type: 'error', message: 'terminal cwd does not exist: /missing' })
    socket.close()
    await expect(opening).rejects.toThrow('terminal cwd does not exist: /missing')
  })

  it('rejects with a disconnect error when the socket closes before the shell starts', async () => {
    const opening = terminalApi.open(openInput())
    FakeWebSocket.instances[0]!.close()
    await expect(opening).rejects.toBeInstanceOf(TerminalDisconnectedError)
  })

  it('reports a dropped connection after the shell started but not a deliberate close', async () => {
    const dropped = openInput()
    const opening = terminalApi.open(dropped)
    FakeWebSocket.instances[0]!.serverSends({ type: 'started', shell: '/bin/sh', cwd: '/', warning: null })
    await opening
    FakeWebSocket.instances[0]!.close()
    expect(dropped.onDisconnect).toHaveBeenCalledOnce()
    expect(dropped.onError).not.toHaveBeenCalled()

    const closed = openInput()
    const second = terminalApi.open(closed)
    FakeWebSocket.instances[1]!.serverSends({ type: 'started', shell: '/bin/sh', cwd: '/', warning: null })
    ;(await second).close()
    expect(closed.onDisconnect).not.toHaveBeenCalled()
  })

  it('refuses to write once the socket is closed', async () => {
    const opening = terminalApi.open(openInput())
    FakeWebSocket.instances[0]!.serverSends({ type: 'started', shell: '/bin/sh', cwd: '/', warning: null })
    const connection = await opening
    connection.close()
    expect(() => connection.write('x')).toThrow(TerminalDisconnectedError)
  })

  it('asks the sidecar for the default shell and bash path validation', async () => {
    runtime.get.mockResolvedValue({ shell: 'cmd.exe', platform: 'windows' })
    runtime.post.mockResolvedValue({ path: 'C:\\Git\\bin\\bash.exe' })

    await expect(terminalApi.detectDefaultShell()).resolves.toEqual({ shell: 'cmd.exe', platform: 'windows' })
    expect(runtime.get).toHaveBeenCalledWith('/api/terminal/default-shell')
    await expect(terminalApi.validateBashPath(' C:\\Git\\bin\\bash.exe ')).resolves.toBe('C:\\Git\\bin\\bash.exe')
    expect(runtime.post).toHaveBeenCalledWith('/api/terminal/validate-bash-path', { path: ' C:\\Git\\bin\\bash.exe ' })
  })

  it('does not open terminals or call the sidecar outside the desktop runtime', async () => {
    runtime.desktop = false
    await expect(terminalApi.open(openInput())).rejects.toThrow('desktop app runtime')
    await expect(terminalApi.detectDefaultShell()).rejects.toThrow('desktop app runtime')
    await expect(terminalApi.validateBashPath(null)).rejects.toThrow('desktop app runtime')
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(runtime.get).not.toHaveBeenCalled()
  })
})
