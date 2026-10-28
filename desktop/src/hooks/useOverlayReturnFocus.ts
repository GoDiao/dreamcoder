import { useCallback, useLayoutEffect, useRef } from 'react'

export function useOverlayReturnFocus(onExited?: () => void) {
  const opener = useRef<HTMLElement | null>(null)
  const callback = useRef(onExited)
  useLayoutEffect(() => { callback.current = onExited }, [onExited])
  const onOpenAutoFocus = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [])
  const onCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault()
    const target = opener.current
    if (target?.isConnected && target !== document.body) target.focus()
    else document.querySelector<HTMLTextAreaElement>('textarea:not([disabled])')?.focus()
    callback.current?.()
  }, [])
  return { onOpenAutoFocus, onCloseAutoFocus }
}
