export interface PortableInkV1 {
  format: "showai-ink-v1";
  brushVersion: 1;
  brush: "pen" | "marker" | "pencil" | "monoline";
  strokeCount: 1;
  width: number;
  opacity: number;
  extent: [number, number];
  samples: number[][];
  transform: number[];
  mask?: (string | number)[][];
  sourceDrawing?: string;
  seed?: number;
  createdAt?: number;
}
export interface CubicInkCapture {
  format: "showai-input-capture-v1";
  sourceID: string;
  configuration: Required<
    import("./ink-kernel/compiled-ink-input.mjs").InkInputConfiguration
  > & { version: 1 };
  raw: number[][];
}
export interface PortableInkV2 {
  format: "showai-ink-v2";
  geometryVersion: 1;
  brushVersion: 1;
  brush: "pen" | "marker" | "monoline";
  strokeCount: 1;
  width: number;
  opacity: number;
  extent: [number, number];
  transform: number[];
  outlineTolerance: number;
  segments: import("./ink-kernel/ink-stroke-kernel.mjs").InkStrokeSegment[];
  capture?: CubicInkCapture;
}
export type PortableInk = PortableInkV1 | PortableInkV2;
export const PORTABLE_INK_FORMAT: "showai-ink-v1";
export const CUBIC_INK_FORMAT: "showai-ink-v2";
export const DEFAULT_OUTLINE_TOLERANCE: number;
export { cubicInkFromInput } from "./cubic-ink.mjs";
export {
  nativeBoardScenePatch,
  resolveNativeBoardScene,
} from "./native-board-scene.mjs";
export function isEditableDrawing(
  node: { type?: string; attrs?: Record<string, any> } | undefined,
): boolean;
export function portableInkSamples(
  ink: PortableInk,
  width?: number,
  pressure?: boolean,
): number[][];
export function portableNodeSamples(node: {
  attrs: Record<string, any>;
}): number[][];
export function portableNodeFragments(node: {
  attrs: Record<string, any>;
}): PortableInk[];
export function portableNodeBounds(node: { attrs: Record<string, any> }): {
  x: number;
  y: number;
  width: number;
  height: number;
};
export function portableNodeHit(
  node: { attrs: Record<string, any> },
  point: { x: number; y: number },
): { inside: boolean; distance: number; solid: boolean; area: number };
export function inkFramePose(
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
  },
  extent: number[],
): number[];
export function inkModelPoses(
  document: any,
  boardId: string,
  previous?: Record<string, number[]>,
): { poses: Record<string, number[]>; nested: boolean; complete: boolean };
export function portableInkColor(color: string, dark?: boolean): string;
export function isPortableInk(ink: unknown): ink is PortableInk;
export function isInkNode(node: {
  type?: string;
  attrs?: Record<string, any>;
}): boolean;
export function portableNodeInk(node: {
  attrs: Record<string, any>;
}): PortableInk;
export function createPortableInk(
  points: { x: number; y: number; pressure?: number }[],
  width: number,
  extent: [number, number],
  brush?: PortableInk["brush"],
  pressure?: boolean,
): PortableInkV1;
export function validatePortableInk(ink: unknown): PortableInk;
export function portableInkGeometry(
  ink: PortableInk,
  strokeWidth?: number,
  pressure?: boolean,
): { path: string; mask?: string; polygons: { x: number; y: number }[][] };
export function portableInkHit(
  ink: PortableInk,
  point: { x: number; y: number },
  strokeWidth?: number,
  pressure?: boolean,
): { inside: boolean; distance: number; solid: boolean; area: number };
export function portableInkBounds(
  ink: PortableInk,
  strokeWidth?: number,
  pressure?: boolean,
): { x: number; y: number; width: number; height: number };

export function inkScenePatch(
  document: any,
  boardId: string,
  previous?: any,
): { document: any; nodes: any[] };
