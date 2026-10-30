export type StrokePoint = [number, number];
export interface InkStrokeSegment {
  points: StrokePoint[];
  radius: [number, number];
}
export interface InkStrokeOptions {
  tolerance?: number;
  geometryVersion?: 1;
  maxDepth?: number;
  maxLeaves?: number;
  maxCommands?: number;
}
export interface InkStrokeStyle {
  sourceWidth: number;
  width: number;
  pressure: boolean;
}
export interface InkStrokeResult {
  commands: number;
  contours: number;
  envelopeCurves: number;
  fallbackLeaves: number;
  sampledChecks: number;
  leaves: number;
  maximumDepth: number;
  fallbackContours: number;
  sampledEnvelopeError: number;
  fallbackCenterBound: number;
  arcErrorBound: number;
}
export type InkStrokeCommand = ["M" | "L" | "Q" | "C" | "Z", ...number[]];
/** Round circular sweep geometry1; see C header for exact approximation,
 * empty/discontinuous/closed input and single-opacity nonzero-union semantics. */
export class CompiledInkStroke {
  constructor();
  counts(
    segments: InkStrokeSegment[],
    options?: InkStrokeOptions,
    style?: InkStrokeStyle,
  ): InkStrokeResult;
  build(
    segments: InkStrokeSegment[],
    options?: InkStrokeOptions,
    style?: InkStrokeStyle,
  ): { commands: InkStrokeCommand[]; result: InkStrokeResult };
  resolve(
    segments: InkStrokeSegment[],
    style: InkStrokeStyle,
  ): InkStrokeSegment[];
  pathGeometry(
    commands: InkStrokeCommand[],
    affine?: number[],
    tolerance?: number,
    maxPoints?: number,
  ): {
    bounds: { x: number; y: number; width: number; height: number };
    polygons: { x: number; y: number }[][];
  };
  pathBounds(
    commands: InkStrokeCommand[],
    affine?: number[],
  ): { x: number; y: number; width: number; height: number };
  pathHit(
    commands: InkStrokeCommand[],
    point: { x: number; y: number },
    affine?: number[],
    tolerance?: number,
    maxPoints?: number,
  ): { inside: boolean; distance: number; solid: true };
}
