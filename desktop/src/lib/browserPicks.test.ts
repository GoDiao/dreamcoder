import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const shellMocks = vi.hoisted(() => ({
  setBrowserPickMode: vi.fn(),
}))

vi.mock('./shell', () => ({
  setBrowserPickMode: shellMocks.setBrowserPickMode,
}))

import { toast } from 'sonner'
import { useBrowserStore } from '../stores/browserStore'
import { useWorkspaceChatContextStore } from '../stores/workspaceChatContextStore'
import {
  handleBrowserPickDone,
  handleBrowserPickStarted,
  handleBrowserPickState,
  stopBrowserPick,
  toggleBrowserPick,
} from './browserPicks'

const VALUE = {
  ref: '12',
  url: 'https://example.com/a',
  title: 'Example',
  tag: 'button',
  label: 'button.buy',
  selector: 'main > button.buy',
  sensitive: false,
  truncated: false,
  role: 'button',
  name: 'Buy',
  text: 'Buy now',
  html: '<button class="buy">Buy now</button>',
  screenshot: { data: 'QUJD', mimeType: 'image/webp' },
}

function references() {
  return useWorkspaceChatContextStore.getState().referencesBySession.s ?? []
}

describe('browser picks', () => {
  beforeEach(() => {
    shellMocks.setBrowserPickMode.mockResolvedValue(undefined)
  })

  afterEach(() => {
    useBrowserStore.setState(useBrowserStore.getInitialState(), true)
    useWorkspaceChatContextStore.setState(useWorkspaceChatContextStore.getInitialState(), true)
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('pick mode', () => {
    it('turns pick mode on for a tab that is not picking, and off for one that is', async () => {
      await toggleBrowserPick('t')
      expect(shellMocks.setBrowserPickMode).toHaveBeenLastCalledWith({ tabId: 't', active: true })
      handleBrowserPickState({ tabId: 't', active: true })
      await toggleBrowserPick('t')
      expect(shellMocks.setBrowserPickMode).toHaveBeenLastCalledWith({ tabId: 't', active: false })
    })

    it('does not change what the toolbar shows until the main process reports it', async () => {
      await toggleBrowserPick('t')
      expect(useBrowserStore.getState().pickActiveByTab.t).toBeUndefined()
      handleBrowserPickState({ tabId: 't', active: true })
      expect(useBrowserStore.getState().pickActiveByTab.t).toBe(true)
      handleBrowserPickState({ tabId: 't', active: false })
      expect(useBrowserStore.getState().pickActiveByTab.t).toBeUndefined()
    })

    it('tells the user and logs when picking cannot start', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      shellMocks.setBrowserPickMode.mockRejectedValue(new Error('another debugger is attached'))
      await toggleBrowserPick('t')
      expect(toast.error).toHaveBeenCalledWith('Could not start picking on this page.')
      expect(warn).toHaveBeenCalled()
    })

    it('leaves pick mode only while it is on', async () => {
      await stopBrowserPick('t')
      expect(shellMocks.setBrowserPickMode).not.toHaveBeenCalled()
      handleBrowserPickState({ tabId: 't', active: true })
      await stopBrowserPick('t')
      expect(shellMocks.setBrowserPickMode).toHaveBeenCalledWith({ tabId: 't', active: false })
    })

    it('logs a failure to leave pick mode without bothering the user', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      handleBrowserPickState({ tabId: 't', active: true })
      shellMocks.setBrowserPickMode.mockRejectedValue(new Error('gone'))
      await stopBrowserPick('t')
      expect(warn).toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('a pick', () => {
    it('shows a pending reference as soon as the click happens', () => {
      handleBrowserPickStarted({ tabId: 't', sessionId: 's', pickId: 'p1' })
      handleBrowserPickStarted({ tabId: 't', sessionId: 's', pickId: 'p2' })
      expect(references().map((reference) => reference.browser?.pendingPickId)).toEqual(['p1', 'p2'])
    })

    it('fills the pending reference where it is, with the element and its screenshot', () => {
      handleBrowserPickStarted({ tabId: 't', sessionId: 's', pickId: 'p1' })
      handleBrowserPickStarted({ tabId: 't', sessionId: 's', pickId: 'p2' })
      handleBrowserPickDone({ tabId: 't', sessionId: 's', pickId: 'p1', ok: true, generation: 3, value: VALUE })

      expect(references()).toHaveLength(2)
      const [first] = references()
      expect(first).toMatchObject({
        kind: 'browser',
        path: 'https://example.com/a',
        name: 'button.buy',
        browser: {
          tabId: 't',
          text: 'Buy now',
          element: { ref: '12', generation: 3, label: 'button.buy', stale: false, screenshot: { data: 'data:image/webp;base64,QUJD' } },
        },
      })
      expect(first?.browser?.pendingPickId).toBeUndefined()
      expect(references()[1]?.browser?.pendingPickId).toBe('p2')
    })

    it('keeps only the identity of a sensitive element', () => {
      handleBrowserPickStarted({ tabId: 't', sessionId: 's', pickId: 'p1' })
      handleBrowserPickDone({
        tabId: 't',
        sessionId: 's',
        pickId: 'p1',
        ok: true,
        generation: 0,
        value: { ...VALUE, sensitive: true },
      })
      expect(references()[0]?.browser?.element).toMatchObject({ sensitive: true, role: '', name: '' })
      expect(references()[0]?.browser?.element?.screenshot).toBeUndefined()
      expect(references()[0]?.browser?.text).toBe('')
    })

    it('removes the placeholder silently when the pick was cancelled', () => {
      handleBrowserPickStarted({ tabId: 't', sessionId: 's', pickId: 'p1' })
      handleBrowserPickDone({ tabId: 't', sessionId: 's', pickId: 'p1', ok: false, cancelled: true })
      expect(references()).toEqual([])
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('removes the placeholder, logs and tells the user when the pick failed', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      handleBrowserPickStarted({ tabId: 't', sessionId: 's', pickId: 'p1' })
      handleBrowserPickDone({ tabId: 't', sessionId: 's', pickId: 'p1', ok: false, cancelled: false, error: 'No node with given id' })
      expect(references()).toEqual([])
      expect(toast.error).toHaveBeenCalledWith('Could not pick that element.')
      expect(warn.mock.calls.flat()).toContain('No node with given id')
    })

    it('treats a description that cannot be used as a failure instead of adding junk', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      handleBrowserPickStarted({ tabId: 't', sessionId: 's', pickId: 'p1' })
      handleBrowserPickDone({ tabId: 't', sessionId: 's', pickId: 'p1', ok: true, generation: 0, value: { ...VALUE, selector: '' } })
      expect(references()).toEqual([])
      expect(toast.error).toHaveBeenCalledWith('Could not pick that element.')
      expect(warn).toHaveBeenCalled()
    })

    it('does not bring back a reference the user already removed', () => {
      handleBrowserPickStarted({ tabId: 't', sessionId: 's', pickId: 'p1' })
      useWorkspaceChatContextStore.getState().removeReference('s', 'browser-pick:p1')
      handleBrowserPickDone({ tabId: 't', sessionId: 's', pickId: 'p1', ok: true, generation: 0, value: VALUE })
      expect(references()).toEqual([])
    })

    it('replaces an earlier pick of the same element in the same document', () => {
      handleBrowserPickStarted({ tabId: 't', sessionId: 's', pickId: 'p1' })
      handleBrowserPickDone({ tabId: 't', sessionId: 's', pickId: 'p1', ok: true, generation: 0, value: VALUE })
      handleBrowserPickStarted({ tabId: 't', sessionId: 's', pickId: 'p2' })
      handleBrowserPickDone({ tabId: 't', sessionId: 's', pickId: 'p2', ok: true, generation: 0, value: VALUE })
      expect(references()).toHaveLength(1)
    })
  })
})
