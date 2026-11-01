import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { SessionStateStore } from '../session/state/store.js'
import { bindGrantChannel, SessionBrowserGrants } from './grants.js'
import { BrowserHostChannel } from './hostChannel.js'
import { BrowserToolError } from './service.js'
import { FakeDesktop } from './testSupport.js'
import { BrowserTrustStore } from './trustStore.js'

const ORIGIN = 'https://example.com'

function setup(options: { timeoutMs?: number; trusted?: string[] } = {}) {
  const store = new SessionStateStore()
  const trusted = new Set(options.trusted ?? [])
  const grants = new SessionBrowserGrants({
    store,
    trust: { has: async (origin) => trusted.has(origin) },
    timeoutMs: options.timeoutMs,
    now: () => 1234,
  })
  const request = (sessionId = 's1', origin = ORIGIN, signal?: AbortSignal, action = 'Click element [1]', onceOnly?: boolean) =>
    grants.ensureOperation({ sessionId, origin, action, ...(onceOnly === undefined ? {} : { onceOnly }) }, signal)
  const pending = (sessionId = 's1') => store.peek(sessionId)?.pendingBrowserGrants ?? []
  return { store, grants, request, pending, trusted }
}

async function settled(promise: Promise<unknown>) {
  return promise.then(
    () => 'resolved' as const,
    (error: unknown) => error as BrowserToolError,
  )
}

const tick = () => Bun.sleep(0)

describe('browser grants', () => {
  let warn: ReturnType<typeof spyOn>

  beforeEach(() => {
    warn = spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warn.mockRestore()
  })

  test('a site in the permanent trust list needs no prompt', async () => {
    const { request, pending } = setup({ trusted: [ORIGIN] })
    await request()
    expect(pending()).toEqual([])
  })

  test('an untrusted site opens a pending grant in the session state', async () => {
    const { request, pending, grants } = setup()
    const result = settled(request())
    await tick()
    expect(pending()).toEqual([
      {
        requestId: expect.any(String),
        origin: ORIGIN,
        action: 'Click element [1]',
        requestedAt: 1234,
        allowOnce: true,
        allowSession: true,
      },
    ])
    grants.cancelSession('s1')
    await result
  })

  test('deny rejects with not_granted and clears the pending grant', async () => {
    const { request, pending, grants } = setup()
    const result = settled(request())
    await tick()
    expect(grants.reply(pending()[0]!.requestId, 'deny')).toBe(true)
    const error = await result
    expect(error).toBeInstanceOf(BrowserToolError)
    expect((error as BrowserToolError).code).toBe('not_granted')
    expect(pending()).toEqual([])
  })

  test('once lets this call through and the next call prompts again', async () => {
    const { request, pending, grants } = setup()
    const first = settled(request())
    await tick()
    grants.reply(pending()[0]!.requestId, 'once')
    expect(await first).toBe('resolved')
    const second = settled(request())
    await tick()
    expect(pending()).toHaveLength(1)
    grants.cancelSession('s1')
    await second
  })

  test('session trust skips later prompts for that origin in that session only', async () => {
    const { request, pending, grants } = setup()
    const first = settled(request())
    await tick()
    grants.reply(pending()[0]!.requestId, 'session')
    expect(await first).toBe('resolved')

    await request()
    expect(pending()).toEqual([])

    const otherOrigin = settled(request('s1', 'https://other.example'))
    const otherSession = settled(request('s2'))
    await tick()
    expect(pending('s1')).toHaveLength(1)
    expect(pending('s2')).toHaveLength(1)
    grants.cancelSession('s1')
    grants.cancelSession('s2')
    await Promise.all([otherOrigin, otherSession])
  })

  test('concurrent requests for one origin and one action share one prompt', async () => {
    const { request, pending, grants } = setup()
    const first = settled(request('s1', ORIGIN, undefined, 'Click element [1]'))
    const second = settled(request('s1', ORIGIN, undefined, 'Click element [1]'))
    await tick()
    expect(pending()).toHaveLength(1)
    grants.reply(pending()[0]!.requestId, 'once')
    expect(await Promise.all([first, second])).toEqual(['resolved', 'resolved'])
    expect(pending()).toEqual([])
  })

  test('two actions on one origin open two prompts and a reply settles only its own', async () => {
    const { request, pending, grants } = setup()
    const click = settled(request('s1', ORIGIN, undefined, 'Click element [1]'))
    const press = settled(request('s1', ORIGIN, undefined, 'Press Enter'))
    await tick()
    expect(pending().map((grant) => grant.action)).toEqual(['Click element [1]', 'Press Enter'])
    const clickGrant = pending().find((grant) => grant.action === 'Click element [1]')!
    grants.reply(clickGrant.requestId, 'once')
    expect(await click).toBe('resolved')
    expect(pending().map((grant) => grant.action)).toEqual(['Press Enter'])
    grants.cancelSession('s1')
    expect(((await press) as BrowserToolError).code).toBe('cancelled')
  })

  test('a once-only request and a normal request for the same action are separate prompts', async () => {
    const { request, pending, grants } = setup()
    const normal = settled(request('s1', ORIGIN, undefined, 'Click element [1]'))
    const onceOnly = settled(request('s1', ORIGIN, undefined, 'Click element [1]', true))
    await tick()
    expect(pending().map((grant) => grant.allowSession)).toEqual([true, false])
    grants.cancelSession('s1')
    await Promise.all([normal, onceOnly])
  })

  test('a once-only request offers a single approval and ignores trusting the site', async () => {
    const { request, pending, grants } = setup()
    const result = settled(request('s1', ORIGIN, undefined, 'Click element [1]', true))
    await tick()
    expect(pending()[0]).toMatchObject({ allowOnce: true, allowSession: false })
    expect(grants.reply(pending()[0]!.requestId, 'session')).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(pending()).toHaveLength(1)
    grants.reply(pending()[0]!.requestId, 'once')
    expect(await result).toBe('resolved')
    const again = settled(request('s1', ORIGIN, undefined, 'Click element [1]', true))
    await tick()
    expect(pending()).toHaveLength(1)
    grants.cancelSession('s1')
    await again
  })

  test('a once-only request still offers the single approval in Bypass mode', async () => {
    const { store, request, pending, grants } = setup()
    store.apply('s1', { type: 'permission_effective_reported', mode: 'bypassPermissions' })
    const result = settled(request('s1', ORIGIN, undefined, 'Click element [1]', true))
    await tick()
    expect(pending()[0]).toMatchObject({ allowOnce: true, allowSession: false })
    grants.reply(pending()[0]!.requestId, 'once')
    expect(await result).toBe('resolved')
  })

  test('a once-only request is skipped for a trusted origin', async () => {
    const { request, pending } = setup({ trusted: [ORIGIN] })
    await request('s1', ORIGIN, undefined, 'Click element [1]', true)
    expect(pending()).toEqual([])
  })

  test('replies for an unknown request are ignored', async () => {
    const { request, pending, grants } = setup()
    const result = settled(request())
    await tick()
    expect(grants.reply('nope', 'session')).toBe(false)
    expect(pending()).toHaveLength(1)
    grants.cancelSession('s1')
    await result
  })

  test('nobody answering within the timeout denies and clears the prompt', async () => {
    const { request, pending } = setup({ timeoutMs: 20 })
    const error = (await settled(request())) as BrowserToolError
    expect(error.code).toBe('not_granted')
    expect(error.message).toContain('No client answered')
    expect(pending()).toEqual([])
  })

  test('an abort removes the pending grant and rejects the call', async () => {
    const { request, pending } = setup()
    const controller = new AbortController()
    const result = settled(request('s1', ORIGIN, controller.signal))
    await tick()
    controller.abort()
    const error = (await result) as BrowserToolError
    expect(error.code).toBe('cancelled')
    expect(pending()).toEqual([])
  })

  test('an abort of one caller keeps the prompt for the others sharing it', async () => {
    const { request, pending, grants } = setup()
    const controller = new AbortController()
    const aborted = settled(request('s1', ORIGIN, controller.signal))
    const kept = settled(request())
    await tick()
    controller.abort()
    expect(((await aborted) as BrowserToolError).code).toBe('cancelled')
    expect(pending()).toHaveLength(1)
    grants.reply(pending()[0]!.requestId, 'once')
    expect(await kept).toBe('resolved')
  })

  test('a signal that is already aborted never opens a prompt', async () => {
    const { request, pending } = setup()
    const controller = new AbortController()
    controller.abort()
    const error = (await settled(request('s1', ORIGIN, controller.signal))) as BrowserToolError
    expect(error.code).toBe('cancelled')
    expect(pending()).toEqual([])
  })

  test('cancelling a session rejects its pending grants and leaves other sessions alone', async () => {
    const { request, pending, grants } = setup()
    const mine = settled(request('s1'))
    const other = settled(request('s2'))
    await tick()
    grants.cancelSession('s1')
    expect(((await mine) as BrowserToolError).code).toBe('cancelled')
    expect(pending('s1')).toEqual([])
    expect(pending('s2')).toHaveLength(1)
    grants.cancelSession('s2')
    await other
  })

  test('cancelling keeps session trust and ending the session forgets it', async () => {
    const { request, pending, grants } = setup()
    const first = settled(request())
    await tick()
    grants.reply(pending()[0]!.requestId, 'session')
    await first

    grants.cancelSession('s1')
    await request()
    expect(pending()).toEqual([])

    grants.endSession('s1')
    const again = settled(request())
    await tick()
    expect(pending()).toHaveLength(1)
    grants.cancelSession('s1')
    await again
  })

  test('in Bypass mode the prompt offers no one-time approval and trusting the site is the only way through', async () => {
    const { store, request, pending, grants } = setup()
    store.apply('s1', { type: 'permission_effective_reported', mode: 'bypassPermissions' })
    const first = settled(request())
    await tick()
    expect(pending()[0]).toMatchObject({ allowOnce: false, allowSession: true })
    expect(grants.reply(pending()[0]!.requestId, 'once')).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(pending()).toHaveLength(1)
    grants.reply(pending()[0]!.requestId, 'session')
    expect(await first).toBe('resolved')

    await request()
    expect(pending()).toEqual([])
  })

  test('in Bypass mode each new origin still prompts once', async () => {
    const { store, request, pending, grants } = setup()
    store.apply('s1', { type: 'permission_effective_reported', mode: 'bypassPermissions' })
    const first = settled(request('s1', ORIGIN))
    await tick()
    grants.reply(pending()[0]!.requestId, 'session')
    await first
    const second = settled(request('s1', 'https://other.example'))
    await tick()
    expect(pending()).toHaveLength(1)
    expect(pending()[0]?.origin).toBe('https://other.example')
    grants.cancelSession('s1')
    await second
  })
})

describe('browser grants over the authenticated channel', () => {
  function connected(trustFile: string) {
    const channel = new BrowserHostChannel()
    const desktop = new FakeDesktop(channel)
    const { grants, request, pending } = setup()
    const trust = new BrowserTrustStore({ getFilePath: () => trustFile })
    const unbind = bindGrantChannel(channel, grants, trust)
    return { desktop, grants, request, pending, unbind }
  }

  test('a grant reply from the desktop resolves the pending call', async () => {
    const { desktop, request, pending, unbind } = connected('/nonexistent/trust.json')
    const result = settled(request())
    await tick()
    desktop.sendGrantReply(pending()[0]!.requestId, 'session')
    expect(await result).toBe('resolved')
    unbind()
  })

  test('a reply for a request nobody asked for changes nothing', async () => {
    const { desktop, request, pending, grants, unbind } = connected('/nonexistent/trust.json')
    const result = settled(request())
    await tick()
    desktop.sendGrantReply('unknown', 'session')
    expect(pending()).toHaveLength(1)
    grants.cancelSession('s1')
    await result
    unbind()
  })

  test('after unbinding, replies and trust requests are no longer served', async () => {
    const { desktop, request, pending, grants, unbind } = connected('/nonexistent/trust.json')
    const result = settled(request())
    await tick()
    unbind()
    desktop.sendGrantReply(pending()[0]!.requestId, 'session')
    expect(pending()).toHaveLength(1)
    desktop.sendTrust('t1', 'list')
    await tick()
    expect(desktop.trustResults[0]).toMatchObject({ id: 't1', ok: false, error: { code: 'unavailable' } })
    grants.cancelSession('s1')
    await result
  })
})
