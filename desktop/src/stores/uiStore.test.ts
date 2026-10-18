import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeMode } from '../types/settings'

const EXPECTED_COLOR_SCHEME: Record<ThemeMode, 'dark' | 'light'> = {
  white: 'light',
  light: 'light',
  dark: 'dark',
  dreamfield: 'light',
  amber: 'light',
  midnight: 'dark',
  aurora: 'dark',
}

describe('uiStore theme handling', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
  })

  it('defaults new installs to the warm light theme', async () => {
    const { initializeTheme, useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().theme).toBe('light')
    initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('hydrates and applies the pure white theme as a light color scheme', async () => {
    window.localStorage.setItem('dreamcoder-theme', 'white')

    const { initializeTheme, useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().theme).toBe('white')
    initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('hydrates Aurora and restores its dark color scheme', async () => {
    window.localStorage.setItem('dreamcoder-theme', 'aurora')
    const { initializeTheme, useUIStore } = await import('./uiStore')

    initializeTheme()
    expect(useUIStore.getState().theme).toBe('aurora')
    expect(document.documentElement.getAttribute('data-theme')).toBe('aurora')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('applies a dark color scheme for dark, midnight and aurora, light for the rest', async () => {
    const { applyTheme } = await import('./uiStore')

    for (const [theme, colorScheme] of Object.entries(EXPECTED_COLOR_SCHEME) as [ThemeMode, string][]) {
      applyTheme(theme)
      expect(document.documentElement.getAttribute('data-theme')).toBe(theme)
      expect(document.documentElement.style.colorScheme).toBe(colorScheme)
    }
  })

  it('cycles through all themes, persists Aurora, and wraps back to white', async () => {
    window.localStorage.setItem('dreamcoder-theme', 'white')
    const { useUIStore } = await import('./uiStore')

    for (const theme of ['light', 'dark', 'dreamfield', 'amber', 'midnight', 'aurora', 'white']) {
      useUIStore.getState().toggleTheme()
      expect(useUIStore.getState().theme).toBe(theme)
      expect(document.documentElement.getAttribute('data-theme')).toBe(theme)
      expect(window.localStorage.getItem('dreamcoder-theme')).toBe(theme)
    }
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
