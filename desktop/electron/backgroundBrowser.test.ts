import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundBrowserError, BackgroundBrowserHost, type BackgroundBrowserEvent, type BackgroundWindow } from './backgroundBrowser'

type Handler = (...args: unknown[]) => void

class FakeContents {
  calls: string[] = []
  attached = false
  destroyed = false
  loaded: string[] = []
  userAgent = 'Mozilla/5.0 Chrome/140 Electron/45'
  openHandler: ((details: { url: string }) => { action: 'deny' }) | null = null
  handlers = new Map<string, Handler[]>()
  debuggerHandlers = new Map<string, Handler[]>()
  commands: Array<{ method: string; params?: Record<string, unknown> }> = []
  sendResult: unknown = {}
  sendFailure: Error | null = null
  loadFailure: Error | null = null
  attachFailure: Error | null = null

  async loadURL(url: string) {
    if (this.loadFailure) throw this.loadFailure
    this.calls.push('load')
    this.loaded.push(url)
  }
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }) {
    this.openHandler = handler
  }
  setUserAgent(userAgent: string) {
    this.userAgent = userAgent
  }
  getUserAgent() {
    return this.userAgent
  }
  isDestroyed() {
    return this.destroyed
  }
  on(event: string, listener: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener])
  }
  debugger = {
    attach: (version?: string) => {
      if (this.attachFailure) throw this.attachFailure
      this.calls.push(`attach:${version}`)
      this.attached = true
    },
    detach: () => {
      this.calls.push('detach')
      this.attached = false
    },
    isAttached: () => this.attached,
    sendCommand: async (method: string, params?: Record<string, unknown>) => {
      if (this.sendFailure) throw this.sendFailure
      this.commands.push({ method, params })
      return this.sendResult
    },
    on: (event: string, listener: Handler) => {
      this.debuggerHandlers.set(event, [...(this.debuggerHandlers.get(event) ?? []), listener])
    },
  }
  fire(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args)
  }
  fireDebugger(event: string, ...args: unknown[]) {
    for (const handler of this.debuggerHandlers.get(event) ?? []) handler(...args)
  }
}

class FakeWindow {
  webContents = new FakeContents()
  closed = false
  closedHandlers: Array<() => void> = []
  isDestroyed() {
    return this.closed
  }
  close() {
    this.closed = true
    this.closedHandlers.forEach((handler) => handler())
  }
  on(_event: 'closed', listener: () => void) {
    this.closedHandlers.push(listener)
  }
}

let windows: FakeWindow[]
let partitions: string[]
let cleared: string[]
let host: BackgroundBrowserHost
let events: BackgroundBrowserEvent[]

beforeEach(() => {
  windows = []
  partitions = []
  cleared = []
  events = []
  host = new BackgroundBrowserHost({
    createWindow: (partition) => {
      partitions.push(partition)
      const window = new FakeWindow()
      windows.push(window)
      return window as unknown as BackgroundWindow
    },
    clearPartition: async (partition) => {
      cleared.push(partition)
    },
    classify: (url) => (/^https:\/\/|^http:\/\/localhost/.test(url) ? 'allow' : 'refuse'),
    userAgent: (userAgent) => userAgent.replace(' Electron/45', ''),
  })
  host.onEvent((event) => events.push(event))
})

const create = (session: string, target: string) => host.run({ kind: 'createTarget', session, target })

describe('creating a page', () => {
  it('loads a blank page before attaching the debugger and takes the Electron mark out of the user agent', async () => {
    await create('s', 't')
    const contents = windows[0]!.webContents
    expect(contents.calls).toEqual(['load', 'attach:1.3'])
    expect(contents.loaded).toEqual(['about:blank'])
    expect(contents.userAgent).toBe('Mozilla/5.0 Chrome/140')
    expect(host.size()).toBe(1)
  })

  it('gives each session its own in-memory partition and shares it between the pages of one session', async () => {
    await create('s1', 'a')
    await create('s1', 'b')
    await create('s2', 'c')
    expect(partitions[0]).toBe(partitions[1])
    expect(partitions[2]).not.toBe(partitions[0])
    expect(partitions.every((partition) => partition.startsWith('web-clone-') && !partition.startsWith('persist:'))).toBe(true)
  })

  it('refuses a page id that is already used', async () => {
    await create('s', 't')
    await expect(create('s', 't')).rejects.toMatchObject({ code: 'internal' })
    expect(windows).toHaveLength(1)
  })

  it('closes the window and reports attach_failed when the page cannot be prepared', async () => {
    const original = windows.length
    host = new BackgroundBrowserHost({
      createWindow: () => {
        const window = new FakeWindow()
        window.webContents.attachFailure = new Error('already attached')
        windows.push(window)
        return window as unknown as BackgroundWindow
      },
      clearPartition: async () => undefined,
      classify: () => 'allow',
      userAgent: (value) => value,
    })
    await expect(host.run({ kind: 'createTarget', session: 's', target: 't' })).rejects.toMatchObject({ code: 'attach_failed', message: expect.stringContaining('already attached') })
    expect(windows[original]!.closed).toBe(true)
    expect(host.size()).toBe(0)
  })
})

describe('commands', () => {
  it('sends a command to the page debugger and returns its result', async () => {
    await create('s', 't')
    const contents = windows[0]!.webContents
    contents.sendResult = { frameTree: { frame: { id: 'f' } } }
    expect(await host.run({ kind: 'cdp', session: 's', target: 't', method: 'Page.getFrameTree' })).toEqual({ result: { frameTree: { frame: { id: 'f' } } } })
    await host.run({ kind: 'cdp', session: 's', target: 't', method: 'Network.enable', params: { maxTotalBufferSize: 5 } })
    expect(contents.commands).toEqual([{ method: 'Page.getFrameTree', params: undefined }, { method: 'Network.enable', params: { maxTotalBufferSize: 5 } }])
  })

  it('reports cdp_error with the message of the debugger', async () => {
    await create('s', 't')
    windows[0]!.webContents.sendFailure = new Error('No node with given id')
    await expect(host.run({ kind: 'cdp', session: 's', target: 't', method: 'DOM.describeNode' })).rejects.toMatchObject({ code: 'cdp_error', message: 'No node with given id' })
  })

  it('reports no_view for a page that was never made, was closed or belongs to another session', async () => {
    await create('s', 't')
    for (const [session, target] of [['s', 'x'], ['other', 't']] as const) {
      await expect(host.run({ kind: 'cdp', session, target, method: 'Page.enable' })).rejects.toBeInstanceOf(BackgroundBrowserError)
    }
    await host.run({ kind: 'closeTarget', session: 's', target: 't' })
    await expect(host.run({ kind: 'cdp', session: 's', target: 't', method: 'Page.enable' })).rejects.toMatchObject({ code: 'no_view' })
  })

  it('lets a page navigate to an allowed address only', async () => {
    await create('s', 't')
    const contents = windows[0]!.webContents
    await host.run({ kind: 'cdp', session: 's', target: 't', method: 'Page.navigate', params: { url: 'https://example.com/' } })
    expect(contents.commands).toHaveLength(1)
    for (const url of ['file:///etc/passwd', 'http://example.com/', 'javascript:alert(1)', '', 'dreamcoder-project://x/y']) {
      await expect(host.run({ kind: 'cdp', session: 's', target: 't', method: 'Page.navigate', params: { url } })).rejects.toMatchObject({ code: 'refused_url' })
    }
    expect(contents.commands).toHaveLength(1)
  })
})

describe('what the page may do on its own', () => {
  it('refuses a main frame navigation to an address that is not allowed and lets the others through', async () => {
    await create('s', 't')
    const contents = windows[0]!.webContents
    const blocked = { preventDefault: vi.fn() }
    contents.fire('will-navigate', blocked, 'file:///etc/passwd')
    contents.fire('will-redirect', blocked, 'http://evil.test/')
    expect(blocked.preventDefault).toHaveBeenCalledTimes(2)
    const fine = { preventDefault: vi.fn() }
    contents.fire('will-navigate', fine, 'https://example.com/next')
    expect(fine.preventDefault).not.toHaveBeenCalled()
  })

  it('opens a link that wants a new window in the same page, and nothing else', async () => {
    await create('s', 't')
    const contents = windows[0]!.webContents
    expect(contents.openHandler!({ url: 'https://example.com/popup' })).toEqual({ action: 'deny' })
    expect(contents.loaded).toEqual(['about:blank', 'https://example.com/popup'])
    expect(contents.openHandler!({ url: 'file:///x' })).toEqual({ action: 'deny' })
    expect(contents.loaded).toHaveLength(2)
  })
})

describe('events and closing', () => {
  it('passes the debugger events of a page on with its session and page id', async () => {
    await create('s', 't')
    windows[0]!.webContents.fireDebugger('message', {}, 'Network.responseReceived', { requestId: '9' })
    expect(events).toEqual([{ kind: 'cdp', session: 's', target: 't', method: 'Network.responseReceived', params: { requestId: '9' } }])
  })

  it('says a page closed when its window goes away by itself, once', async () => {
    await create('s', 't')
    windows[0]!.close()
    windows[0]!.webContents.fire('destroyed')
    expect(events).toEqual([{ kind: 'closed', session: 's', target: 't' }])
    expect(host.size()).toBe(0)
  })

  it('detaches the debugger and closes the window of a page that was closed on request', async () => {
    await create('s', 't')
    await host.run({ kind: 'closeTarget', session: 's', target: 't' })
    expect(windows[0]!.webContents.calls).toContain('detach')
    expect(windows[0]!.closed).toBe(true)
    expect(host.size()).toBe(0)
    await expect(host.run({ kind: 'closeTarget', session: 's', target: 'unknown' })).resolves.toEqual({})
  })
})

describe('ending sessions', () => {
  it('closes every page of the session and clears its data, leaving other sessions alone', async () => {
    await create('s1', 'a')
    await create('s1', 'b')
    await create('s2', 'c')
    await host.run({ kind: 'destroySession', session: 's1' })
    expect(windows.map((window) => window.closed)).toEqual([true, true, false])
    expect(cleared).toEqual([partitions[0]])
    expect(host.size()).toBe(1)
  })

  it('closes everything, as when the desktop connection drops or the app quits', async () => {
    await create('s1', 'a')
    await create('s2', 'c')
    await host.destroyAll()
    expect(windows.every((window) => window.closed)).toBe(true)
    expect(cleared).toHaveLength(2)
    expect(host.size()).toBe(0)
  })

  it('does not fail when the data of the session cannot be cleared', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    host = new BackgroundBrowserHost({
      createWindow: () => new FakeWindow() as unknown as BackgroundWindow,
      clearPartition: async () => {
        throw new Error('busy')
      },
      classify: () => 'allow',
      userAgent: (value) => value,
    })
    await host.run({ kind: 'createTarget', session: 's', target: 't' })
    await expect(host.run({ kind: 'destroySession', session: 's' })).resolves.toEqual({})
    expect(error).toHaveBeenCalled()
  })

  it('ignores destroying a session that does not exist', async () => {
    await expect(host.run({ kind: 'destroySession', session: 'nope' })).resolves.toEqual({})
    expect(cleared).toEqual([])
  })
})
