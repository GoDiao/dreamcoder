import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openBrowserUrl: vi.fn(),
  isBrowserGuestShown: vi.fn(),
  finishBrowserOpenTab: vi.fn(),
  finishBrowserActivate: vi.fn(),
}))

vi.mock('./browserGuests', () => ({
  openBrowserUrl: mocks.openBrowserUrl,
  isBrowserGuestShown: mocks.isBrowserGuestShown,
  closeBrowser: vi.fn(),
  submitBrowserInput: vi.fn(),
}))

vi.mock('./shell', () => ({
  finishBrowserOpenTab: mocks.finishBrowserOpenTab,
  finishBrowserActivate: mocks.finishBrowserActivate,
}))

import { handleActivateRequest, handleOpenTabRequest } from './browserControlRequests'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'

function panelOf(sessionId: string) {
  const panel = useWorkspacePanelStore.getState().panelBySession[sessionId]
  if (!panel) throw new Error(`no panel for ${sessionId}`)
  return panel
}

beforeEach(() => {
  mocks.finishBrowserOpenTab.mockResolvedValue(undefined)
  mocks.finishBrowserActivate.mockResolvedValue(undefined)
  mocks.isBrowserGuestShown.mockReturnValue(false)
  useSessionStore.setState({ sessions: [{ id: 's' } as never] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  useSessionStore.setState({ sessions: [] })
  useTabStore.setState({ tabs: [], activeTabId: null })
  useWorkspacePanelStore.setState({ panelBySession: {} })
  localStorage.clear()
})

describe('browser open-tab request', () => {
  it('opens the panel on a new active browser tab, loads the address and replies with the tab id', async () => {
    await handleOpenTabRequest({ requestId: 'r1', sessionId: 's', url: 'http://localhost:3000/' })

    const panel = panelOf('s')
    const tab = panel.tabs[0]
    expect(panel.isOpen).toBe(true)
    expect(panel.activeTabId).toBe(tab?.id)
    expect(tab).toMatchObject({ kind: 'browser', url: 'http://localhost:3000/' })
    expect(mocks.openBrowserUrl).toHaveBeenCalledWith('s', tab?.id, 'http://localhost:3000/')
    expect(mocks.finishBrowserOpenTab).toHaveBeenCalledWith({ requestId: 'r1', tabId: tab?.id })
  })

  it('opens an empty tab without loading anything when there is no address', async () => {
    await handleOpenTabRequest({ requestId: 'r1', sessionId: 's', url: null })

    const tab = panelOf('s').tabs[0]
    expect(tab).toMatchObject({ kind: 'browser', url: '' })
    expect(mocks.openBrowserUrl).not.toHaveBeenCalled()
    expect(mocks.finishBrowserOpenTab).toHaveBeenCalledWith({ requestId: 'r1', tabId: tab?.id })
  })

  it('adds a tab next to the existing ones', async () => {
    await handleOpenTabRequest({ requestId: 'r1', sessionId: 's', url: 'https://a.test/' })
    await handleOpenTabRequest({ requestId: 'r2', sessionId: 's', url: 'https://b.test/' })

    const panel = panelOf('s')
    expect(panel.tabs).toHaveLength(2)
    expect(panel.activeTabId).toBe(panel.tabs[1]?.id)
  })

  it('also knows sessions that are open in the app but missing from the session list', async () => {
    useSessionStore.setState({ sessions: [] })
    useTabStore.setState({ tabs: [{ sessionId: 's', title: 'T', type: 'session', status: 'idle' }], activeTabId: 's' })

    await handleOpenTabRequest({ requestId: 'r1', sessionId: 's', url: null })

    expect(mocks.finishBrowserOpenTab).toHaveBeenCalledOnce()
  })

  it('logs a warning and replies with nothing for an unknown session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await handleOpenTabRequest({ requestId: 'r1', sessionId: 'missing', url: null })

    expect(warn).toHaveBeenCalledWith('[browser] open-tab request for an unknown session', 'missing')
    expect(useWorkspacePanelStore.getState().panelBySession.missing).toBeUndefined()
    expect(mocks.finishBrowserOpenTab).not.toHaveBeenCalled()
  })

  it('logs a warning and replies with nothing when the page cannot be created', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.openBrowserUrl.mockImplementation(() => {
      throw new Error('Browser layer is not mounted')
    })

    await handleOpenTabRequest({ requestId: 'r1', sessionId: 's', url: 'https://a.test/' })

    expect(warn).toHaveBeenCalledWith('[browser] open-tab request failed', 's', expect.any(Error))
    expect(mocks.finishBrowserOpenTab).not.toHaveBeenCalled()
  })
})

describe('browser activate request', () => {
  function seedPanel(isOpen: boolean) {
    useWorkspacePanelStore.setState({
      panelBySession: {
        s: {
          isOpen,
          expanded: false,
          activeTabId: 'files',
          recentFiles: [],
          tabs: [{ id: 'files', kind: 'files' }, { id: 'a', kind: 'browser', url: '', title: '' }],
        },
      },
    })
  }

  it('selects the tab, opens a closed panel and reports that the page is shown', async () => {
    seedPanel(false)
    mocks.isBrowserGuestShown.mockReturnValue(true)

    await handleActivateRequest({ requestId: 'r1', tabId: 'a' })

    expect(panelOf('s')).toMatchObject({ isOpen: true, activeTabId: 'a' })
    expect(mocks.finishBrowserActivate).toHaveBeenCalledWith({ requestId: 'r1', shown: true })
  })

  it('keeps an open panel open', async () => {
    seedPanel(true)
    mocks.isBrowserGuestShown.mockReturnValue(true)

    await handleActivateRequest({ requestId: 'r1', tabId: 'a' })

    expect(panelOf('s')).toMatchObject({ isOpen: true, activeTabId: 'a' })
  })

  it('waits briefly for the page to appear', async () => {
    vi.useFakeTimers()
    seedPanel(true)
    mocks.isBrowserGuestShown.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true)

    const pending = handleActivateRequest({ requestId: 'r1', tabId: 'a' })
    await vi.advanceTimersByTimeAsync(200)
    await pending

    expect(mocks.finishBrowserActivate).toHaveBeenCalledWith({ requestId: 'r1', shown: true })
  })

  it('reports not shown after about a second when the page stays hidden', async () => {
    vi.useFakeTimers()
    seedPanel(true)

    const pending = handleActivateRequest({ requestId: 'r1', tabId: 'a' })
    await vi.advanceTimersByTimeAsync(1500)
    await pending

    expect(mocks.finishBrowserActivate).toHaveBeenCalledWith({ requestId: 'r1', shown: false })
  })

  it('answers not shown for an unknown tab and changes nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    seedPanel(false)

    await handleActivateRequest({ requestId: 'r1', tabId: 'missing' })

    expect(warn).toHaveBeenCalledWith('[browser] activate request for an unknown tab', 'missing')
    expect(panelOf('s')).toMatchObject({ isOpen: false, activeTabId: 'files' })
    expect(mocks.finishBrowserActivate).toHaveBeenCalledWith({ requestId: 'r1', shown: false })
  })
})
