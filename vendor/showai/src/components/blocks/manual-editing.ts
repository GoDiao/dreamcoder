/**
 * Built-in components whose parameters a person can change by hand: a settings
 * form (BlockSettings) or direct editing on the canvas. Every other component,
 * including custom components, is changed through an agent; their raw JSON stays
 * an advanced option.
 */
const SETTINGS_FORM = new Set([
  "chart",
  "database",
  "metrics",
  "playground",
  "gallery",
  "bookmark",
  "references",
  "video",
  "audio",
  "pdf",
  "archify",
  "diagram-design",
  "fireworks-tech-graph",
]);
const EDITED_IN_PLACE = new Set(["mindmap", "flowchart", "text"]);

export function supportsManualEditing(kind: string): boolean {
  return (
    SETTINGS_FORM.has(kind) || EDITED_IN_PLACE.has(kind) || kind.startsWith("g2-")
  );
}
