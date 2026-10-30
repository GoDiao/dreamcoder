import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { NodeLayout } from "./types";
import type { Point } from "./geometry.mjs";
export interface EndpointBinding {
  targetId: string;
  anchor: Point;
}
export interface ArrowBindings {
  start?: EndpointBinding;
  end?: EndpointBinding;
}
export type SurfaceIndex = Map<
  string,
  { node: JSONContent; parent: JSONContent | null }
>;
export function indexSurfaceTree(content: JSONContent): SurfaceIndex;
export function arrowEndpoints(node: JSONContent, frame: NodeLayout): Point[];
export function boundEndpoints(
  node: JSONContent,
  frame: NodeLayout,
  index: SurfaceIndex,
  layout: Record<string, NodeLayout>,
): Point[];
export function arrowFromEndpoints(
  node: JSONContent,
  frame: NodeLayout,
  endpoints: Point[],
  bindings?: ArrowBindings,
): { node: JSONContent; frame: NodeLayout };
export function reconcileConnections<T extends ShowDocument>(document: T): T;
export function bindingAtPoint(
  document: ShowDocument,
  parentId: string,
  point: Point,
  tolerance?: number,
  excluded?: Set<string>,
): EndpointBinding | null;
export function transformedBindings(
  bindings: ArrowBindings,
  transformedIds: Set<string>,
): ArrowBindings;
export function connectionAnchor(
  frame: NodeLayout,
  point: { x: number; y: number },
  snap?: number,
): { x: number; y: number };
