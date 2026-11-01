import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { SessionStateStore } from '../session/state/store.js'
import { SessionBrowserGrants } from './grants.js'
import { BrowserHostChannel } from './hostChannel.js'
import { bindBrowserActivity, bindEmulationReset } from './runtime.js'
import { BrowserService, type BrowserGrants, type ToolResult } from './service.js'
import { allowAllGrants, FakeDesktop, FakeSnapshotter, makeInspect, makeView } from './testSupport.js'

function setup(options: { grants?: BrowserGrants } = {}) {
  const channel = new BrowserHostChannel()
  const desktop = new FakeDesktop(channel)
  const store = new SessionStateStore()
  const service = new BrowserService({
    channel,
    grants: options.grants ?? allowAllGrants(),
    getProjectRoot: () => '/project',
    createSnapshotter: () => new FakeSnapshotter(),
    settleMs: 0,
  })
  const unbind = bindBrowserActivity(service, store)
  const unbindReset = bindEmulationReset(service, store)
  desktop.setViews([makeView(), makeView({ tabId: 't2', webContentsId: 2 })])
  desktop.on('inspect', () => makeInspect())
  desktop.on('cdp', () => ({ result: {} }))
  const activity = (sessionId = 's1') => store.peek(sessionId)?.browserActivity ?? null
  return { channel, desktop, store, service, unbind, unbindReset, activity }
}

function textOf(result: ToolResult) {
  const first = result.content[0]
  return first && first.type === 'text' ? first.text : ''
}

const tick = () => Bun.sleep(5)

describe('browser activity in session state', () => {
  test('is set while a call runs and cleared when it ends', async () => {
    const { service, desktop, activity } = setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    desktop.on('cdp', async () => {
      await gate
      return { result: { data: 'x' } }
    })

    const call = service.screenshot('s1', {})
    await tick()
    expect(activity()).toEqual({ tabId: 't1' })
    release()
    await call
    expect(activity()).toBeNull()
  })

  test('stays active until the last of two overlapping calls ends', async () => {
    const { service, desktop, activity, store } = setup()
    const releases: Array<() => void> = []
    desktop.on('cdp', () => new Promise((resolve) => releases.push(() => resolve({ result: { data: 'x' } }))))
    const versions: number[] = []
    store.subscribe((change) => {
      if ('browserActivity' in change.patch) versions.push(change.state.version)
    })

    const first = service.screenshot('s1', { tabId: 't1' })
    const second = service.screenshot('s1', { tabId: 't2' })
    await tick()
    expect(releases).toHaveLength(2)
    expect(activity()).toEqual({ tabId: 't1' })

    releases[0]!()
    await first
    expect(activity()).toEqual({ tabId: 't1' })

    releases[1]!()
    await second
    expect(activity()).toBeNull()
    expect(versions).toHaveLength(2)
  })

  test('keeps the sessions apart', async () => {
    const { service, desktop, activity } = setup()
    desktop.setViews([makeView(), makeView({ sessionId: 's2', tabId: 't9', webContentsId: 9 })])
    desktop.on('cdp', () => new Promise(() => undefined))

    void service.screenshot('s2', {})
    await tick()
    expect(activity('s2')).toEqual({ tabId: 't9' })
    expect(activity('s1')).toBeNull()
  })

  test('is cleared when a call fails', async () => {
    const { service, desktop, activity } = setup()
    desktop.on('cdp', () => ({ fail: { code: 'internal', message: 'boom' } }))
    const result = await service.screenshot('s1', {})
    expect(result.isError).toBe(true)
    expect(activity()).toBeNull()
  })

  test('stops following the service once unbound', async () => {
    const { service, unbind, activity } = setup()
    unbind()
    await service.snapshot('s1', {})
    expect(activity()).toBeNull()
  })

  test('a late end does not create state for a session that was disposed', async () => {
    const { service, desktop, store } = setup()
    let release!: () => void
    desktop.on('cdp', () => new Promise((resolve) => {
      release = () => resolve({ result: { data: 'x' } })
    }))
    const call = service.screenshot('s1', {})
    await tick()
    store.dispose('s1')
    release()
    await call
    expect(store.peek('s1')).toBeUndefined()
  })
})

describe('stop from the desktop', () => {
  let warn: ReturnType<typeof spyOn>

  beforeEach(() => {
    warn = spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warn.mockRestore()
  })

  test('fails the call in flight and clears the activity', async () => {
    const { service, desktop, activity } = setup()
    desktop.on('cdp', () => new Promise(() => undefined))
    const call = service.screenshot('s1', {})
    await tick()
    expect(activity()).toEqual({ tabId: 't1' })

    desktop.sendStop('s1')
    const result = await call
    expect(result.isError).toBe(true)
    expect(activity()).toBeNull()
    expect(textOf(await service.snapshot('s1', {}))).toContain('[browser.stopped]')
  })

  test('also withdraws a pending permission request of that session', async () => {
    const store = new SessionStateStore()
    const grants = new SessionBrowserGrants({ store, trust: { has: async () => false } })
    const channel = new BrowserHostChannel()
    const desktop = new FakeDesktop(channel)
    const service = new BrowserService({
      channel,
      grants,
      getProjectRoot: () => '/project',
      createSnapshotter: () => new FakeSnapshotter(),
      settleMs: 0,
    })
    bindBrowserActivity(service, store)
    desktop.setViews([makeView()])
    desktop.on('inspect', () => makeInspect())
    desktop.on('cdp', () => ({ result: {} }))
    await service.snapshot('s1', {})

    const call = service.click('s1', { id: 1 })
    await tick()
    expect(store.peek('s1')?.pendingBrowserGrants).toHaveLength(1)
    expect(store.peek('s1')?.browserActivity).toEqual({ tabId: 't1' })

    desktop.sendStop('s1')
    const result = await call
    expect(result.isError).toBe(true)
    expect(store.peek('s1')?.pendingBrowserGrants).toEqual([])
    expect(store.peek('s1')?.browserActivity).toBeNull()
    expect(desktop.of('cdp').filter((entry) => (entry.command as { method: string }).method.startsWith('Input.'))).toEqual([])
  })

  test('does not touch another session', async () => {
    const { service, desktop, activity } = setup()
    desktop.setViews([makeView(), makeView({ sessionId: 's2', tabId: 't9', webContentsId: 9 })])
    desktop.on('cdp', () => new Promise(() => undefined))
    void service.screenshot('s2', {})
    await tick()

    desktop.sendStop('s1')
    expect(activity('s2')).toEqual({ tabId: 't9' })
    expect(service.isStopped('s2')).toBe(false)
  })
})

describe('emulation reset at the end of a turn', () => {
  const clearCalls = (desktop: FakeDesktop) =>
    desktop.of('cdp').filter((entry) => (entry.command as { method: string }).method === 'Emulation.clearDeviceMetricsOverride')

  test('clears an active emulation when the turn goes back to idle', async () => {
    const { service, desktop, store, unbindReset } = setup()
    await service.emulate('s1', { width: 375, height: 667 })
    store.apply('s1', { type: 'turn_started', at: 1 })
    expect(clearCalls(desktop)).toHaveLength(0)
    store.apply('s1', { type: 'turn_ended' })
    await tick()
    expect(clearCalls(desktop)).toHaveLength(1)
    expect(textOf(await service.snapshot('s1', {}))).not.toContain('Emulation')
    unbindReset()
  })

  test('also clears when the turn is reported idle, or the conversation is cleared', async () => {
    const { service, desktop, store, unbindReset } = setup()
    await service.emulate('s1', { colorScheme: 'dark' })
    store.apply('s1', { type: 'turn_started', at: 1 })
    store.apply('s1', { type: 'turn_state_reported', state: 'idle', at: 2 })
    await tick()
    expect(clearCalls(desktop)).toHaveLength(1)
    await service.emulate('s1', { colorScheme: 'dark' })
    store.apply('s1', { type: 'turn_started', at: 3 })
    store.apply('s1', { type: 'conversation_cleared' })
    await tick()
    expect(clearCalls(desktop)).toHaveLength(2)
    unbindReset()
  })

  test('does nothing while the turn waits for a permission or keeps running', async () => {
    const { service, desktop, store, unbindReset } = setup()
    await service.emulate('s1', { width: 375, height: 667 })
    store.apply('s1', { type: 'turn_started', at: 1 })
    store.apply('s1', { type: 'turn_state_reported', state: 'requires_action', at: 2 })
    store.apply('s1', { type: 'turn_state_reported', state: 'running', at: 3 })
    store.apply('s1', { type: 'turn_activity_reported', activity: 'thinking' })
    await tick()
    expect(clearCalls(desktop)).toHaveLength(0)
    unbindReset()
  })

  test('sends nothing when no emulation is active, and nothing for an idle session', async () => {
    const { desktop, store, unbindReset } = setup()
    store.apply('s1', { type: 'turn_started', at: 1 })
    store.apply('s1', { type: 'turn_ended' })
    store.apply('s1', { type: 'turn_ended' })
    await tick()
    expect(desktop.of('cdp')).toEqual([])
    unbindReset()
  })

  test('clears only the session whose turn ended', async () => {
    const { service, desktop, store, unbindReset } = setup()
    desktop.setViews([makeView(), makeView({ sessionId: 's2', tabId: 't9', webContentsId: 9 })])
    await service.emulate('s1', { width: 375, height: 667 })
    await service.emulate('s2', { width: 375, height: 667 })
    store.apply('s1', { type: 'turn_started', at: 1 })
    store.apply('s2', { type: 'turn_started', at: 1 })
    store.apply('s1', { type: 'turn_ended' })
    await tick()
    expect(clearCalls(desktop).map((entry) => entry.tabId)).toEqual(['t1'])
    unbindReset()
  })

  test('a failing desktop never throws into the store', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const { service, desktop, store, unbindReset } = setup()
      await service.emulate('s1', { width: 375, height: 667 })
      desktop.on('cdp', () => ({ fail: { code: 'cdp_error', message: 'gone' } }))
      store.apply('s1', { type: 'turn_started', at: 1 })
      expect(() => store.apply('s1', { type: 'turn_ended' })).not.toThrow()
      await tick()
      expect(store.peek('s1')?.turn.phase).toBe('idle')
      unbindReset()
    } finally {
      warn.mockRestore()
    }
  })

  test('stops following the store once unbound', async () => {
    const { service, desktop, store, unbindReset } = setup()
    await service.emulate('s1', { width: 375, height: 667 })
    unbindReset()
    store.apply('s1', { type: 'turn_started', at: 1 })
    store.apply('s1', { type: 'turn_ended' })
    await tick()
    expect(clearCalls(desktop)).toHaveLength(0)
  })
})
