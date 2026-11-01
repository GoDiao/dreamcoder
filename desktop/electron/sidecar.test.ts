import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:net'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FakeChild = EventEmitter & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  exitCode: number | null
  kill: () => void
}

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawn: spawnMock, default: { spawn: spawnMock } }))

import { startSidecar } from './sidecar'

const paths = { binary: '/bin/sidecar', appRoot: '/app', h5DistDir: '/dist' }
const servers: Server[] = []

function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    kill: vi.fn(),
  })
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  spawnMock.mockReset()
})

describe('startSidecar', () => {
  it('writes a random token to the child stdin once and keeps stdin open', async () => {
    const child = fakeChild()
    const written: string[] = []
    child.stdin.on('data', (chunk: Buffer) => written.push(chunk.toString('utf8')))
    const ended = vi.fn()
    child.stdin.on('end', ended)
    spawnMock.mockImplementation((_binary: string, args: string[]) => {
      const server = createServer()
      servers.push(server)
      server.listen(Number(args[args.indexOf('--port') + 1]), '127.0.0.1')
      return child
    })

    const runtime = await startSidecar(paths, '1.0.0')
    await new Promise((resolve) => setImmediate(resolve))

    expect(runtime.token).toMatch(/^[0-9a-f]{64}$/)
    expect(written.join('')).toBe(`${runtime.token}\n`)
    expect(ended).not.toHaveBeenCalled()
    expect(child.stdin.writableEnded).toBe(false)

    const [binary, args, options] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string>; stdio: string[] }]
    expect(binary).toBe('/bin/sidecar')
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(args.join(' ')).not.toContain(runtime.token)
    expect(Object.values(options.env)).not.toContain(runtime.token)
  })

  it('uses a different token for every start', async () => {
    const tokens: string[] = []
    for (let i = 0; i < 2; i += 1) {
      spawnMock.mockImplementation((_binary: string, args: string[]) => {
        const server = createServer()
        servers.push(server)
        server.listen(Number(args[args.indexOf('--port') + 1]), '127.0.0.1')
        return fakeChild()
      })
      tokens.push((await startSidecar(paths, '1.0.0')).token)
    }
    expect(tokens[0]).not.toBe(tokens[1])
  })
})
