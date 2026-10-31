import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setBrowserGuestLayer: vi.fn(),
  showBlockedNavigation: vi.fn(),
  replayBrowserShortcut: vi.fn(),
  addBrowserSelectionToChat: vi.fn(),
  setBrowserMenuLabels: vi.fn(),
  handleOpenTabRequest: vi.fn(),
  handleActivateRequest: vi.fn(),
  handleBrowserPickState: vi.fn(),
  handleBrowserPickStarted: vi.fn(),
  handleBrowserPickDone: vi.fn(),
  startBrowserMarkSync: vi.fn(),
  stopBrowserMarkSync: vi.fn(),
  openBrowserExternalProtocol: vi.fn(),
  handlers: {} as Record<string, (payload: never) => void>,
  unlisten: vi.fn(),
}))

vi.mock('../../lib/browserGuests', () => ({
  setBrowserGuestLayer: mocks.setBrowserGuestLayer,
  showBlockedNavigation: mocks.showBlockedNavigation,
  replayBrowserShortcut: mocks.replayBrowserShortcut,
  addBrowserSelectionToChat: mocks.addBrowserSelectionToChat,
}))

vi.mock('../../lib/browserControlRequests', () => ({
  handleOpenTabRequest: mocks.handleOpenTabRequest,
  handleActivateRequest: mocks.handleActivateRequest,
}))

vi.mock('../../lib/browserPicks', () => ({
  handleBrowserPickState: mocks.handleBrowserPickState,
  handleBrowserPickStarted: mocks.handleBrowserPickStarted,
  handleBrowserPickDone: mocks.handleBrowserPickDone,
}))

vi.mock('../../lib/browserMarks', () => ({
  startBrowserMarkSync: mocks.startBrowserMarkSync,
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
    onBrowserOpenTabRequest: subscribe('openTab'),
    onBrowserActivateRequest: subscribe('activate'),
    onBrowserSelection: subscribe('selection'),
    onBrowserPickState: subscribe('pickState'),
    onBrowserPickStarted: subscribe('pickStarted'),
    onBrowserPickDone: subscribe('pickDone'),
    setBrowserMenuLabels: mocks.setBrowserMenuLabels,
    openBrowserExternalProtocol: mocks.openBrowserExternalProtocol,
  }
})

import { useBrowserStore } from '../../stores/browserStore'
import { BrowserGuestLayer } from './BrowserGuestLayer'

describe('BrowserGuestLayer', () => {
  const initialState = useBrowserStore.getInitialState()

  beforeEach(() => {
    mocks.startBrowserMarkSync.mockReturnValue(mocks.stopBrowserMarkSync)
    mocks.openBrowserExternalProtocol.mockResolvedValue(undefined)
    mocks.setBrowserMenuLabels.mockResolvedValue(undefined)
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
    await waitFor(() => expect(Object.keys(mocks.handlers)).toHaveLength(9))

    mocks.handlers.blocked?.({ guestId: 1, url: 'http://x.test', reason: 'scheme' } as never)
    mocks.handlers.shortcut?.({ key: 'k' } as never)
    expect(mocks.showBlockedNavigation).toHaveBeenCalledWith({ guestId: 1, url: 'http://x.test', reason: 'scheme' })
    expect(mocks.replayBrowserShortcut).toHaveBeenCalledWith({ key: 'k' })

    mocks.handlers.openTab?.({ requestId: 'r1', sessionId: 's', url: null } as never)
    mocks.handlers.activate?.({ requestId: 'r2', tabId: 't' } as never)
    expect(mocks.handleOpenTabRequest).toHaveBeenCalledWith({ requestId: 'r1', sessionId: 's', url: null })
    expect(mocks.handleActivateRequest).toHaveBeenCalledWith({ requestId: 'r2', tabId: 't' })

    const selection = { guestId: 3, text: 'picked', truncated: false, title: 'T', url: 'https://example.com/' }
    mocks.handlers.selection?.(selection as never)
    expect(mocks.addBrowserSelectionToChat).toHaveBeenCalledWith(selection)

    mocks.handlers.pickState?.({ tabId: 't', active: true } as never)
    mocks.handlers.pickStarted?.({ tabId: 't', sessionId: 's', pickId: 'p' } as never)
    mocks.handlers.pickDone?.({ tabId: 't', sessionId: 's', pickId: 'p', ok: false, cancelled: true } as never)
    expect(mocks.handleBrowserPickState).toHaveBeenCalledWith({ tabId: 't', active: true })
    expect(mocks.handleBrowserPickStarted).toHaveBeenCalledWith({ tabId: 't', sessionId: 's', pickId: 'p' })
    expect(mocks.handleBrowserPickDone).toHaveBeenCalledWith({ tabId: 't', sessionId: 's', pickId: 'p', ok: false, cancelled: true })

    unmount()
    await waitFor(() => expect(mocks.unlisten).toHaveBeenCalledTimes(9))
  })

  it('keeps the marks of picked elements in sync with the message box while it is mounted', () => {
    const { unmount } = render(<BrowserGuestLayer />)
    expect(mocks.startBrowserMarkSync).toHaveBeenCalledTimes(1)
    expect(mocks.stopBrowserMarkSync).not.toHaveBeenCalled()
    unmount()
    expect(mocks.stopBrowserMarkSync).toHaveBeenCalledTimes(1)
  })

  it('hands the localized page menu labels to the main process', async () => {
    render(<BrowserGuestLayer />)

    await waitFor(() => expect(mocks.setBrowserMenuLabels).toHaveBeenCalledWith({ addToChat: 'Add to chat', copy: 'Copy' }))
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
