import type { JSONContent } from "@tiptap/core";
import type { NodeLayout } from "./types";
import type { Camera } from "./model";
export interface Point {
  pressure?: number;
  x: number;
  y: number;
}
export interface Bounds extends Point {
  width: number;
  height: number;
}
export interface SnapGuide {
  axis: "x" | "y";
  value: number;
  from: number;
  to: number;
  kind: "align" | "gap";
}
export interface SnapIndex {
  boxes: (Bounds & { id: string })[];
  x: { value: number; box: Bounds & { id: string } }[];
  y: SnapIndex["x"];
}
export function radians(degrees?: number): number;
export function rotatePoint(
  point: Point,
  center: Point,
  degrees?: number,
): Point;
export function frameAnchor(frame: NodeLayout, anchor: Point): Point;
export function normalizedAnchor(frame: NodeLayout, point: Point): Point;
export function frameCorners(frame: NodeLayout): Point[];
export function pointsBounds(points: Point[]): Bounds | null;
export function frameBounds(frame: NodeLayout): Bounds;
export function hitFrame(
  frame: NodeLayout,
  point: Point,
  tolerance?: number,
): boolean;
export function intersectsFrame(frame: NodeLayout, rect: NodeLayout): boolean;
export function screenToSurface(
  point: Point,
  origin: Point,
  camera: Camera,
): Point;
export function surfaceToScreen(
  point: Point,
  origin: Point,
  camera: Camera,
): Point;
export function objectCapabilities(node: JSONContent): {
  rotate: boolean;
  resizeHeight: boolean;
  bindTarget: boolean;
  minWidth: number;
  minHeight: number;
};
export function createSnapIndex(
  objects: { id: string; frame: NodeLayout }[],
): SnapIndex;
export function snapFrame(
  frame: NodeLayout,
  index: SnapIndex,
  scale?: number,
  resize?: boolean,
): { frame: NodeLayout; guides: SnapGuide[] };
export function resizeFrame(
  frame: NodeLayout,
  delta: Point,
  handle?: string,
  minimum?: { width: number; height: number },
  keepAspect?: boolean,
): NodeLayout;

export function frameHeight(frame: NodeLayout): number;
export function snapResizeFrame(
  frame: NodeLayout,
  index: SnapIndex,
  scale: number,
  handle: string,
  minimum: { width: number; height: number },
  keepAspect?: boolean,
): { frame: NodeLayout; guides: SnapGuide[] };
export function selectionMinimum(
  bounds: NodeLayout,
  objects: {
    frame: NodeLayout;
    minWidth: number;
    minHeight: number;
    resizeHeight: boolean;
  }[],
): { width: number; height: number };
export function bindingParent(
  parent: JSONContent | null | undefined,
  layout: Record<string, NodeLayout> | undefined,
): boolean;
export function translationDelta(frames: NodeLayout[], delta: Point): Point;
