import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import path from 'node:path'

const BIND_HOST = '0.0.0.0'
const CONTROL_HOST = '127.0.0.1'
const STARTUP_TIMEOUT_MS = 10_000
const STARTUP_LOG_LIMIT = 40
const CONFIG_DIR_ENV = 'DREAMCODER_CONFIG_DIR'

export type SidecarPaths = {
  binary: string
  appRoot: string
  h5DistDir: string
}

export function devSidecarPaths(desktopRoot: string, triple: string, exe: string): Pick<SidecarPaths, 'binary' | 'appRoot'> {
  const binDir = path.join(desktopRoot, 'binaries', triple)
  return { binary: path.join(binDir, `dreamcoder-sidecar${exe}`), appRoot: binDir }
}

export type SidecarRuntime = {
  url: string
  child: ChildProcess
  token: string
}

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, BIND_HOST, () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('read local port: no address'))
      })
    })
  })
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: CONTROL_HOST, port })
    socket.setTimeout(200)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

async function waitForServer(port: number, child: ChildProcess, spawnError: () => Error | null) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    const error = spawnError()
    if (error) throw new Error(`sidecar failed to start: ${error.message}`)
    if (child.exitCode !== null) throw new Error(`sidecar exited with code ${child.exitCode}`)
    if (await canConnect(port)) return
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`desktop server did not start listening on ${CONTROL_HOST}:${port} within 10 seconds`)
}

function sidecarEnv(paths: SidecarPaths, appVersion: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_H5_AUTO_PUBLIC_URL: '1',
    CLAUDE_H5_DIST_DIR: paths.h5DistDir,
    DREAMCODER_PARENT_PID: String(process.pid),
    APP_VERSION: appVersion,
  }
  const configDir = process.env[CONFIG_DIR_ENV]
  if (configDir) {
    const cacheDir = path.join(configDir, 'Cache')
    mkdirSync(cacheDir, { recursive: true })
    env.XDG_CACHE_HOME = cacheDir
  }
  return env
}

export async function startSidecar(paths: SidecarPaths, appVersion: string): Promise<SidecarRuntime> {
  const port = await reservePort()
  const logs: string[] = []
  const token = randomBytes(32).toString('hex')
  const child = spawn(
    paths.binary,
    ['server', '--app-root', paths.appRoot, '--host', BIND_HOST, '--port', String(port)],
    { env: sidecarEnv(paths, appVersion), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  )
  const record = (stream: string) => (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.trim()) continue
      console.log(`[claude-server] ${line}`)
      logs.push(`[${stream}] ${line}`)
      if (logs.length > STARTUP_LOG_LIMIT) logs.shift()
    }
  }
  child.stdin?.on('error', (error) => console.error('[claude-server] writing to sidecar stdin failed', error))
  child.stdin?.write(`${token}\n`)
  child.stdout?.on('data', record('stdout'))
  child.stderr?.on('data', record('stderr'))
  let spawnError: Error | null = null
  child.once('error', (error) => {
    spawnError = error
    console.error('[claude-server] sidecar failed to start', error)
  })
  child.once('exit', (code, signal) => {
    console.error(`[claude-server] sidecar exited (code=${code}, signal=${signal})`)
  })

  try {
    await waitForServer(port, child, () => spawnError)
  } catch (error) {
    child.kill()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}\n\nRecent server logs:\n${logs.join('\n') || 'No server stdout/stderr was captured before the timeout.'}`)
  }

  return { url: `http://${CONTROL_HOST}:${port}`, child, token }
}
