import type { MouseEvent } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSelectionAnchor, useQuoteSelection } from './selectionPopover'

afterEach(() => vi.restoreAllMocks())

describe('chat selection anchor', () => {
  it('anchors to the first visible selected line instead of the multiline bounding box', () => {
    const range = document.createRange()
    Object.assign(range, {
      getClientRects: () => [new DOMRect(), new DOMRect(90, 120, 180, 20), new DOMRect(40, 160, 600, 20)],
      getBoundingClientRect: () => new DOMRect(40, 120, 600, 60),
    })
    expect(getSelectionAnchor(range, { clientX: 620, clientY: 180 })).toEqual({ x: 90, y: 120, width: 180, height: 60 })
  })

  it('uses the range bounds when individual line rectangles are unavailable', () => {
    const range = document.createRange()
    Object.assign(range, { getBoundingClientRect: () => new DOMRect(80, 60, 150, 20) })
    expect(getSelectionAnchor(range, { clientX: 200, clientY: 80 })).toEqual({ x: 80, y: 60, width: 150, height: 20 })
  })

  it('falls back to the selection gesture position when the range has no geometry', () => {
    const range = document.createRange()
    Object.assign(range, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() })
    expect(getSelectionAnchor(range, { clientX: 70, clientY: 90 })).toEqual({ x: 70, y: 90, width: 0, height: 0 })
  })
})

describe('quote selection', () => {
  function shadowSurface() {
    const root = document.createElement('div')
    const host = document.createElement('diffs-container')
    const shadow = host.attachShadow({ mode: 'open' })
    root.append(host)
    document.body.append(root)
    return { root, shadow }
  }

  it('stays open while the selection lives inside a shadow root', () => {
    const { root, shadow } = shadowSurface()
    Object.defineProperty(shadow, 'getSelection', { value: () => ({ isCollapsed: false }) })
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true } as Selection)
    const { result } = renderHook(() => useQuoteSelection(() => ({ text: 'quoted' }), 'key'))
    act(() => result.current.onMouseUp({ currentTarget: root } as unknown as MouseEvent<HTMLElement>))
    act(() => { document.dispatchEvent(new Event('selectionchange')) })
    expect(result.current.selection).toEqual({ text: 'quoted' })
    root.remove()
  })

  it('closes once the selection collapses', () => {
    const { root, shadow } = shadowSurface()
    Object.defineProperty(shadow, 'getSelection', { value: () => ({ isCollapsed: true }) })
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true } as Selection)
    const { result } = renderHook(() => useQuoteSelection(() => ({ text: 'quoted' }), 'key'))
    act(() => result.current.onMouseUp({ currentTarget: root } as unknown as MouseEvent<HTMLElement>))
    act(() => { document.dispatchEvent(new Event('selectionchange')) })
    expect(result.current.selection).toBeNull()
    root.remove()
  })
})
