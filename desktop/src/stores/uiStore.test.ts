import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('uiStore theme handling', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
  })

  it('defaults new installs to the pure white theme', async () => {
    const { initializeTheme, useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().theme).toBe('white')
    initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
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

  it('cycles through all themes, persists Aurora, and wraps back to white', async () => {
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
