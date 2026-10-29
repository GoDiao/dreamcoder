import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePanelWidthPersistence } from './usePanelWidthPersistence'

const panel = vi.hoisted(() => ({ current: { getSize: vi.fn(() => ({ inPixels: 300, asPercentage: 30 })) } }))
vi.mock('react-resizable-panels', () => ({ usePanelRef: () => panel }))

afterEach(() => {
  vi.restoreAllMocks()
  panel.current.getSize.mockReset().mockReturnValue({ inPixels: 300, asPercentage: 30 })
})

describe('panel width persistence', () => {
  it('waits for the committed DOM size after a user resize and ignores layout initialization', () => {
    let frame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1 })
    const save = vi.fn()
    const { result } = renderHook(() => usePanelWidthPersistence(save, true))
    act(() => result.current.onLayoutChanged({}, { isUserInteraction: false }))
    expect(frame).toBeUndefined()
    act(() => result.current.onLayoutChanged({}, { isUserInteraction: true }))
    expect(save).not.toHaveBeenCalled()
    panel.current.getSize.mockReturnValue({ inPixels: 380, asPercentage: 38 })
    act(() => frame?.(0))
    expect(save).toHaveBeenCalledWith(380)
  })

  it('cancels pending writes when the panel closes and when it unmounts', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7)
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const save = vi.fn()
    const { result, rerender, unmount } = renderHook(({ enabled }) => usePanelWidthPersistence(save, enabled), { initialProps: { enabled: true } })
    act(() => result.current.onLayoutChanged({}, { isUserInteraction: true }))
    rerender({ enabled: false })
    expect(cancel).toHaveBeenCalledWith(7)
    act(() => result.current.onLayoutChanged({}, { isUserInteraction: true }))
    expect(save).not.toHaveBeenCalled()
    rerender({ enabled: true })
    act(() => result.current.onLayoutChanged({}, { isUserInteraction: true }))
    unmount()
    expect(cancel).toHaveBeenCalledTimes(2)
  })
})
