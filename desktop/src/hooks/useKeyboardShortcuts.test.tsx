import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { APP_ZOOM_STORAGE_KEY } from '../lib/appZoom'
import { useSettingsStore } from '../stores/settingsStore'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { useUIStore } from '../stores/uiStore'
import { useSessionStore } from '../stores/sessionStore'

describe('useKeyboardShortcuts quick switcher', () => {
  beforeEach(() => {
    useUIStore.setState({ activeModal: null, sidebarOpen: false })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useUIStore.setState({ activeModal: null })
  })

  it.each([{ metaKey: true }, { ctrlKey: true }])('opens the palette from a focused input with %o', (modifier) => {
    render(<><ShortcutHost /><input aria-label="Composer" /></>)
    const input = document.querySelector('input')!
    input.focus()
    expect(fireEvent.keyDown(input, { key: 'k', ...modifier })).toBe(false)
    expect(useUIStore.getState().activeModal).toBe('command-palette')
    expect(useUIStore.getState().sidebarOpen).toBe(false)
  })

  it.each([
    { key: 'k' },
    { key: 'k', ctrlKey: true, altKey: true },
    { key: 'K', ctrlKey: true, shiftKey: true },
    { key: 'k', metaKey: true, isComposing: true },
    { key: 'k', ctrlKey: true, keyCode: 229 },
    { key: 'k', ctrlKey: true, repeat: true },
  ])('ignores a non-shortcut, composition, or key repeat: %o', (event) => {
    render(<ShortcutHost />)
    fireEvent.keyDown(document, event)
    expect(useUIStore.getState().activeModal).toBeNull()
  })

  it('does not replace another open modal', () => {
    useUIStore.setState({ activeModal: 'rename' })
    render(<ShortcutHost />)
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(useUIStore.getState().activeModal).toBe('rename')
  })

  it('captures Ctrl+K before a terminal can consume it', () => {
    const terminalKey = vi.fn((event: React.KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
    })
    render(<><ShortcutHost /><textarea aria-label="Terminal" onKeyDown={terminalKey} /></>)
    fireEvent.keyDown(document.querySelector('textarea')!, { key: 'k', ctrlKey: true })
    expect(useUIStore.getState().activeModal).toBe('command-palette')
    expect(terminalKey).not.toHaveBeenCalled()
  })

  it('does not cover a locally managed dialog', () => {
    render(<><ShortcutHost /><div role="dialog" aria-modal="true" /></>)
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(useUIStore.getState().activeModal).toBeNull()
  })

  it('does not run underlying actions while the palette is open', () => {
    useUIStore.setState({ activeModal: 'command-palette' })
    const setActiveSession = vi.spyOn(useSessionStore.getState(), 'setActiveSession')
    render(<ShortcutHost />)
    fireEvent.keyDown(document, { key: 'n', ctrlKey: true })
    expect(setActiveSession).not.toHaveBeenCalled()
  })

  it('removes its listener when unmounted', () => {
    const { unmount } = render(<ShortcutHost />)
    unmount()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(useUIStore.getState().activeModal).toBeNull()
  })
})

function ShortcutHost() {
  useKeyboardShortcuts()
  return null
}

function setNavigatorPlatform(platform: string) {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  })
}

describe('useKeyboardShortcuts app zoom', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-app-zoom-mode')
    document.documentElement.removeAttribute('data-app-zoom-percent')
    document.documentElement.style.removeProperty('--app-zoom')
    document.body.style.removeProperty('zoom')
    useSettingsStore.setState({ uiZoom: 1 })
    setNavigatorPlatform('Win32')
  })

  afterEach(() => {
    cleanup()
  })

  it('handles Ctrl zoom shortcuts on Windows and Linux style platforms', async () => {
    render(<ShortcutHost />)

    fireEvent.keyDown(document, {
      code: 'Equal',
      ctrlKey: true,
      key: '=',
    })

    await waitFor(() => {
      expect(window.localStorage.getItem(APP_ZOOM_STORAGE_KEY)).toBe('1.1')
    })
    expect(useSettingsStore.getState().uiZoom).toBe(1.1)
    expect(document.documentElement.getAttribute('data-app-zoom-percent')).toBe('110')

    fireEvent.keyDown(document, {
      code: 'Minus',
      ctrlKey: true,
      key: '-',
    })

    await waitFor(() => {
      expect(window.localStorage.getItem(APP_ZOOM_STORAGE_KEY)).toBe('1')
    })
    expect(useSettingsStore.getState().uiZoom).toBe(1)

    fireEvent.keyDown(document, {
      code: 'NumpadAdd',
      ctrlKey: true,
      key: '+',
    })
    await waitFor(() => {
      expect(window.localStorage.getItem(APP_ZOOM_STORAGE_KEY)).toBe('1.1')
    })

    fireEvent.keyDown(document, {
      code: 'Digit0',
      ctrlKey: true,
      key: '0',
    })

    await waitFor(() => {
      expect(window.localStorage.getItem(APP_ZOOM_STORAGE_KEY)).toBe('1')
    })
  })

  it('uses Cmd zoom shortcuts on macOS', async () => {
    setNavigatorPlatform('MacIntel')
    render(<ShortcutHost />)

    fireEvent.keyDown(document, {
      code: 'Minus',
      key: '-',
      metaKey: true,
    })

    await waitFor(() => {
      expect(window.localStorage.getItem(APP_ZOOM_STORAGE_KEY)).toBe('0.9')
    })

    fireEvent.keyDown(document, {
      code: 'Equal',
      ctrlKey: true,
      key: '=',
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(window.localStorage.getItem(APP_ZOOM_STORAGE_KEY)).toBe('0.9')
  })
})
