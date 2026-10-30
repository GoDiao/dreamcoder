import type { BoardTool } from "./types";
import type { MessageKey, Translator } from "../i18n";
import type messages from "../i18n/messages/surface";

export const boardTools: {
  tool: BoardTool | null;
  label: MessageKey<typeof messages>;
  key: string;
  aliases: string[];
}[] = [
  { tool: null, label: "tool.select", key: "1", aliases: ["v"] },
  { tool: "pen", label: "tool.pen", key: "2", aliases: ["p"] },
  { tool: "highlighter", label: "tool.highlighter", key: "3", aliases: ["h"] },
  { tool: "rectangle", label: "tool.rectangle", key: "4", aliases: ["r"] },
  { tool: "ellipse", label: "tool.ellipse", key: "5", aliases: ["e", "o"] },
  { tool: "arrow", label: "tool.arrow", key: "6", aliases: ["a"] },
  { tool: "pan", label: "tool.pan", key: "8", aliases: ["m"] },
  { tool: "eraser", label: "tool.eraser", key: "9", aliases: ["x"] },
  { tool: "lasso", label: "tool.lasso", key: "L", aliases: ["l"] },
  { tool: "text", label: "tool.text", key: "T", aliases: ["t"] },
];

export function boardToolForKey(key: string) {
  const lower = key.toLowerCase();
  return boardTools.find(
    (entry) => entry.key === key || entry.aliases.includes(lower),
  );
}

/** Every key that picks the tool, letters first, e.g. ["E", "O", "5"]. */
export function boardToolKeys(tool: BoardTool | null) {
  const entry = boardTools.find((item) => item.tool === tool);
  return entry
    ? [...entry.aliases.map((alias) => alias.toUpperCase()), entry.key].filter(
        (key, index, all) => all.indexOf(key) === index,
      )
    : [];
}

/** Tooltip shortcut text, e.g. "P / 2". */
export function boardToolShortcut(tool: BoardTool | null) {
  return boardToolKeys(tool).join(" / ");
}

/**
 * The board's keyboard help, built from the same table the key handler reads
 * so the description cannot name keys that do nothing.
 */
export function boardEditDescription(
  t: Translator<(typeof messages)["catalogs"]["zh-CN"]>,
) {
  return t("board.descriptionEdit", {
    pan: boardToolShortcut("pan"),
    tools: boardTools
      .map((entry) =>
        t("board.toolKeys", {
          keys: boardToolShortcut(entry.tool),
          label: t(entry.label),
        }),
      )
      .join(t("board.toolKeysSeparator")),
  });
}
