let pointerLast = false

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => { pointerLast = true }, true)
  document.addEventListener('keydown', () => { pointerLast = false }, true)
}

export function lastInteractionWasPointer() {
  return pointerLast
}

export function pointerAwareCloseAutoFocus(handler?: (event: Event) => void) {
  return (event: Event) => {
    handler?.(event)
    if (pointerLast) event.preventDefault()
  }
}
