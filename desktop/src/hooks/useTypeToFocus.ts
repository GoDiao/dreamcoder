import { useEffect, type RefObject } from 'react'

const TYPING_TARGETS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"]'

export function useTypeToFocus(ref: RefObject<HTMLTextAreaElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const textarea = ref.current
      if (!textarea || textarea.disabled || event.defaultPrevented || event.isComposing) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest(TYPING_TARGETS)) return
      if (event.key === ' ' && target && target !== document.body) return
      textarea.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled, ref])
}
