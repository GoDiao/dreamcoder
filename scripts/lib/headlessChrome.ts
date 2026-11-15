import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const START_TIMEOUT_MS = 15_000
const LOAD_TIMEOUT_MS = 30_000

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }
type Listener = (params: Record<string, unknown>) => void

export type ChromePage = {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>
  evaluate<T>(expression: string): Promise<T>
  goto(url: string): Promise<void>
  setViewport(width: number, height: number): Promise<void>
  screenshot(clip?: { x: number; y: number; width: number; height: number }): Promise<Uint8Array>
}

export type HeadlessChrome = {
  newPage(): Promise<ChromePage>
  close(): Promise<void>
}

async function waitForPort(profile: string): Promise<string> {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    const text = await readFile(join(profile, 'DevToolsActivePort'), 'utf-8').catch(() => null)
    const [port, path] = text?.trim().split('\n') ?? []
    if (port && path) return `ws://127.0.0.1:${port}${path}`
    await Bun.sleep(100)
  }
  throw new Error('Chrome did not open its debugging port')
}

export async function launchChrome(): Promise<HeadlessChrome> {
  const profile = await mkdtemp(join(tmpdir(), 'dreamcoder-chrome-'))
  const child = Bun.spawn([
    CHROME,
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdout: 'ignore', stderr: 'ignore' })
  const socket = new WebSocket(await waitForPort(profile))
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome')), { once: true })
  })
  let nextId = 1
  const pending = new Map<number, Pending>()
  const listeners = new Map<string, Set<Listener>>()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown>; sessionId?: string }
    if (message.id !== undefined) {
      const waiter = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) waiter?.reject(new Error(message.error.message))
      else waiter?.resolve(message.result)
      return
    }
    if (message.method) {
      for (const listener of listeners.get(`${message.sessionId ?? ''}:${message.method}`) ?? []) listener(message.params ?? {})
    }
  })

  const send = <T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> => {
    const id = nextId++
    socket.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }))
    return new Promise<T>((resolve, reject) => pending.set(id, { resolve: resolve as (value: unknown) => void, reject }))
  }

  const once = (sessionId: string, method: string, timeout: number): Promise<void> => new Promise((resolve, reject) => {
    const key = `${sessionId}:${method}`
    const set = listeners.get(key) ?? new Set<Listener>()
    listeners.set(key, set)
    const timer = setTimeout(() => {
      set.delete(listener)
      reject(new Error(`Timed out waiting for ${method}`))
    }, timeout)
    const listener: Listener = () => {
      clearTimeout(timer)
      set.delete(listener)
      resolve()
    }
    set.add(listener)
  })

  return {
    async newPage() {
      const { targetId } = await send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
      const call = <T>(method: string, params?: Record<string, unknown>) => send<T>(method, params, sessionId)
      await call('Page.enable')
      await call('Runtime.enable')
      return {
        send: call,
        async evaluate<T>(expression: string) {
          const result = await call<{ result: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text: string } }>('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
          })
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
          return result.result.value as T
        },
        async goto(url: string) {
          const loaded = once(sessionId, 'Page.loadEventFired', LOAD_TIMEOUT_MS)
          await call('Page.navigate', { url })
          await loaded
        },
        async setViewport(width: number, height: number) {
          await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
        },
        async screenshot(clip) {
          const { data } = await call<{ data: string }>('Page.captureScreenshot', { format: 'png', ...(clip && { clip: { ...clip, scale: 1 } }) })
          return Buffer.from(data, 'base64')
        },
      }
    },
    async close() {
      socket.close()
      child.kill()
      await child.exited
      await rm(profile, { recursive: true, force: true })
    },
  }
}
