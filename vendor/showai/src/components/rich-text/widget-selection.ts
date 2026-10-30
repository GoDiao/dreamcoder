import { GapCursor } from "@tiptap/pm/gapcursor";
import { NodeSelection, Selection, type EditorState } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";

/** Clear an atom selection without changing the document or selecting another atom. */
export function clearWidgetSelection(state: EditorState) {
  const current = state.selection;
  if (
    !(current instanceof NodeSelection) ||
    current.node.type.name !== "widget"
  )
    return null;
  const text =
    Selection.findFrom(current.$to, 1, true) ??
    Selection.findFrom(current.$from, -1, true);
  // Mapping validates the gap through the public API, including an atom-only page.
  const gap = text
    ? null
    : new GapCursor(state.doc.resolve(state.doc.content.size)).map(
        state.doc,
        new Mapping(),
      );
  const next = text ?? (gap instanceof GapCursor ? gap : null);
  return next
    ? state.tr.setSelection(next).setMeta("addToHistory", false)
    : null;
}
