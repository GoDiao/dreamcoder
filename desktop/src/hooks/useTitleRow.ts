import type { CSSProperties } from 'react'
import { isMacOverlayTitlebar } from '../lib/windowChrome'
import { useUIStore } from '../stores/uiStore'

export function useTitleRow() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const macTitlebar = isMacOverlayTitlebar()
  const style = (atWindowEdge: boolean): CSSProperties | undefined => macTitlebar
    ? {
        height: 'var(--titlebar-height)',
        ...(atWindowEdge && !sidebarOpen ? { paddingLeft: 'calc(var(--traffic-lights-end) + 1.75rem + 12px)' } : {}),
      }
    : undefined
  return { style, className: macTitlebar ? '' : 'h-11' }
}
