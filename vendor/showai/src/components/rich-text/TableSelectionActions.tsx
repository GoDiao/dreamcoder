import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { TableCellsMerge, TableCellsSplit, X } from "../../ui/icons";
import {
  documentTableActionMeta,
  documentTableSelection,
} from "./table-selection";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/richText";

/** Shared actions for the selection and context menu slots. */
export function TableSelectionActions({
  editor,
  context = false,
  onAction,
}: {
  editor: Editor;
  context?: boolean;
  onAction?: () => void;
}) {
  const t = useTranslator(messages);
  const selected = documentTableSelection(editor.state);
  if (!selected && !context && !editor.can().splitCell()) return null;
  const run = (command: "mergeCells" | "splitCell") => {
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor
      .chain()
      .setMeta(documentTableActionMeta, true)
      .focus()
      [command]()
      .run();
    onAction?.();
  };
  return (
    <>
      {!context && <span className="toolbar-divider" aria-hidden="true" />}
      <div
        className="editor-table-actions"
        role="group"
        aria-label={t("table.cellActions")}
      >
        {selected && (
          <span className="editor-menu-status" role="status">
            {selected.rows === 1 && selected.columns === 1
              ? t("table.shiftClickHint")
              : t("table.selectedCells", {
                  rows: selected.rows,
                  columns: selected.columns,
                })}
          </span>
        )}
        {(
          [
            ["mergeCells", t("table.mergeCells"), TableCellsMerge],
            ["splitCell", t("table.splitCell"), TableCellsSplit],
          ] as const
        ).map(([command, label, Icon]) => (
          <button
            key={command}
            type="button"
            className="editor-tool"
            role={context ? "menuitem" : undefined}
            aria-label={label}
            title={label}
            disabled={!editor.can()[command]()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(command)}
          >
            <Icon size={16} />
            {context && <span>{label}</span>}
          </button>
        ))}
        {!context && selected && (
          <button
            type="button"
            className="editor-tool"
            aria-label={t("table.clearSelection")}
            title={t("table.clearSelection")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              editor.view.dispatch(
                editor.state.tr.setSelection(
                  TextSelection.near(editor.state.selection.$from),
                ),
              );
              editor.view.focus();
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
    </>
  );
}
