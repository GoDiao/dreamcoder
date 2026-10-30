export interface TextEntry {
  node: Text | HTMLIFrameElement | HTMLBRElement;
  start: number;
  end: number;
}
/** Keep this factory self-contained: sandboxed components receive this exact code. */
export function createTextModel(
  root: Element,
  frameText: (frame: HTMLIFrameElement) => string = () => "",
) {
  const doc = root.ownerDocument;
  const excluded =
    'button,input,textarea,select,summary,[role="button"],[role="slider"],[data-surface-ui],.editor-toolbar,.editor-bubble,.block-handle,.block-menu,[data-surface-handle],script,style,[hidden],svg[aria-hidden="true"],.katex-mathml';
  const entries: TextEntry[] = [];
  let text = "",
    previousBlock: Element | null = null;
  const walker = doc.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (node instanceof Element) {
          const style = getComputedStyle(node);
          if (
            node.matches(excluded) ||
            style.display === "none" ||
            style.visibility === "hidden"
          )
            return NodeFilter.FILTER_REJECT;
          return node instanceof HTMLIFrameElement ||
            node instanceof HTMLBRElement
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
        const parent = node.parentElement!;
        if (
          !node.textContent ||
          getComputedStyle(parent).userSelect === "none" ||
          (!node.textContent.trim() &&
            /[\n\r]/.test(node.textContent) &&
            !getComputedStyle(parent).whiteSpace.startsWith("pre"))
        )
          return NodeFilter.FILTER_REJECT;
        const bounds = doc.createRange();
        bounds.selectNodeContents(node);
        if (!bounds.getClientRects().length) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  while (walker.nextNode()) {
    const node = walker.currentNode as Text | HTMLIFrameElement | HTMLBRElement;
    const value =
      node instanceof HTMLIFrameElement
        ? frameText(node)
        : node instanceof HTMLBRElement
          ? "\n"
          : node.data;
    const block = (
      node instanceof Element ? node : node.parentElement!
    )?.closest(
      "p,div,section,article,li,pre,td,th,h1,h2,h3,h4,h5,h6,blockquote",
    );
    if (entries.length && block !== previousBlock)
      text +=
        block?.closest("tr") &&
        block.closest("tr") === previousBlock?.closest("tr")
          ? "\t"
          : "\n";
    previousBlock = block ?? null;
    const start = text.length;
    text += value;
    entries.push({ node, start, end: text.length });
  }
  const offsetAt = (node: Node, offset: number) => {
    const entry = entries.find((entry) => entry.node === node);
    return entry
      ? entry.start + Math.max(0, Math.min(entry.end - entry.start, offset))
      : null;
  };
  const ranges = (from: number, to: number) =>
    entries.flatMap((entry) => {
      if (
        entry.node instanceof HTMLIFrameElement ||
        entry.end <= from ||
        entry.start >= to
      )
        return [];
      const range = doc.createRange();
      if (entry.node instanceof HTMLBRElement) range.selectNode(entry.node);
      else {
        range.setStart(
          entry.node,
          Math.min(entry.node.length, Math.max(from - entry.start, 0)),
        );
        range.setEnd(
          entry.node,
          Math.min(
            entry.node.length,
            to - entry.start,
            entry.end - entry.start,
          ),
        );
      }
      return [range];
    });
  return { entries, text, offsetAt, ranges };
}
