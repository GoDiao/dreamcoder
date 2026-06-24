import { useEffect } from 'react'

type ElementRef = {
  current: HTMLElement | null
}

const VIEWPORT_MARGIN = 12

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

export function clearWindowSelection() {
  window.getSelection()?.removeAllRanges()
}

export function getSelectionPopoverPosition(
  range: Range,
  root: HTMLElement,
  {
    menuWidth,
    menuHeight,
    offset,
    fallbackPointer,
  }: {
    menuWidth: number
    menuHeight: number
    offset: number
    fallbackPointer?: { clientX: number; clientY: number }
  },
) {
  const rect = typeof range.getBoundingClientRect === 'function'
    ? range.getBoundingClientRect()
    : null
  const rootRect = root.getBoundingClientRect()
  const hasUsableRangeRect = Boolean(rect && (rect.width > 0 || rect.height > 0))
  const pointerInsideRoot = fallbackPointer
    && fallbackPointer.clientX >= rootRect.left
    && fallbackPointer.clientX <= rootRect.right
    && fallbackPointer.clientY >= rootRect.top
    && fallbackPointer.clientY <= rootRect.bottom
  const fallbackLeft = pointerInsideRoot ? fallbackPointer.clientX - menuWidth / 2 : rootRect.left + 24
  const fallbackTop = pointerInsideRoot ? fallbackPointer.clientY : rootRect.top + 24
  const selectionLeft = hasUsableRangeRect ? rect!.left : fallbackLeft
  const selectionRight = hasUsableRangeRect ? rect!.right : selectionLeft + menuWidth
  const selectionTop = hasUsableRangeRect ? rect!.top : fallbackTop
  const selectionBottom = hasUsableRangeRect ? rect!.bottom : selectionTop + menuHeight
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || rootRect.right + VIEWPORT_MARGIN
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || rootRect.bottom + VIEWPORT_MARGIN
  const minX = VIEWPORT_MARGIN
  const maxX = Math.max(minX, viewportWidth - menuWidth - VIEWPORT_MARGIN)
  const minY = VIEWPORT_MARGIN
  const maxY = Math.max(minY, viewportHeight - menuHeight - VIEWPORT_MARGIN)
  const aboveY = selectionTop - menuHeight - offset
  const belowY = selectionBottom + offset
  const y = aboveY >= VIEWPORT_MARGIN || belowY + menuHeight > viewportHeight - VIEWPORT_MARGIN
    ? aboveY
    : belowY
  const centerX = selectionLeft + (selectionRight - selectionLeft) / 2

  return {
    x: clampValue(centerX - menuWidth / 2, minX, maxX),
    y: clampValue(y, minY, maxY),
  }
}

export function useSelectionPopoverDismiss({
  active,
  popoverRef,
  onDismiss,
}: {
  active: boolean
  popoverRef: ElementRef
  onDismiss: () => void
}) {
  useEffect(() => {
    if (!active) return

    const handlePointerDown = (event: PointerEvent) => {
      const popover = popoverRef.current
      const target = event.target
      if (popover && target instanceof Node && popover.contains(target)) {
        return
      }

      onDismiss()
      clearWindowSelection()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [active, onDismiss, popoverRef])
}
