import type { Node } from "@tiptap/pm/model";

/** Exclude a following paragraph whose content starts exactly at the selection end. */
export function selectionBlockIds(doc: Node, from: number, to: number) {
  const inner: string[] = [];
  const outer: string[] = [];
  doc.nodesBetween(from, to, (node, pos, parent) => {
    const id = node.attrs?.id;
    if (typeof id !== "string" || id.startsWith("page-tail-")) return;
    if (node.isTextblock) {
      const start = pos + 1;
      const end = start + node.content.size;
      if (
        Math.max(from, start) < Math.min(to, end) ||
        (node.content.size === 0 && from <= pos && to >= pos + node.nodeSize)
      )
        inner.push(id);
    } else if (parent === doc) outer.push(id);
  });
  return [...new Set(inner.length ? inner : outer)].slice(0, 100);
}
