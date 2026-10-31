import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  submitBrowserInput: vi.fn(),
  browserGoBack: vi.fn(),
  browserGoForward: vi.fn(),
  browserReload: vi.fn(),
  browserStop: vi.fn(),
  hasBrowserGuest: vi.fn(),
  openBrowserUrl: vi.fn(),
  placeBrowserGuest: vi.fn(),
  release: vi.fn(),
  reloadAllBrowsers: vi.fn(),
  clearBrowserData: vi.fn(),
  openBrowserUrlInSystem: vi.fn(),
  stopBrowserControl: vi.fn(),
  toggleBrowserPick: vi.fn(),
  stopBrowserPick: vi.fn(),
  updateUserSettings: vi.fn(),
}))

vi.mock('../../lib/browserGuests', () => ({
  submitBrowserInput: mocks.submitBrowserInput,
  browserGoBack: mocks.browserGoBack,
  browserGoForward: mocks.browserGoForward,
  browserReload: mocks.browserReload,
  browserStop: mocks.browserStop,
  hasBrowserGuest: mocks.hasBrowserGuest,
  openBrowserUrl: mocks.openBrowserUrl,
  placeBrowserGuest: mocks.placeBrowserGuest,
  reloadAllBrowsers: mocks.reloadAllBrowsers,
}))

vi.mock('../../lib/browserPicks', () => ({
  toggleBrowserPick: mocks.toggleBrowserPick,
  stopBrowserPick: mocks.stopBrowserPick,
}))

vi.mock('../../lib/shell', () => ({
  clearBrowserData: mocks.clearBrowserData,
  openBrowserUrlInSystem: mocks.openBrowserUrlInSystem,
  stopBrowserControl: mocks.stopBrowserControl,
}))

vi.mock('../../api/settings', () => ({
  settingsApi: { updateUser: mocks.updateUserSettings },
}))

import { toast } from 'sonner'
import { useBrowserStore } from '../../stores/browserStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useChatStore } from '../../stores/chatStore'
import { BrowserView } from './BrowserView'

function tab(id: string, url = '') {
  return { id, kind: 'browser' as const, url, title: '' }
}

describe('BrowserView', () => {
  const initialState = useBrowserStore.getInitialState()
  const initialSettings = useSettingsStore.getInitialState()

  beforeEach(() => {
    mocks.placeBrowserGuest.mockReturnValue(mocks.release)
    mocks.hasBrowserGuest.mockReturnValue(true)
    mocks.submitBrowserInput.mockResolvedValue(undefined)
    mocks.clearBrowserData.mockResolvedValue(undefined)
    mocks.openBrowserUrlInSystem.mockResolvedValue(undefined)
    mocks.updateUserSettings.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    cleanup()
    useBrowserStore.setState(initialState, true)
    useSettingsStore.setState(initialSettings, true)
    useChatStore.setState(useChatStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('shows an empty state until the tab has a page', () => {
    render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)

    expect(screen.getByText(/Open a local dev server/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open in system browser' })).toBeDisabled()
  })

  it('places the tab page over its stage and parks it on unmount', () => {
    const { unmount } = render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)

    expect(mocks.placeBrowserGuest).toHaveBeenCalledWith('t1', screen.getByTestId('browser-stage'), true)
    unmount()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it('moves the page when another tab is shown', () => {
    const { rerender } = render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)
    rerender(<BrowserView sessionId="s1" tab={tab('t2')} projectRoot="/repo" />)

    expect(mocks.release).toHaveBeenCalledOnce()
    expect(mocks.placeBrowserGuest).toHaveBeenLastCalledWith('t2', screen.getByTestId('browser-stage'), true)
  })

  it('reopens the saved address of a restored tab that has no page yet', () => {
    mocks.hasBrowserGuest.mockReturnValue(false)
    const { rerender } = render(<BrowserView sessionId="s1" tab={tab('t1', 'http://localhost:3000/')} projectRoot="/repo" />)
    expect(mocks.openBrowserUrl).toHaveBeenCalledWith('s1', 't1', 'http://localhost:3000/')

    mocks.openBrowserUrl.mockClear()
    rerender(<BrowserView sessionId="s1" tab={tab('t2')} projectRoot="/repo" />)
    expect(mocks.openBrowserUrl).not.toHaveBeenCalled()
  })

  it('mirrors the page into the address bar and enables navigation', () => {
    useBrowserStore.getState().patchPage('t1', { canGoBack: true, canGoForward: true })
    render(<BrowserView sessionId="s1" tab={tab('t1', 'http://localhost:3000/')} projectRoot="/repo" />)

    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue('http://localhost:3000/')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(mocks.browserGoBack).toHaveBeenCalledWith('t1')
    expect(mocks.browserGoForward).toHaveBeenCalledWith('t1')
    expect(mocks.browserReload).toHaveBeenCalledWith('t1')
    expect(screen.queryByText(/Open a local dev server/)).toBeNull()
  })

  describe('pick element toggle', () => {
    it('is disabled until the page is ready and the tab has an address', () => {
      const { rerender } = render(<BrowserView sessionId="s1" tab={tab('t1', 'https://example.com/')} projectRoot="/repo" />)
      const toggle = screen.getByRole('button', { name: 'Pick an element to add to the chat' })
      expect(toggle).toBeDisabled()

      act(() => useBrowserStore.getState().patchPage('t1', { ready: true }))
      expect(toggle).toBeEnabled()

      rerender(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)
      expect(toggle).toBeDisabled()
    })

    it('toggles pick mode for its own tab', () => {
      useBrowserStore.getState().patchPage('t1', { ready: true })
      render(<BrowserView sessionId="s1" tab={tab('t1', 'https://example.com/')} projectRoot="/repo" />)

      fireEvent.click(screen.getByRole('button', { name: 'Pick an element to add to the chat' }))
      expect(mocks.toggleBrowserPick).toHaveBeenCalledWith('t1')
    })

    it('shows that picking is on from the main process state and says how to stop', () => {
      useBrowserStore.getState().patchPage('t1', { ready: true })
      render(<BrowserView sessionId="s1" tab={tab('t1', 'https://example.com/')} projectRoot="/repo" />)
      expect(screen.getByRole('button', { name: 'Pick an element to add to the chat' })).toHaveAttribute('aria-pressed', 'false')

      act(() => useBrowserStore.getState().setPickActive('t1', true))
      const stop = screen.getByRole('button', { name: 'Stop picking elements' })
      expect(stop).toHaveAttribute('aria-pressed', 'true')

      act(() => useBrowserStore.getState().setPickActive('t1', false))
      expect(screen.getByRole('button', { name: 'Pick an element to add to the chat' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('can still be switched off while the page is not ready', () => {
      useBrowserStore.getState().setPickActive('t1', true)
      render(<BrowserView sessionId="s1" tab={tab('t1', 'https://example.com/')} projectRoot="/repo" />)
      expect(screen.getByRole('button', { name: 'Stop picking elements' })).toBeEnabled()
    })

    it('does not show picking that is on for another tab', () => {
      useBrowserStore.getState().patchPage('t1', { ready: true })
      useBrowserStore.getState().setPickActive('t2', true)
      render(<BrowserView sessionId="s1" tab={tab('t1', 'https://example.com/')} projectRoot="/repo" />)
      expect(screen.getByRole('button', { name: 'Pick an element to add to the chat' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('stops picking on Escape in the app, only while picking is on', () => {
      useBrowserStore.getState().patchPage('t1', { ready: true })
      render(<BrowserView sessionId="s1" tab={tab('t1', 'https://example.com/')} projectRoot="/repo" />)
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(mocks.stopBrowserPick).not.toHaveBeenCalled()

      act(() => useBrowserStore.getState().setPickActive('t1', true))
      fireEvent.keyDown(document.body, { key: 'a' })
      expect(mocks.stopBrowserPick).not.toHaveBeenCalled()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(mocks.stopBrowserPick).toHaveBeenCalledWith('t1')

      act(() => useBrowserStore.getState().setPickActive('t1', false))
      mocks.stopBrowserPick.mockClear()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(mocks.stopBrowserPick).not.toHaveBeenCalled()
    })

    it('stops listening for Escape when the view goes away', () => {
      useBrowserStore.getState().setPickActive('t1', true)
      const { unmount } = render(<BrowserView sessionId="s1" tab={tab('t1', 'https://example.com/')} projectRoot="/repo" />)
      unmount()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(mocks.stopBrowserPick).not.toHaveBeenCalled()
    })
  })

  it('offers stop while a page loads', () => {
    useBrowserStore.getState().patchPage('t1', { loading: true })
    render(<BrowserView sessionId="s1" tab={tab('t1', 'https://example.com/')} projectRoot="/repo" />)

    fireEvent.click(screen.getByRole('button', { name: 'Stop loading' }))
    expect(mocks.browserStop).toHaveBeenCalledWith('t1')
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })

  it('submits the typed address with the session project', () => {
    render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)
    const input = screen.getByRole('textbox', { name: 'Address' })

    fireEvent.change(input, { target: { value: 'localhost:5173' } })
    fireEvent.submit(input)

    expect(mocks.submitBrowserInput).toHaveBeenCalledWith('s1', 't1', 'localhost:5173', '/repo')
  })

  it('ignores an empty address and reports a failed open', async () => {
    render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot={null} />)
    const input = screen.getByRole('textbox', { name: 'Address' })

    fireEvent.submit(input)
    expect(mocks.submitBrowserInput).not.toHaveBeenCalled()

    mocks.submitBrowserInput.mockRejectedValue(new Error('Browser layer is not mounted'))
    fireEvent.change(input, { target: { value: 'example.com' } })
    fireEvent.submit(input)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Browser layer is not mounted'))
  })

  it('shows why an address was refused and lets the user dismiss it', () => {
    useBrowserStore.getState().setNotice('t1', { kind: 'refused', reason: 'outsideProject', url: '/etc/hosts' })
    render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)

    const notice = screen.getByTestId('browser-notice')
    expect(notice).toHaveTextContent('That file is outside the project folder.')
    expect(notice).toHaveTextContent('/etc/hosts')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByTestId('browser-notice')).toBeNull()
  })

  it('shows a load failure for the current tab only', () => {
    useBrowserStore.getState().setNotice('t2', { kind: 'loadFailed', url: 'http://localhost:3000/', description: 'ERR_CONNECTION_REFUSED' })
    const { rerender } = render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)
    expect(screen.queryByTestId('browser-notice')).toBeNull()

    rerender(<BrowserView sessionId="s1" tab={tab('t2')} projectRoot="/repo" />)
    expect(screen.getByTestId('browser-notice')).toHaveTextContent('Could not load http://localhost:3000/.')
    expect(screen.getByTestId('browser-notice')).toHaveTextContent('ERR_CONNECTION_REFUSED')
  })

  it('opens the current page in the system browser', () => {
    render(<BrowserView sessionId="s1" tab={tab('t1', 'https://example.com/')} projectRoot="/repo" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open in system browser' }))
    expect(mocks.openBrowserUrlInSystem).toHaveBeenCalledWith('https://example.com/')
  })

  it('clears browsing data only after confirmation and reloads the pages', async () => {
    render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)

    const trigger = screen.getByRole('button', { name: 'Browser actions' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const first = await screen.findByRole('menuitem', { name: 'Search engine' })
    await waitFor(() => expect(first).toHaveFocus())
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    const item = await screen.findByRole('menuitem', { name: 'Clear browsing data' })
    await waitFor(() => expect(item).toHaveFocus())
    fireEvent.keyDown(item, { key: 'Enter' })
    expect(await screen.findByText('Clear browsing data?')).toBeInTheDocument()
    expect(mocks.clearBrowserData).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    })
    await waitFor(() => expect(mocks.clearBrowserData).toHaveBeenCalledOnce())
    expect(mocks.reloadAllBrowsers).toHaveBeenCalledOnce()
    expect(toast.success).toHaveBeenCalledWith('Browsing data cleared.')
  })

  async function openSearchEngineMenu() {
    const trigger = screen.getByRole('button', { name: 'Browser actions' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const parent = await screen.findByRole('menuitem', { name: 'Search engine' })
    await waitFor(() => expect(parent).toHaveFocus())
    fireEvent.keyDown(parent, { key: 'ArrowRight' })
  }

  it('offers the search engines with the saved one checked', async () => {
    useSettingsStore.setState({ browserSearchEngine: 'baidu' })
    render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)
    await openSearchEngineMenu()

    const choices = await screen.findAllByRole('menuitemradio')
    expect(choices.map((choice) => choice.textContent)).toEqual(['Bing', 'Google', 'DuckDuckGo', 'Baidu'])
    expect(choices.map((choice) => choice.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true'])
  })

  it('tells the user the address bar also searches', () => {
    render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)

    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveAttribute('placeholder', expect.stringContaining('Search'))
  })

  it('saves the chosen search engine and checks it the next time the menu opens', async () => {
    render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)
    await openSearchEngineMenu()
    expect(await screen.findByRole('menuitemradio', { name: 'Bing' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'DuckDuckGo' }), { key: 'Enter' })

    await waitFor(() => expect(mocks.updateUserSettings).toHaveBeenCalledExactlyOnceWith({ browserSearchEngine: 'duckduckgo' }))
    expect(useSettingsStore.getState().browserSearchEngine).toBe('duckduckgo')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    await openSearchEngineMenu()
    expect(await screen.findByRole('menuitemradio', { name: 'DuckDuckGo' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Bing' })).toHaveAttribute('aria-checked', 'false')
  })

  it('keeps the previous engine and reports the error when saving fails', async () => {
    mocks.updateUserSettings.mockRejectedValue(new Error('Invalid browserSearchEngine'))
    render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)
    await openSearchEngineMenu()

    fireEvent.keyDown(await screen.findByRole('menuitemradio', { name: 'Google' }), { key: 'Enter' })

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid browserSearchEngine'))
    expect(useSettingsStore.getState().browserSearchEngine).toBe('bing')
  })

  it('shows the activity bar above only the tab the agent operates', () => {
    useChatStore.setState({
      sessions: {
        s1: {
          ...useChatStore.getState().getSession('s1'),
          mirror: {
            id: 's1',
            version: 1,
            permission: { desired: 'default', effective: 'default' },
            runtime: { desired: null, effective: null },
            title: { text: null, source: null },
            workspace: { workDir: '/repo', projectRoot: '/repo', workDirExists: true },
            process: { phase: 'running', generation: 1 },
            turn: { phase: 'idle' },
            pendingPermissions: [],
            pendingBrowserGrants: [],
            browserActivity: { tabId: 't1' },
            slashCommands: [],
            activeGoal: null,
            backgroundTasks: [],
            uiPages: [],
            team: null,
            clientCount: 1,
          },
        },
      },
    })
    const { rerender } = render(<BrowserView sessionId="s1" tab={tab('t1')} projectRoot="/repo" />)
    expect(screen.getByTestId('browser-activity')).toBeInTheDocument()

    rerender(<BrowserView sessionId="s1" tab={tab('t2')} projectRoot="/repo" />)
    expect(screen.queryByTestId('browser-activity')).not.toBeInTheDocument()
  })
})
