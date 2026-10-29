import { useState } from "react";
import {
  MousePointer2,
  Pencil,
  Highlighter,
  Square,
  Circle,
  ArrowUpRight,
  ChevronDown,
  Hand,
  Eraser,
  Lasso,
  Type,
} from "../ui/icons";
import { boardToolKeys, boardToolShortcut, boardTools } from "./board-tools";
import type { BoardTool } from "./types";
import "./board-tools.css";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";

const icons = [
  MousePointer2,
  Pencil,
  Highlighter,
  Square,
  Circle,
  ArrowUpRight,
  Hand,
  Eraser,
  Lasso,
  Type,
];

export function BoardTools({
  tool,
  onChange,
}: {
  tool: BoardTool | null;
  onChange: (tool: BoardTool | null) => void;
}) {
  const t = useTranslator(messages);
  const [expanded, setExpanded] = useState(true);
  const mobile =
    typeof document !== "undefined" &&
    document.documentElement.dataset.native === "ios";
  const entries = boardTools
    .map((entry, index) => ({
      ...entry,
      Icon: icons[index],
    }))
    .filter((entry) => !mobile || !["lasso", "pan"].includes(entry.tool ?? ""));
  return (
    <div
      className="board-tool-stack"
      style={{ "--board-tool-count": entries.length } as React.CSSProperties}
    >
      <div className="board-tool-shortcuts">
        <button
          type="button"
          className="board-tool-disclosure"
          aria-label={
            expanded ? t("tool.hideShortcuts") : t("tool.showShortcuts")
          }
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown
            size={12}
            style={expanded ? undefined : { transform: "rotate(180deg)" }}
          />
        </button>
        {expanded && (
          <div className="board-tool-keys" aria-hidden="true">
            {entries.map(({ key }) => (
              <kbd key={key}>{key}</kbd>
            ))}
          </div>
        )}
      </div>
      <div className="board-tool-buttons">
        {entries.map(({ tool: value, label, key, Icon }) => {
          return (
            <button
              type="button"
              key={key}
              aria-label={t(label)}
              aria-keyshortcuts={boardToolKeys(value).join(" ")}
              title={mobile ? t(label) : t("tool.withShortcut", {
                label: t(label),
                key: boardToolShortcut(value),
              })}
              aria-pressed={tool === value}
              onClick={() => onChange(value)}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
