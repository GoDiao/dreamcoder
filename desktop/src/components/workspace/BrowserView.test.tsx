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
  setCanvasMessageHandler: vi.fn(),
  openBrowserUrl: vi.fn(),
  placeBrowserGuest: vi.fn(),
  release: vi.fn(),
  reloadAllBrowsers: vi.fn(),
  isProjectPageUrl: vi.fn((url: string) => url.startsWith('dreamcoder-project://')),
  getBrowserGuestContentsId: vi.fn(() => null),
  exportArtifactPage: vi.fn(),
  resolveStoredBrowserUrl: vi.fn(),
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
  setCanvasMessageHandler: mocks.setCanvasMessageHandler,
  openBrowserUrl: mocks.openBrowserUrl,
  placeBrowserGuest: mocks.placeBrowserGuest,
  reloadAllBrowsers: mocks.reloadAllBrowsers,
  isProjectPageUrl: mocks.isProjectPageUrl,
  resolveStoredBrowserUrl: mocks.resolveStoredBrowserUrl,
  getBrowserGuestContentsId: mocks.getBrowserGuestContentsId,
}))

vi.mock('../../lib/artifactExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/artifactExport')>()),
  exportArtifactPage: mocks.exportArtifactPage,
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

  it('re-resolves the saved address of a restored project page with the tab root before opening it', async () => {
    mocks.hasBrowserGuest.mockReturnValue(false)
    mocks.resolveStoredBrowserUrl.mockResolvedValue('dreamcoder-project://fresh/report/index.html')
    const restored = { ...tab('t1', 'dreamcoder-project://stale/report/index.html'), root: '/repo/dc_artifacts' }
    render(<BrowserView sessionId="s1" tab={restored} projectRoot="/repo" />)

    await waitFor(() => expect(mocks.openBrowserUrl).toHaveBeenCalledWith('s1', 't1', 'dreamcoder-project://fresh/report/index.html'))
    expect(mocks.resolveStoredBrowserUrl).toHaveBeenCalledWith(restored, '/repo')
  })

  it('tells the user when a restored project page can no longer be found', async () => {
    mocks.hasBrowserGuest.mockReturnValue(false)
    mocks.resolveStoredBrowserUrl.mockRejectedValue(new Error('gone'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<BrowserView sessionId="s1" tab={tab('t1', 'dreamcoder-project://stale/a.html')} projectRoot="/repo" />)

    await waitFor(() => expect(useBrowserStore.getState().noticeByTab.t1).toEqual({ kind: 'refused', reason: 'notFound', url: 'dreamcoder-project://stale/a.html' }))
    expect(mocks.openBrowserUrl).not.toHaveBeenCalled()
    warn.mockRestore()
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

  it('shows a progress bar only while a page loads', () => {
    useBrowserStore.getState().patchPage('t1', { loading: true })
    const { rerender } = render(<BrowserView sessionId="s1" tab={tab('t1', 'https://example.com/')} projectRoot="/repo" />)
    expect(screen.getByTestId('browser-progress')).toBeTruthy()

    act(() => useBrowserStore.getState().patchPage('t1', { loading: false }))
    rerender(<BrowserView sessionId="s1" tab={tab('t1', 'https://example.com/')} projectRoot="/repo" />)
    expect(screen.queryByTestId('browser-progress')).toBeNull()
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

  describe('canvas messages', () => {
    const artifactTab = { ...tab('t1', 'dreamcoder-project://id/flow/index.html'), root: '/repo/dc_artifacts', artifact: { id: 'id-1', name: 'flow', mtimeMs: 1, canvas: true as const } }

    async function openMenuOf() {
      const trigger = screen.getByRole('button', { name: 'Browser actions' })
      act(() => trigger.focus())
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findAllByRole('menuitem')
    }

    it('offers no export on the canvas page itself, only on a board opened from it', async () => {
      useBrowserStore.getState().patchPage('t1', { ready: true })
      const view = render(<BrowserView sessionId="s1" tab={artifactTab} projectRoot="/repo" />)
      await openMenuOf()
      expect(screen.queryByRole('menuitem', { name: 'Export as PDF' })).not.toBeInTheDocument()
      expect(screen.getByRole('menu').firstElementChild).not.toHaveAttribute('data-slot', 'dropdown-menu-separator')
      view.unmount()
      cleanup()

      const boardTab = { ...tab('t3', 'dreamcoder-project://id/flow/home.html'), root: '/repo/dc_artifacts', artifact: { id: 'id-1', name: 'flow', mtimeMs: 1, board: 'home' } }
      useBrowserStore.getState().patchPage('t3', { ready: true })
      render(<BrowserView sessionId="s1" tab={boardTab} projectRoot="/repo" />)
      await openMenuOf()
      expect(screen.getByRole('menuitem', { name: 'Export as PDF' })).not.toHaveAttribute('data-disabled')
    })

    it('does not listen for canvas messages on a board tab or on a page artifact', () => {
      render(<BrowserView sessionId="s1" tab={{ ...artifactTab, artifact: { id: 'id-1', name: 'flow', mtimeMs: 1, board: 'home' } }} projectRoot="/repo" />)
      cleanup()
      render(<BrowserView sessionId="s1" tab={{ ...artifactTab, artifact: { id: 'id-1', name: 'report', mtimeMs: 1 } }} projectRoot="/repo" />)
      expect(mocks.setCanvasMessageHandler).not.toHaveBeenCalled()
    })

    it('listens for the canvas messages of an artifact tab and stops when the tab goes away', () => {
      const view = render(<BrowserView sessionId="s1" tab={artifactTab} projectRoot="/repo" />)
      expect(mocks.setCanvasMessageHandler).toHaveBeenCalledWith('t1', expect.any(Function))
      view.unmount()
      expect(mocks.setCanvasMessageHandler).toHaveBeenLastCalledWith('t1', null)
    })

    it('does not listen on an ordinary page', () => {
      render(<BrowserView sessionId="s1" tab={tab('t2', 'https://example.com/')} projectRoot="/repo" />)
      expect(mocks.setCanvasMessageHandler).not.toHaveBeenCalled()
    })
  })

  describe('export', () => {
    const artifactTab = { ...tab('t1', 'dreamcoder-project://id/report/index.html'), title: 'Quarterly report', root: '/repo/dc_artifacts', artifact: { id: 'id-1', name: 'report', mtimeMs: 1 } }

    async function openMenu() {
      const trigger = screen.getByRole('button', { name: 'Browser actions' })
      act(() => trigger.focus())
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await screen.findAllByRole('menuitem')
    }

    it('offers the three formats on an artifact tab once its page is ready', async () => {
      useBrowserStore.getState().patchPage('t1', { ready: true })
      render(<BrowserView sessionId="s1" tab={artifactTab} projectRoot="/repo" />)

      await openMenu()

      for (const name of ['Export as PDF', 'Export as PNG image', 'Export as standalone HTML']) {
        expect(screen.getByRole('menuitem', { name })).not.toHaveAttribute('data-disabled')
      }
    })

    it('disables them while the page is not ready and offers none on an ordinary page', async () => {
      const { unmount } = render(<BrowserView sessionId="s1" tab={artifactTab} projectRoot="/repo" />)
      await openMenu()
      expect(screen.getByRole('menuitem', { name: 'Export as PDF' })).toHaveAttribute('data-disabled')
      unmount()
      cleanup()

      render(<BrowserView sessionId="s1" tab={tab('t2', 'https://example.com/')} projectRoot="/repo" />)
      await openMenu()
      expect(screen.queryByRole('menuitem', { name: 'Export as PDF' })).not.toBeInTheDocument()
    })

    it('exports the tab page for this chat under the artifact title and reports where it was saved', async () => {
      useBrowserStore.getState().patchPage('t1', { ready: true })
      mocks.exportArtifactPage.mockResolvedValue({ status: 'saved', path: '/Users/me/Report.pdf' })
      const success = vi.mocked(toast.success)
      success.mockClear()
      render(<BrowserView sessionId="s1" tab={artifactTab} projectRoot="/repo" />)

      await openMenu()
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Export as PDF' }), { key: 'Enter' })

      await waitFor(() => expect(success).toHaveBeenCalledWith('Saved to /Users/me/Report.pdf'))
      expect(mocks.exportArtifactPage).toHaveBeenCalledWith(expect.objectContaining({ tabId: 't1', sessionId: 's1', format: 'pdf', title: 'Quarterly report' }))
    })

    it('shows why an export failed and stays quiet after a cancel', async () => {
      useBrowserStore.getState().patchPage('t1', { ready: true })
      const error = vi.mocked(toast.error)
      const success = vi.mocked(toast.success)
      error.mockClear()
      success.mockClear()
      render(<BrowserView sessionId="s1" tab={artifactTab} projectRoot="/repo" />)

      mocks.exportArtifactPage.mockResolvedValueOnce({ status: 'cancelled' })
      await openMenu()
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Export as PNG image' }), { key: 'Enter' })
      await waitFor(() => expect(mocks.exportArtifactPage).toHaveBeenCalledTimes(1))
      expect(error).not.toHaveBeenCalled()
      expect(success).not.toHaveBeenCalled()

      mocks.exportArtifactPage.mockRejectedValueOnce(new Error('disk full'))
      await openMenu()
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Export as standalone HTML' }), { key: 'Enter' })
      await waitFor(() => expect(error).toHaveBeenCalledWith('Export failed: disk full'))
    })
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
            pendingReports: [],
            queuedMessages: [],
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

  describe('template preview tab', () => {
    const pendingChoice = (candidates: string[]) => {
      useChatStore.setState({
        sessions: {
          s1: {
            ...useChatStore.getState().getSession('s1'),
            pendingPermission: {
              requestId: 'perm-1',
              toolName: 'ChooseDesignTemplate',
              toolUseId: 'tool-1',
              input: { candidates: candidates.map((id) => ({ id, reason: 'fits' })), title: 'Landing' },
            },
          },
        },
      })
    }
    const previewTab = (templateId: string) => ({ ...tab('t1', 'dreamcoder-project://x/index.html'), template: { id: templateId } })

    it('offers to use the template when the agent is waiting for a choice that includes it, and answers with it', () => {
      const send = vi.spyOn(useChatStore.getState(), 'respondToPermission').mockImplementation(() => {})
      pendingChoice(['saas', 'app-a'])
      render(<BrowserView sessionId="s1" tab={previewTab('saas')} projectRoot="/repo" />)

      fireEvent.click(screen.getByRole('button', { name: 'Use this template' }))

      expect(send).toHaveBeenCalledWith('s1', 'perm-1', true, {
        updatedInput: { candidates: [{ id: 'saas', reason: 'fits' }, { id: 'app-a', reason: 'fits' }], title: 'Landing', choice: 'saas' },
      })
    })

    it('offers nothing when the template was not among the candidates, nothing is pending, or the tab is not a preview', () => {
      pendingChoice(['app-a', 'app'])
      const { rerender } = render(<BrowserView sessionId="s1" tab={previewTab('saas')} projectRoot="/repo" />)
      expect(screen.queryByRole('button', { name: 'Use this template' })).not.toBeInTheDocument()

      act(() => useChatStore.setState(useChatStore.getInitialState(), true))
      rerender(<BrowserView sessionId="s1" tab={previewTab('saas')} projectRoot="/repo" />)
      expect(screen.queryByRole('button', { name: 'Use this template' })).not.toBeInTheDocument()

      act(() => pendingChoice(['saas', 'app-a']))
      rerender(<BrowserView sessionId="s1" tab={tab('t1', 'dreamcoder-project://x/index.html')} projectRoot="/repo" />)
      expect(screen.queryByRole('button', { name: 'Use this template' })).not.toBeInTheDocument()
    })
  })
})
