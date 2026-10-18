import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

const NEXT_KEYS: Record<'horizontal' | 'both', string[]> = {
  horizontal: ['ArrowRight'],
  both: ['ArrowRight', 'ArrowDown'],
}
const PREV_KEYS: Record<'horizontal' | 'both', string[]> = {
  horizontal: ['ArrowLeft'],
  both: ['ArrowLeft', 'ArrowUp'],
}

/**
 * Keydown handler body for a roving-tabindex group (radio group, tab list) attached
 * to the container: Arrow keys wrap through the enabled items matching `itemSelector`,
 * Home/End jump to the ends. Returns the newly focused item so the caller can select it.
 */
export function moveRovingFocus(
  event: ReactKeyboardEvent<HTMLElement>,
  itemSelector: string,
  orientation: 'horizontal' | 'both' = 'both',
): HTMLElement | null {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(itemSelector))
    .filter((item) => !(item as HTMLButtonElement).disabled)
  if (items.length === 0) return null
  const current = items.findIndex((item) => item === event.target || item.contains(event.target as Node))
  if (current < 0) return null

  let next: number
  if (NEXT_KEYS[orientation].includes(event.key)) next = (current + 1) % items.length
  else if (PREV_KEYS[orientation].includes(event.key)) next = (current - 1 + items.length) % items.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  else return null

  event.preventDefault()
  const target = items[next]!
  target.focus()
  return target
}
