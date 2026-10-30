import type { EditorState } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { Fragment } from "@tiptap/pm/model";

export const textRangeEditMeta = "showaiTextRangeEdit";
export interface TextEditRange {
  from: number;
  to: number;
}
/** Delete only characters. Structural boundaries and component nodes stay intact. */
export function replaceTextRanges(
  state: EditorState,
  ranges: TextEditRange[],
  text: string,
  insert = true,
) {
  const sorted = ranges
    .filter((range) => range.to > range.from)
    .sort((a, b) => a.from - b.from);
  if (!sorted.length) return null;
  const merged: TextEditRange[] = [];
  for (const range of sorted) {
    let textOnly = true;
    state.doc.nodesBetween(range.from, range.to, (node) => {
      if (!node.isText && node.isLeaf && node.type.name !== "hardBreak")
        textOnly = false;
    });
    if (
      !textOnly ||
      !state.doc.resolve(range.from).sameParent(state.doc.resolve(range.to))
    )
      throw new Error("A text edit must stay inside a single text block.");
    const last = merged.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  const tr = state.tr;
  for (const range of [...merged].reverse()) tr.delete(range.from, range.to);
  const position = tr.mapping.map(merged[0].from, -1);
  let size = 0;
  if (insert && text) {
    const $position = tr.doc.resolve(position);
    const marks = state.doc.resolve(merged[0].from).marks();
    if ($position.parent.type.spec.code || !text.includes("\n")) {
      tr.insertText(text, position);
      size = text.length;
    } else {
      const nodes = text
        .split(/\r?\n/)
        .flatMap((line, index) => [
          ...(index ? [state.schema.nodes.hardBreak.create()] : []),
          ...(line ? [state.schema.text(line, marks)] : []),
        ]);
      const fragment = Fragment.fromArray(nodes);
      size = fragment.size;
      tr.insert(position, fragment);
    }
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(position + size)));
  return tr;
}
