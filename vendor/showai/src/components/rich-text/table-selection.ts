import type { EditorState } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";
import { CellSelection, cellAround, TableMap } from "@tiptap/pm/tables";

export const documentTableActionMeta = "showaiTableAction";

/** Select logical rows/columns, including any cells that already span them. */
export function selectDocumentTableCells(
  state: EditorState,
  tablePosition: number,
  scope: "cell" | "row" | "column",
) {
  const table = state.doc.nodeAt(tablePosition);
  if (table?.type.name !== "table") return null;
  const current =
    state.selection instanceof CellSelection
      ? state.selection.$headCell
      : cellAround(state.selection.$head);
  const $cell =
    current && current.before(-1) === tablePosition
      ? current
      : state.doc.resolve(tablePosition + 1 + TableMap.get(table).map[0]);
  const selection =
    scope === "row"
      ? CellSelection.rowSelection($cell)
      : scope === "column"
        ? CellSelection.colSelection($cell)
        : new CellSelection($cell);
  return state.tr.setSelection(selection);
}

export function documentTableSelection(state: EditorState) {
  const selection = state.selection;
  if (!(selection instanceof CellSelection)) return null;
  const table = selection.$anchorCell.node(-1);
  const start = selection.$anchorCell.start(-1);
  const rect = TableMap.get(table).rectBetween(
    selection.$anchorCell.pos - start,
    selection.$headCell.pos - start,
  );
  return {
    tablePosition: start - 1,
    rows: rect.bottom - rect.top,
    columns: rect.right - rect.left,
  };
}

/** Follow stable cell IDs when saved content is normalized or updated externally. */
export function restoreDocumentTableCellSelection(
  doc: Node,
  selection: CellSelection,
) {
  const anchorId = selection.$anchorCell.nodeAfter?.attrs.id;
  const headId = selection.$headCell.nodeAfter?.attrs.id;
  if (!anchorId || !headId) return null;
  let anchor: number | undefined;
  let head: number | undefined;
  doc.descendants((node, position) => {
    if (!["tableCell", "tableHeader"].includes(node.type.name)) return;
    if (node.attrs.id === anchorId) anchor = position;
    if (node.attrs.id === headId) head = position;
  });
  if (anchor === undefined && head === undefined) return null;
  // Undoing a split/merge can remove one endpoint while retaining the other.
  anchor ??= head;
  head ??= anchor;
  if (anchor === undefined || head === undefined) return null;
  const $anchor = doc.resolve(anchor);
  const $head = doc.resolve(head);
  if ($anchor.node(-1) !== $head.node(-1)) return null;
  return new CellSelection($anchor, $head);
}
