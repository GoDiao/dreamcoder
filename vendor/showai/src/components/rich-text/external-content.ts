import type { JSONContent } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { sameEditorContent } from "../../editor/node-json";

/** Apply a remote change through ProseMirror's position mapping. Replacing the
 * whole document discards cursor mapping and makes undo remove remote edits. */
export function externalContentTransaction(
  state: EditorState,
  content: JSONContent,
): Transaction | null {
  if (sameEditorContent(state.doc, content)) return null;
  const next = state.schema.nodeFromJSON(content);
  const start = state.doc.content.findDiffStart(next.content);
  if (start === null) return null;
  const end = state.doc.content.findDiffEnd(next.content)!;
  let from = end.a,
    to = end.b;
  const overlap = start - Math.min(from, to);
  if (overlap > 0) {
    from += overlap;
    to += overlap;
  }
  return state.tr
    .replace(start, from, next.slice(start, to))
    .setMeta("addToHistory", false)
    .setMeta("preventUpdate", true);
}
