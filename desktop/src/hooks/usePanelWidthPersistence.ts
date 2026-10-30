import { useCallback, useEffect, useRef } from 'react'
import { usePanelRef, type GroupProps } from 'react-resizable-panels'

export function usePanelWidthPersistence(saveWidth: (width: number) => void, enabled: boolean) {
  const panelRef = usePanelRef()
  const pendingFrame = useRef<number | null>(null)
  useEffect(() => () => {
    if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current)
    pendingFrame.current = null
  }, [enabled])
  const onLayoutChanged = useCallback<NonNullable<GroupProps['onLayoutChanged']>>((_layout, meta) => {
    if (!enabled || !meta.isUserInteraction) return
    if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current)
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = null
      const width = panelRef.current?.getSize().inPixels
      if (width !== undefined && Number.isFinite(width) && width > 0) saveWidth(width)
    })
  }, [enabled, panelRef, saveWidth])
  return { panelRef, onLayoutChanged }
}
