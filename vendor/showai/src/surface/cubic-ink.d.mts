import type { PortableInkV2 } from "./portable-ink.mjs";
import type { CompiledInkInput } from "./ink-kernel/compiled-ink-input.mjs";
import type {
  InkStrokeCommand,
  InkStrokeResult,
} from "./ink-kernel/ink-stroke-kernel.mjs";
export const CUBIC_INK_CHUNK_SEGMENTS: 128;
export const CUBIC_INK_MAX_COMMANDS: 1000000;
export const CUBIC_INK_MAX_CHUNK_COMMANDS: 100000;
export const CUBIC_INK_MAX_LEAVES: 100000;
export interface CubicInkChunk {
  start: number;
  end: number;
  commands: InkStrokeCommand[];
  statistics: InkStrokeResult;
  bounds: { x: number; y: number; width: number; height: number };
}
export interface CubicInkGeometry {
  commands: InkStrokeCommand[];
  path: string;
  statistics: InkStrokeResult;
  chunks: CubicInkChunk[];
  bounds: { x: number; y: number; width: number; height: number };
}
/** Fixed128 source partition, one paint. 1M aggregate commands/100k leaves,
 * 100k commands per actual derived block. No source points are discarded. */
export function cubicInkGeometry(
  ink: PortableInkV2,
  width?: number,
  pressure?: boolean,
): CubicInkGeometry;
export function cubicInkChunks(
  ink: PortableInkV2,
  width?: number,
  pressure?: boolean,
): CubicInkChunk[];
export function cubicInkQueryGeometry(
  ink: PortableInkV2,
  width?: number,
  pressure?: boolean,
): {
  bounds: { x: number; y: number; width: number; height: number };
  polygons: { x: number; y: number }[][];
};
export function cubicInkBounds(
  ink: PortableInkV2,
  width?: number,
  pressure?: boolean,
): { x: number; y: number; width: number; height: number };
export function cubicInkHit(
  ink: PortableInkV2,
  point: { x: number; y: number },
  width?: number,
  pressure?: boolean,
): { inside: boolean; distance: number; solid: true; area: number };
export function cubicInkFromInput(
  input: CompiledInkInput,
  options: {
    sourceID: string;
    extent: [number, number];
    origin?: { x: number; y: number };
    brush?: PortableInkV2["brush"];
    opacity?: number;
    outlineTolerance?: number;
    capture?: boolean;
  },
): PortableInkV2;
