/** Screen-space cutouts must match painted UI, including scrolling/clipping.
 * Offscreen toolbar children still have DOM rectangles; sending those raw
 * rectangles to the native canvas would erase ink beyond the actual toolbar. */
export function inkUIRegions(elements: Iterable<Element>) {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const rectangles = new Map<Element, DOMRect>();
  const styleOf = (element: Element) => {
    let value = styles.get(element);
    if (!value) {
      value = getComputedStyle(element);
      styles.set(element, value);
    }
    return value;
  };
  const rectangleOf = (element: Element) => {
    let value = rectangles.get(element);
    if (!value) {
      value = element.getBoundingClientRect();
      rectangles.set(element, value);
    }
    return value;
  };
  const clips = (overflow: string) =>
    /^(auto|scroll|hidden|clip)$/.test(overflow);
  const regions: { x: number; y: number; width: number; height: number }[] = [];
  for (const element of elements) {
    const style = styleOf(element);
    if (style.pointerEvents === "none" || style.visibility !== "visible")
      continue;
    const layer = element.closest(":popover-open,:modal");
    for (const rect of element.getClientRects()) {
      let left = Math.max(0, rect.left),
        top = Math.max(0, rect.top);
      let right = Math.min(innerWidth, rect.right),
        bottom = Math.min(innerHeight, rect.bottom);
      for (
        let parent = element === layer ? null : element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const parentStyle = styleOf(parent);
        const clipX = clips(parentStyle.overflowX), clipY = clips(parentStyle.overflowY);
        // Hidden candidates and non-clipping ancestors need no layout read.
        // All caches remain local to this one actual UI measurement.
        const rect = clipX || clipY ? rectangleOf(parent) : undefined;
        if (clipX) {
          left = Math.max(left, rect!.left);
          right = Math.min(right, rect!.right);
        }
        if (clipY) {
          top = Math.max(top, rect!.top);
          bottom = Math.min(bottom, rect!.bottom);
        }
        if (right <= left || bottom <= top || parent === layer) break;
      }
      if (right > left && bottom > top)
        regions.push({
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        });
    }
  }
  return regions;
}

/** The native scene owns presentation/input inside its retained DOM world.
 * That world is a layout mirror, not interactive overlay UI. A real top-layer
 * panel can escape it and still needs a cutout in the native input surface. */
export function nativeBoardUIRegions(elements: Iterable<Element>) {
  function* candidates() {
    for (const element of elements) {
      const world = element.closest('.page-surface[data-native-board-active="true"] > .surface-scroll > .surface-world');
      if (!world || element.closest(":popover-open,:modal")) yield element;
    }
  }
  return inkUIRegions(candidates());
}
