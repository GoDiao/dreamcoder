export * from "./cubic-ink.mjs";
import type { PortableInkV2 } from "./portable-ink.mjs";
import type { CubicInkGeometry } from "./cubic-ink.mjs";
export function cubicInkQueryFromGeometry(
  ink: PortableInkV2,
  geometry: CubicInkGeometry,
): {
  bounds: { x: number; y: number; width: number; height: number };
  polygons: { x: number; y: number }[][];
};
export function cubicInkHitFromGeometry(
  ink: PortableInkV2,
  geometry: CubicInkGeometry,
  point: { x: number; y: number },
): { inside: boolean; distance: number; solid: true; area: number };
