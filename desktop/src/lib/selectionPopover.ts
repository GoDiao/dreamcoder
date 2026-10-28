import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'

export function getSelectionAnchor(range: Range, pointer: { clientX: number; clientY: number }) {
  const rects = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : []
  const bounds = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null
  const rect = rects.find((item) => item.width > 0 && item.height > 0) ?? bounds
  if (rect && (rect.width > 0 || rect.height > 0)) {
    return { x: rect.left, y: rect.top, width: rect.width, height: Math.max(rect.height, (bounds?.bottom ?? rect.bottom) - rect.top) }
  }
  return { x: pointer.clientX, y: pointer.clientY, width: 0, height: 0 }
}

export function readComposedSelection(root: HTMLElement | null) {
  const shadows = root ? Array.from(root.querySelectorAll('diffs-container')).flatMap((host) => host.shadowRoot ? [host.shadowRoot] : []) : []
  const selection = shadows.map((shadow) => (shadow as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.()).find((value) => value && !value.isCollapsed)
    ?? window.getSelection()
  return { shadows, selection }
}

export function useQuoteSelection<T>(read: (event: MouseEvent<HTMLElement>) => T | null, resetKey: unknown) {
  const [selection, setSelection] = useState<T | null>(null)
  const containerRef = useRef<HTMLElement | null>(null)
  const clear = useCallback(() => setSelection(null), [])

  useEffect(clear, [clear, resetKey])

  useEffect(() => {
    if (!selection) return
    const handleSelectionChange = () => {
      const current = readComposedSelection(containerRef.current).selection
      if (!current || current.isCollapsed) clear()
    }
    window.addEventListener('scroll', clear, true)
    window.addEventListener('resize', clear)
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      window.removeEventListener('scroll', clear, true)
      window.removeEventListener('resize', clear)
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [selection, clear])

  return {
    selection,
    onMouseUp: (event: MouseEvent<HTMLElement>) => {
      containerRef.current = event.currentTarget
      setSelection(read(event))
    },
    contains: (target: EventTarget | null) => target instanceof Node && Boolean(containerRef.current?.contains(target)),
    clear,
    dismiss: () => {
      setSelection(null)
      window.getSelection()?.removeAllRanges()
    },
  }
}
