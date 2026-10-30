import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setBrowserGuestLayer: vi.fn(),
  showBlockedNavigation: vi.fn(),
  replayBrowserShortcut: vi.fn(),
  openBrowserExternalProtocol: vi.fn(),
  handlers: {} as Record<string, (payload: never) => void>,
  unlisten: vi.fn(),
}))

vi.mock('../../lib/browserGuests', () => ({
  setBrowserGuestLayer: mocks.setBrowserGuestLayer,
  showBlockedNavigation: mocks.showBlockedNavigation,
  replayBrowserShortcut: mocks.replayBrowserShortcut,
}))

vi.mock('../../lib/shell', () => {
  const subscribe = (name: string) => async (handler: (payload: never) => void) => {
    mocks.handlers[name] = handler
    return mocks.unlisten
  }
  return {
    onBrowserBlocked: subscribe('blocked'),
    onBrowserShortcut: subscribe('shortcut'),
    onBrowserExternalRequest: subscribe('external'),
    openBrowserExternalProtocol: mocks.openBrowserExternalProtocol,
  }
})

import { useBrowserStore } from '../../stores/browserStore'
import { BrowserGuestLayer } from './BrowserGuestLayer'

describe('BrowserGuestLayer', () => {
  const initialState = useBrowserStore.getInitialState()

  beforeEach(() => {
    mocks.openBrowserExternalProtocol.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    useBrowserStore.setState(initialState, true)
    vi.clearAllMocks()
  })

  it('hands its element to the guest registry', () => {
    render(<BrowserGuestLayer />)

    expect(mocks.setBrowserGuestLayer).toHaveBeenCalledWith(screen.getByTestId('browser-guest-layer'))
  })

  it('forwards main-process events and unsubscribes on unmount', async () => {
    const { unmount } = render(<BrowserGuestLayer />)
    await waitFor(() => expect(Object.keys(mocks.handlers)).toHaveLength(3))

    mocks.handlers.blocked?.({ guestId: 1, url: 'http://x.test', reason: 'scheme' } as never)
    mocks.handlers.shortcut?.({ key: 'k' } as never)
    expect(mocks.showBlockedNavigation).toHaveBeenCalledWith({ guestId: 1, url: 'http://x.test', reason: 'scheme' })
    expect(mocks.replayBrowserShortcut).toHaveBeenCalledWith({ key: 'k' })

    unmount()
    await waitFor(() => expect(mocks.unlisten).toHaveBeenCalledTimes(3))
  })

  it('asks before opening an external protocol and opens it on confirm', async () => {
    render(<BrowserGuestLayer />)
    await waitFor(() => expect(mocks.handlers.external).toBeDefined())

    act(() => mocks.handlers.external?.({ url: 'zoommtg://zoom.us/join' } as never))
    expect(await screen.findByText('Open another app?')).toBeInTheDocument()
    expect(screen.getByText('zoommtg://zoom.us/join')).toBeInTheDocument()
    expect(mocks.openBrowserExternalProtocol).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    })
    expect(mocks.openBrowserExternalProtocol).toHaveBeenCalledWith('zoommtg://zoom.us/join')
    expect(useBrowserStore.getState().externalRequestUrl).toBeNull()
  })

  it('does not open anything when the user cancels, and keeps the first request while one is open', async () => {
    render(<BrowserGuestLayer />)
    await waitFor(() => expect(mocks.handlers.external).toBeDefined())

    act(() => mocks.handlers.external?.({ url: 'vscode://first' } as never))
    act(() => mocks.handlers.external?.({ url: 'vscode://second' } as never))
    expect(await screen.findByText('vscode://first')).toBeInTheDocument()
    expect(screen.queryByText('vscode://second')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })
    expect(mocks.openBrowserExternalProtocol).not.toHaveBeenCalled()
    expect(useBrowserStore.getState().externalRequestUrl).toBeNull()
  })
})
