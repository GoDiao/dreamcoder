import type { JSONContent } from "@tiptap/core";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
} from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/pageOutline";
import { pageOutlineNodes, type ManualOutlineEntry } from "./page-outline.mjs";
export function ManualOutlineEditor({
  page,
  entries,
  onChange,
}: {
  page: JSONContent;
  entries: ManualOutlineEntry[];
  onChange: (entries: ManualOutlineEntry[]) => void;
}) {
  const t = useTranslator(messages);
  const label = (node: JSONContent): string =>
    node.text ??
    node.content?.map(label).join("") ??
    node.attrs?.name ??
    node.type ??
    "";
  const targets = [...pageOutlineNodes(page)]
    .filter(([, node]) => node.type !== "text")
    .map(([id, node]) => ({
      id,
      label: (label(node) || node.attrs?.name || node.type).slice(0, 100),
    }));
  const act = (
    id: string,
    action:
      | "up"
      | "down"
      | "indent"
      | "outdent"
      | "remove"
      | Partial<ManualOutlineEntry>,
  ) => {
    const next = structuredClone(entries);
    const visit = (
      siblings: ManualOutlineEntry[],
      parent?: { siblings: ManualOutlineEntry[]; index: number },
    ): boolean => {
      const index = siblings.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        if (typeof action === "object") Object.assign(siblings[index], action);
        else if (action === "remove") siblings.splice(index, 1);
        else if (action === "up" && index > 0)
          [siblings[index - 1], siblings[index]] = [
            siblings[index],
            siblings[index - 1],
          ];
        else if (action === "down" && index < siblings.length - 1)
          [siblings[index + 1], siblings[index]] = [
            siblings[index],
            siblings[index + 1],
          ];
        else if (action === "indent" && index > 0) {
          const child = siblings.splice(index, 1)[0];
          (siblings[index - 1].children ??= []).push(child);
        } else if (action === "outdent" && parent)
          parent.siblings.splice(
            parent.index + 1,
            0,
            siblings.splice(index, 1)[0],
          );
        return true;
      }
      return siblings.some(
        (entry, index) =>
          entry.children && visit(entry.children, { siblings, index }),
      );
    };
    visit(next);
    onChange(next);
  };
  const render = (values: ManualOutlineEntry[], depth = 0) => (
    <ol>
      {values.map((entry, index) => (
        <li key={entry.id}>
          <div className="outline-manual-row">
            <input
              aria-label={t("entryTitle")}
              value={entry.title ?? ""}
              placeholder={
                targets.find((target) => target.id === entry.nodeId)?.label ??
                t("group")
              }
              onChange={(event) =>
                act(entry.id, { title: event.target.value || undefined })
              }
            />
            <select
              aria-label={t("entryTarget")}
              value={entry.nodeId ?? ""}
              onChange={(event) =>
                act(entry.id, {
                  nodeId: event.target.value || undefined,
                  ...(!event.target.value && !entry.title
                    ? { title: t("group") }
                    : {}),
                })
              }
            >
              <option value="">{t("group")}</option>
              {entry.nodeId &&
                !targets.some((target) => target.id === entry.nodeId) && (
                  <option value={entry.nodeId}>{t("missingTarget")}</option>
                )}
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
            <div className="outline-manual-actions">
              {(
                [
                  ["up", ArrowUp, index === 0],
                  ["down", ArrowDown, index === values.length - 1],
                  ["indent", ChevronRight, index === 0 || depth >= 23],
                  ["outdent", ChevronLeft, depth === 0],
                  ["remove", Trash2, false],
                ] as const
              ).map(([action, Icon, disabled]) => (
                <button
                  key={action}
                  type="button"
                  aria-label={t(action === "remove" ? "removeEntry" : action)}
                  disabled={disabled}
                  onClick={() => act(entry.id, action)}
                >
                  <Icon size={13} />
                </button>
              ))}
            </div>
          </div>
          {entry.children?.length ? render(entry.children, depth + 1) : null}
        </li>
      ))}
    </ol>
  );
  return (
    <div className="outline-manual-editor">
      {render(entries)}
      <button
        type="button"
        className="outline-manual-add"
        onClick={() =>
          onChange([...entries, { id: crypto.randomUUID(), title: t("group") }])
        }
      >
        <Plus size={14} />
        {t("addEntry")}
      </button>
    </div>
  );
}
