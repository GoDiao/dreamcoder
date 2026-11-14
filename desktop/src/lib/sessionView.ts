export const SESSION_VIEW_ATTRIBUTE = 'data-session-view'

export function focusedSessionViewId(): string | null {
  const active = document.activeElement
  return active instanceof Element
    ? active.closest(`[${SESSION_VIEW_ATTRIBUTE}]`)?.getAttribute(SESSION_VIEW_ATTRIBUTE) ?? null
    : null
}
