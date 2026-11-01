import { randomUUID } from 'node:crypto'
import type { BackgroundBrowserCommand, BrowserHostErrorCode } from '../../src/server/browserHost/protocol'

type Listener = (...args: unknown[]) => void
type PreventableEvent = { preventDefault(): void }

export type BackgroundContents = {
  loadURL(url: string): Promise<void>
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  setUserAgent(userAgent: string): void
  getUserAgent(): string
  isDestroyed(): boolean
  on(event: string, listener: Listener): unknown
  debugger: {
    attach(protocolVersion?: string): void
    detach(): void
    isAttached(): boolean
    sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>
    on(event: string, listener: Listener): unknown
  }
}

export type BackgroundWindow = {
  webContents: BackgroundContents
  isDestroyed(): boolean
  close(): void
  on(event: 'closed', listener: () => void): unknown
}

export type BackgroundBrowserEvent =
  | { kind: 'cdp'; session: string; target: string; method: string; params: unknown }
  | { kind: 'closed'; session: string; target: string }

export type BackgroundBrowserDeps = {
  createWindow(partition: string): BackgroundWindow
  clearPartition(partition: string): Promise<void>
  classify(url: string): 'allow' | 'external' | 'refuse'
  userAgent(userAgent: string): string
}

export class BackgroundBrowserError extends Error {
  constructor(readonly code: BrowserHostErrorCode, message: string) {
    super(message)
  }
}

type Entry = { session: string; target: string; window: BackgroundWindow }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class BackgroundBrowserHost {
  private readonly partitions = new Map<string, string>()
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<(event: BackgroundBrowserEvent) => void>()

  constructor(private readonly deps: BackgroundBrowserDeps) {}

  onEvent(listener: (event: BackgroundBrowserEvent) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async run(command: BackgroundBrowserCommand): Promise<unknown> {
    switch (command.kind) {
      case 'createTarget':
        await this.createTarget(command.session, command.target)
        return {}
      case 'closeTarget':
        this.closeTarget(command.session, command.target)
        return {}
      case 'cdp':
        return { result: await this.cdp(command.session, command.target, command.method, command.params) }
      case 'destroySession':
        await this.destroySession(command.session)
        return {}
    }
  }

  async destroyAll() {
    for (const session of [...this.partitions.keys()]) await this.destroySession(session)
  }

  size() {
    return this.entries.size
  }

  private key(session: string, target: string) {
    return `${session}\u0000${target}`
  }

  private emit(event: BackgroundBrowserEvent) {
    this.listeners.forEach((listener) => listener(event))
  }

  private async createTarget(session: string, target: string) {
    const key = this.key(session, target)
    if (this.entries.has(key)) throw new BackgroundBrowserError('internal', `target ${target} already exists`)
    let partition = this.partitions.get(session)
    if (!partition) {
      partition = `web-clone-${randomUUID()}`
      this.partitions.set(session, partition)
    }
    const window = this.deps.createWindow(partition)
    const contents = window.webContents
    const entry: Entry = { session, target, window }
    this.entries.set(key, entry)
    try {
      contents.setUserAgent(this.deps.userAgent(contents.getUserAgent()))
      this.guard(contents)
      contents.on('destroyed', (() => this.forget(entry)) as Listener)
      window.on('closed', () => this.forget(entry))
      await contents.loadURL('about:blank')
      contents.debugger.attach('1.3')
      contents.debugger.on('message', ((_event: unknown, method: string, params: unknown) => {
        this.emit({ kind: 'cdp', session, target, method, params })
      }) as Listener)
    } catch (error) {
      this.entries.delete(key)
      if (!window.isDestroyed()) window.close()
      throw new BackgroundBrowserError('attach_failed', `could not open a background page: ${errorMessage(error)}`)
    }
  }

  private guard(contents: BackgroundContents) {
    const allow = (url: string) => this.deps.classify(url) === 'allow'
    contents.setWindowOpenHandler(({ url }) => {
      if (allow(url)) void contents.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
    contents.on('will-navigate', ((event: PreventableEvent, url: string) => {
      if (!allow(url)) event.preventDefault()
    }) as Listener)
    contents.on('will-redirect', ((event: PreventableEvent, url: string) => {
      if (!allow(url)) event.preventDefault()
    }) as Listener)
  }

  private forget(entry: Entry) {
    const key = this.key(entry.session, entry.target)
    if (this.entries.get(key) !== entry) return
    this.entries.delete(key)
    this.emit({ kind: 'closed', session: entry.session, target: entry.target })
  }

  private closeTarget(session: string, target: string) {
    const entry = this.entries.get(this.key(session, target))
    if (!entry) return
    this.entries.delete(this.key(session, target))
    this.dispose(entry)
  }

  private dispose(entry: Entry) {
    const { window } = entry
    if (window.isDestroyed()) return
    if (window.webContents.debugger.isAttached()) {
      try {
        window.webContents.debugger.detach()
      } catch (error) {
        console.error(`[web-clone] detaching the debugger failed: ${errorMessage(error)}`)
      }
    }
    window.close()
  }

  private async cdp(session: string, target: string, method: string, params: Record<string, unknown> | undefined) {
    const entry = this.entries.get(this.key(session, target))
    if (!entry || entry.window.isDestroyed()) throw new BackgroundBrowserError('no_view', `there is no background page ${target}`)
    if (method === 'Page.navigate') {
      const url = typeof params?.url === 'string' ? params.url : ''
      if (this.deps.classify(url) !== 'allow') throw new BackgroundBrowserError('refused_url', `${url.slice(0, 120)} cannot be opened here`)
    }
    try {
      return await entry.window.webContents.debugger.sendCommand(method, params)
    } catch (error) {
      throw new BackgroundBrowserError('cdp_error', errorMessage(error))
    }
  }

  private async destroySession(session: string) {
    const partition = this.partitions.get(session)
    this.partitions.delete(session)
    for (const [key, entry] of [...this.entries]) {
      if (entry.session !== session) continue
      this.entries.delete(key)
      this.dispose(entry)
    }
    if (partition) await this.deps.clearPartition(partition).catch((error: unknown) => console.error(`[web-clone] clearing the session data failed: ${errorMessage(error)}`))
  }
}
