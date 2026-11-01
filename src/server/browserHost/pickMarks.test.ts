import { describe, expect, spyOn, test } from 'bun:test'
import { BrowserHostChannel, BrowserHostError, parseBrowserHostInbound } from './hostChannel.js'
import { bindPickChannel } from './runtime.js'
import { BrowserService } from './service.js'
import { allowAllGrants, FakeDesktop, FakeSnapshotter, makeInspect, makeView } from './testSupport.js'

function setup() {
  const channel = new BrowserHostChannel()
  const desktop = new FakeDesktop(channel)
  const snapshotter = new FakeSnapshotter()
  const service = new BrowserService({
    channel,
    grants: allowAllGrants(),
    getProjectRoot: () => '/project',
    createSnapshotter: () => snapshotter,
    settleMs: 0,
  })
  desktop.setViews([makeView({ generation: 3 })])
  desktop.on('inspect', () => makeInspect({ generation: 3 }))
  desktop.on('cdp', () => ({ result: { data: 'SHOT' } }))
  return { channel, desktop, snapshotter, service }
}

const tick = () => Bun.sleep(5)
const FUTURE = Number.MAX_SAFE_INTEGER

describe('BrowserService.pick', () => {
  test('describes the node, reads the React info, and takes one clipped webp screenshot with the marks hidden', async () => {
    const { desktop, snapshotter, service } = setup()
    snapshotter.reactResult = { react: { components: ['Buy', 'Page'], props: { size: 'lg' } }, truncated: true }

    const value = await service.pick('t1', 3, 55, FUTURE)

    expect(snapshotter.pickCalls).toEqual([55])
    expect(snapshotter.reactCalls).toEqual([55])
    expect(value).toMatchObject({
      ref: '7',
      tag: 'button',
      label: 'button.buy',
      sensitive: false,
      truncated: true,
      react: { components: ['Buy', 'Page'], props: { size: 'lg' } },
      screenshot: { data: 'SHOT', mimeType: 'image/webp' },
    })
    expect('rect' in value).toBe(false)
    const shots = desktop.commands.filter(
      (entry) => entry.command.kind === 'cdp' && entry.command.method === 'Page.captureScreenshot',
    )
    expect(shots).toHaveLength(1)
    expect(shots[0]?.expectGeneration).toBe(3)
    expect(shots[0]?.command).toMatchObject({
      params: { format: 'webp', quality: 80, clip: { x: 80, y: 180, width: 120, height: 70, scale: 1 } },
    })
    expect(snapshotter.hiddenCalls).toEqual([true, false])
    expect(snapshotter.paintCalls).toBe(1)
  })

  test('limits the screenshot to the viewport and to 2048 device pixels', async () => {
    const { desktop, snapshotter, service } = setup()
    snapshotter.pickResult = {
      ...snapshotter.pickResult,
      rect: { x: -50, y: 10, width: 5000, height: 100, viewportWidth: 1200, viewportHeight: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 2 },
    }
    await service.pick('t1', 3, 1, FUTURE)
    const shot = desktop.commands.find((entry) => entry.command.kind === 'cdp' && entry.command.method === 'Page.captureScreenshot')
    const clip = (shot?.command as unknown as { params: { clip: { x: number; y: number; width: number; height: number; scale: number } } }).params.clip
    expect(clip.x).toBe(0)
    expect(clip.width).toBe(1200)
    expect(clip.scale).toBeCloseTo(2048 / (1200 * 2), 5)
  })

  test('clips in page coordinates, so a scrolled page captures the element and not what is at the same place on the first screen', async () => {
    const { desktop, snapshotter, service } = setup()
    snapshotter.pickResult = {
      ...snapshotter.pickResult,
      rect: { x: 100, y: 200, width: 80, height: 30, viewportWidth: 800, viewportHeight: 600, scrollX: 15, scrollY: 1300, devicePixelRatio: 1 },
    }
    await service.pick('t1', 3, 1, FUTURE)
    const shot = desktop.commands.find((entry) => entry.command.kind === 'cdp' && entry.command.method === 'Page.captureScreenshot')
    expect(shot?.command).toMatchObject({ params: { clip: { x: 95, y: 1480, width: 120, height: 70 } } })
  })

  test('skips the screenshot when the element is outside the viewport', async () => {
    const { desktop, snapshotter, service } = setup()
    snapshotter.pickResult = {
      ...snapshotter.pickResult,
      rect: { x: 100, y: 2000, width: 50, height: 50, viewportWidth: 800, viewportHeight: 600, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    }
    const value = await service.pick('t1', 3, 1, FUTURE)
    expect(value.screenshot).toBeUndefined()
    expect(desktop.cdpMethods()).not.toContain('Page.captureScreenshot')
  })

  test('returns only the identity of a sensitive element and never reads React info or takes a screenshot', async () => {
    const { desktop, snapshotter, service } = setup()
    snapshotter.pickResult = {
      ref: '9',
      url: 'https://example.com/login',
      title: 'Log in',
      tag: 'input',
      label: 'input.pw',
      selector: 'form > input.pw',
      sensitive: true,
      truncated: false,
    }
    const value = await service.pick('t1', 3, 4, FUTURE)
    expect(value).toEqual({
      ref: '9',
      url: 'https://example.com/login',
      title: 'Log in',
      tag: 'input',
      label: 'input.pw',
      selector: 'form > input.pw',
      sensitive: true,
      truncated: false,
    })
    expect(snapshotter.reactCalls).toEqual([])
    expect(snapshotter.hiddenCalls).toEqual([])
    expect(desktop.cdpMethods()).not.toContain('Page.captureScreenshot')
  })

  test('still returns the pick when the React info cannot be read, and logs why', async () => {
    const { snapshotter, service } = setup()
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    snapshotter.reactInfo = async () => {
      throw new Error('no main world')
    }
    const value = await service.pick('t1', 3, 1, FUTURE)
    expect(value.react).toBeUndefined()
    expect(value.screenshot).toBeDefined()
    expect(warn.mock.calls.flat().join(' ')).toContain('no main world')
    warn.mockRestore()
  })

  test('shows the marks again and still returns the pick when the screenshot fails', async () => {
    const { desktop, snapshotter, service } = setup()
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    desktop.on('cdp', () => ({ fail: { code: 'cdp_error', message: 'hung' } }))
    const value = await service.pick('t1', 3, 1, FUTURE)
    expect(value.screenshot).toBeUndefined()
    expect(snapshotter.hiddenCalls).toEqual([true, false])
    warn.mockRestore()
  })

  test('registers the picked element for this document so the agent can use its id without a snapshot first', async () => {
    const { service } = setup()
    await service.pick('t1', 3, 1, FUTURE)
    const result = await service.click('s1', { id: 7 })
    expect(result.isError).toBeUndefined()
  })

  test('relays every command with the generation the pick was made in', async () => {
    const { desktop, service } = setup()
    await service.pick('t1', 3, 1, FUTURE)
    const cdp = desktop.commands.filter((entry) => entry.command.kind === 'cdp')
    expect(cdp.length).toBeGreaterThan(0)
    expect(cdp.every((entry) => entry.expectGeneration === 3)).toBe(true)
  })

  test('refuses a tab that does not exist', async () => {
    const { service } = setup()
    await expect(service.pick('missing', 3, 1, FUTURE)).rejects.toBeInstanceOf(BrowserHostError)
  })

  test('waits for an agent operation on the same tab instead of interleaving with it', async () => {
    const { desktop, snapshotter, service } = setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    desktop.on('cdp', async (message) => {
      if (message.command.kind === 'cdp' && message.command.method === 'Page.captureScreenshot' && snapshotter.pickCalls.length === 0) {
        await gate
      }
      return { result: { data: 'x' } }
    })
    const agent = service.screenshot('s1', {})
    await tick()
    const picked = service.pick('t1', 3, 1, FUTURE)
    await tick()
    expect(snapshotter.pickCalls).toEqual([])
    release()
    await agent
    await picked
    expect(snapshotter.pickCalls).toEqual([1])
  })
})

describe('expired pick and marks requests', () => {
  test('a pick whose deadline passed in the queue is dropped without any page work', async () => {
    const { desktop, snapshotter, service } = setup()
    const error = await service.pick('t1', 3, 1, Date.now() - 1).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BrowserHostError)
    expect((error as BrowserHostError).code).toBe('expired')
    expect(snapshotter.pickCalls).toEqual([])
    expect(desktop.of('cdp')).toHaveLength(0)
  })

  test('marks whose deadline passed in the queue are dropped without any page work', async () => {
    const { desktop, snapshotter, service } = setup()
    const error = await service.marks('t1', 3, ['7'], Date.now() - 1).catch((caught: unknown) => caught)
    expect((error as BrowserHostError).code).toBe('expired')
    expect(snapshotter.marksCalls).toEqual([])
    expect(desktop.commands).toHaveLength(0)
  })

  test('a request that expires while it waits behind another operation is dropped when its turn comes', async () => {
    const { desktop, snapshotter, service } = setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    desktop.on('cdp', async () => {
      await gate
      return { result: { data: 'x' } }
    })
    const agent = service.screenshot('s1', {})
    await tick()
    const picked = service.pick('t1', 3, 1, Date.now() + 30).catch((caught: unknown) => caught)
    await Bun.sleep(50)
    release()
    await agent
    expect(((await picked) as BrowserHostError).code).toBe('expired')
    expect(snapshotter.pickCalls).toEqual([])
  })

  test('a request inside its deadline still runs', async () => {
    const { snapshotter, service } = setup()
    await service.pick('t1', 3, 1, Date.now() + 60_000)
    expect(snapshotter.pickCalls).toEqual([1])
  })

  test('the host channel answers an expired pick with the expired code', async () => {
    const { channel, desktop, snapshotter, service } = setup()
    bindPickChannel(channel, service)
    desktop.sendPick('p9', 't1', 3, 12, Date.now() - 1)
    desktop.sendMarks('m9', 't1', 3, ['7'], Date.now() - 1)
    await tick()
    expect(snapshotter.pickCalls).toEqual([])
    expect(desktop.pickResults[0]).toMatchObject({ id: 'p9', ok: false, error: { code: 'expired' } })
    expect(desktop.marksResults[0]).toMatchObject({ id: 'm9', ok: false, error: { code: 'expired' } })
  })
})

describe('BrowserService.marks', () => {
  test('draws the numeric ids and answers which refs are still alive', async () => {
    const { desktop, snapshotter, service } = setup()
    snapshotter.marksAlive = (ids) => ids.filter((id) => id !== 8)
    const alive = await service.marks('t1', 3, ['7', '8', 'x', '-1'], FUTURE)
    expect(snapshotter.marksCalls).toEqual([[7, 8]])
    expect(alive).toEqual(['7'])
    expect(desktop.of('cdp')).toHaveLength(0)
  })

  test('an empty list removes the overlay', async () => {
    const { snapshotter, service } = setup()
    expect(await service.marks('t1', 3, [], FUTURE)).toEqual([])
    expect(snapshotter.marksCalls).toEqual([[]])
  })
})

describe('pick and marks on the host channel', () => {
  test('parses well-formed requests and rejects malformed ones', () => {
    expect(parseBrowserHostInbound(JSON.stringify({ type: 'pick', id: 'p', tabId: 't', generation: 2, backendNodeId: 9, expiresAt: 1_000 }))).toEqual({
      type: 'pick',
      id: 'p',
      tabId: 't',
      generation: 2,
      backendNodeId: 9,
      expiresAt: 1_000,
    })
    expect(parseBrowserHostInbound(JSON.stringify({ type: 'marks', id: 'm', tabId: 't', generation: 0, refs: ['1', '22'], expiresAt: 2_000 }))).toEqual({
      type: 'marks',
      id: 'm',
      tabId: 't',
      generation: 0,
      refs: ['1', '22'],
      expiresAt: 2_000,
    })
    const bad = [
      { type: 'pick', id: 'p', tabId: 't', generation: -1, backendNodeId: 9, expiresAt: 1 },
      { type: 'pick', id: 'p', tabId: 't', generation: 1, backendNodeId: 1.5, expiresAt: 1 },
      { type: 'pick', id: '', tabId: 't', generation: 1, backendNodeId: 1, expiresAt: 1 },
      { type: 'pick', id: 'p', generation: 1, backendNodeId: 1, expiresAt: 1 },
      { type: 'pick', id: 'p', tabId: 't', generation: 1, backendNodeId: 1 },
      { type: 'pick', id: 'p', tabId: 't', generation: 1, backendNodeId: 1, expiresAt: '1' },
      { type: 'marks', id: 'm', tabId: 't', generation: 1, refs: [1], expiresAt: 1 },
      { type: 'marks', id: 'm', tabId: 't', generation: 1, refs: ['x'.repeat(21)], expiresAt: 1 },
      { type: 'marks', id: 'm', tabId: 't', generation: 1, refs: Array.from({ length: 201 }, () => '1'), expiresAt: 1 },
      { type: 'marks', id: 'm', tabId: 't', generation: 1, expiresAt: 1 },
      { type: 'marks', id: 'm', tabId: 't', generation: 1, refs: [] },
    ]
    for (const message of bad) expect(parseBrowserHostInbound(JSON.stringify(message))).toBeNull()
  })

  test('answers a pick with the value the handler returns', async () => {
    const { channel, desktop, snapshotter, service } = setup()
    bindPickChannel(channel, service)
    desktop.sendPick('p1', 't1', 3, 12)
    await tick()
    await tick()
    expect(snapshotter.pickCalls).toEqual([12])
    expect(desktop.pickResults).toHaveLength(1)
    expect(desktop.pickResults[0]).toMatchObject({ type: 'pick_result', id: 'p1', ok: true, value: { ref: '7', tag: 'button' } })
  })

  test('answers a failing pick with the error code and message', async () => {
    const { channel, desktop, service } = setup()
    bindPickChannel(channel, service)
    desktop.sendPick('p2', 'missing', 3, 12)
    await tick()
    expect(desktop.pickResults[0]).toMatchObject({ type: 'pick_result', id: 'p2', ok: false, error: { code: 'no_view' } })
  })

  test('answers marks with the alive refs', async () => {
    const { channel, desktop, snapshotter, service } = setup()
    bindPickChannel(channel, service)
    snapshotter.marksAlive = () => [7]
    desktop.sendMarks('m1', 't1', 3, ['7', '9'])
    await tick()
    await tick()
    expect(desktop.marksResults[0]).toEqual({ type: 'marks_result', id: 'm1', ok: true, alive: ['7'] })
  })

  test('says picking is unavailable while nothing handles it', async () => {
    const { desktop } = setup()
    desktop.sendPick('p3', 't1', 3, 1)
    desktop.sendMarks('m3', 't1', 3, [])
    await tick()
    expect(desktop.pickResults[0]).toMatchObject({ ok: false, error: { code: 'unavailable' } })
    expect(desktop.marksResults[0]).toMatchObject({ ok: false, error: { code: 'unavailable' } })
  })

  test('unbinding removes the handlers', async () => {
    const { channel, desktop, service } = setup()
    const unbind = bindPickChannel(channel, service)
    unbind()
    desktop.sendPick('p4', 't1', 3, 1)
    await tick()
    expect(desktop.pickResults[0]).toMatchObject({ ok: false, error: { code: 'unavailable' } })
  })
})

describe('user_picking errors', () => {
  test('tell the agent to wait and say that reading still works', async () => {
    const { desktop, service } = setup()
    desktop.on('inspect', () => makeInspect({ generation: 3 }))
    desktop.on('cdp', () => ({ fail: { code: 'user_picking', message: 'the user is picking an element on this page' } }))
    const result = await service.screenshot('s1', {})
    const text = result.content[0] && result.content[0].type === 'text' ? result.content[0].text : ''
    expect(result.isError).toBe(true)
    expect(text).toContain('[browser.user_picking]')
    expect(text).toContain('Wait a few seconds')
    expect(text).toContain('read-only tools such as snapshot still work')
  })
})
