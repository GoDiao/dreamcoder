import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const highlight = vi.hoisted(() => vi.fn((text: string, state?: number) => ({
  lines: text.split('\n').map((line) => `${state ?? 0}:${line}`),
  state: (state ?? 0) + 1,
})))

vi.mock('../lib/highlighter', () => ({
  loadHighlighter: () => Promise.resolve({ highlight }),
}))

import { useHighlightedCode } from './useHighlightedCode'

describe('useHighlightedCode', () => {
  it('shows plain lines until the highlighter loads', () => {
    const { result, unmount } = renderHook(() => useHighlightedCode('a\nb', 'ts'))
    expect(result.current).toEqual(['a', 'b'])
    unmount()
  })

  it('highlights completed lines once and carries their state into appended code', async () => {
    const { result, rerender } = renderHook(({ value }) => useHighlightedCode(value, 'ts'), { initialProps: { value: 'a\nb' } })
    await waitFor(() => expect(result.current).toEqual(['0:a', '1:b']))

    highlight.mockClear()
    rerender({ value: 'a\nb\nc' })

    expect(result.current).toEqual(['0:a', '1:b', '2:c'])
    expect(highlight.mock.calls).toEqual([['b', 1], ['c', 2]])
  })

  it('starts over when the code is replaced', async () => {
    const { result, rerender } = renderHook(({ value }) => useHighlightedCode(value, 'ts'), { initialProps: { value: 'a\nb\nc' } })
    await waitFor(() => expect(result.current).toEqual(['0:a', '0:b', '1:c']))

    rerender({ value: 'x\ny' })

    expect(result.current).toEqual(['0:x', '1:y'])
  })
})
