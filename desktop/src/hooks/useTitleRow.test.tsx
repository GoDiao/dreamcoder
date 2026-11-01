import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ mac: false }))

vi.mock('../lib/windowChrome', () => ({ isMacOverlayTitlebar: () => mocks.mac }))

import { useUIStore } from '../stores/uiStore'
import { useTitleRow } from './useTitleRow'

const initialSidebarOpen = useUIStore.getState().sidebarOpen

describe('useTitleRow', () => {
  beforeEach(() => {
    mocks.mac = false
    useUIStore.setState({ sidebarOpen: true })
  })

  afterEach(() => {
    mocks.mac = false
    useUIStore.setState({ sidebarOpen: initialSidebarOpen })
  })

  it('gives the row a fixed height class and no inline style outside macOS', () => {
    const { result } = renderHook(() => useTitleRow())
    expect(result.current.className).toBe('h-11')
    expect(result.current.style(true)).toBeUndefined()
  })

  it('sizes the row to the title bar on macOS', () => {
    mocks.mac = true
    const { result } = renderHook(() => useTitleRow())
    expect(result.current.className).toBe('')
    expect(result.current.style(true)).toEqual({ height: 'var(--titlebar-height)' })
  })

  it('keeps clear of the traffic lights when the sidebar is hidden and the row starts at the window edge', () => {
    mocks.mac = true
    const { result } = renderHook(() => useTitleRow())
    act(() => useUIStore.setState({ sidebarOpen: false }))
    expect(result.current.style(true)?.paddingLeft).toContain('var(--traffic-lights-end)')
    expect(result.current.style(false)?.paddingLeft).toBeUndefined()
  })
})
