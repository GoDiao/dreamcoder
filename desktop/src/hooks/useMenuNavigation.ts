import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'

const MENU_ITEM_SELECTOR = [
  '[role="menuitem"]:not([disabled])',
  '[role="menuitemradio"]:not([disabled])',
  '[role="menuitemcheckbox"]:not([disabled])',
].join(',')

function getMenuItems(menu: HTMLElement | null) {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)) : []
}

type MenuNavigationOptions = {
  /** Falsy while closed; a new value (e.g. another row's id) counts as reopening. */
  openKey: unknown
  menuRef: RefObject<HTMLElement | null>
  onClose: () => void
  /** Where focus returns on close; defaults to whatever had focus when the menu opened. */
  triggerRef?: RefObject<HTMLElement | null>
  /** Changing it (e.g. switching to a submenu view) refocuses the first item. */
  focusKey?: unknown
}

/**
 * Keyboard behaviour for a role="menu" popup: focus the first item on open,
 * Arrow/Home/End between items, Escape closes, and focus returns to the trigger
 * when the menu closes without something else taking focus.
 */
export function useMenuNavigation({ openKey, menuRef, onClose, triggerRef, focusKey }: MenuNavigationOptions) {
  const returnTargetRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!openKey) return
    const active = document.activeElement
    returnTargetRef.current = triggerRef?.current ?? (active instanceof HTMLElement ? active : null)
    return () => {
      const target = returnTargetRef.current
      returnTargetRef.current = null
      const current = document.activeElement
      if (target?.isConnected && (!current || current === document.body)) target.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey])

  useEffect(() => {
    if (!openKey) return
    getMenuItems(menuRef.current)[0]?.focus()
  }, [openKey, focusKey, menuRef])

  /** Close and put focus back on the trigger right away, before any follow-up action runs. */
  const closeAndRestoreFocus = useCallback(() => {
    const target = returnTargetRef.current
    onClose()
    if (target?.isConnected) target.focus()
  }, [onClose])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeAndRestoreFocus()
      return
    }
    const items = getMenuItems(menuRef.current)
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLElement)
    let next: number
    switch (event.key) {
      case 'ArrowDown':
        next = index < 0 ? 0 : (index + 1) % items.length
        break
      case 'ArrowUp':
        next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = items.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    items[next]?.focus()
  }, [closeAndRestoreFocus, menuRef])

  return { onKeyDown, closeAndRestoreFocus }
}
