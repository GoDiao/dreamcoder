import type { NodeLayout } from "./types";
export type DiagramDirection = "right" | "down" | "left" | "up";
export interface DiagramNodeInput {
  id: string;
  shape?: "rectangle" | "ellipse";
  label?: string;
  labelSize?: number;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
  strokeWidth?: number;
}
export interface DiagramEdgeInput {
  id?: string;
  from: string;
  to: string;
  label?: string;
  labelSize?: number;
  name?: string;
  color?: string;
  strokeWidth?: number;
}
export interface DiagramInsertInput {
  parentId?: string | null;
  direction?: DiagramDirection;
  origin?: { x: number; y: number };
  spacing?: { node?: number; rank?: number };
  nodes: DiagramNodeInput[];
  edges?: DiagramEdgeInput[];
}
export function layoutGraph(
  nodes: { id: string; width: number; height: number }[],
  edges: { id?: string; from: string; to: string; label?: string; labelSize?: number }[],
  options?: {
    direction?: DiagramDirection;
    origin?: { x: number; y: number };
    spacing?: { node?: number; rank?: number };
  },
): Record<string, { x: number; y: number }>;
export function insertDiagram<T extends { content: unknown; layout?: unknown }>(
  document: T,
  operation: DiagramInsertInput,
): { document: T; shapeIds: string[]; arrowIds: string[] };
type Anchor = { x: number; y: number };
export function tidyFrames(
  document: { content: unknown; layout?: Record<string, NodeLayout> },
  ids: string[],
  direction?: DiagramDirection,
): {
  frames: Record<string, NodeLayout>;
  anchors: Record<string, { start: Anchor; end: Anchor }>;
} | null;
