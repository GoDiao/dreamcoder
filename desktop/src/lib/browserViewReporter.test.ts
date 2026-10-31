import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const shellMocks = vi.hoisted(() => ({
  registerBrowserView: vi.fn(),
  updateBrowserView: vi.fn(),
  unregisterBrowserView: vi.fn(),
}))

vi.mock('./shell', () => shellMocks)

import { registerGuestView, reportViewState, unregisterGuestView } from './browserViewReporter'
import { useTabStore } from '../stores/tabStore'
import { useWorkspacePanelStore, type WorkspaceTab } from '../stores/workspacePanelStore'

const browserTab = (id: string): WorkspaceTab => ({ id, kind: 'browser', url: '', title: '' })

function setPanel(sessionId: string, activeTabId: string | null, tabIds: string[]) {
  useWorkspacePanelStore.setState((state) => ({
    panelBySession: {
      ...state.panelBySession,
      [sessionId]: { isOpen: true, expanded: false, tabs: tabIds.map(browserTab), activeTabId, recentFiles: [] },
    },
  }))
}

function setForeground(sessionId: string | null, type: 'session' | 'scheduled' = 'session') {
  useTabStore.setState({
    tabs: sessionId ? [{ sessionId, title: 'T', type, status: 'idle' }] : [],
    activeTabId: sessionId,
  })
}

async function register(sessionId: string, tabId: string, shown: { value: boolean }) {
  registerGuestView(sessionId, tabId, 5, () => shown.value)
  await vi.waitFor(() => expect(shellMocks.updateBrowserView).toHaveBeenCalled())
}

const registered: string[] = []

beforeEach(() => {
  shellMocks.registerBrowserView.mockResolvedValue(undefined)
  shellMocks.updateBrowserView.mockResolvedValue(undefined)
  shellMocks.unregisterBrowserView.mockResolvedValue(undefined)
  setPanel('s', 'a', ['a', 'b'])
  setForeground('s')
})

afterEach(() => {
  for (const tabId of registered.splice(0)) unregisterGuestView(tabId)
  useWorkspacePanelStore.setState({ panelBySession: {} })
  useTabStore.setState({ tabs: [], activeTabId: null })
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('browser view reporter', () => {
  it('registers the view and then sends its first state', async () => {
    const shown = { value: true }
    registered.push('a')
    await register('s', 'a', shown)

    expect(shellMocks.registerBrowserView).toHaveBeenCalledWith({ sessionId: 's', tabId: 'a', webContentsId: 5 })
    expect(shellMocks.updateBrowserView).toHaveBeenCalledWith({ tabId: 'a', shown: true, active: true, foreground: true })
    expect(shellMocks.registerBrowserView.mock.invocationCallOrder[0]).toBeLessThan(shellMocks.updateBrowserView.mock.invocationCallOrder[0]!)
  })

  it('sends nothing before the main process has accepted the registration', async () => {
    let accept: () => void = () => {}
    shellMocks.registerBrowserView.mockReturnValue(new Promise<void>((resolve) => { accept = resolve }))
    const shown = { value: true }
    registered.push('a')
    registerGuestView('s', 'a', 5, () => shown.value)

    reportViewState('a')
    expect(shellMocks.updateBrowserView).not.toHaveBeenCalled()

    accept()
    await vi.waitFor(() => expect(shellMocks.updateBrowserView).toHaveBeenCalledOnce())
  })

  it('sends only when the state changed', async () => {
    const shown = { value: false }
    registered.push('a')
    await register('s', 'a', shown)
    reportViewState('a')
    reportViewState('a')
    expect(shellMocks.updateBrowserView).toHaveBeenCalledOnce()

    shown.value = true
    reportViewState('a')
    reportViewState('a')
    expect(shellMocks.updateBrowserView).toHaveBeenCalledTimes(2)
    expect(shellMocks.updateBrowserView).toHaveBeenLastCalledWith({ tabId: 'a', shown: true, active: true, foreground: true })
  })

  it('follows the active panel tab of the session', async () => {
    registered.push('a', 'b')
    await register('s', 'a', { value: true })
    registerGuestView('s', 'b', 6, () => false)
    await vi.waitFor(() => expect(shellMocks.updateBrowserView).toHaveBeenCalledWith({ tabId: 'b', shown: false, active: false, foreground: true }))
    shellMocks.updateBrowserView.mockClear()

    useWorkspacePanelStore.getState().activateTab('s', 'b')

    expect(shellMocks.updateBrowserView).toHaveBeenCalledTimes(2)
    expect(shellMocks.updateBrowserView).toHaveBeenCalledWith({ tabId: 'a', shown: true, active: false, foreground: true })
    expect(shellMocks.updateBrowserView).toHaveBeenCalledWith({ tabId: 'b', shown: false, active: true, foreground: true })
  })

  it('is not active when another kind of panel tab is selected', async () => {
    registered.push('a')
    await register('s', 'a', { value: true })
    setPanel('s', 'files', ['a', 'files'])

    expect(shellMocks.updateBrowserView).toHaveBeenLastCalledWith({ tabId: 'a', shown: true, active: false, foreground: true })
  })

  it('follows the session whose chat is displayed', async () => {
    registered.push('a')
    await register('s', 'a', { value: true })

    setForeground('other')
    expect(shellMocks.updateBrowserView).toHaveBeenLastCalledWith({ tabId: 'a', shown: true, active: true, foreground: false })

    setForeground('s', 'scheduled')
    expect(shellMocks.updateBrowserView).toHaveBeenCalledTimes(2)

    setForeground('s')
    expect(shellMocks.updateBrowserView).toHaveBeenLastCalledWith({ tabId: 'a', shown: true, active: true, foreground: true })
    expect(shellMocks.updateBrowserView).toHaveBeenCalledTimes(3)
  })

  it('does not resend for store changes that leave the state unchanged', async () => {
    registered.push('a')
    await register('s', 'a', { value: true })

    useWorkspacePanelStore.getState().patchTab('s', 'a', { url: 'https://example.com/' })
    useWorkspacePanelStore.getState().patchTab('s', 'b', { url: 'https://b.test/' })

    expect(shellMocks.updateBrowserView).toHaveBeenCalledOnce()
  })

  it('stops reporting once a view is unregistered and tells the main process', async () => {
    const shown = { value: true }
    await register('s', 'a', shown)
    unregisterGuestView('a')
    shellMocks.updateBrowserView.mockClear()

    shown.value = false
    reportViewState('a')
    useWorkspacePanelStore.getState().activateTab('s', 'b')

    expect(shellMocks.unregisterBrowserView).toHaveBeenCalledWith({ tabId: 'a' })
    expect(shellMocks.updateBrowserView).not.toHaveBeenCalled()
  })

  it('does not report or unregister a tab that was never registered', () => {
    reportViewState('ghost')
    unregisterGuestView('ghost')

    expect(shellMocks.updateBrowserView).not.toHaveBeenCalled()
    expect(shellMocks.unregisterBrowserView).not.toHaveBeenCalled()
  })

  it('drops a view the main process refused and logs why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    shellMocks.registerBrowserView.mockRejectedValue(new Error('not a guest'))
    registerGuestView('s', 'a', 5, () => true)
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[browser] failed to register view', 'a', expect.any(Error)))

    reportViewState('a')
    unregisterGuestView('a')

    expect(shellMocks.updateBrowserView).not.toHaveBeenCalled()
    expect(shellMocks.unregisterBrowserView).not.toHaveBeenCalled()
  })

  it('retries after a failed update on the next report', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    shellMocks.updateBrowserView.mockRejectedValueOnce(new Error('unknown tab'))
    registered.push('a')
    registerGuestView('s', 'a', 5, () => true)
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[browser] failed to report view state', 'a', expect.any(Error)))

    reportViewState('a')

    expect(shellMocks.updateBrowserView).toHaveBeenCalledTimes(2)
  })
})
