export interface CanvasReference {
  surfaceId: string;
  kind: "point" | "region";
  x: number;
  y: number;
  width?: number;
  height?: number;
}
export const referenceRequest = "showai:agent-reference-request";
export const referencePicked = "showai:agent-reference-picked";
export const referenceDisplay = "showai:agent-reference-display";
export function referenceInstructions(value?: CanvasReference) {
  if (!value) return "";
  const round = (number: number) => Math.round(number * 10) / 10;
  return `\nOptional spatial reference on surfaceId=${value.surfaceId}: ${value.kind === "point" ? `point (${round(value.x)}, ${round(value.y)})` : `region x=${round(value.x)}, y=${round(value.y)}, width=${round(value.width ?? 0)}, height=${round(value.height ?? 0)}`}. Coordinates are in the canvas world space. This is a user-provided reference to understand the request, not a placement constraint or permission to modify additional content. Choose a suitable location and preserve ongoing human edits.`;
}
