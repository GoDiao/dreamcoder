import { useRef } from 'react'

export function useMenuAction() {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pendingAction = useRef<(() => void) | null>(null)

  function runAfterClose(action: () => void) {
    pendingAction.current = action
  }

  function afterClose() {
    const action = pendingAction.current
    pendingAction.current = null
    if (!action) return
    triggerRef.current?.focus()
    action()
  }

  function onCloseAutoFocus(event: Event) {
    if (!pendingAction.current) return
    event.preventDefault()
    afterClose()
  }

  return { triggerRef, runAfterClose, onCloseAutoFocus, afterClose }
}
