import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionsApi } from '../../api/sessions'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import type { SessionListItem } from '../../types/session'
import { CommandPalette } from './CommandPalette'

function session(id: string, title: string, modifiedAt: string): SessionListItem {
  return {
    id,
    title,
    createdAt: '2026-09-01T00:00:00.000Z',
    modifiedAt,
    messageCount: 2,
    projectPath: '/project',
    workDir: '/project',
    workDirExists: true,
  }
}

const sessions = [
  session('older', 'Database migration', '2026-09-10T12:00:00.000Z'),
  session('newer', 'Authentication flow', '2026-09-11T12:00:00.000Z'),
  session('oldest', 'Terminal rendering', '2026-09-09T12:00:00.000Z'),
]

function openPalette() {
  act(() => useUIStore.getState().openModal('command-palette'))
}

async function readyPalette() {
  openPalette()
  const options = await screen.findAllByRole('option')
  return { input: screen.getByRole('combobox'), options }
}

describe('CommandPalette', () => {
  const connectToSession = vi.fn()
  const originalConnect = useChatStore.getState().connectToSession
  const scrollIntoView = vi.fn()
  const originalScrollIntoView = Element.prototype.scrollIntoView

  beforeEach(() => {
    window.localStorage.clear()
    useUIStore.setState({ activeModal: null, activeView: 'code' })
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({ sessions: [] })
    useSettingsStore.setState({ locale: 'en' })
    connectToSession.mockReset()
    useChatStore.setState({ connectToSession })
    scrollIntoView.mockReset()
    Element.prototype.scrollIntoView = scrollIntoView
    vi.spyOn(sessionsApi, 'list').mockResolvedValue({ sessions, total: sessions.length })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useChatStore.setState({ connectToSession: originalConnect })
    useSessionStore.setState({ sessions: [] })
    useUIStore.setState({ activeModal: null })
    useSettingsStore.setState({ locale: 'zh' })
    if (originalScrollIntoView) {
      Element.prototype.scrollIntoView = originalScrollIntoView
    } else {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('fetches only while open and exposes an accessible dialog with an automatically focused search field', async () => {
    render(<CommandPalette />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sessionsApi.list).not.toHaveBeenCalled()

    const { input, options } = await readyPalette()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName()
    expect(input).toHaveAccessibleName()
    await waitFor(() => expect(input).toHaveFocus())
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('Authentication flow'),
      expect.stringContaining('Database migration'),
      expect.stringContaining('Terminal rendering'),
    ])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id)
  })

  it('wraps keyboard selection, keeps it visible, and opens the selected session with Enter', async () => {
    render(<CommandPalette />)
    const { input, options } = await readyPalette()

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', options[2]!.id)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(scrollIntoView).toHaveBeenCalled()
    expect(scrollIntoView.mock.instances).toContain(options[1])

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useTabStore.getState().tabs).toEqual([
      expect.objectContaining({ sessionId: 'older', title: 'Database migration', type: 'session' }),
    ])
    expect(useTabStore.getState().activeTabId).toBe('older')
    expect(useSessionStore.getState().sessions).toContainEqual(sessions[0])
    expect(connectToSession).toHaveBeenCalledExactlyOnceWith('older')
    expect(useUIStore.getState().activeModal).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('clicks through to an existing session tab without creating a duplicate tab', async () => {
    useTabStore.getState().openTab('newer', 'Previous title')
    useTabStore.getState().openTab('unrelated', 'Unrelated conversation')
    render(<CommandPalette />)
    await readyPalette()

    fireEvent.click(screen.getByRole('option', { name: /Authentication flow/ }))

    expect(useTabStore.getState().tabs).toHaveLength(2)
    expect(useTabStore.getState().tabs.filter((tab) => tab.sessionId === 'newer')).toHaveLength(1)
    expect(useTabStore.getState().tabs[0]?.title).toBe('Authentication flow')
    expect(useTabStore.getState().activeTabId).toBe('newer')
    expect(connectToSession).toHaveBeenCalledExactlyOnceWith('newer')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('filters as the user types and resets keyboard selection to a valid match', async () => {
    render(<CommandPalette />)
    const { input } = await readyPalette()
    fireEvent.keyDown(input, { key: 'ArrowUp' })

    fireEvent.change(input, { target: { value: 'authenticaton' } })

    const matches = screen.getAllByRole('option')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toHaveTextContent('Authentication flow')
    expect(matches[0]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', matches[0]!.id)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(connectToSession).toHaveBeenCalledExactlyOnceWith('newer')
  })

  it('handles an empty result list without selecting a session or exposing a stale active option', async () => {
    render(<CommandPalette />)
    const { input } = await readyPalette()
    fireEvent.change(input, { target: { value: 'zzzzzzzzzzzzzzzzzzzzzz' } })

    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(input.getAttribute('aria-activedescendant')).toBeFalsy()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(connectToSession).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('restores the original focus when Escape closes the palette', async () => {
    render(<><button>Open search</button><CommandPalette /></>)
    const opener = screen.getByRole('button', { name: 'Open search' })
    opener.focus()
    const { input } = await readyPalette()
    await waitFor(() => expect(input).toHaveFocus())

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(connectToSession).not.toHaveBeenCalled()
  })

  it('closes on the backdrop, while clicks inside the dialog keep it open', async () => {
    render(<CommandPalette />)
    await readyPalette()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)
    expect(useUIStore.getState().activeModal).toBe('command-palette')

    const backdrop = dialog.previousElementSibling
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)
    expect(useUIStore.getState().activeModal).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('traps both Tab directions inside the dialog, including the retry action', async () => {
    vi.mocked(sessionsApi.list).mockRejectedValue(new Error('Network unavailable'))
    render(<><button>Outside</button><CommandPalette /></>)
    openPalette()
    await screen.findByRole('button', { name: /retry/i })
    const dialog = screen.getByRole('dialog')
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
    ))
    expect(focusable.length).toBeGreaterThanOrEqual(2)
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(first).toHaveFocus()
    first.focus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  it('shows a loading state, reports a failure, and lets the user retry', async () => {
    let rejectRequest!: (error: Error) => void
    vi.mocked(sessionsApi.list)
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectRequest = reject }))
      .mockResolvedValueOnce({ sessions, total: sessions.length })
    render(<CommandPalette />)
    openPalette()
    const input = screen.getByRole('combobox')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(connectToSession).not.toHaveBeenCalled()

    await act(async () => rejectRequest(new Error('Network unavailable')))
    const retry = await screen.findByRole('button', { name: /retry/i })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i)
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    fireEvent.click(retry)

    expect(await screen.findAllByRole('option')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(sessionsApi.list).toHaveBeenCalledTimes(2)
  })

  it('clears the previous query and fetches fresh sessions when reopened', async () => {
    render(<CommandPalette />)
    const { input } = await readyPalette()
    fireEvent.change(input, { target: { value: 'authentication' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [session('fresh', 'New conversation', '2026-09-12T12:00:00.000Z')],
      total: 1,
    })

    openPalette()
    expect(await screen.findByRole('option', { name: /New conversation/ })).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(screen.queryByRole('option', { name: /Authentication flow/ })).not.toBeInTheDocument()
    expect(sessionsApi.list).toHaveBeenCalledTimes(2)
  })

  it('stops pagination when closed before the pending page resolves', async () => {
    let resolveRequest!: (page: Awaited<ReturnType<typeof sessionsApi.list>>) => void
    vi.mocked(sessionsApi.list).mockImplementationOnce(() => new Promise((resolve) => {
      resolveRequest = resolve
    }))
    render(<CommandPalette />)
    openPalette()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })

    await act(async () => resolveRequest({ sessions, total: 300 }))

    expect(sessionsApi.list).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not navigate, select, or close while a composition session is active', async () => {
    render(<CommandPalette />)
    const { input, options } = await readyPalette()
    fireEvent.compositionStart(input)

    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
      fireEvent.keyDown(input, { key })
      expect(options[0]).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    }
    expect(connectToSession).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(connectToSession).toHaveBeenCalledExactlyOnceWith('older')
  })

  it.each([
    { isComposing: true },
    { keyCode: 229 },
  ])('honors native IME keyboard flags %j even without composition events', async (imeFlags) => {
    render(<CommandPalette />)
    const { input, options } = await readyPalette()

    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
      fireEvent.keyDown(input, { key, ...imeFlags })
      expect(options[0]).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    }
    expect(connectToSession).not.toHaveBeenCalled()
  })

  it('updates its translated placeholder and dialog label when the locale changes', async () => {
    render(<CommandPalette />)
    const { input } = await readyPalette()
    const englishPlaceholder = input.getAttribute('placeholder')
    expect(englishPlaceholder).toMatch(/search/i)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Switch session')

    act(() => useSettingsStore.setState({ locale: 'zh' }))

    expect(input.getAttribute('placeholder')).not.toBe(englishPlaceholder)
    expect(input.getAttribute('placeholder')).toMatch(/[\u4e00-\u9fff]/)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('切换会话')
    expect(input).toHaveAccessibleName()
  })
})
