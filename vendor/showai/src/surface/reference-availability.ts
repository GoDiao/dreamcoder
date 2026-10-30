// Track mounted, enabled pickers rather than inferring availability from the
// resource kind: Pages can contain Boards, and Boards can be locked or hidden.
const pickers = new Map<string, Set<symbol>>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export function registerReferencePicker(pageId: string) {
  const token = Symbol();
  const entries = pickers.get(pageId) ?? new Set<symbol>();
  entries.add(token);
  pickers.set(pageId, entries);
  changed();
  return () => {
    entries.delete(token);
    if (!entries.size) pickers.delete(pageId);
    changed();
  };
}

export const referenceAvailable = (pageId: string | null) =>
  !!pageId && !!pickers.get(pageId)?.size;

export function subscribeReferenceAvailability(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
