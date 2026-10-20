import { useCallback, useEffect, useRef, type MouseEvent } from 'react'
import { isTauriRuntime } from '../lib/desktopRuntime'

/** Elements that keep their own click behaviour and never start a window drag. */
export const WINDOW_DRAG_IGNORE_SELECTOR = 'button, input, textarea, select, a, [role="button"]'

type DraggableWindow = {
  startDragging: () => Promise<void>
  toggleMaximize: () => Promise<void>
}

/**
 * Mouse-down handler that moves the window from anywhere inside an element,
 * except its interactive children; a double-click maximizes or restores.
 *
 * Tauri 2.10's `data-tauri-drag-region` only reacts when the element itself is
 * clicked, not its children, so the title bar areas call startDragging instead.
 * Do not combine the two on one element: both would handle the double-click.
 */
export function useWindowDrag(): (event: MouseEvent) => void {
  const windowRef = useRef<DraggableWindow | null>(null)

  useEffect(() => {
    if (!isTauriRuntime()) return
    // Loaded ahead of time so the drag starts on the mouse-down itself.
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        windowRef.current = getCurrentWindow()
      })
      .catch(() => {})
  }, [])

  return useCallback((event: MouseEvent) => {
    if (event.button !== 0) return
    if ((event.target as Element).closest(WINDOW_DRAG_IGNORE_SELECTOR)) return
    const win = windowRef.current
    if (!win) return
    const action = event.detail === 2 ? win.toggleMaximize() : win.startDragging()
    void action.catch(() => {})
  }, [])
}
