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

  it('cycles through all theme modes', async () => {
    const { useUIStore } = await import('./uiStore')

    // white → light
    useUIStore.getState().toggleTheme()
    expect(useUIStore.getState().theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')

    // light → dark
    useUIStore.getState().toggleTheme()
    expect(useUIStore.getState().theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    // dark → dreamfield
    useUIStore.getState().toggleTheme()
    expect(useUIStore.getState().theme).toBe('dreamfield')
    expect(document.documentElement.style.colorScheme).toBe('light')

    // dreamfield → amber
    useUIStore.getState().toggleTheme()
    expect(useUIStore.getState().theme).toBe('amber')
    expect(document.documentElement.style.colorScheme).toBe('light')

    // amber → midnight (midnight is a dark color scheme)
    useUIStore.getState().toggleTheme()
    expect(useUIStore.getState().theme).toBe('midnight')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    // midnight → white (wraps)
    useUIStore.getState().toggleTheme()
    expect(useUIStore.getState().theme).toBe('white')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
