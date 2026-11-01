export function selectionTouchesSensitiveField(): boolean {
  const isSensitive = (element: Element | null): boolean => {
    if (!element || element.localName !== 'input') return false
    const autocomplete = element.getAttribute('autocomplete') ?? ''
    return (element as HTMLInputElement).type === 'password' || /(^|\s)cc-/i.test(autocomplete)
  }
  const touches = (doc: Document, depth: number): boolean => {
    let active: Element | null = doc.activeElement
    while (active) {
      if (isSensitive(active)) return true
      active = active.shadowRoot?.activeElement ?? null
    }
    const selection = doc.defaultView?.getSelection()
    if (selection && selection.rangeCount > 0) {
      for (const input of Array.from(doc.querySelectorAll('input'))) {
        if (isSensitive(input) && selection.containsNode(input, true)) return true
      }
    }
    if (depth >= 4) return false
    for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
      let inner: Document | null = null
      try {
        inner = frame.contentDocument
      } catch {
        inner = null
      }
      if (inner && touches(inner, depth + 1)) return true
    }
    return false
  }
  return touches(document, 0)
}

export const SELECTION_PROBE_SOURCE = `(${selectionTouchesSensitiveField.toString()})()`
