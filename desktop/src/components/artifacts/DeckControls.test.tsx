import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runDeckCall: vi.fn(),
  presentDeck: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../../lib/browserGuests', () => ({ runDeckCall: mocks.runDeckCall, presentDeck: mocks.presentDeck }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import type { DeckState } from '../../lib/deckBridge'
import { useBrowserStore } from '../../stores/browserStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { DeckControls } from './DeckControls'

const deck = (overrides: Partial<DeckState> = {}): DeckState => ({ artifact: 'deck-1', slide: 'agenda', title: 'Agenda', index: 1, count: 3, mode: 'browse', ...overrides })
const show = (state: DeckState | null) => act(() => useBrowserStore.getState().patchPage('t1', { deck: state }))

describe('DeckControls', () => {
  beforeEach(() => {
    mocks.runDeckCall.mockResolvedValue(undefined)
    mocks.presentDeck.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    useBrowserStore.setState(useBrowserStore.getInitialState(), true)
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('shows nothing for a page that is not a deck, and appears once the page reports one', () => {
    render(<DeckControls tabId="t1" />)
    expect(screen.queryByTestId('deck-controls')).not.toBeInTheDocument()
    show(deck())
    expect(screen.getByTestId('deck-position')).toHaveTextContent('2 / 3')
    show(null)
    expect(screen.queryByTestId('deck-controls')).not.toBeInTheDocument()
  })

  it('turns pages in the deck of its own tab', () => {
    show(deck())
    render(<DeckControls tabId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }))
    expect(mocks.runDeckCall.mock.calls).toEqual([
      ['t1', 'window.__dreamcoderDeck?.next()'],
      ['t1', 'window.__dreamcoderDeck?.prev()'],
    ])
  })

  it('disables the page buttons at the ends of the deck', () => {
    show(deck({ index: 0 }))
    render(<DeckControls tabId="t1" />)
    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeEnabled()
    show(deck({ index: 2 }))
    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeDisabled()
  })

  it('switches to the overview and back, showing which one is on', () => {
    show(deck())
    render(<DeckControls tabId="t1" />)
    const overview = screen.getByRole('button', { name: 'Overview' })
    expect(overview).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(overview)
    expect(mocks.runDeckCall).toHaveBeenLastCalledWith('t1', 'window.__dreamcoderDeck?.setMode("overview")')

    show(deck({ mode: 'overview' }))
    expect(overview).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(overview)
    expect(mocks.runDeckCall).toHaveBeenLastCalledWith('t1', 'window.__dreamcoderDeck?.setMode("browse")')
  })

  it('starts the presentation and tells the user when full screen is refused', async () => {
    show(deck())
    render(<DeckControls tabId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    expect(mocks.presentDeck).toHaveBeenCalledWith('t1')
    expect(mocks.toastError).not.toHaveBeenCalled()

    mocks.presentDeck.mockRejectedValueOnce(new Error('not allowed'))
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Could not start the presentation: not allowed'))
  })

  it('offers nothing to do in a deck without slides', () => {
    show(deck({ slide: null, title: null, index: -1, count: 0 }))
    render(<DeckControls tabId="t1" />)
    expect(screen.getByTestId('deck-position')).toHaveTextContent('0 / 0')
    for (const name of ['Previous slide', 'Next slide', 'Overview', 'Present']) expect(screen.getByRole('button', { name })).toBeDisabled()
  })

  it('uses the language of the app', () => {
    useSettingsStore.setState({ locale: 'zh' })
    show(deck())
    render(<DeckControls tabId="t1" />)
    expect(screen.getByRole('button', { name: '总览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '演示' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一页' })).toBeInTheDocument()
  })
})
