import type { JSONContent } from "@tiptap/core";
import type { NodeLayout } from "./types";
import type { Point, SnapIndex, SnapGuide } from "./geometry.mjs";
export function drawingBounds(
  node: JSONContent,
): { x: number; y: number; width: number; height: number } | null;
export function geometryFrame(node: JSONContent, frame: NodeLayout): NodeLayout;
export function frameFromGeometry(
  node: JSONContent,
  stored: NodeLayout,
  visual: NodeLayout,
): NodeLayout;
export function shapeHit(
  node: JSONContent,
  frame: NodeLayout,
  point: Point,
): { inside: boolean; distance: number; solid: boolean; area: number };
export interface PickCandidate {
  id: string;
  node: JSONContent;
  frame: NodeLayout;
  point: Point;
  tolerance: number;
  scale: number;
  viewport?: NodeLayout;
}
export function pickShape<T extends PickCandidate>(
  candidates: T[],
  hitInside?: boolean,
): T | null;
export function pickSelection<T extends PickCandidate>(
  candidates: T[],
): T | null;
export function creationPoints(
  tool: string,
  origin: Point,
  current: Point,
  modifiers?: { shiftKey?: boolean; altKey?: boolean },
): Point[];

export function shapeIntersects(
  node: JSONContent,
  frame: NodeLayout,
  rect: NodeLayout,
  wrap?: boolean,
): boolean;
export function shapeIntersectsPolygon(
  node: JSONContent,
  frame: NodeLayout,
  polygon: Point[],
  tolerance?: number,
): boolean;

export function snapCreation(
  points: Point[],
  index: SnapIndex,
  scale: number,
  keepAspect?: boolean,
): { points: Point[]; guides: SnapGuide[] };

export function arrowHeadLength(
  a: Point,
  b: Point,
  strokeWidth?: number,
): number;
export function arrowPath(a: Point, b: Point, strokeWidth?: number): string;
export function smoothPath(points: Point[]): string;
