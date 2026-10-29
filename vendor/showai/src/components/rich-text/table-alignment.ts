import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, type EditorState, type Transaction } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import type { TableAlignment } from "../blocks/TableAlignment";
import { translator } from "../../i18n";
import messages from "../../i18n/messages/richText";

const t = translator(messages);

export const TableAlignmentAttributes = Extension.create({
  name: "tableAlignment",
  addGlobalAttributes() {
    return [
      {
        types: ["table", "tableCell", "tableHeader"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              ["left", "center", "right"].includes(element.style.textAlign)
                ? element.style.textAlign
                : null,
            renderHTML: (attributes: Record<string, unknown>) =>
              ["left", "center", "right"].includes(String(attributes.textAlign))
                ? { style: `text-align: ${attributes.textAlign}` }
                : {},
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const thisEditor = this.editor;
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (
            !thisEditor.isEditable ||
            !transactions.some((transaction) => transaction.docChanged)
          )
            return null;
          const tr = state.tr;
          state.doc.descendants((node, position) => {
            if (node.type.name !== "table") return;
            const map = TableMap.get(node);
            const defaults = Array.from({ length: map.width }, (_, column) => {
              const values = new Set(
                Array.from(
                  { length: map.height },
                  (_, row) =>
                    node.nodeAt(map.map[row * map.width + column])?.attrs
                      .textAlign,
                ).filter(Boolean),
              );
              return values.size === 1 ? [...values][0] : node.attrs.textAlign;
            });
            forEachCell(node, position, (cell, cellPosition) => {
              if (cell.attrs.textAlign) return;
              const rect = map.findCell(cellPosition - position - 1);
              const values = new Set(defaults.slice(rect.left, rect.right));
              const alignment =
                values.size === 1 ? [...values][0] : node.attrs.textAlign;
              if (alignment)
                tr.setNodeAttribute(cellPosition, "textAlign", alignment);
            });
          });
          return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },
});

function forEachCell(
  table: Node,
  tablePosition: number,
  visit: (cell: Node, position: number) => void,
) {
  table.forEach((row, rowOffset) =>
    row.forEach((cell, cellOffset) =>
      visit(cell, tablePosition + 2 + rowOffset + cellOffset),
    ),
  );
}

export function tableAlignmentValue(
  table: Node,
  column: number | null,
): string | null {
  const positions = cellPositions(table, column);
  const values = positions.map(
    (position) =>
      table.nodeAt(position)?.attrs.textAlign ??
      table.attrs.textAlign ??
      "left",
  );
  return values.every((value) => value === values[0])
    ? (values[0] ?? "left")
    : null;
}

function cellPositions(table: Node, column: number | null): number[] {
  const map = TableMap.get(table);
  if (
    column !== null &&
    (!Number.isInteger(column) || column < 0 || column >= map.width)
  )
    throw new Error(t("table.columnOutOfRange"));
  // Map offsets include cells spanning several rows or columns only once.
  return [
    ...new Set(
      column === null
        ? map.map
        : Array.from(
            { length: map.height },
            (_, row) => map.map[row * map.width + column],
          ),
    ),
  ];
}

export function alignDocumentTable(
  state: EditorState,
  tablePosition: number,
  column: number | null,
  alignment: TableAlignment,
): Transaction {
  const table = state.doc.nodeAt(tablePosition);
  if (!table || table.type.name !== "table")
    throw new Error(t("table.notATable"));
  const tr = state.tr;
  if (column === null)
    tr.setNodeAttribute(tablePosition, "textAlign", alignment);
  for (const offset of cellPositions(table, column)) {
    const position = tablePosition + 1 + offset;
    const cell = state.doc.nodeAt(position)!;
    tr.setNodeAttribute(position, "textAlign", alignment);
    // Existing paragraph formatting must not override the chosen column alignment.
    cell.descendants((node, childOffset) => {
      if (node.type.name === "table") return false;
      if (
        ["paragraph", "heading"].includes(node.type.name) &&
        node.attrs.textAlign
      )
        tr.setNodeAttribute(position + 1 + childOffset, "textAlign", null);
    });
  }
  return tr;
}
