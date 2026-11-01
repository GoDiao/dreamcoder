import { describe, expect, spyOn, test } from 'bun:test'
import { BrowserHostChannel, BrowserHostError } from './hostChannel.js'
import type { BrowserHostCommand } from './protocol.js'
import { BrowserService, redactHeaders, type BrowserGrants, type ToolResult } from './service.js'
import { createSnapshotter } from './snapshot/snapshotter.js'
import {
  allowAllGrants,
  fail,
  FakeDesktop,
  FakeSnapshotter,
  makeInspect,
  makeView,
  withDialogs,
} from './testSupport.js'

function setup(options: { grants?: BrowserGrants; settleMs?: number; pollMs?: number } = {}) {
  const channel = new BrowserHostChannel()
  const desktop = new FakeDesktop(channel)
  const snapshotter = new FakeSnapshotter()
  const grants = allowAllGrants()
  const service = new BrowserService({
    channel,
    grants: options.grants ?? grants,
    getProjectRoot: () => '/project',
    createSnapshotter: () => snapshotter,
    settleMs: options.settleMs ?? 0,
    pollMs: options.pollMs ?? 5,
  })
  desktop.setViews([makeView()])
  desktop.on('inspect', () => makeInspect())
  desktop.on('cdp', () => ({ result: {} }))
  return { channel, desktop, snapshotter, grants, service }
}

function textOf(result: ToolResult) {
  const first = result.content[0]
  return first && first.type === 'text' ? first.text : ''
}

function outsideFences(text: string) {
  return text.replace(/(?:Security: [^\n]*\n)?<UNTRUSTED_PAGE_CONTENT nonce="([^"]+)">[\s\S]*?<\/UNTRUSTED_PAGE_CONTENT nonce="\1">/g, '')
}

function expectFenced(result: ToolResult, ...pageTexts: string[]) {
  const text = textOf(result)
  for (const pageText of pageTexts) {
    expect(text).toContain(pageText)
    expect(outsideFences(text)).not.toContain(pageText)
  }
}

describe('snapshot', () => {
  test('wraps the page text as untrusted data and remembers the document it belongs to', async () => {
    const { service, snapshotter } = setup()
    const result = await service.snapshot('s1', {})
    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toContain('<UNTRUSTED_PAGE_CONTENT nonce="')
    expect(textOf(result)).toContain('[1] button "Go"')
    expect(textOf(result)).toContain('Tab t1')
    expect(snapshotter.snapshotCalls[0]?.delta).toBe(false)
  })

  test('passes delta, baseline and region through', async () => {
    const { service, snapshotter } = setup()
    await service.snapshot('s1', { delta: true, baseline: 'b0', region: 4 })
    expect(snapshotter.snapshotCalls[0]).toMatchObject({ delta: true, baseline: 'b0', region: 4 })
  })

  test('does not ask for a grant, reading is free', async () => {
    const { service, grants } = setup()
    await service.snapshot('s1', {})
    expect(grants.requests).toEqual([])
  })

  test('searches and continues reading only when asked to', async () => {
    const { service, snapshotter } = setup()
    await service.snapshot('s1', {})
    await service.snapshot('s1', { find: '  Breaking changes ' })
    await service.snapshot('s1', { textFrom: 8000 })
    expect(snapshotter.snapshotCalls[0]).toMatchObject({ find: null, textFrom: 0 })
    expect(snapshotter.snapshotCalls[1]).toMatchObject({ find: 'Breaking changes', textFrom: 0 })
    expect(snapshotter.snapshotCalls[2]).toMatchObject({ find: null, textFrom: 8000 })
  })

  test('refuses find together with textFrom and a blank find before reading the page', async () => {
    const { service, snapshotter } = setup()
    const both = await service.snapshot('s1', { find: 'x', textFrom: 10 })
    expect(both.isError).toBe(true)
    expect(textOf(both)).toContain('[browser.invalid_arguments]')
    expect(textOf(both)).toContain('either find or textFrom')
    const blank = await service.snapshot('s1', { find: '   ' })
    expect(blank.isError).toBe(true)
    expect(textOf(blank)).toContain('[browser.invalid_arguments]')
    expect(snapshotter.snapshotCalls).toEqual([])
  })

  test('a find snapshot still marks the page as snapshotted', async () => {
    const { service } = setup()
    await service.snapshot('s1', { find: 'Go' })
    const result = await service.click('s1', { id: 1 })
    expect(result.isError).toBeUndefined()
  })

  test('reports a missing desktop browser as an error result', async () => {
    const service = new BrowserService({
      channel: new BrowserHostChannel(),
      grants: allowAllGrants(),
      getProjectRoot: () => null,
      createSnapshotter: () => new FakeSnapshotter(),
    })
    const result = await service.snapshot('s1', {})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.no_host]')
  })

  test('uses the tab the caller names and refuses a tab of another session', async () => {
    const { service, desktop } = setup()
    desktop.setViews([makeView(), makeView({ tabId: 't2', active: false }), makeView({ sessionId: 's2', tabId: 't9' })])
    const ok = await service.snapshot('s1', { tabId: 't2' })
    expect(ok.isError).toBeUndefined()
    expect(desktop.of('inspect').at(-1)?.tabId).toBe('t2')
    const refused = await service.snapshot('s1', { tabId: 't9' })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('[browser.tab_unavailable]')
  })

  test('tells the agent to navigate first when the session has no tab', async () => {
    const { service, desktop } = setup()
    desktop.setViews([])
    const result = await service.snapshot('s1', {})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.no_tab]')
    expect(desktop.of('openTab')).toHaveLength(0)
  })

  test('opens one tab for two parallel navigations', async () => {
    const { service, desktop } = setup()
    desktop.setViews([])
    desktop.on('resolve', () => ({ ok: true, url: 'http://localhost:3000/', origin: 'http://localhost:3000', local: true }))
    desktop.on('openTab', () => {
      setTimeout(() => desktop.setViews([makeView({ tabId: 'fresh' })]), 5)
      return { tabId: 'fresh' }
    })
    await Promise.all([
      service.navigate('s1', { url: 'localhost:3000' }),
      service.navigate('s1', { url: 'localhost:3000' }),
    ])
    expect(desktop.of('openTab')).toHaveLength(1)
  })
})

describe('visibility', () => {
  test('activates the tab of a foreground session that is not shown', async () => {
    const { service, desktop } = setup()
    let shown = false
    desktop.on('inspect', () => makeInspect({ shown }))
    desktop.on('activate', () => {
      shown = true
      return { shown: true }
    })
    const result = await service.snapshot('s1', {})
    expect(result.isError).toBeUndefined()
    expect(desktop.of('activate')).toHaveLength(1)
  })

  test('refuses to operate a tab of a session in the background', async () => {
    const { service, desktop } = setup()
    desktop.on('inspect', () => makeInspect({ shown: false, foreground: false }))
    const result = await service.snapshot('s1', {})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.not_shown]')
    expect(desktop.of('activate')).toHaveLength(0)
  })

  test('reports a tab that could not be shown', async () => {
    const { service, desktop } = setup()
    desktop.on('inspect', () => makeInspect({ shown: false }))
    desktop.on('activate', () => ({ shown: false }))
    const result = await service.snapshot('s1', {})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.not_shown]')
  })
})

describe('navigate', () => {
  test('resolves the input in the desktop with the project root and then navigates', async () => {
    const { service, desktop } = setup()
    desktop.on('resolve', () => ({ ok: true, url: 'http://localhost:3000/', origin: 'http://localhost:3000', local: true }))
    desktop.on('navigate', () => ({ url: 'http://localhost:3000/', generation: 2, loading: false }))
    const result = await service.navigate('s1', { url: 'localhost:3000' })
    expect(textOf(result)).toStartWith('Navigated to the address below. The page is loaded.')
    expectFenced(result, 'http://localhost:3000/')
    expect(desktop.of('resolve')[0]?.command).toMatchObject({ input: 'localhost:3000', projectRoot: '/project' })
  })

  test('refuses what the desktop refuses', async () => {
    const { service, desktop } = setup()
    desktop.on('resolve', () => ({ ok: false, reason: 'scheme' }))
    const result = await service.navigate('s1', { url: 'ftp://x' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.refused_url]')
    expect(desktop.of('navigate')).toHaveLength(0)
  })

  test('asks for the destination origin when it is external and not local', async () => {
    const { service, desktop, grants } = setup()
    desktop.on('resolve', () => ({ ok: true, url: 'https://docs.example.org/a', origin: 'https://docs.example.org', local: false }))
    desktop.on('navigate', () => ({ url: 'https://docs.example.org/a', generation: 2, loading: false }))
    await service.navigate('s1', { url: 'https://docs.example.org/a' })
    expect(grants.requests).toHaveLength(1)
    expect(grants.requests[0]).toMatchObject({ sessionId: 's1', origin: 'https://docs.example.org' })
  })

  test('does not navigate when the grant is denied', async () => {
    const { service, desktop } = setup({
      grants: {
        async ensureOperation() {
          throw new Error('[browser.denied] The user did not allow this origin.')
        },
        cancelSession() {},
        endSession() {},
      },
    })
    desktop.on('resolve', () => ({ ok: true, url: 'https://docs.example.org/a', origin: 'https://docs.example.org', local: false }))
    const result = await service.navigate('s1', { url: 'https://docs.example.org/a' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('did not allow')
    expect(desktop.of('navigate')).toHaveLength(0)
  })

  test('opens the browser panel with the page when the session has no tab yet', async () => {
    const { service, desktop } = setup()
    desktop.setViews([])
    desktop.on('resolve', () => ({ ok: true, url: 'http://localhost:3000/', origin: 'http://localhost:3000', local: true }))
    desktop.on('openTab', () => {
      queueMicrotask(() => desktop.setViews([makeView({ tabId: 'fresh' })]))
      return { tabId: 'fresh' }
    })
    const result = await service.navigate('s1', { url: 'localhost:3000' })
    expect(textOf(result)).toContain('Opened a browser tab at http://localhost:3000/')
    expect(desktop.of('openTab')[0]?.command).toMatchObject({ kind: 'openTab', sessionId: 's1', url: 'http://localhost:3000/' })
    expect(desktop.of('navigate')).toHaveLength(0)
  })
})

describe('scroll', () => {
  test('describes the move and the new position and says to take a snapshot', async () => {
    const { service, snapshotter } = setup()
    const result = await service.scroll('s1', { direction: 'down' })
    expect(result.isError).toBeUndefined()
    expect(snapshotter.scrollCalls).toEqual([{ direction: 'down', amount: null }])
    expect(textOf(result)).toBe(
      'Scrolled down 720px in the page. Now at 48% of the page (scrolled 1440 of 3000px, content height 3800px). The visible elements changed: take a snapshot to see them. Element ids from earlier snapshots stay valid.',
    )
  })

  test('passes the amount and names a scrollable area', async () => {
    const { service, snapshotter } = setup()
    snapshotter.scrollResult = { ok: true, moved: 300, position: 300, maxPosition: 900, total: 1500, area: 'div "Comments"' }
    const result = await service.scroll('s1', { direction: 'down', amount: 300 })
    expect(snapshotter.scrollCalls).toEqual([{ direction: 'down', amount: 300 }])
    expect(textOf(result)).toContain('Scrolled down 300px in the scrollable area div "Comments".')
    expect(textOf(result)).toContain('Now at 33% of the scrollable area div "Comments"')
  })

  test('reports top and bottom as such', async () => {
    const { service, snapshotter } = setup()
    snapshotter.scrollResult = { ok: true, moved: 1560, position: 3000, maxPosition: 3000, total: 3800, area: null }
    expect(textOf(await service.scroll('s1', { direction: 'bottom' }))).toContain('Scrolled to the bottom of the page (down 1560px). Now at 100%')
    snapshotter.scrollResult = { ok: true, moved: 3000, position: 0, maxPosition: 3000, total: 3800, area: null }
    expect(textOf(await service.scroll('s1', { direction: 'top' }))).toContain('Scrolled to the top of the page (up 3000px). Now at 0%')
  })

  test('says when it did not move, without asking for a new snapshot', async () => {
    const { service, snapshotter } = setup()
    snapshotter.scrollResult = { ok: true, moved: 0, position: 3000, maxPosition: 3000, total: 3800, area: null }
    const atEnd = await service.scroll('s1', { direction: 'down' })
    expect(atEnd.isError).toBeUndefined()
    expect(textOf(atEnd)).toBe('Did not move: already at the bottom of the page (position 3000 of 3000).')
    snapshotter.scrollResult = { ok: true, moved: 0, position: 0, maxPosition: 3000, total: 3800, area: null }
    expect(textOf(await service.scroll('s1', { direction: 'up' }))).toContain('already at the top of the page')
    snapshotter.scrollResult = { ok: true, moved: 0, position: 200, maxPosition: 3000, total: 3800, area: null }
    expect(textOf(await service.scroll('s1', { direction: 'down' }))).toContain('the page did not scroll (position 200 of 3000)')
  })

  test('is a read: it never asks for a grant, even on an external origin', async () => {
    const { service, grants, desktop } = setup()
    desktop.on('inspect', () => makeInspect({ origin: 'https://docs.example.org', local: false }))
    const result = await service.scroll('s1', { direction: 'down' })
    expect(result.isError).toBeUndefined()
    expect(grants.requests).toEqual([])
  })

  test('keeps the ids of the last snapshot valid', async () => {
    const { service, snapshotter } = setup()
    await service.snapshot('s1', {})
    await service.scroll('s1', { direction: 'down' })
    const result = await service.click('s1', { id: 1 })
    expect(result.isError).toBeUndefined()
    expect(snapshotter.locateCalls).toEqual([1])
  })

  test('turns a missing scroll target into an error that says what to do', async () => {
    const { service, snapshotter } = setup()
    snapshotter.scrollResult = { ok: false, reason: 'not_scrollable', detail: 'Nothing on this page can scroll vertically.' }
    const result = await service.scroll('s1', { direction: 'down' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('[browser.not_scrollable] Nothing on this page can scroll vertically.')
  })

  test('uses the tab the caller names', async () => {
    const { service, desktop } = setup()
    desktop.setViews([makeView(), makeView({ tabId: 't2', active: false })])
    await service.scroll('s1', { direction: 'down', tabId: 't2' })
    expect(desktop.of('inspect').at(-1)?.tabId).toBe('t2')
  })

  test('waits for the call before it on the same tab', async () => {
    const { service, desktop, snapshotter } = setup()
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    desktop.on('cdp', async () => {
      order.push('screenshot')
      await gate
      return { result: { data: 'x' } }
    })
    const originalScroll = snapshotter.scroll.bind(snapshotter)
    snapshotter.scroll = async (args) => {
      order.push('scroll')
      return originalScroll(args)
    }
    const first = service.screenshot('s1', {})
    const second = service.scroll('s1', { direction: 'down' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(order).toEqual(['screenshot'])
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['screenshot', 'scroll'])
  })

  test('is refused after the user stopped browser control, and counts as activity while it runs', async () => {
    const { service, snapshotter } = setup()
    const events: string[] = []
    service.onActivity((sessionId, tabId, active) => events.push(`${sessionId}:${tabId}:${active}`))
    await service.scroll('s1', { direction: 'down' })
    expect(events).toEqual(['s1:t1:true', 's1:t1:false'])
    service.stop('s1')
    const blocked = await service.scroll('s1', { direction: 'down' })
    expect(blocked.isError).toBe(true)
    expect(textOf(blocked)).toContain('[browser.stopped]')
    expect(snapshotter.scrollCalls).toHaveLength(1)
  })

  test('a stop from the desktop fails a scroll that is in flight', async () => {
    const { service, desktop, snapshotter } = setup()
    snapshotter.scroll = () => new Promise(() => undefined)
    desktop.on('cdp', () => new Promise(() => undefined))
    const pending = service.screenshot('s1', {})
    const scrolling = service.scroll('s1', { direction: 'down' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    desktop.sendStop('s1')
    expect((await pending).isError).toBe(true)
    const result = await scrolling
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.stopped]')
  })

  test('reports dialogs that opened while it ran', async () => {
    const { service, desktop } = setup()
    desktop.on('inspect', () => withDialogs(makeInspect(), [{ kind: 'alert', message: 'Welcome', handledAs: 'accepted' }]))
    const result = await service.scroll('s1', { direction: 'down' })
    expectFenced(result, 'alert "Welcome" was accepted automatically')
  })
})

describe('click and type', () => {
  test('click needs a snapshot of the current page first', async () => {
    const { service, desktop } = setup()
    const result = await service.click('s1', { id: 1 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.stale_snapshot]')
    expect(desktop.cdpMethods()).toEqual([])
  })

  test('click locates the element and sends the mouse events for the current document', async () => {
    const { service, desktop, snapshotter } = setup()
    await service.snapshot('s1', {})
    const result = await service.click('s1', { id: 1 })
    expect(textOf(result)).toStartWith('Clicked [1].')
    expectFenced(result, 'button "Go"')
    expect(snapshotter.locateCalls).toEqual([1])
    expect(desktop.cdpMethods()).toEqual([
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
    ])
    expect(desktop.of('cdp').every((entry) => entry.expectGeneration === 1)).toBe(true)
  })

  test('ids from an earlier snapshot of the same page keep working across snapshots and actions', async () => {
    const { service, snapshotter } = setup()
    await service.snapshot('s1', {})
    await service.snapshot('s1', { delta: true, baseline: 'b1' })
    await service.scroll('s1', { direction: 'down' })
    const clicked = await service.click('s1', { id: 1 })
    const typed = await service.type('s1', { id: 1, text: 'hi' })
    const pressed = await service.pressKey('s1', { key: 'Tab', id: 1 })
    const region = await service.snapshot('s1', { region: 1 })
    expect([clicked, typed, pressed, region].map((result) => result.isError)).toEqual([undefined, undefined, undefined, undefined])
    expect(snapshotter.locateCalls).toEqual([1, 1])
    expect(snapshotter.focusCalls).toEqual([
      { id: 1, clear: true },
      { id: 1, clear: false },
    ])
    expect(snapshotter.snapshotCalls[2]).toMatchObject({ region: 1 })
  })

  test('after the page navigated the ids are rejected, for every action that takes one', async () => {
    const { service, desktop, snapshotter } = setup()
    await service.snapshot('s1', {})
    desktop.on('inspect', () => makeInspect({ generation: 2 }))
    const results = [
      await service.click('s1', { id: 1 }),
      await service.type('s1', { id: 1, text: 'x' }),
      await service.pressKey('s1', { key: 'Tab', id: 1 }),
    ]
    for (const result of results) {
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe(
        '[browser.stale_snapshot] The page navigated since your last snapshot, so earlier element ids are gone. Take a new snapshot and use the ids it returns.',
      )
    }
    expect(snapshotter.locateCalls).toEqual([])
    expect(snapshotter.focusCalls).toEqual([])
    await service.snapshot('s1', {})
    expect((await service.click('s1', { id: 1 })).isError).toBeUndefined()
  })

  test('an element that left the page is reported with the next step', async () => {
    const { service, snapshotter, desktop } = setup()
    await service.snapshot('s1', {})
    const detail = 'Element 1 is no longer on the page. Take a new snapshot.'
    snapshotter.locateResult = { ok: false, reason: 'gone', detail }
    const clicked = await service.click('s1', { id: 1 })
    expect(clicked.isError).toBe(true)
    expect(textOf(clicked)).toBe(`[browser.element_gone] ${detail}`)
    snapshotter.focusResult = { ok: false, reason: 'gone', detail }
    snapshotter.locateResult = { ok: true, x: 1, y: 2, role: 'textbox', name: 'Q' }
    const typed = await service.type('s1', { id: 1, text: 'x' })
    expect(textOf(typed)).toBe(`[browser.element_gone] ${detail}`)
    const pressed = await service.pressKey('s1', { key: 'Tab', id: 1 })
    expect(textOf(pressed)).toBe(`[browser.element_gone] ${detail}`)
    expect(desktop.cdpMethods().filter((method) => method === 'Input.insertText')).toEqual([])
  })

  test('click turns an element failure into an instruction', async () => {
    const { service, snapshotter } = setup()
    await service.snapshot('s1', {})
    snapshotter.locateResult = { ok: false, reason: 'covered', detail: 'It sits under a dialog.' }
    const result = await service.click('s1', { id: 1 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.element_covered]')
    expect(textOf(result)).toContain('Take a new snapshot')
  })

  test('click reports a navigation it caused', async () => {
    const { service, desktop } = setup()
    await service.snapshot('s1', {})
    let calls = 0
    desktop.on('inspect', () => {
      calls += 1
      const local = { origin: 'http://localhost:3000', local: true }
      return calls > 1 ? makeInspect({ ...local, generation: 2, url: 'https://example.com/next' }) : makeInspect(local)
    })
    const result = await service.click('s1', { id: 1 })
    expect(textOf(result)).toContain('Page navigated.')
    expectFenced(result, 'https://example.com/next')
  })

  test('a snapshot of an earlier document does not authorize a click on the new one', async () => {
    const { service, desktop } = setup()
    await service.snapshot('s1', {})
    desktop.on('inspect', () => makeInspect({ generation: 2 }))
    const result = await service.click('s1', { id: 1 })
    expect(textOf(result)).toContain('[browser.stale_snapshot]')
  })

  test('type focuses with clear by default and inserts the text', async () => {
    const { service, desktop, snapshotter } = setup()
    await service.snapshot('s1', {})
    const result = await service.type('s1', { id: 1, text: 'hello' })
    expect(textOf(result)).toStartWith('Typed 5 characters into [1].')
    expectFenced(result, 'button "Go"')
    expect(snapshotter.focusCalls).toEqual([{ id: 1, clear: true }])
    expect(desktop.cdpMethods()).toContain('Input.insertText')
    expect(desktop.of('cdp').at(-1)?.command).toMatchObject({ method: 'Input.insertText', params: { text: 'hello' } })
  })

  test('type with submit presses Enter', async () => {
    const { service, desktop } = setup()
    await service.snapshot('s1', {})
    await service.type('s1', { id: 1, text: 'x', submit: true, clear: false })
    const keys = desktop.of('cdp').filter((entry) => (entry.command as { method: string }).method === 'Input.dispatchKeyEvent')
    expect(keys).toHaveLength(2)
    expect((keys[0]?.command as Extract<BrowserHostCommand, { kind: 'cdp' }>).params?.key).toBe('Enter')
  })

  test('type refuses an element that is not a text field', async () => {
    const { service, snapshotter } = setup()
    await service.snapshot('s1', {})
    snapshotter.focusResult = { ok: false, reason: 'not_editable', detail: 'It is a button.' }
    const result = await service.type('s1', { id: 1, text: 'x' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.element_not_editable]')
  })

  test('press_key rejects an unknown key without touching the page', async () => {
    const { service, desktop } = setup()
    const result = await service.pressKey('s1', { key: 'Banana' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.invalid_key]')
    expect(desktop.cdpMethods()).toEqual([])
  })

  test('press_key sends a key down and a key up', async () => {
    const { service, desktop } = setup()
    const result = await service.pressKey('s1', { key: 'Escape' })
    expect(textOf(result)).toContain('Pressed Escape')
    expect(desktop.cdpMethods()).toEqual(['Input.dispatchKeyEvent', 'Input.dispatchKeyEvent'])
  })
})

describe('authorization', () => {
  test('external origins need a grant for operations, with the origin from the desktop', async () => {
    const { service, grants } = setup()
    await service.snapshot('s1', {})
    await service.click('s1', { id: 1 })
    expect(grants.requests).toHaveLength(1)
    expect(grants.requests[0]).toMatchObject({ sessionId: 's1', origin: 'https://example.com' })
    expect(grants.requests[0]?.action).toContain('Click')
  })

  test('local origins and pages without an origin never ask', async () => {
    const { service, desktop, grants } = setup()
    await service.snapshot('s1', {})
    desktop.on('inspect', () => makeInspect({ origin: 'http://localhost:3000', local: true }))
    await service.click('s1', { id: 1 })
    desktop.on('inspect', () => makeInspect({ origin: null, url: 'about:blank' }))
    await service.pressKey('s1', { key: 'Tab' })
    expect(grants.requests).toEqual([])
  })

  test('a denied grant stops the action before anything reaches the page', async () => {
    const { service, desktop } = setup({
      grants: {
        async ensureOperation() {
          throw new Error('[browser.denied] The user did not allow https://example.com.')
        },
        cancelSession() {},
        endSession() {},
      },
    })
    await service.snapshot('s1', {})
    const result = await service.click('s1', { id: 1 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('did not allow')
    expect(desktop.cdpMethods()).toEqual([])
  })

  test('the action is not run when the page changed while the grant was pending', async () => {
    let changed = false
    const { service, desktop } = setup({
      grants: {
        async ensureOperation() {
          changed = true
        },
        cancelSession() {},
        endSession() {},
      },
    })
    desktop.on('inspect', () => (changed ? makeInspect({ generation: 2 }) : makeInspect()))
    const result = await service.pressKey('s1', { key: 'Tab' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.target_changed]')
    expect(desktop.cdpMethods()).toEqual([])
  })
})

describe('authorization of frames on a local page', () => {
  const local = { origin: 'http://localhost:3000', url: 'http://localhost:3000/', local: true }

  test('asks once-only for each external frame origin, in order, with the same action', async () => {
    const { service, desktop, grants } = setup()
    desktop.on('inspect', () => makeInspect({ ...local, frames: ['https://ads.example', 'https://pay.example'] }))
    await service.snapshot('s1', {})
    const result = await service.click('s1', { id: 1 })
    expect(result.isError).toBeUndefined()
    expect(grants.requests).toEqual([
      { sessionId: 's1', origin: 'https://ads.example', action: 'Click element [1]', onceOnly: true },
      { sessionId: 's1', origin: 'https://pay.example', action: 'Click element [1]', onceOnly: true },
    ])
  })

  test('does not ask for reads, even with frames', async () => {
    const { service, desktop, grants } = setup()
    desktop.on('inspect', () => makeInspect({ ...local, frames: ['https://ads.example'] }))
    await service.snapshot('s1', {})
    await service.scroll('s1', { direction: 'down' })
    expect(grants.requests).toEqual([])
  })

  test('does not ask on a local page without frames', async () => {
    const { service, desktop, grants } = setup()
    desktop.on('inspect', () => makeInspect({ ...local, frames: [] }))
    await service.snapshot('s1', {})
    await service.click('s1', { id: 1 })
    expect(grants.requests).toEqual([])
  })

  test('an external page still asks for its own origin only, as a normal request', async () => {
    const { service, desktop, grants } = setup()
    desktop.on('inspect', () => makeInspect({ frames: ['https://ads.example'] }))
    await service.snapshot('s1', {})
    await service.click('s1', { id: 1 })
    expect(grants.requests).toEqual([{ sessionId: 's1', origin: 'https://example.com', action: 'Click element [1]' }])
  })

  test('the action is not run when the frames changed while a grant was pending', async () => {
    let answered = false
    const { service, desktop } = setup({
      grants: {
        async ensureOperation() {
          answered = true
        },
        cancelSession() {},
        endSession() {},
      },
    })
    desktop.on('inspect', () => makeInspect({ ...local, frames: answered ? ['https://ads.example', 'https://evil.example'] : ['https://ads.example'] }))
    const result = await service.pressKey('s1', { key: 'Tab' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.target_changed]')
    expect(desktop.cdpMethods()).toEqual([])
  })

  test('an external page whose frames change during the grant wait still runs the action', async () => {
    let answered = false
    const { service, desktop } = setup({
      grants: {
        async ensureOperation() {
          answered = true
        },
        cancelSession() {},
        endSession() {},
      },
    })
    desktop.on('inspect', () => makeInspect({ frames: answered ? ['https://ads.example'] : [] }))
    const result = await service.pressKey('s1', { key: 'Tab' })
    expect(result.isError).toBeUndefined()
    expect(desktop.cdpMethods()).toContain('Input.dispatchKeyEvent')
  })

  test('a denied frame grant stops the action before anything reaches the page', async () => {
    const { service, desktop } = setup({
      grants: {
        async ensureOperation() {
          throw new Error('[browser.not_granted] The user did not allow https://ads.example.')
        },
        cancelSession() {},
        endSession() {},
      },
    })
    desktop.on('inspect', () => makeInspect({ ...local, frames: ['https://ads.example'] }))
    const result = await service.pressKey('s1', { key: 'Tab' })
    expect(result.isError).toBe(true)
    expect(desktop.cdpMethods()).toEqual([])
  })
})

describe('errors and dialogs', () => {
  test('a stale document error from the desktop carries the next step', async () => {
    const { service, desktop } = setup()
    await service.snapshot('s1', {})
    desktop.on('cdp', () => fail('stale_document', 'The page changed.'))
    const result = await service.click('s1', { id: 1 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.stale_document]')
    expect(textOf(result)).toContain('Take a new snapshot')
  })

  test('an attach failure explains the likely cause', async () => {
    const { service, desktop } = setup()
    desktop.on('cdp', () => fail('attach_failed', 'Another debugger is already attached.'))
    const result = await service.screenshot('s1', {})
    expect(textOf(result)).toContain('[browser.attach_failed]')
    expect(textOf(result)).toContain('developer tools')
  })

  test('dialogs handled during a call are reported in its result', async () => {
    const { service, desktop } = setup()
    desktop.on('cdp', () =>
      withDialogs({ result: { data: 'QUJD' } }, [{ kind: 'alert', message: 'Saved!', handledAs: 'accepted' }]),
    )
    const result = await service.screenshot('s1', {})
    expect(textOf(result)).toContain('alert "Saved!" was accepted automatically')
  })

  test('page URLs in results are clipped and fenced', async () => {
    const { service, desktop } = setup()
    const long = `http://localhost:3000/${'a'.repeat(1_000)}`
    desktop.on('resolve', () => ({ ok: true, url: 'http://localhost:3000/', origin: 'http://localhost:3000', local: true }))
    desktop.on('navigate', () => ({ url: long, generation: 2, loading: false }))
    const result = await service.navigate('s1', { url: 'localhost:3000' })
    expectFenced(result, `${long.slice(0, 300)}…`)
    expect(textOf(result)).not.toContain(long)
  })

  test('dialogs that came with a failure are reported too', async () => {
    const { service, desktop } = setup()
    desktop.on('cdp', () => fail('cdp_error', 'No target.', [{ kind: 'confirm', message: 'Leave?', handledAs: 'dismissed' }]))
    const result = await service.screenshot('s1', {})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('confirm "Leave?" was dismissed automatically')
  })

  test('a connection that drops mid-call fails the call without repeating it', async () => {
    const { service, desktop } = setup()
    desktop.on('cdp', () => new Promise(() => undefined))
    const pending = service.screenshot('s1', {})
    await new Promise((resolve) => setTimeout(resolve, 5))
    desktop.disconnect()
    const result = await pending
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.disconnected]')
    expect(desktop.of('cdp')).toHaveLength(1)
  })
})

describe('screenshot', () => {
  test('returns the image and says the content is untrusted', async () => {
    const { service, desktop } = setup()
    desktop.on('cdp', () => ({ result: { data: 'QUJD' } }))
    const result = await service.screenshot('s1', {})
    expect(result.content[1]).toEqual({ type: 'image', data: 'QUJD', mimeType: 'image/jpeg' })
    expect(textOf(result)).toContain('untrusted')
    expectFenced(result, 'https://example.com/')
  })

  test('fails clearly when the browser returns no image', async () => {
    const { service } = setup()
    const result = await service.screenshot('s1', {})
    expect(result.isError).toBe(true)
  })
})

describe('console and network', () => {
  test('console returns entries wrapped as untrusted and continues from where it stopped', async () => {
    const { service, desktop } = setup()
    const sinces: number[] = []
    desktop.on('events', (message) => {
      const command = message.command as { since: number }
      sinces.push(command.since)
      return {
        entries: [{ seq: 4, at: 1, level: 'error', text: 'boom', url: 'https://example.com/a.js', line: 3 }],
        dropped: 0,
        next: 4,
        since: command.since,
      }
    })
    const first = await service.console('s1', {})
    expect(textOf(first)).toContain('#4 [error] boom (https://example.com/a.js:3)')
    expect(textOf(first)).toContain('<UNTRUSTED_PAGE_CONTENT')
    expect(textOf(first)).toContain('started with the first browser call')
    await service.console('s1', {})
    expect(sinces).toEqual([0, 4])
  })

  test('console filters by level', async () => {
    const { service, desktop } = setup()
    desktop.on('events', () => ({
      entries: [
        { seq: 1, at: 1, level: 'log', text: 'fine' },
        { seq: 2, at: 1, level: 'error', text: 'bad' },
      ],
      dropped: 0,
      next: 2,
      since: 0,
    }))
    const result = await service.console('s1', { level: 'error' })
    expect(textOf(result)).toContain('bad')
    expect(textOf(result)).not.toContain('fine')
  })

  test('network redacts sensitive headers and filters by url', async () => {
    const { service, desktop } = setup()
    desktop.on('events', () => ({
      entries: [
        {
          seq: 1,
          at: 1,
          requestId: 'r1',
          method: 'GET',
          url: 'https://example.com/api/me',
          status: 200,
          mimeType: 'application/json',
          requestHeaders: { Authorization: 'Bearer abc', Accept: 'application/json', 'X-Api-Key': 'k' },
          responseHeaders: { 'Set-Cookie': 'sid=1', 'Content-Type': 'application/json' },
        },
        { seq: 2, at: 1, requestId: 'r2', method: 'GET', url: 'https://example.com/other', status: 404 },
      ],
      dropped: 3,
      next: 2,
      since: 0,
    }))
    const result = await service.network('s1', { urlContains: '/api/', includeHeaders: true })
    const body = textOf(result)
    expect(body).toContain('GET 200 application/json https://example.com/api/me')
    expect(body).not.toContain('/other')
    expect(body).not.toContain('Bearer abc')
    expect(body).not.toContain('sid=1')
    expect(body).toContain('[redacted]')
    expect(body).toContain('3 older entries were dropped')
  })

  test('redactHeaders keeps harmless headers and hides token-like names', () => {
    expect(redactHeaders({ 'X-Auth-Token': 'a', Accept: 'b', Cookie: 'c' })).toEqual({
      'X-Auth-Token': '[redacted]',
      Accept: 'b',
      Cookie: '[redacted]',
    })
    expect(redactHeaders(undefined)).toBeUndefined()
  })
})

describe('serialization and stop', () => {
  test('calls on one tab run one at a time in arrival order', async () => {
    const { service, desktop } = setup()
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    desktop.on('cdp', async (message) => {
      const method = (message.command as { method: string }).method
      order.push(`cdp:${method}`)
      if (order.length === 1) await gate
      return { result: { data: 'x' } }
    })
    const first = service.screenshot('s1', {})
    const second = service.screenshot('s1', {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(order).toHaveLength(1)
    release()
    await Promise.all([first, second])
    expect(order).toHaveLength(2)
  })

  test('a stop from the desktop fails the call in flight and blocks further calls until resume', async () => {
    const { service, desktop } = setup()
    desktop.on('cdp', () => new Promise(() => undefined))
    const pending = service.screenshot('s1', {})
    await new Promise((resolve) => setTimeout(resolve, 5))
    desktop.sendStop('s1')
    const stopped = await pending
    expect(stopped.isError).toBe(true)
    expect(desktop.cancelled.length).toBeGreaterThan(0)
    const blocked = await service.snapshot('s1', {})
    expect(textOf(blocked)).toContain('[browser.stopped]')
    service.resume('s1')
    desktop.on('cdp', () => ({ result: { data: 'x' } }))
    const again = await service.snapshot('s1', {})
    expect(again.isError).toBeUndefined()
  })

  test('reports activity while a call runs', async () => {
    const { service } = setup()
    const events: string[] = []
    service.onActivity((sessionId, tabId, active) => events.push(`${sessionId}:${tabId}:${active}`))
    await service.snapshot('s1', {})
    expect(events).toEqual(['s1:t1:true', 's1:t1:false'])
  })

  test('a stop cancels the pending permission requests of that session only', () => {
    const { service, grants } = setup()
    service.stop('s1')
    expect(grants.cancelled).toEqual(['s1'])
    expect(grants.ended).toEqual([])
  })

  test('releasing a session ends its permission state', async () => {
    const { service, grants } = setup()
    await service.releaseSession('s1')
    expect(grants.ended).toEqual(['s1'])
  })

  test('releasing a session detaches its tabs', async () => {
    const { service, desktop } = setup()
    desktop.on('release', () => ({}))
    await service.releaseSession('s1')
    expect(desktop.of('release')).toHaveLength(1)
  })
})

function sleepFor(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function inspectsThat(desktop: FakeDesktop, change: Partial<ReturnType<typeof makeInspect>>, changeFromCall = 2) {
  let calls = 0
  desktop.on('inspect', () => {
    calls += 1
    return calls >= changeFromCall ? makeInspect(change) : makeInspect()
  })
}

describe('wait_for', () => {
  test('returns as soon as the text appears, without a grant and without assigning ids', async () => {
    const { service, snapshotter, grants } = setup()
    snapshotter.hasTextAnswer = (call) => call >= 3
    const result = await service.waitFor('s1', { text: ' Saved ' })
    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toMatch(/^Text appeared after \d+ms\.$/)
    expect(snapshotter.hasTextCalls).toEqual(['Saved', 'Saved', 'Saved'])
    expect(snapshotter.snapshotCalls).toEqual([])
    expect(grants.requests).toEqual([])
  })

  test('returns when the text is gone', async () => {
    const { service, snapshotter } = setup()
    snapshotter.hasTextAnswer = (call) => call < 2
    const result = await service.waitFor('s1', { textGone: 'Loading' })
    expect(textOf(result)).toMatch(/^Text disappeared after \d+ms\.$/)
    expect(snapshotter.hasTextCalls).toEqual(['Loading', 'Loading'])
  })

  test('checks once and returns at once when the condition already holds', async () => {
    const { service, snapshotter } = setup()
    const started = Date.now()
    const result = await service.waitFor('s1', { text: 'Hello', timeoutMs: 30_000 })
    expect(textOf(result)).toContain('Text appeared after')
    expect(snapshotter.hasTextCalls).toHaveLength(1)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  test('times out with the text and the limit in the message', async () => {
    const { service, snapshotter } = setup()
    snapshotter.hasTextAnswer = () => false
    const started = Date.now()
    const appear = await service.waitFor('s1', { text: 'Saved', timeoutMs: 100 })
    expect(Date.now() - started).toBeGreaterThanOrEqual(95)
    expect(appear.isError).toBe(true)
    expect(textOf(appear)).toBe('[browser.timeout] "Saved" did not appear within 100ms. Take a snapshot to see the page.')
    snapshotter.hasTextAnswer = () => true
    const vanish = await service.waitFor('s1', { textGone: 'Spinner', timeoutMs: 100 })
    expect(vanish.isError).toBe(true)
    expect(textOf(vanish)).toBe('[browser.timeout] "Spinner" did not disappear within 100ms. Take a snapshot to see the page.')
  })

  test('keeps the tab queue only for as long as it waits', async () => {
    const { service, desktop, snapshotter } = setup()
    snapshotter.hasTextAnswer = () => false
    desktop.on('cdp', () => ({ result: { data: 'QUJD' } }))
    const order: string[] = []
    const waiting = service.waitFor('s1', { text: 'never', timeoutMs: 100 }).then(() => order.push('wait'))
    const shot = service.screenshot('s1', {}).then(() => order.push('screenshot'))
    await Promise.all([waiting, shot])
    expect(order).toEqual(['wait', 'screenshot'])
  })

  test('refuses a call that does not name exactly one text before touching the page', async () => {
    const { service, desktop, snapshotter } = setup()
    const calls = [
      await service.waitFor('s1', {}),
      await service.waitFor('s1', { text: 'a', textGone: 'b' }),
      await service.waitFor('s1', { text: '   ' }),
    ]
    for (const result of calls) {
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain('[browser.invalid_arguments]')
    }
    expect(desktop.of('inspect')).toHaveLength(0)
    expect(snapshotter.hasTextCalls).toEqual([])
  })

  test('ends when the call is aborted and frees the tab', async () => {
    const { service, snapshotter } = setup()
    snapshotter.hasTextAnswer = () => false
    const controller = new AbortController()
    const waiting = service.waitFor('s1', { text: 'never', timeoutMs: 30_000 }, controller.signal)
    await sleepFor(30)
    const started = Date.now()
    controller.abort()
    const result = await waiting
    expect(Date.now() - started).toBeLessThan(500)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.cancelled]')
    snapshotter.hasTextAnswer = () => true
    expect((await service.waitFor('s1', { text: 'x' })).isError).toBeUndefined()
  })

  test('a user stop ends the wait at once and blocks further calls', async () => {
    const { service, desktop, snapshotter } = setup()
    snapshotter.hasTextAnswer = () => false
    const waiting = service.waitFor('s1', { text: 'never', timeoutMs: 30_000 })
    await sleepFor(30)
    const started = Date.now()
    desktop.sendStop('s1')
    const result = await waiting
    expect(Date.now() - started).toBeLessThan(500)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.stopped]')
    const polls = snapshotter.hasTextCalls.length
    await sleepFor(30)
    expect(snapshotter.hasTextCalls).toHaveLength(polls)
    expect(textOf(await service.waitFor('s1', { text: 'x' }))).toContain('[browser.stopped]')
  })

  test('a stop that lands while a poll is in flight is reported as a stop', async () => {
    const channel = new BrowserHostChannel()
    const desktop = new FakeDesktop(channel)
    const service = new BrowserService({
      channel,
      grants: allowAllGrants(),
      getProjectRoot: () => null,
      createSnapshotter,
      settleMs: 0,
      pollMs: 5,
    })
    desktop.setViews([makeView()])
    desktop.on('inspect', () => makeInspect())
    desktop.on('cdp', (message) => {
      const method = (message.command as { method: string }).method
      if (method === 'Page.getFrameTree') return { result: { frameTree: { frame: { id: 'f1' } } } }
      if (method === 'Page.createIsolatedWorld') return { result: { executionContextId: 5 } }
      return new Promise(() => undefined)
    })
    const waiting = service.waitFor('s1', { text: 'never', timeoutMs: 30_000 })
    await sleepFor(30)
    expect(desktop.cdpMethods()).toContain('Runtime.evaluate')
    desktop.sendStop('s1')
    expect(textOf(await waiting)).toContain('[browser.stopped]')
  })

  test('polls the page through the isolated world with the text op and no snapshot', async () => {
    const channel = new BrowserHostChannel()
    const desktop = new FakeDesktop(channel)
    const service = new BrowserService({
      channel,
      grants: allowAllGrants(),
      getProjectRoot: () => null,
      createSnapshotter,
      settleMs: 0,
      pollMs: 5,
    })
    desktop.setViews([makeView()])
    desktop.on('inspect', () => makeInspect())
    let evaluations = 0
    desktop.on('cdp', (message) => {
      const command = message.command as { method: string; params?: Record<string, unknown> }
      if (command.method === 'Page.getFrameTree') return { result: { frameTree: { frame: { id: 'f1' } } } }
      if (command.method === 'Page.createIsolatedWorld') return { result: { executionContextId: 5 } }
      evaluations += 1
      return { result: { result: { type: 'object', value: { present: evaluations >= 3 } } } }
    })
    const result = await service.waitFor('s1', { text: 'Saved' })
    expect(textOf(result)).toMatch(/^Text appeared after \d+ms\.$/)
    const evaluates = desktop.of('cdp').filter((entry) => (entry.command as { method: string }).method === 'Runtime.evaluate')
    expect(evaluates).toHaveLength(3)
    for (const entry of evaluates) {
      const params = (entry.command as unknown as { params: { expression: string; contextId: number } }).params
      expect(params.contextId).toBe(5)
      expect(params.expression.endsWith('("hasText", {"text":"Saved"})')).toBe(true)
    }
  })

  test('keeps waiting on the new page when the document changes and says so', async () => {
    const { service, desktop, snapshotter } = setup()
    inspectsThat(desktop, { generation: 2, url: 'https://example.com/next' })
    snapshotter.hasTextAnswer = (call) => {
      if (call === 1) throw new BrowserHostError('stale_document', 'The page changed.')
      return true
    }
    const result = await service.waitFor('s1', { text: 'Welcome' })
    expect(result.isError).toBeUndefined()
    expect(outsideFences(textOf(result))).toMatch(
      /^Text appeared after \d+ms\. Page navigated\. Element ids from before are gone; take a new snapshot\.\nAddress \(comes from the page\):\n$/,
    )
    expectFenced(result, 'https://example.com/next')
    expect(snapshotter.hasTextCalls).toHaveLength(2)
  })

  test('a page that navigated away from a snapshot invalidates its ids after the wait', async () => {
    const { service, desktop, snapshotter } = setup()
    await service.snapshot('s1', {})
    inspectsThat(desktop, { generation: 2, url: 'https://example.com/next' })
    snapshotter.hasTextAnswer = () => true
    const waited = await service.waitFor('s1', { text: 'Welcome' })
    expect(textOf(waited)).toContain('Page navigated.')
    expectFenced(waited, 'https://example.com/next')
    const clicked = await service.click('s1', { id: 1 })
    expect(textOf(clicked)).toContain('[browser.stale_snapshot]')
  })

  test('says the page navigated also when it timed out', async () => {
    const { service, desktop, snapshotter } = setup()
    inspectsThat(desktop, { url: 'https://example.com/other', generation: 7 })
    snapshotter.hasTextAnswer = () => false
    const result = await service.waitFor('s1', { text: 'x', timeoutMs: 100 })
    expect(textOf(result)).toContain('did not appear within 100ms. Take a snapshot to see the page. Page navigated.')
    expectFenced(result, 'https://example.com/other')
  })

  test('counts as activity while it waits', async () => {
    const { service, snapshotter } = setup()
    snapshotter.hasTextAnswer = (call) => call >= 3
    const events: string[] = []
    service.onActivity((sessionId, tabId, active) => events.push(`${sessionId}:${tabId}:${active}`))
    await service.waitFor('s1', { text: 'x' })
    expect(events).toEqual(['s1:t1:true', 's1:t1:false'])
  })
})

describe('styles', () => {
  test('returns the header and the computed values as untrusted page data, without a grant', async () => {
    const { service, snapshotter, grants } = setup()
    await service.snapshot('s1', {})
    const result = await service.styles('s1', { id: 1 })
    expect(result.isError).toBeUndefined()
    expect(snapshotter.stylesCalls).toEqual([{ id: 1, properties: null }])
    const body = textOf(result)
    expect(body).toContain('Tab t1')
    expect(body).toContain('<UNTRUSTED_PAGE_CONTENT nonce="')
    expect(body).toContain(
      '[1] <button> role=button name="Go" box: x=10 y=20 width=80 height=32 (CSS px, relative to the viewport)\ndisplay: inline-block\ncolor: rgb(0, 0, 0)',
    )
    expect(grants.requests).toEqual([])
  })

  test('passes the requested properties and reports the unknown ones', async () => {
    const { service, snapshotter } = setup()
    await service.snapshot('s1', {})
    snapshotter.stylesResult = {
      ok: true,
      tag: 'div',
      role: 'generic',
      name: '',
      box: { x: 0, y: 0, width: 5, height: 6 },
      values: [{ name: 'margin-top', value: '8px' }],
      unknown: ['marginz', 'colour'],
    }
    const result = await service.styles('s1', { id: 1, properties: ['margin-top', 'marginz', 'colour'] })
    expect(snapshotter.stylesCalls[0]?.properties).toEqual(['margin-top', 'marginz', 'colour'])
    expect(textOf(result)).toContain('margin-top: 8px')
    expect(textOf(result)).toContain('Unknown properties, not reported: marginz, colour')
  })

  test('needs a snapshot of the current page first', async () => {
    const { service, snapshotter } = setup()
    const result = await service.styles('s1', { id: 1 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.stale_snapshot]')
    expect(snapshotter.stylesCalls).toEqual([])
  })

  test('reports an element that is gone or unknown the way click does', async () => {
    const { service, snapshotter } = setup()
    await service.snapshot('s1', {})
    const gone = 'Element 1 is no longer on the page. Take a new snapshot.'
    snapshotter.stylesResult = { ok: false, reason: 'gone', detail: gone }
    expect(textOf(await service.styles('s1', { id: 1 }))).toBe(`[browser.element_gone] ${gone}`)
    snapshotter.locateResult = { ok: false, reason: 'unknown_id', detail: 'No element has this id.' }
    snapshotter.stylesResult = { ok: false, reason: 'unknown_id', detail: 'No element has this id.' }
    const unknown = await service.styles('s1', { id: 1 })
    const clicked = await service.click('s1', { id: 1 })
    expect(textOf(unknown)).toBe(textOf(clicked))
    expect(textOf(unknown)).toBe(
      '[browser.element_unknown_id] Element [1] cannot be used: No element has this id. Take a new snapshot and choose an element from it.',
    )
  })
})

describe('evaluate', () => {
  type CdpParams = Record<string, unknown> | undefined

  function scriptCdp(desktop: FakeDesktop, answers: Record<string, (params: CdpParams) => unknown>) {
    desktop.on('cdp', (message) => {
      const command = message.command as { method: string; params?: CdpParams }
      const answer = answers[command.method]
      if (!answer) return { result: {} }
      const out = answer(command.params)
      if (typeof out === 'object' && out !== null && 'fail' in out) return out
      if (typeof out === 'object' && out !== null && 'withDialogs' in out) {
        return { ...out, value: { result: (out as unknown as { value: unknown }).value } }
      }
      return { result: out }
    })
  }

  function cdpCalls(desktop: FakeDesktop) {
    return desktop.of('cdp').map((entry) => {
      const { method, params } = entry.command as { method: string; params?: CdpParams }
      return { method, params }
    })
  }

  test('asks for a grant on an external origin, naming the expression, and never on a local page', async () => {
    const { service, desktop, grants } = setup()
    scriptCdp(desktop, { 'Runtime.evaluate': () => ({ result: { type: 'string', value: 'x' } }) })
    await service.evaluate('s1', { expression: 'document.title' })
    expect(grants.requests).toHaveLength(1)
    expect(grants.requests[0]).toMatchObject({ sessionId: 's1', origin: 'https://example.com' })
    expect(grants.requests[0]?.action).toBe('Run JavaScript: document.title')
    desktop.on('inspect', () => makeInspect({ origin: 'http://localhost:3000', local: true }))
    await service.evaluate('s1', { expression: 'document.title' })
    expect(grants.requests).toHaveLength(1)
  })

  test('is not run when the grant is denied', async () => {
    const { service, desktop } = setup({
      grants: {
        async ensureOperation() {
          throw new Error('[browser.denied] The user did not allow https://example.com.')
        },
        cancelSession() {},
        endSession() {},
      },
    })
    const result = await service.evaluate('s1', { expression: 'document.cookie' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('did not allow')
    expect(desktop.cdpMethods()).toEqual([])
  })

  test('without an id it evaluates in the main world of the page and returns JSON as untrusted data', async () => {
    const { service, desktop, snapshotter } = setup()
    scriptCdp(desktop, { 'Runtime.evaluate': () => ({ result: { type: 'string', value: 'Hello' } }) })
    const result = await service.evaluate('s1', { expression: 'document.title' })
    expect(result.isError).toBeUndefined()
    const body = textOf(result)
    expect(body).toContain('<UNTRUSTED_PAGE_CONTENT nonce="')
    expect(body).toContain('"Hello"')
    const [call] = cdpCalls(desktop)
    expect(call?.method).toBe('Runtime.evaluate')
    expect(call?.params).toEqual({ expression: 'document.title', awaitPromise: true, userGesture: false, timeout: 5000 })
    expect(call?.params).not.toHaveProperty('contextId')
    expect(snapshotter.elementObjectCalls).toEqual([])
    expect(cdpCalls(desktop).map((entry) => entry.method)).toEqual(['Runtime.evaluate'])
  })

  test('with an id it resolves the isolated-world element to the main world and calls the function on it', async () => {
    const { service, desktop, snapshotter } = setup()
    await service.snapshot('s1', {})
    scriptCdp(desktop, {
      'DOM.describeNode': () => ({ node: { backendNodeId: 77 } }),
      'DOM.resolveNode': () => ({ object: { objectId: 'main-9' } }),
      'Runtime.callFunctionOn': () => ({ result: { type: 'number', value: 42 } }),
    })
    const result = await service.evaluate('s1', { expression: '(element) => element.offsetWidth', id: 1 })
    expect(textOf(result)).toContain('\n42\n')
    expect(snapshotter.elementObjectCalls).toEqual([1])
    expect(cdpCalls(desktop)).toEqual([
      { method: 'DOM.describeNode', params: { objectId: 'isolated-1' } },
      { method: 'DOM.resolveNode', params: { backendNodeId: 77 } },
      {
        method: 'Runtime.callFunctionOn',
        params: {
          objectId: 'main-9',
          functionDeclaration: '(element) => element.offsetWidth',
          arguments: [{ objectId: 'main-9' }],
          awaitPromise: true,
          userGesture: false,
        },
      },
      { method: 'Runtime.releaseObject', params: { objectId: 'isolated-1' } },
      { method: 'Runtime.releaseObject', params: { objectId: 'main-9' } },
    ])
  })

  test('with an id it needs a current snapshot and reports an element that is gone', async () => {
    const { service, desktop, snapshotter } = setup()
    const early = await service.evaluate('s1', { expression: '(e) => 1', id: 1 })
    expect(textOf(early)).toContain('[browser.stale_snapshot]')
    await service.snapshot('s1', {})
    const detail = 'Element 1 is no longer on the page. Take a new snapshot.'
    snapshotter.elementObjectResult = { ok: false, reason: 'gone', detail }
    const gone = await service.evaluate('s1', { expression: '(e) => 1', id: 1 })
    expect(gone.isError).toBe(true)
    expect(textOf(gone)).toBe(`[browser.element_gone] ${detail}`)
    expect(desktop.cdpMethods()).toEqual([])
  })

  test('serializes an object result and releases the remote object', async () => {
    const { service, desktop } = setup()
    scriptCdp(desktop, {
      'Runtime.evaluate': () => ({ result: { type: 'object', className: 'Object', objectId: 'obj-1' } }),
      'Runtime.callFunctionOn': () => ({ result: { type: 'object', value: { a: 1, b: [2, 'x'] } } }),
    })
    const result = await service.evaluate('s1', { expression: '({a: 1})' })
    expect(textOf(result)).toContain('\n{"a":1,"b":[2,"x"]}\n')
    const calls = cdpCalls(desktop)
    expect(calls[1]).toMatchObject({
      method: 'Runtime.callFunctionOn',
      params: { objectId: 'obj-1', returnByValue: true, userGesture: false },
    })
    expect(calls.at(-1)).toEqual({ method: 'Runtime.releaseObject', params: { objectId: 'obj-1' } })
  })

  test('renders undefined, null and numbers JSON cannot hold', async () => {
    const { service, desktop } = setup()
    const answers: Array<[unknown, string]> = [
      [{ type: 'undefined' }, '\nundefined\n'],
      [{ type: 'object', subtype: 'null', value: null }, '\nnull\n'],
      [{ type: 'number', unserializableValue: 'NaN', description: 'NaN' }, '\nNaN\n'],
      [{ type: 'bigint', unserializableValue: '10n', description: '10n' }, '\n10n\n'],
      [{ type: 'boolean', value: true }, '\ntrue\n'],
    ]
    for (const [remote, expected] of answers) {
      scriptCdp(desktop, { 'Runtime.evaluate': () => ({ result: remote }) })
      expect(textOf(await service.evaluate('s1', { expression: 'x' }))).toContain(expected)
    }
  })

  test('cuts a long result at 10000 characters and says how much is missing', async () => {
    const { service, desktop } = setup()
    scriptCdp(desktop, { 'Runtime.evaluate': () => ({ result: { type: 'string', value: 'x'.repeat(12_000) } }) })
    const result = await service.evaluate('s1', { expression: "'x'.repeat(12000)" })
    const body = textOf(result)
    expect(body).toContain(`"${'x'.repeat(9_999)}`)
    expect(body).not.toContain('x'.repeat(10_000))
    expect(body).toContain('(result cut at 10000 characters: 2002 more not shown; return a smaller value)')
  })

  test('returns a thrown exception as an error with its message and a clipped stack', async () => {
    const { service, desktop } = setup()
    const stack = `ReferenceError: foo is not defined\n${'    at <anonymous>:1:1\n'.repeat(200)}`
    scriptCdp(desktop, {
      'Runtime.evaluate': () => ({
        result: { type: 'object', subtype: 'error' },
        exceptionDetails: { text: 'Uncaught', exception: { type: 'object', subtype: 'error', description: stack } },
      }),
    })
    const result = await service.evaluate('s1', { expression: 'foo' })
    expect(result.isError).toBe(true)
    const body = textOf(result)
    expect(body).toStartWith('[browser.eval_exception]')
    expect(body).toContain('<UNTRUSTED_PAGE_CONTENT nonce="')
    expect(body).toContain('ReferenceError: foo is not defined')
    expect(body).toContain('…')
    expect(body.length).toBeLessThan(2_500)
  })

  test('returns a thrown non-error value', async () => {
    const { service, desktop } = setup()
    scriptCdp(desktop, {
      'Runtime.evaluate': () => ({
        result: { type: 'string', value: 'nope' },
        exceptionDetails: { text: 'Uncaught', exception: { type: 'string', value: 'nope' } },
      }),
    })
    const result = await service.evaluate('s1', { expression: "throw 'nope'" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Uncaught "nope"')
  })

  test('asks for plain data when the result is a DOM node, a function or cyclic', async () => {
    const { service, desktop } = setup()
    const asked = async (answers: Record<string, (params: CdpParams) => unknown>) => {
      scriptCdp(desktop, answers)
      return service.evaluate('s1', { expression: 'x' })
    }
    const node = await asked({ 'Runtime.evaluate': () => ({ result: { type: 'object', subtype: 'node', objectId: 'n1' } }) })
    expect(node.isError).toBe(true)
    expect(textOf(node)).toStartWith('[browser.eval_not_serializable] The result is a DOM node, which cannot be returned as data. Return plain data')
    const fn = await asked({ 'Runtime.evaluate': () => ({ result: { type: 'function', objectId: 'f1' } }) })
    expect(textOf(fn)).toContain('The result is a function')
    const cyclic = await asked({
      'Runtime.evaluate': () => ({ result: { type: 'object', objectId: 'c1' } }),
      'Runtime.callFunctionOn': () => fail('cdp_error', 'Object reference chain is too long'),
    })
    expect(cyclic.isError).toBe(true)
    expect(textOf(cyclic)).toContain('[browser.eval_not_serializable] The result is a value that cannot be converted to JSON')
  })

  test('other browser errors still surface as themselves', async () => {
    const { service, desktop } = setup()
    scriptCdp(desktop, { 'Runtime.evaluate': () => fail('cdp_error', 'Inspected target navigated or closed') })
    const result = await service.evaluate('s1', { expression: 'x' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.cdp_error]')
  })

  test('reports a navigation the script caused', async () => {
    const { service, desktop } = setup()
    inspectsThat(desktop, { generation: 2, url: 'https://example.com/next' }, 3)
    scriptCdp(desktop, { 'Runtime.evaluate': () => ({ result: { type: 'undefined' } }) })
    const result = await service.evaluate('s1', { expression: "location.href = '/next'" })
    expect(textOf(result)).toContain('Page navigated. Element ids from before are gone; take a new snapshot.')
    expectFenced(result, 'https://example.com/next')
  })

  test('reports the dialogs that opened while it ran, also on failure', async () => {
    const { service, desktop } = setup()
    scriptCdp(desktop, {
      'Runtime.evaluate': () =>
        withDialogs(
          { result: { type: 'object' }, exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: late' } } },
          [{ kind: 'alert', message: 'Hi', handledAs: 'accepted' }],
        ),
    })
    const result = await service.evaluate('s1', { expression: "alert('Hi'); throw new Error('late')" })
    expect(result.isError).toBe(true)
    expectFenced(result, 'alert "Hi" was accepted automatically')
  })
})

describe('navigation note after an action', () => {
  const NOTE = 'Page navigated. Element ids from before are gone; take a new snapshot.'

  test.each([
    ['click', 3, (service: BrowserService) => service.click('s1', { id: 1 })],
    ['type', 3, (service: BrowserService) => service.type('s1', { id: 1, text: 'x' })],
    ['press_key', 3, (service: BrowserService) => service.pressKey('s1', { key: 'Enter' })],
    ['scroll', 2, (service: BrowserService) => service.scroll('s1', { direction: 'down' })],
  ])('%s says so when the page URL changed', async (_name, changeFromCall, act) => {
    const { service, desktop } = setup()
    await service.snapshot('s1', {})
    inspectsThat(desktop, { generation: 2, url: 'https://example.com/next' }, changeFromCall)
    const result = await act(service)
    expect(textOf(result)).toContain(NOTE)
    expectFenced(result, 'https://example.com/next')
  })

  test('a URL change in the same document is reported without saying the ids are gone', async () => {
    const { service, desktop } = setup()
    await service.snapshot('s1', {})
    inspectsThat(desktop, { url: 'https://example.com/#section' }, 3)
    const result = await service.click('s1', { id: 1 })
    expect(textOf(result)).toContain('The address changed without a page load; element ids are still valid.')
    expect(textOf(result)).not.toContain('ids from before are gone')
    expectFenced(result, 'https://example.com/#section')
  })

  test('a new document is reported with its ids gone', async () => {
    const { service, desktop } = setup()
    await service.snapshot('s1', {})
    inspectsThat(desktop, { url: 'https://example.com/next', generation: 9 }, 3)
    const result = await service.click('s1', { id: 1 })
    expect(textOf(result)).toContain('Page navigated. Element ids from before are gone')
    expectFenced(result, 'https://example.com/next')
  })

  test('says nothing when the URL and the document are the same', async () => {
    const { service } = setup()
    await service.snapshot('s1', {})
    for (const result of [
      await service.click('s1', { id: 1 }),
      await service.pressKey('s1', { key: 'Tab' }),
      await service.scroll('s1', { direction: 'down' }),
    ]) {
      expect(textOf(result)).not.toContain('Page navigated')
    }
  })

  test('back names the page it went to and says the ids are gone', async () => {
    const { service, desktop } = setup()
    desktop.on('history', () => ({ url: 'https://example.com/next', generation: 2 }))
    inspectsThat(desktop, { generation: 2, url: 'https://example.com/next' }, 3)
    const result = await service.back('s1', {})
    expect(textOf(result)).toStartWith(`Went back to the address below. ${NOTE}`)
    expectFenced(result, 'https://example.com/next')
    expect(textOf(result).match(/<UNTRUSTED_PAGE_CONTENT /g)).toHaveLength(1)
  })

  test('back still asks for a snapshot when the page did not change', async () => {
    const { service, desktop } = setup()
    desktop.on('history', () => ({ url: 'https://example.com/', generation: 1 }))
    const result = await service.back('s1', {})
    expect(textOf(result)).toStartWith('Went back to the address below. Take a snapshot to see the page.')
    expectFenced(result, 'https://example.com/')
    expect(textOf(result).match(/<UNTRUSTED_PAGE_CONTENT /g)).toHaveLength(1)
  })
})

describe('emulate', () => {
  const cdpCalls = (desktop: FakeDesktop) =>
    desktop.of('cdp').map((entry) => {
      const command = entry.command as Extract<BrowserHostCommand, { kind: 'cdp' }>
      return { method: command.method, params: command.params }
    })

  const mediaParams = (colorScheme: string, reducedMotion: string) => ({
    media: '',
    features: [
      { name: 'prefers-color-scheme', value: colorScheme },
      { name: 'prefers-reduced-motion', value: reducedMotion },
    ],
  })

  test('sets the viewport and the media features in that order and reports what is active', async () => {
    const { service, desktop } = setup()
    const result = await service.emulate('s1', { width: 375, height: 667, colorScheme: 'dark' })
    expect(result.isError).toBeUndefined()
    expect(cdpCalls(desktop)).toEqual([
      { method: 'Emulation.setDeviceMetricsOverride', params: { width: 375, height: 667, deviceScaleFactor: 1, mobile: false } },
      { method: 'Emulation.setEmulatedMedia', params: mediaParams('dark', '') },
    ])
    expect(textOf(result)).toBe(
      'Emulation active: 375x667 (desktop), color scheme dark. Call emulate with reset to restore the normal view. The layout and visible elements may have changed: take a snapshot to see them.',
    )
  })

  test('passes mobile and the device scale factor and names them in the result', async () => {
    const { service, desktop } = setup()
    const result = await service.emulate('s1', { width: 390, height: 844, mobile: true, deviceScaleFactor: 3 })
    expect(cdpCalls(desktop)).toEqual([
      { method: 'Emulation.setDeviceMetricsOverride', params: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } },
    ])
    expect(textOf(result)).toContain('Emulation active: 390x844 (mobile, scale 3).')
  })

  test('a media feature alone leaves the viewport alone, and later calls keep what is already set', async () => {
    const { service, desktop } = setup()
    await service.emulate('s1', { colorScheme: 'dark' })
    const second = await service.emulate('s1', { reducedMotion: 'reduce' })
    expect(cdpCalls(desktop)).toEqual([
      { method: 'Emulation.setEmulatedMedia', params: mediaParams('dark', '') },
      { method: 'Emulation.setEmulatedMedia', params: mediaParams('dark', 'reduce') },
    ])
    expect(textOf(second)).toContain('Emulation active: color scheme dark, reduced motion reduce.')
  })

  test('auto clears one feature and keeps the others, and says cleared when nothing is left', async () => {
    const { service, desktop } = setup()
    await service.emulate('s1', { colorScheme: 'light', reducedMotion: 'no-preference' })
    const first = await service.emulate('s1', { colorScheme: 'auto' })
    expect(cdpCalls(desktop).at(-1)).toEqual({ method: 'Emulation.setEmulatedMedia', params: mediaParams('', 'no-preference') })
    expect(textOf(first)).toContain('Emulation active: reduced motion no-preference.')
    const second = await service.emulate('s1', { reducedMotion: 'auto' })
    expect(cdpCalls(desktop).at(-1)).toEqual({ method: 'Emulation.setEmulatedMedia', params: mediaParams('', '') })
    expect(textOf(second)).toStartWith('Emulation cleared.')
  })

  test('a new viewport replaces the old one and leaves the media features', async () => {
    const { service, desktop } = setup()
    await service.emulate('s1', { width: 375, height: 667, colorScheme: 'dark' })
    const result = await service.emulate('s1', { width: 768, height: 1024 })
    expect(cdpCalls(desktop).at(-1)).toEqual({
      method: 'Emulation.setDeviceMetricsOverride',
      params: { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false },
    })
    expect(cdpCalls(desktop)).toHaveLength(3)
    expect(textOf(result)).toContain('Emulation active: 768x1024 (desktop), color scheme dark.')
  })

  test('reset clears the viewport and both media features and says so', async () => {
    const { service, desktop } = setup()
    await service.emulate('s1', { width: 375, height: 667, reducedMotion: 'reduce' })
    desktop.commands.length = 0
    const result = await service.emulate('s1', { reset: true })
    expect(result.isError).toBeUndefined()
    expect(cdpCalls(desktop)).toEqual([
      { method: 'Emulation.clearDeviceMetricsOverride', params: undefined },
      { method: 'Emulation.setEmulatedMedia', params: mediaParams('', '') },
    ])
    expect(textOf(result)).toBe('Emulation cleared. The page is back to its normal view: take a snapshot to see it.')
  })

  test('reset also runs when the service believes nothing is active', async () => {
    const { service, desktop } = setup()
    const result = await service.emulate('s1', { reset: true })
    expect(cdpCalls(desktop).map((call) => call.method)).toEqual(['Emulation.clearDeviceMetricsOverride', 'Emulation.setEmulatedMedia'])
    expect(textOf(result)).toStartWith('Emulation cleared.')
  })

  test.each([
    ['nothing to do', {}, 'at least one'],
    ['only mobile', { mobile: true }, 'together with width and height'],
    ['only a scale factor', { deviceScaleFactor: 2 }, 'together with width and height'],
    ['width without height', { width: 375 }, 'width and height together'],
    ['height without width', { height: 667, colorScheme: 'dark' as const }, 'width and height together'],
    ['reset with a size', { reset: true, width: 375, height: 667 }, 'reset cannot be combined'],
    ['reset with a color scheme', { reset: true, colorScheme: 'dark' as const }, 'reset cannot be combined'],
    ['reset with mobile', { reset: true, mobile: false }, 'reset cannot be combined'],
  ])('refuses %s before touching the page', async (_name, args, message) => {
    const { service, desktop } = setup()
    const result = await service.emulate('s1', args)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('[browser.invalid_arguments]')
    expect(textOf(result)).toContain(message)
    expect(desktop.commands).toEqual([])
  })

  test('reset: false does not count as a reset', async () => {
    const { service } = setup()
    const result = await service.emulate('s1', { reset: false })
    expect(textOf(result)).toContain('[browser.invalid_arguments]')
  })

  test('never asks for a grant, even on an external origin', async () => {
    const { service, grants } = setup()
    await service.emulate('s1', { width: 375, height: 667 })
    await service.emulate('s1', { reset: true })
    expect(grants.requests).toEqual([])
  })

  test('counts as activity while it runs', async () => {
    const { service } = setup()
    const events: string[] = []
    service.onActivity((sessionId, tabId, active) => events.push(`${sessionId}:${tabId}:${active}`))
    await service.emulate('s1', { colorScheme: 'dark' })
    expect(events).toEqual(['s1:t1:true', 's1:t1:false'])
  })

  test('is refused after the user stopped browser control', async () => {
    const { service, desktop } = setup()
    service.stop('s1')
    const result = await service.emulate('s1', { colorScheme: 'dark' })
    expect(textOf(result)).toContain('[browser.stopped]')
    expect(desktop.of('cdp')).toEqual([])
  })

  test('uses the tab the caller names and keeps the state per tab', async () => {
    const { service, desktop } = setup()
    desktop.setViews([makeView(), makeView({ tabId: 't2', active: false })])
    await service.emulate('s1', { width: 375, height: 667, tabId: 't2' })
    expect(desktop.of('cdp')[0]?.tabId).toBe('t2')
    expect(textOf(await service.snapshot('s1', { tabId: 't2' }))).toContain('Emulation active: 375x667')
    expect(textOf(await service.snapshot('s1', { tabId: 't1' }))).not.toContain('Emulation')
  })

  test('a failure in the media step keeps the viewport that was already set in the state', async () => {
    const { service, desktop } = setup()
    desktop.on('cdp', (message) =>
      (message.command as { method: string }).method === 'Emulation.setEmulatedMedia' ? fail('cdp_error', 'no media') : { result: {} },
    )
    const result = await service.emulate('s1', { width: 375, height: 667, colorScheme: 'dark' })
    expect(result.isError).toBe(true)
    const snapshot = textOf(await service.snapshot('s1', {}))
    expect(snapshot).toContain('Emulation active: 375x667 (desktop).')
    expect(snapshot).not.toContain('color scheme')
  })

  test('snapshot and screenshot say that an emulation is active, and stay quiet when none is', async () => {
    const { service, desktop } = setup()
    desktop.on('cdp', () => ({ result: { data: 'QUJD' } }))
    expect(textOf(await service.snapshot('s1', {}))).not.toContain('Emulation')
    expect(textOf(await service.screenshot('s1', {}))).not.toContain('Emulation')
    await service.emulate('s1', { width: 375, height: 667 })
    const snapshot = textOf(await service.snapshot('s1', {}))
    expect(snapshot).toStartWith('Tab t1\nEmulation active: 375x667 (desktop). Call emulate with reset to restore the normal view.\n')
    expect(textOf(await service.screenshot('s1', {}))).toContain('Emulation active: 375x667 (desktop).')
    await service.emulate('s1', { reset: true })
    expect(textOf(await service.snapshot('s1', {}))).not.toContain('Emulation')
  })

  test('stays active when the page navigates, because the override survives navigation', async () => {
    const { service, desktop } = setup()
    await service.emulate('s1', { width: 375, height: 667 })
    desktop.on('inspect', () => makeInspect({ generation: 2, url: 'https://example.com/next' }))
    expect(textOf(await service.snapshot('s1', {}))).toContain('Emulation active: 375x667')
  })

  describe('lifetime', () => {
    test('a stop from the desktop forgets it, because the desktop detaches the debugger and that clears the override', async () => {
      const { service, desktop } = setup()
      await service.emulate('s1', { width: 375, height: 667 })
      desktop.sendStop('s1')
      service.resume('s1')
      expect(textOf(await service.snapshot('s1', {}))).not.toContain('Emulation')
    })

    test('a stop from the desktop leaves the other sessions alone', async () => {
      const { service, desktop } = setup()
      desktop.setViews([makeView(), makeView({ sessionId: 's2', tabId: 't9' })])
      await service.emulate('s2', { width: 375, height: 667 })
      desktop.sendStop('s1')
      expect(textOf(await service.snapshot('s2', {}))).toContain('Emulation active: 375x667')
    })

    test('a stop that does not detach the debugger keeps it, so the end of the turn can still clear it', async () => {
      const { service, desktop } = setup()
      await service.emulate('s1', { width: 375, height: 667 })
      service.stop('s1')
      desktop.commands.length = 0
      await service.resetEmulation('s1')
      expect(cdpCalls(desktop).map((call) => call.method)).toEqual(['Emulation.clearDeviceMetricsOverride', 'Emulation.setEmulatedMedia'])
    })

    test('releasing the session forgets it', async () => {
      const { service, desktop } = setup()
      desktop.on('release', () => ({}))
      await service.emulate('s1', { width: 375, height: 667 })
      await service.releaseSession('s1')
      desktop.commands.length = 0
      await service.resetEmulation('s1')
      expect(desktop.of('cdp')).toEqual([])
      expect(textOf(await service.snapshot('s1', {}))).not.toContain('Emulation')
    })

    test('closing the tab forgets it, so a new tab with the same id starts clean', async () => {
      const { service, desktop } = setup()
      await service.emulate('s1', { width: 375, height: 667 })
      desktop.setViews([])
      desktop.setViews([makeView()])
      expect(textOf(await service.snapshot('s1', {}))).not.toContain('Emulation')
    })
  })

  describe('resetEmulation', () => {
    test('clears the tabs of the session that have an emulation and no others', async () => {
      const { service, desktop } = setup()
      desktop.setViews([makeView(), makeView({ tabId: 't2', active: false }), makeView({ sessionId: 's2', tabId: 't9' })])
      await service.emulate('s1', { colorScheme: 'dark', tabId: 't2' })
      await service.emulate('s2', { width: 375, height: 667 })
      desktop.commands.length = 0
      await service.resetEmulation('s1')
      expect(desktop.of('cdp').map((entry) => [entry.tabId, (entry.command as { method: string }).method])).toEqual([
        ['t2', 'Emulation.clearDeviceMetricsOverride'],
        ['t2', 'Emulation.setEmulatedMedia'],
      ])
      expect(textOf(await service.snapshot('s1', { tabId: 't2' }))).not.toContain('Emulation')
      expect(textOf(await service.snapshot('s2', {}))).toContain('Emulation active')
    })

    test('sends nothing when no emulation is active', async () => {
      const { service, desktop } = setup()
      await service.resetEmulation('s1')
      await service.emulate('s1', { reset: true })
      desktop.commands.length = 0
      await service.resetEmulation('s1')
      expect(desktop.commands).toEqual([])
    })

    test('works after a stop, needs no grant and does not count as activity', async () => {
      const { service, desktop, grants } = setup()
      await service.emulate('s1', { width: 375, height: 667 })
      service.stop('s1')
      const events: boolean[] = []
      service.onActivity((_sessionId, _tabId, active) => events.push(active))
      grants.requests.length = 0
      desktop.commands.length = 0
      await service.resetEmulation('s1')
      expect(desktop.of('cdp')).toHaveLength(2)
      expect(grants.requests).toEqual([])
      expect(events).toEqual([])
    })

    test('never throws when the desktop refuses or is gone, and keeps the state after a refusal for another try', async () => {
      const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const { service, desktop } = setup()
        await service.emulate('s1', { width: 375, height: 667 })
        desktop.on('cdp', () => fail('cdp_error', 'detached'))
        await service.resetEmulation('s1')
        expect(warn).toHaveBeenCalledTimes(1)
        expect(textOf(await service.snapshot('s1', {}))).toContain('Emulation active')
        desktop.disconnect()
        await service.resetEmulation('s1')
      } finally {
        warn.mockRestore()
      }
    })

    test('waits for a call that is running on the tab', async () => {
      const { service, desktop } = setup()
      await service.emulate('s1', { width: 375, height: 667 })
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      desktop.on('cdp', async (message) => {
        if ((message.command as { method: string }).method === 'Page.captureScreenshot') await gate
        return { result: { data: 'QUJD' } }
      })
      desktop.commands.length = 0
      const shot = service.screenshot('s1', {})
      await sleepFor(10)
      const reset = service.resetEmulation('s1')
      await sleepFor(10)
      expect(desktop.of('cdp').map((entry) => (entry.command as { method: string }).method)).toEqual(['Page.captureScreenshot'])
      release()
      await Promise.all([shot, reset])
      expect(desktop.of('cdp').map((entry) => (entry.command as { method: string }).method)).toEqual([
        'Page.captureScreenshot',
        'Emulation.clearDeviceMetricsOverride',
        'Emulation.setEmulatedMedia',
      ])
    })
  })
})
