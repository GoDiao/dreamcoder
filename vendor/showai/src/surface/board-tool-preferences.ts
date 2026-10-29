import type { BoardTool, DrawingStyle } from "./types";

export const boardToolPreferencesKey = "showai:board-tools:v1";
export const boardToolPreferencesChanged = "showai:board-tools-changed";
const tools = ["pen", "highlighter", "rectangle", "ellipse", "arrow", "region", "eraser", "text", "pan", "lasso"] as const;
export function boardStyleKey(tool: BoardTool | null) { return tool ?? "pen"; }
export function readBoardToolPreferences(): { tool: BoardTool | null; styles: Record<string, DrawingStyle> } {
  const styles = Object.fromEntries(tools.map(tool => [tool, {
    color: tool === "highlighter" ? "#facc15" : "#252629", fillColor: "none",
    strokeWidth: tool === "highlighter" ? 16 : tool === "eraser" ? 24 : 2.5,
    pressure: true,
  }])) as Record<string, DrawingStyle>;
  let saved: { tool?: unknown; styles?: Record<string, Partial<DrawingStyle>> } = {};
  try { saved = JSON.parse(localStorage.getItem(boardToolPreferencesKey) ?? "{}"); }
  catch { return { tool: null, styles }; }
  if (!saved || typeof saved !== "object") return { tool: null, styles };
  for (const tool of tools) {
    const value = saved.styles?.[tool];
    if (!value || typeof value !== "object") continue;
    for (const field of ["color", "fillColor"] as const)
      if (typeof value[field] === "string" && value[field]!.length > 0 && value[field]!.length <= 128) styles[tool][field] = value[field]!;
    if (typeof value.strokeWidth === "number" && Number.isFinite(value.strokeWidth) && value.strokeWidth >= 0.5 && value.strokeWidth <= 200) styles[tool].strokeWidth = value.strokeWidth;
    if (typeof value.pressure === "boolean") styles[tool].pressure = value.pressure;
    if (typeof value.labelSize === "number" && Number.isFinite(value.labelSize) && value.labelSize >= 8 && value.labelSize <= 200) styles[tool].labelSize = value.labelSize;
  }
  return { tool: tools.includes(saved.tool as BoardTool) ? saved.tool as BoardTool : null, styles };
}
export function saveBoardToolPreferences(update: { tool?: BoardTool | null; style?: { key: string; patch: Partial<DrawingStyle> } }) {
  const next = readBoardToolPreferences();
  if ("tool" in update) next.tool = update.tool ?? null;
  if (update.style) next.styles[update.style.key] = { ...next.styles[update.style.key], ...update.style.patch };
  localStorage.setItem(boardToolPreferencesKey, JSON.stringify(next));
  window.dispatchEvent(new Event(boardToolPreferencesChanged));
  return next;
}
