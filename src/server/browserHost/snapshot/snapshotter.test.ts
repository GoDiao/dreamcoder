import { describe, expect, test } from 'bun:test'
import { createSnapshotter } from './snapshotter.js'
import type { CdpSend, SnapshotOptions } from './types.js'

type Call = { method: string; params: Record<string, unknown> | undefined }

const OPTIONS: SnapshotOptions = {
  delta: false,
  baseline: null,
  region: null,
  find: null,
  textFrom: 0,
  maxItems: 150,
  mainChars: 8000,
  maxChars: 16000,
}

const SNAPSHOT_VALUE = {
  text: 'URL: http://x',
  baseline: 'abc',
  full: true,
  items: [{ id: 1, role: 'button', name: 'Go', offscreen: false }],
  itemsDropped: 0,
  mainCharsDropped: 0,
  unreadFrames: 0,
}

function evaluated(value: unknown) {
  return { result: { type: 'object', value } }
}

type Handler = (call: Call, evaluateIndex: number) => unknown

function fakeCdp(onEvaluate: Handler) {
  const calls: Call[] = []
  let worlds = 0
  let evaluations = 0
  const cdp: CdpSend = async (method, params) => {
    const call = { method, params }
    calls.push(call)
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-1' } } }
    if (method === 'Page.createIsolatedWorld') {
      worlds += 1
      return { executionContextId: 100 + worlds }
    }
    if (method === 'Runtime.evaluate') {
      const index = evaluations
      evaluations += 1
      const outcome = onEvaluate(call, index)
      if (outcome instanceof Error) throw outcome
      return outcome
    }
    throw new Error(`unexpected ${method}`)
  }
  return { cdp, calls, worlds: () => worlds }
}

function methods(calls: Call[]) {
  return calls.map((call) => call.method)
}

describe('createSnapshotter', () => {
  test('creates the isolated world lazily and reuses it', async () => {
    const fake = fakeCdp(() => evaluated(SNAPSHOT_VALUE))
    const snapshotter = createSnapshotter(fake.cdp)
    expect(fake.calls).toHaveLength(0)
    await snapshotter.snapshot(OPTIONS)
    await snapshotter.snapshot(OPTIONS)
    expect(methods(fake.calls)).toEqual([
      'Page.getFrameTree',
      'Page.createIsolatedWorld',
      'Runtime.evaluate',
      'Runtime.evaluate',
    ])
    expect(fake.calls[1]?.params).toEqual({ frameId: 'frame-1', worldName: 'dreamcoder-snapshot' })
    expect(fake.calls[2]?.params?.contextId).toBe(101)
    expect(fake.calls[3]?.params?.contextId).toBe(101)
    expect(fake.calls[2]?.params?.returnByValue).toBe(true)
  })

  test('later snapshots, locate and focus all run in the world that handed out the ids', async () => {
    const fake = fakeCdp((call) => {
      const expression = String(call.params?.expression)
      if (expression.includes(')("locate", ')) return evaluated({ ok: true, x: 1, y: 2, role: 'link', name: 'A' })
      if (expression.includes(')("focus", ')) return evaluated({ ok: true })
      return evaluated(SNAPSHOT_VALUE)
    })
    const snapshotter = createSnapshotter(fake.cdp)
    await snapshotter.snapshot(OPTIONS)
    await snapshotter.snapshot({ ...OPTIONS, delta: true, baseline: 'abc' })
    await snapshotter.locate(1)
    await snapshotter.focus(1, false)
    await snapshotter.snapshot({ ...OPTIONS, region: 1 })
    expect(fake.worlds()).toBe(1)
    const contexts = fake.calls.filter((call) => call.method === 'Runtime.evaluate').map((call) => call.params?.contextId)
    expect(contexts).toEqual([101, 101, 101, 101, 101])
  })

  test('creates the world once for concurrent first calls', async () => {
    const fake = fakeCdp(() => evaluated(SNAPSHOT_VALUE))
    const snapshotter = createSnapshotter(fake.cdp)
    await Promise.all([snapshotter.snapshot(OPTIONS), snapshotter.snapshot(OPTIONS)])
    expect(fake.worlds()).toBe(1)
  })

  test('passes the snapshot options to the program as JSON', async () => {
    const fake = fakeCdp(() => evaluated(SNAPSHOT_VALUE))
    const options: SnapshotOptions = {
      delta: true,
      baseline: 'b1',
      region: 7,
      find: 'needle',
      textFrom: 0,
      maxItems: 5,
      mainChars: 6,
      maxChars: 7,
    }
    await createSnapshotter(fake.cdp).snapshot(options)
    const expression = String(fake.calls[2]?.params?.expression)
    expect(expression.endsWith(`("snapshot", ${JSON.stringify(options)})`)).toBe(true)
    expect(expression.startsWith('(function pageProgram')).toBe(true)
  })

  test('passes locate and focus arguments to the program', async () => {
    const fake = fakeCdp((call) =>
      evaluated(String(call.params?.expression).includes('"locate"') ? { ok: true, x: 1, y: 2, role: 'link', name: 'A' } : { ok: true }),
    )
    const snapshotter = createSnapshotter(fake.cdp)
    expect(await snapshotter.locate(12)).toEqual({ ok: true, x: 1, y: 2, role: 'link', name: 'A' })
    expect(await snapshotter.focus(13, true)).toEqual({ ok: true })
    expect(String(fake.calls[2]?.params?.expression).endsWith('("locate", {"id":12})')).toBe(true)
    expect(String(fake.calls[3]?.params?.expression).endsWith('("focus", {"id":13,"clear":true})')).toBe(true)
  })

  test('passes scroll arguments to the program and maps the result', async () => {
    const page = { ok: true, moved: 720, position: 1440, maxPosition: 3000, total: 3800, area: null }
    const area = { ...page, area: 'div "Comments"' }
    const fake = fakeCdp((call) => evaluated(String(call.params?.expression).includes('"amount":null') ? page : area))
    const snapshotter = createSnapshotter(fake.cdp)
    expect(await snapshotter.scroll({ direction: 'down', amount: null })).toEqual(page)
    expect(await snapshotter.scroll({ direction: 'up', amount: 300 })).toEqual(area)
    expect(String(fake.calls[2]?.params?.expression).endsWith('("scroll", {"direction":"down","amount":null})')).toBe(true)
    expect(String(fake.calls[3]?.params?.expression).endsWith('("scroll", {"direction":"up","amount":300})')).toBe(true)
  })

  test('maps a scroll failure and rejects malformed scroll results', async () => {
    const failed = fakeCdp(() => evaluated({ ok: false, reason: 'not_scrollable', detail: 'Nothing scrolls.' }))
    expect(await createSnapshotter(failed.cdp).scroll({ direction: 'bottom', amount: null })).toEqual({
      ok: false,
      reason: 'not_scrollable',
      detail: 'Nothing scrolls.',
    })
    const bad: unknown[] = [
      { ok: true },
      { ok: true, moved: '1', position: 0, maxPosition: 0, total: 0, area: null },
      { ok: true, moved: 1, position: 0, maxPosition: 0, total: 0, area: 5 },
      { ok: false, reason: 'gone', detail: 'x' },
      'nope',
    ]
    for (const value of bad) {
      const fake = fakeCdp(() => evaluated(value))
      await expect(createSnapshotter(fake.cdp).scroll({ direction: 'up', amount: null })).rejects.toThrow('unexpected')
    }
  })

  test('maps a snapshot result and its items', async () => {
    const fake = fakeCdp(() => evaluated(SNAPSHOT_VALUE))
    expect(await createSnapshotter(fake.cdp).snapshot(OPTIONS)).toEqual(SNAPSHOT_VALUE)
  })

  test('recreates the world once when the context was destroyed', async () => {
    const fake = fakeCdp((_call, index) =>
      index === 0 ? new Error('Cannot find context with specified id') : evaluated(SNAPSHOT_VALUE),
    )
    const snapshotter = createSnapshotter(fake.cdp)
    await snapshotter.snapshot(OPTIONS)
    expect(fake.worlds()).toBe(2)
    expect(fake.calls.filter((call) => call.method === 'Runtime.evaluate').map((call) => call.params?.contextId)).toEqual([
      101, 102,
    ])
    await snapshotter.snapshot(OPTIONS)
    expect(fake.worlds()).toBe(2)
  })

  test('recreates the world when the exception text says the context was destroyed', async () => {
    const fake = fakeCdp((_call, index) =>
      index === 0
        ? { exceptionDetails: { text: 'Execution context was destroyed.' } }
        : evaluated(SNAPSHOT_VALUE),
    )
    await createSnapshotter(fake.cdp).snapshot(OPTIONS)
    expect(fake.worlds()).toBe(2)
  })

  test('retries only once', async () => {
    const fake = fakeCdp(() => new Error('Execution context was destroyed.'))
    await expect(createSnapshotter(fake.cdp).snapshot(OPTIONS)).rejects.toThrow('Execution context was destroyed')
    expect(fake.worlds()).toBe(2)
    expect(fake.calls.filter((call) => call.method === 'Runtime.evaluate')).toHaveLength(2)
  })

  test('does not retry other protocol errors', async () => {
    const fake = fakeCdp(() => new Error('Target closed'))
    await expect(createSnapshotter(fake.cdp).locate(1)).rejects.toThrow('Target closed')
    expect(fake.worlds()).toBe(1)
    expect(fake.calls.filter((call) => call.method === 'Runtime.evaluate')).toHaveLength(1)
  })

  test('maps a page exception to an Error with its text', async () => {
    const fake = fakeCdp(() => ({
      exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: boom\n    at <anonymous>' } },
    }))
    const snapshotter = createSnapshotter(fake.cdp)
    await expect(snapshotter.snapshot(OPTIONS)).rejects.toThrow('TypeError: boom')
    expect(fake.worlds()).toBe(1)
  })

  test('falls back to the exception text when there is no description', async () => {
    const fake = fakeCdp(() => ({ exceptionDetails: { text: 'Uncaught' } }))
    await expect(createSnapshotter(fake.cdp).focus(1, false)).rejects.toThrow('Uncaught')
  })

  test('creating the world again after a failed creation', async () => {
    let failFirst = true
    const calls: string[] = []
    const cdp: CdpSend = async (method) => {
      calls.push(method)
      if (method === 'Page.getFrameTree') {
        if (failFirst) {
          failFirst = false
          throw new Error('no frame yet')
        }
        return { frameTree: { frame: { id: 'f' } } }
      }
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 5 }
      return evaluated(SNAPSHOT_VALUE)
    }
    const snapshotter = createSnapshotter(cdp)
    await expect(snapshotter.snapshot(OPTIONS)).rejects.toThrow('no frame yet')
    expect((await snapshotter.snapshot(OPTIONS)).baseline).toBe('abc')
  })

  test('maps an unknown region id to an Error', async () => {
    const fake = fakeCdp(() => evaluated({ error: 'unknown_id' }))
    await expect(createSnapshotter(fake.cdp).snapshot({ ...OPTIONS, region: 9 })).rejects.toThrow('Unknown element id 9')
  })

  test('maps the id of a removed region to an Error that says to take a new snapshot', async () => {
    const fake = fakeCdp(() => evaluated({ error: 'gone' }))
    await expect(createSnapshotter(fake.cdp).snapshot({ ...OPTIONS, region: 9 })).rejects.toThrow(
      'Element 9 is no longer on the page. Take a new snapshot.',
    )
  })

  test('hands the page detail of a removed element through unchanged', async () => {
    const detail = 'Element 4 is no longer on the page. Take a new snapshot.'
    const locate = fakeCdp(() => evaluated({ ok: false, reason: 'gone', detail }))
    expect(await createSnapshotter(locate.cdp).locate(4)).toEqual({ ok: false, reason: 'gone', detail })
    const focus = fakeCdp(() => evaluated({ ok: false, reason: 'gone', detail }))
    expect(await createSnapshotter(focus.cdp).focus(4, true)).toEqual({ ok: false, reason: 'gone', detail })
  })

  test('maps locate and focus failures', async () => {
    const locate = fakeCdp(() => evaluated({ ok: false, reason: 'covered', detail: 'by a dialog' }))
    expect(await createSnapshotter(locate.cdp).locate(3)).toEqual({ ok: false, reason: 'covered', detail: 'by a dialog' })
    const focus = fakeCdp(() => evaluated({ ok: false, reason: 'not_editable', detail: 'no' }))
    expect(await createSnapshotter(focus.cdp).focus(3, false)).toEqual({ ok: false, reason: 'not_editable', detail: 'no' })
  })

  const malformedValues: Array<[string, unknown]> = [
    ['null', null],
    ['a string', 'text'],
    ['an array', []],
    ['a missing field', { ...SNAPSHOT_VALUE, text: undefined }],
    ['a wrong field type', { ...SNAPSHOT_VALUE, itemsDropped: '0' }],
    ['a malformed item', { ...SNAPSHOT_VALUE, items: [{ id: '1', role: 'button', name: 'x', offscreen: false }] }],
    ['an item that is not an object', { ...SNAPSHOT_VALUE, items: [null] }],
  ]
  for (const [label, value] of malformedValues) {
    test(`rejects a snapshot result that is ${label}`, async () => {
      const fake = fakeCdp(() => evaluated(value))
      await expect(createSnapshotter(fake.cdp).snapshot(OPTIONS)).rejects.toThrow('unexpected')
    })
  }

  test('rejects malformed locate and focus results', async () => {
    const bad: unknown[] = [
      { ok: true },
      { ok: true, x: '1', y: 2, role: 'a', name: 'b' },
      { ok: false, reason: 'exploded', detail: 'x' },
      { ok: false, reason: 'gone' },
      'nope',
    ]
    for (const value of bad) {
      const locate = fakeCdp(() => evaluated(value))
      await expect(createSnapshotter(locate.cdp).locate(1)).rejects.toThrow('unexpected')
    }
    const badFocus: unknown[] = [{ ok: false, reason: 'covered', detail: 'x' }, { ok: false, reason: 'gone' }, 1]
    for (const value of badFocus) {
      const focus = fakeCdp(() => evaluated(value))
      await expect(createSnapshotter(focus.cdp).focus(1, false)).rejects.toThrow('unexpected')
    }
  })

  test('rejects malformed protocol responses', async () => {
    const noFrame: CdpSend = async () => ({})
    await expect(createSnapshotter(noFrame).snapshot(OPTIONS)).rejects.toThrow('frame tree')
    const noContext: CdpSend = async (method) =>
      method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'f' } } } : {}
    await expect(createSnapshotter(noContext).snapshot(OPTIONS)).rejects.toThrow('isolated world')
    const noValue = fakeCdp(() => ({ result: { type: 'undefined' } }))
    await expect(createSnapshotter(noValue.cdp).snapshot(OPTIONS)).rejects.toThrow('evaluate response')
    const notObject = fakeCdp(() => 'x')
    await expect(createSnapshotter(notObject.cdp).snapshot(OPTIONS)).rejects.toThrow('evaluate response')
  })

  test('hasText runs the text op in the isolated world by value and maps the answer', async () => {
    const fake = fakeCdp((_call, index) => evaluated({ present: index === 1 }))
    const snapshotter = createSnapshotter(fake.cdp)
    expect(await snapshotter.hasText('Saved')).toBe(false)
    expect(await snapshotter.hasText('Saved')).toBe(true)
    const evaluations = fake.calls.filter((call) => call.method === 'Runtime.evaluate')
    expect(evaluations.map((call) => call.params?.contextId)).toEqual([101, 101])
    expect(evaluations[0]?.params?.returnByValue).toBe(true)
    expect(String(evaluations[0]?.params?.expression).endsWith('("hasText", {"text":"Saved"})')).toBe(true)
    const bad = fakeCdp(() => evaluated({ present: 'yes' }))
    await expect(createSnapshotter(bad.cdp).hasText('x')).rejects.toThrow('unexpected text result')
  })

  test('styles passes the ids and properties and maps the result', async () => {
    const page = {
      ok: true as const,
      tag: 'div',
      role: 'generic',
      name: '',
      box: { x: 1, y: 2, width: 3, height: 4 },
      values: [{ name: 'display', value: 'flex' }],
      unknown: ['nope'],
    }
    const fake = fakeCdp(() => evaluated(page))
    const snapshotter = createSnapshotter(fake.cdp)
    expect(await snapshotter.styles(5, ['display', 'nope'])).toEqual(page)
    expect(await snapshotter.styles(5, null)).toEqual(page)
    const expressions = fake.calls.filter((call) => call.method === 'Runtime.evaluate').map((call) => String(call.params?.expression))
    expect(expressions[0]?.endsWith('("styles", {"id":5,"properties":["display","nope"]})')).toBe(true)
    expect(expressions[1]?.endsWith('("styles", {"id":5,"properties":null})')).toBe(true)
  })

  test('styles maps an element that is gone and rejects malformed results', async () => {
    const detail = 'Element 5 is no longer on the page. Take a new snapshot.'
    const gone = fakeCdp(() => evaluated({ ok: false, reason: 'gone', detail }))
    expect(await createSnapshotter(gone.cdp).styles(5, null)).toEqual({ ok: false, reason: 'gone', detail })
    const bad: unknown[] = [
      { ok: true },
      { ok: true, tag: 'a', role: 'link', name: '', box: { x: 1, y: 2, width: 3 }, values: [], unknown: [] },
      { ok: true, tag: 'a', role: 'link', name: '', box: { x: 1, y: 2, width: 3, height: 4 }, values: [{ name: 'x' }], unknown: [] },
      { ok: false, reason: 'hidden', detail: 'x' },
      'nope',
    ]
    for (const value of bad) {
      const fake = fakeCdp(() => evaluated(value))
      await expect(createSnapshotter(fake.cdp).styles(1, null)).rejects.toThrow('unexpected styles result')
    }
  })

  test('elementObject asks for the element as an object in the same world and returns its object id', async () => {
    const fake = fakeCdp(() => ({ result: { type: 'object', subtype: 'node', objectId: 'iso-7', className: 'HTMLDivElement' } }))
    const snapshotter = createSnapshotter(fake.cdp)
    expect(await snapshotter.elementObject(7)).toEqual({ ok: true, objectId: 'iso-7' })
    const [evaluation] = fake.calls.filter((call) => call.method === 'Runtime.evaluate')
    expect(evaluation?.params?.returnByValue).toBe(false)
    expect(evaluation?.params?.contextId).toBe(101)
    expect(String(evaluation?.params?.expression).endsWith('("element", {"id":7})')).toBe(true)
    expect(fake.calls.filter((call) => call.method === 'Runtime.evaluate')).toHaveLength(1)
  })

  test('elementObject explains why there is no element', async () => {
    const detail = 'No element has this id. Take a new snapshot to get current ids.'
    const unknown = fakeCdp((call) =>
      call.params?.returnByValue === false
        ? { result: { type: 'object', subtype: 'null', value: null } }
        : evaluated({ ok: false, reason: 'unknown_id', detail }),
    )
    expect(await createSnapshotter(unknown.cdp).elementObject(99)).toEqual({ ok: false, reason: 'unknown_id', detail })
    const raced = fakeCdp((call) =>
      call.params?.returnByValue === false ? { result: { type: 'object', subtype: 'null', value: null } } : evaluated({ ok: true }),
    )
    expect(await createSnapshotter(raced.cdp).elementObject(3)).toEqual({
      ok: false,
      reason: 'gone',
      detail: 'Element 3 is no longer on the page. Take a new snapshot.',
    })
  })
})

const PICK_VALUE = {
  ref: '4',
  url: 'https://example.com/',
  title: 'Example',
  tag: 'button',
  label: 'button.buy',
  selector: 'main > button.buy',
  sensitive: false,
  truncated: false,
  role: 'button',
  name: 'Buy',
  text: 'Buy',
  styles: { display: 'block', bad: 3 },
  html: '<button class="buy">Buy</button>',
  rect: { x: 1, y: 2, width: 3, height: 4, viewportWidth: 800, viewportHeight: 600, scrollX: 0, scrollY: 40, devicePixelRatio: 2 },
}

function fakeNodeCdp(handlers: { onCall?: (call: Call) => unknown; onResolve?: (call: Call, index: number) => unknown } = {}) {
  const calls: Call[] = []
  let worlds = 0
  let resolves = 0
  const cdp: CdpSend = async (method, params) => {
    calls.push({ method, params })
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-1' } } }
    if (method === 'Page.createIsolatedWorld') {
      worlds += 1
      return { executionContextId: 100 + worlds }
    }
    if (method === 'DOM.resolveNode') {
      const index = resolves
      resolves += 1
      const outcome = handlers.onResolve ? handlers.onResolve({ method, params }, index) : { object: { objectId: `obj-${index}` } }
      if (outcome instanceof Error) throw outcome
      return outcome
    }
    if (method === 'Runtime.callFunctionOn') return handlers.onCall ? handlers.onCall({ method, params }) : evaluated(PICK_VALUE)
    if (method === 'Runtime.releaseObject') return {}
    if (method === 'Runtime.evaluate') return evaluated({ ok: true, alive: [4] })
    throw new Error(`unexpected ${method}`)
  }
  return { cdp, calls, worlds: () => worlds }
}

describe('createSnapshotter: picking', () => {
  test('resolves the node into the snapshot world, runs the pick op on it and releases the object', async () => {
    const fake = fakeNodeCdp()
    const picked = await createSnapshotter(fake.cdp).pick(55)
    expect(methods(fake.calls)).toEqual([
      'Page.getFrameTree',
      'Page.createIsolatedWorld',
      'DOM.resolveNode',
      'Runtime.callFunctionOn',
      'Runtime.releaseObject',
    ])
    expect(fake.calls[2]?.params).toEqual({ backendNodeId: 55, executionContextId: 101 })
    const call = fake.calls[3]?.params
    expect(call?.objectId).toBe('obj-0')
    expect(call?.returnByValue).toBe(true)
    expect(String(call?.functionDeclaration).startsWith('function () { return (function pageProgram')).toBe(true)
    expect(String(call?.functionDeclaration).endsWith('("pick", {}, this) }')).toBe(true)
    expect(fake.calls[4]?.params).toEqual({ objectId: 'obj-0' })
    expect(picked).toMatchObject({ ref: '4', tag: 'button', label: 'button.buy', role: 'button', styles: { display: 'block' } })
    expect(picked.rect).toEqual(PICK_VALUE.rect)
  })

  test('registers in the world later snapshots and marks use', async () => {
    const fake = fakeNodeCdp()
    const snapshotter = createSnapshotter(fake.cdp)
    await snapshotter.pick(1)
    await snapshotter.marks([4])
    expect(fake.worlds()).toBe(1)
    const evaluation = fake.calls.find((call) => call.method === 'Runtime.evaluate')
    expect(evaluation?.params?.contextId).toBe(101)
    expect(String(evaluation?.params?.expression).endsWith('("marks", {"ids":[4]})')).toBe(true)
  })

  test('drops everything but the identity of a sensitive pick', async () => {
    const fake = fakeNodeCdp({
      onCall: () =>
        evaluated({
          ...PICK_VALUE,
          sensitive: true,
          html: '<input value="secret">',
          text: 'secret',
        }),
    })
    const picked = await createSnapshotter(fake.cdp).pick(1)
    expect(picked).toEqual({
      ref: '4',
      url: 'https://example.com/',
      title: 'Example',
      tag: 'button',
      label: 'button.buy',
      selector: 'main > button.buy',
      sensitive: true,
      truncated: false,
    })
  })

  test('recreates the world and retries once when the execution context is gone', async () => {
    const fake = fakeNodeCdp({
      onResolve: (_call, index) => (index === 0 ? new Error('Cannot find context with specified id') : { object: { objectId: 'obj-1' } }),
    })
    const picked = await createSnapshotter(fake.cdp).pick(1)
    expect(picked.ref).toBe('4')
    expect(fake.worlds()).toBe(2)
    expect(fake.calls.filter((call) => call.method === 'DOM.resolveNode').map((call) => call.params?.executionContextId)).toEqual([101, 102])
  })

  test('reports a node that cannot be resolved and malformed results', async () => {
    const missing = fakeNodeCdp({ onResolve: () => new Error('No node with given id found') })
    await expect(createSnapshotter(missing.cdp).pick(1)).rejects.toThrow('No node with given id found')
    const noObject = fakeNodeCdp({ onResolve: () => ({}) })
    await expect(createSnapshotter(noObject.cdp).pick(1)).rejects.toThrow('unexpected node resolution')
    const malformed = fakeNodeCdp({ onCall: () => evaluated({ ref: 4 }) })
    await expect(createSnapshotter(malformed.cdp).pick(1)).rejects.toThrow('unexpected pick result')
    expect(malformed.calls.at(-1)?.method).toBe('Runtime.releaseObject')
  })

  test('reads React info in the main world, without an execution context', async () => {
    const fake = fakeNodeCdp({ onCall: () => evaluated({ components: ['Buy', '', 'Page'], props: { size: 'lg' }, truncated: true }) })
    const info = await createSnapshotter(fake.cdp).reactInfo(8)
    expect(info).toEqual({ react: { components: ['Buy', 'Page'], props: { size: 'lg' } }, truncated: true })
    expect(fake.calls[0]?.method).toBe('DOM.resolveNode')
    expect(fake.calls[0]?.params).toEqual({ backendNodeId: 8 })
    expect(String(fake.calls[1]?.params?.functionDeclaration).startsWith('function reactProgram')).toBe(true)
    expect(fake.worlds()).toBe(0)
  })

  test('has no React info for a page without React, and omits absent props', async () => {
    const none = fakeNodeCdp({ onCall: () => evaluated(null) })
    expect(await createSnapshotter(none.cdp).reactInfo(8)).toBeNull()
    const noProps = fakeNodeCdp({ onCall: () => evaluated({ components: ['Buy'], props: null, truncated: false }) })
    expect(await createSnapshotter(noProps.cdp).reactInfo(8)).toEqual({ react: { components: ['Buy'] }, truncated: false })
    const bad = fakeNodeCdp({ onCall: () => evaluated('nope') })
    await expect(createSnapshotter(bad.cdp).reactInfo(8)).rejects.toThrow('unexpected react result')
  })

  test('marks answers the ids still alive and rejects a malformed answer', async () => {
    const fake = fakeNodeCdp()
    expect(await createSnapshotter(fake.cdp).marks([4, 5])).toEqual([4])
    const bad = fakeNodeCdp()
    const broken = createSnapshotter(async (method, params) => (method === 'Runtime.evaluate' ? evaluated({ alive: ['x'] }) : bad.cdp(method, params)))
    await expect(broken.marks([1])).rejects.toThrow('unexpected marks result')
  })

  test('hides and shows the marks through the page program', async () => {
    const fake = fakeNodeCdp()
    const snapshotter = createSnapshotter(fake.cdp)
    await snapshotter.setMarksHidden(true)
    await snapshotter.setMarksHidden(false)
    const expressions = fake.calls.filter((call) => call.method === 'Runtime.evaluate').map((call) => String(call.params?.expression))
    expect(expressions[0]?.endsWith('("marksHidden", {"hidden":true})')).toBe(true)
    expect(expressions[1]?.endsWith('("marksHidden", {"hidden":false})')).toBe(true)
  })

  test('waits for two animation frames in the snapshot world', async () => {
    const fake = fakeNodeCdp()
    await createSnapshotter(fake.cdp).waitForPaint()
    const evaluation = fake.calls.find((call) => call.method === 'Runtime.evaluate')
    expect(evaluation?.params).toMatchObject({ contextId: 101, awaitPromise: true, returnByValue: true })
    expect(String(evaluation?.params?.expression).match(/requestAnimationFrame/g)).toHaveLength(2)
  })
})
