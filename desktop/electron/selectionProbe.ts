export function selectionTouchesSensitiveField(): boolean {
  const isSensitive = (element: Element | null): boolean => {
    if (!(element instanceof HTMLInputElement)) return false
    const autocomplete = element.getAttribute('autocomplete') ?? ''
    return element.type === 'password' || /(^|\s)cc-/i.test(autocomplete)
  }
  let active: Element | null = document.activeElement
  while (active) {
    if (isSensitive(active)) return true
    active = active.shadowRoot?.activeElement ?? null
  }
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  for (const input of Array.from(document.querySelectorAll('input'))) {
    if (isSensitive(input) && selection.containsNode(input, true)) return true
  }
  return false
}

export const SELECTION_PROBE_SOURCE = `(${selectionTouchesSensitiveField.toString()})()`
