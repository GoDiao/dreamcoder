import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runDeckCall: vi.fn(),
  presentDeck: vi.fn(),
  toastError: vi.fn(),
  setDeckMessageHandler: vi.fn(),
  applyDeckEdit: vi.fn(),
  deleteDeckSlide: vi.fn(),
  flushDeckEdits: vi.fn(),
  stopArtifactHold: vi.fn(),
}))

vi.mock('../../lib/browserGuests', () => ({ runDeckCall: mocks.runDeckCall, presentDeck: mocks.presentDeck, setDeckMessageHandler: mocks.setDeckMessageHandler }))
vi.mock('../../lib/artifactUserEdits', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/artifactUserEdits')>()), stopArtifactHold: mocks.stopArtifactHold }))
vi.mock('../../lib/deckEdits', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/deckEdits')>()), applyDeckEdit: mocks.applyDeckEdit, deleteDeckSlide: mocks.deleteDeckSlide, flushDeckEdits: mocks.flushDeckEdits }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import { ApiError } from '../../api/client'
import type { DeckRequest, DeckState } from '../../lib/deckBridge'
import { useBrowserStore } from '../../stores/browserStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { DeckControls } from './DeckControls'

const deck = (overrides: Partial<DeckState> = {}): DeckState => ({ artifact: 'deck-1', slide: 'agenda', title: 'Agenda', index: 1, count: 3, mode: 'browse', editing: false, ...overrides })
const target = { root: '/repo/dc_artifacts', name: 'talk', title: 'Talk', sessionId: 's1' }
const show = (state: DeckState | null) => act(() => useBrowserStore.getState().patchPage('t1', { deck: state }))

describe('DeckControls', () => {
  beforeEach(() => {
    mocks.runDeckCall.mockResolvedValue(undefined)
    mocks.presentDeck.mockResolvedValue(undefined)
    mocks.applyDeckEdit.mockResolvedValue(undefined)
    mocks.deleteDeckSlide.mockResolvedValue(undefined)
    mocks.flushDeckEdits.mockResolvedValue(undefined)
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

  it('offers editing and deleting only for a deck its tab can write to', () => {
    show(deck())
    const { rerender } = render(<DeckControls tabId="t1" />)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete slide' })).not.toBeInTheDocument()
    expect(mocks.setDeckMessageHandler).not.toHaveBeenCalledWith('t1', expect.any(Function))
    rerender(<DeckControls tabId="t1" editTarget={target} />)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete slide' })).toBeEnabled()
  })

  it('turns editing on and off, showing which one is on and what the user can do', () => {
    show(deck())
    render(<DeckControls tabId="t1" editTarget={target} />)
    const edit = screen.getByRole('button', { name: 'Edit' })
    expect(edit).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(edit)
    expect(mocks.runDeckCall).toHaveBeenLastCalledWith('t1', 'window.__dreamcoderDeck?.setEditing(true)')

    show(deck({ editing: true }))
    expect(edit).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('deck-editing-hint')).toHaveTextContent('Click a text to change it. Enter saves, Shift+Enter starts a new line.')
    show(deck({ editing: true, mode: 'overview' }))
    expect(screen.getByTestId('deck-editing-hint')).toHaveTextContent('Drag a slide to move it, or press ⌘/Ctrl and an arrow key.')
    fireEvent.click(edit)
    expect(mocks.runDeckCall).toHaveBeenLastCalledWith('t1', 'window.__dreamcoderDeck?.setEditing(false)')
  })

  it('offers no editing or deleting during the presentation or in a deck without slides', () => {
    show(deck({ mode: 'present' }))
    render(<DeckControls tabId="t1" editTarget={target} />)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete slide' })).toBeDisabled()
    show(deck({ slide: null, title: null, index: -1, count: 0 }))
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete slide' })).toBeDisabled()
  })

  it('writes back the order and the edits its deck sends, and tells the user when one conflicts or fails', async () => {
    show(deck())
    const { unmount } = render(<DeckControls tabId="t1" editTarget={target} />)
    const handler = mocks.setDeckMessageHandler.mock.calls.find((call) => call[0] === 't1' && call[1])?.[1] as (message: DeckRequest) => void
    handler({ type: 'order', slides: ['b', 'a'] })
    expect(mocks.applyDeckEdit).toHaveBeenCalledWith({ tabId: 't1', ...target }, { type: 'order', slides: ['b', 'a'] })

    mocks.applyDeckEdit.mockRejectedValueOnce(new ApiError(409, { message: 'changed' }))
    handler({ type: 'order', slides: ['b', 'a'] })
    await waitFor(() => expect(mocks.toastError).toHaveBeenLastCalledWith('The slides were just changed elsewhere. The latest order is shown.'))
    mocks.applyDeckEdit.mockRejectedValueOnce(new ApiError(409, { message: 'changed' }))
    handler({ type: 'edit' })
    await waitFor(() => expect(mocks.toastError).toHaveBeenLastCalledWith('This slide was just changed elsewhere. The latest version is shown; make your edit again.'))
    mocks.applyDeckEdit.mockRejectedValueOnce(new Error('offline'))
    handler({ type: 'edit' })
    await waitFor(() => expect(mocks.toastError).toHaveBeenLastCalledWith('Could not save the change: offline'))

    unmount()
    expect(mocks.setDeckMessageHandler).toHaveBeenLastCalledWith('t1', null)
    expect(mocks.stopArtifactHold).toHaveBeenCalledWith('t1')
  })

  it('writes the edits its deck made while no handler listened, as soon as it listens again', () => {
    show(deck())
    render(<DeckControls tabId="t1" editTarget={target} />)
    expect(mocks.flushDeckEdits).toHaveBeenCalledWith({ tabId: 't1', ...target })
  })

  it('deletes the current slide only after the user confirms', async () => {
    show(deck())
    render(<DeckControls tabId="t1" editTarget={target} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete slide' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Agenda')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.deleteDeckSlide).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete slide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.deleteDeckSlide).toHaveBeenCalledWith({ tabId: 't1', ...target }, 'agenda'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    mocks.deleteDeckSlide.mockRejectedValueOnce(new Error('gone'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete slide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Could not delete the slide: gone'))
  })

  it('says what Edit is for while it is off', async () => {
    show(deck())
    render(<DeckControls tabId="t1" editTarget={target} />)
    fireEvent.focus(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Change text and reorder slides')
  })

  it('asks before deleting when the deck itself asks to delete the current slide', async () => {
    show(deck())
    render(<DeckControls tabId="t1" editTarget={target} />)
    const handler = mocks.setDeckMessageHandler.mock.calls.find((call) => call[0] === 't1' && call[1])?.[1] as (message: DeckRequest) => void
    act(() => handler({ type: 'delete' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Agenda')
    expect(mocks.applyDeckEdit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.deleteDeckSlide).toHaveBeenCalledWith({ tabId: 't1', ...target }, 'agenda'))
  })

  it('uses the language of the app', () => {
    useSettingsStore.setState({ locale: 'zh' })
    show(deck())
    render(<DeckControls tabId="t1" />)
    expect(screen.getByRole('button', { name: '总览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '演示' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一页' })).toBeInTheDocument()
    cleanup()
    render(<DeckControls tabId="t1" editTarget={target} />)
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除本页' })).toBeInTheDocument()
  })
})
