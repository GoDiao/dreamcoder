import type { NodeLayout } from "./types";
export const DEFAULT_DRAWING_COLOR: string;
export function facingAnchor(
  frame: NodeLayout,
  toward: { x: number; y: number },
): { x: number; y: number };
export function completeDrawings<T extends { content: unknown; layout?: unknown }>(
  document: T,
  sets: { framed: Set<string>; fresh: Set<string> },
): T;
