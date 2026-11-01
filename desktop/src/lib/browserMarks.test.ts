import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const shellMocks = vi.hoisted(() => ({
  syncBrowserMarks: vi.fn(),
}))

vi.mock('./shell', () => ({
  syncBrowserMarks: shellMocks.syncBrowserMarks,
}))

import { useWorkspaceChatContextStore, type WorkspaceChatReference } from '../stores/workspaceChatContextStore'
import { refreshBrowserMarksBeforeSend, startBrowserMarkSync } from './browserMarks'

function pick(ref: string, options: { tabId?: string; generation?: number; stale?: boolean } = {}) {
  return {
    kind: 'browser' as const,
    path: 'https://example.com/',
    name: ref,
    browser: {
      url: 'https://example.com/',
      title: '',
      tabId: options.tabId ?? 't1',
      text: '',
      truncated: false,
      element: {
        ref,
        generation: options.generation ?? 0,
        tag: 'b',
        label: 'b',
        role: '',
        name: '',
        selector: `b${ref}`,
        sensitive: false,
        stale: options.stale ?? false,
      },
    },
  }
}

function store() {
  return useWorkspaceChatContextStore.getState()
}

function staleFlags(sessionId = 's') {
  return (store().referencesBySession[sessionId] ?? []).map((reference: WorkspaceChatReference) => reference.browser?.element?.stale)
}

describe('browser marks', () => {
  let stop: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    shellMocks.syncBrowserMarks.mockImplementation(async ({ refs }: { refs: Array<{ ref: string }> }) => refs.map((request) => request.ref))
    stop = startBrowserMarkSync()
  })

  afterEach(() => {
    stop()
    useWorkspaceChatContextStore.setState(useWorkspaceChatContextStore.getInitialState(), true)
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('draws the marks of a picked element after a short pause, with the document it belongs to', async () => {
    store().addReference('s', pick('1', { generation: 2 }))
    expect(shellMocks.syncBrowserMarks).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(shellMocks.syncBrowserMarks).toHaveBeenCalledTimes(1)
    expect(shellMocks.syncBrowserMarks).toHaveBeenCalledWith({ tabId: 't1', refs: [{ ref: '1', generation: 2 }] })
  })

  it('sends one update for a burst of changes', async () => {
    store().addReference('s', pick('1'))
    await vi.advanceTimersByTimeAsync(100)
    store().addReference('s', pick('2'))
    await vi.advanceTimersByTimeAsync(100)
    store().addReference('s', pick('3'))
    await vi.advanceTimersByTimeAsync(150)
    expect(shellMocks.syncBrowserMarks).toHaveBeenCalledTimes(1)
    expect(shellMocks.syncBrowserMarks.mock.calls[0]?.[0].refs.map((request: { ref: string }) => request.ref)).toEqual(['1', '2', '3'])
  })

  it('updates each tab on its own and keeps tabs of other sessions apart', async () => {
    store().addReference('s', pick('1', { tabId: 't1' }))
    store().addReference('s', pick('2', { tabId: 't2' }))
    store().addReference('other', pick('3', { tabId: 't3' }))
    await vi.advanceTimersByTimeAsync(150)
    const calls = shellMocks.syncBrowserMarks.mock.calls.map((call) => call[0])
    expect(calls).toHaveLength(3)
    expect(calls).toContainEqual({ tabId: 't1', refs: [{ ref: '1', generation: 0 }] })
    expect(calls).toContainEqual({ tabId: 't2', refs: [{ ref: '2', generation: 0 }] })
    expect(calls).toContainEqual({ tabId: 't3', refs: [{ ref: '3', generation: 0 }] })
  })

  it('removes the mark when the chip is removed, and clears the tab when the message is sent', async () => {
    store().addReference('s', pick('1'))
    store().addReference('s', pick('2'))
    await vi.advanceTimersByTimeAsync(150)
    store().removeReference('s', store().referencesBySession.s?.[0]?.id ?? '')
    await vi.advanceTimersByTimeAsync(150)
    expect(shellMocks.syncBrowserMarks).toHaveBeenLastCalledWith({ tabId: 't1', refs: [{ ref: '2', generation: 0 }] })
    store().clearReferences('s')
    await vi.advanceTimersByTimeAsync(150)
    expect(shellMocks.syncBrowserMarks).toHaveBeenLastCalledWith({ tabId: 't1', refs: [] })
    expect(shellMocks.syncBrowserMarks).toHaveBeenCalledTimes(3)
  })

  it('does not bother the page when a session never had any marks', async () => {
    store().addReference('s', {
      kind: 'browser',
      path: 'https://example.com/',
      name: 'x',
      browser: { url: 'https://example.com/', title: '', tabId: 't1', text: 'sel', truncated: false },
    })
    store().clearReferences('s')
    await vi.advanceTimersByTimeAsync(300)
    expect(shellMocks.syncBrowserMarks).not.toHaveBeenCalled()
  })

  it('does not send the same list twice', async () => {
    store().addReference('s', pick('1'))
    await vi.advanceTimersByTimeAsync(150)
    store().addReference('s', {
      kind: 'browser',
      path: 'https://example.com/',
      name: 'x',
      browser: { url: 'https://example.com/', title: '', tabId: 't1', text: 'sel', truncated: false },
    })
    await vi.advanceTimersByTimeAsync(150)
    expect(shellMocks.syncBrowserMarks).toHaveBeenCalledTimes(1)
  })

  it('flags the elements the page no longer has as stale, and stops drawing them', async () => {
    shellMocks.syncBrowserMarks.mockResolvedValueOnce(['2'])
    store().addReference('s', pick('1'))
    store().addReference('s', pick('2'))
    await vi.advanceTimersByTimeAsync(150)
    expect(staleFlags()).toEqual([true, false])
    await vi.advanceTimersByTimeAsync(150)
    expect(shellMocks.syncBrowserMarks).toHaveBeenLastCalledWith({ tabId: 't1', refs: [{ ref: '2', generation: 0 }] })
  })

  it('leaves stale elements and pending picks out of the update', async () => {
    store().addReference('s', pick('1', { stale: true }))
    store().addReference('s', pick('2'))
    store().addReference('s', {
      id: 'browser-pick:p',
      kind: 'browser',
      path: '',
      name: '',
      browser: { url: '', title: '', tabId: 't1', text: '', truncated: false, pendingPickId: 'p' },
    })
    await vi.advanceTimersByTimeAsync(150)
    expect(shellMocks.syncBrowserMarks).toHaveBeenCalledWith({ tabId: 't1', refs: [{ ref: '2', generation: 0 }] })
  })

  it('logs a failed update, keeps the elements, and tries again on the next change', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    shellMocks.syncBrowserMarks.mockRejectedValueOnce(new Error('no browser view for tab t1'))
    store().addReference('s', pick('1'))
    await vi.advanceTimersByTimeAsync(150)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(staleFlags()).toEqual([false])
    store().addReference('s', pick('2'))
    await vi.advanceTimersByTimeAsync(150)
    expect(shellMocks.syncBrowserMarks).toHaveBeenCalledTimes(2)
  })

  it('does not run two updates of one tab at the same time', async () => {
    const releases: Array<(alive: string[]) => void> = []
    shellMocks.syncBrowserMarks.mockImplementation(() => new Promise<string[]>((resolve) => releases.push(resolve)))
    store().addReference('s', pick('1'))
    await vi.advanceTimersByTimeAsync(150)
    store().addReference('s', pick('2'))
    await vi.advanceTimersByTimeAsync(150)
    expect(releases).toHaveLength(1)
    releases[0]?.(['1'])
    await vi.advanceTimersByTimeAsync(0)
    expect(releases).toHaveLength(2)
    releases[1]?.(['1', '2'])
    await vi.advanceTimersByTimeAsync(0)
  })

  it('stops listening once stopped', async () => {
    stop()
    store().addReference('s', pick('1'))
    await vi.advanceTimersByTimeAsync(300)
    expect(shellMocks.syncBrowserMarks).not.toHaveBeenCalled()
  })

  describe('before sending', () => {
    it('asks again even though nothing changed, and flags what is gone', async () => {
      store().addReference('s', pick('1'))
      await vi.advanceTimersByTimeAsync(150)
      shellMocks.syncBrowserMarks.mockResolvedValueOnce([])
      await refreshBrowserMarksBeforeSend('s')
      expect(shellMocks.syncBrowserMarks).toHaveBeenCalledTimes(2)
      expect(staleFlags()).toEqual([true])
    })

    it('takes over a pending debounced update instead of sending it twice', async () => {
      store().addReference('s', pick('1'))
      await refreshBrowserMarksBeforeSend('s')
      await vi.advanceTimersByTimeAsync(300)
      expect(shellMocks.syncBrowserMarks).toHaveBeenCalledTimes(1)
    })

    it('does not fail when the page cannot be reached', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      store().addReference('s', pick('1'))
      shellMocks.syncBrowserMarks.mockRejectedValue(new Error('the sidecar is not connected'))
      await expect(refreshBrowserMarksBeforeSend('s')).resolves.toBeUndefined()
      expect(staleFlags()).toEqual([false])
      expect(warn).toHaveBeenCalled()
    })

    it('does nothing for a session without picked elements', async () => {
      await refreshBrowserMarksBeforeSend('s')
      expect(shellMocks.syncBrowserMarks).not.toHaveBeenCalled()
    })
  })
})
