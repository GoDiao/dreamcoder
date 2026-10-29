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

vi.mock('../../lib/shell', () => ({
  clearBrowserData: mocks.clearBrowserData,
  openBrowserUrlInSystem: mocks.openBrowserUrlInSystem,
}))

import { toast } from 'sonner'
import { useBrowserStore } from '../../stores/browserStore'
import { BrowserView } from './BrowserView'

function tab(id: string, url = '') {
  return { id, kind: 'browser' as const, url, title: '' }
}

describe('BrowserView', () => {
  const initialState = useBrowserStore.getInitialState()

  beforeEach(() => {
    mocks.placeBrowserGuest.mockReturnValue(mocks.release)
    mocks.hasBrowserGuest.mockReturnValue(true)
    mocks.submitBrowserInput.mockResolvedValue(undefined)
    mocks.clearBrowserData.mockResolvedValue(undefined)
    mocks.openBrowserUrlInSystem.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    useBrowserStore.setState(initialState, true)
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
})
