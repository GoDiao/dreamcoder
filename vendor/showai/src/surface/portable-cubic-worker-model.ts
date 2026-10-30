import {
  CompiledInkInput,
  inkInputConfiguration,
  type InkInputPoint,
  type InkInputSnapshot,
} from "./ink-kernel/compiled-ink-input.mjs";
import {
  CompiledInkStroke,
  type InkStrokeCommand,
  type InkStrokeResult,
} from "./ink-kernel/ink-stroke-kernel.mjs";
import {
  cubicInkFromInput,
  cubicInkGeometry,
  CUBIC_INK_CHUNK_SEGMENTS,
  CUBIC_INK_MAX_CHUNK_COMMANDS,
  CUBIC_INK_MAX_COMMANDS,
  CUBIC_INK_MAX_LEAVES,
} from "./cubic-ink-core.mjs";
import {
  validateCubicInk,
  DEFAULT_OUTLINE_TOLERANCE,
} from "./portable-ink-v2.mjs";
import type { PortableInkV2 } from "./portable-ink.mjs";
import type { NodeLayout } from "./types";
import type { JSONContent } from "@tiptap/core";
import {
  captureOwnedJSON,
  freezeOwnedJSON,
  ownedJSONMetrics,
} from "../portable/owned-json.mjs";

export interface CubicInputOptions {
  strokeId: string;
  pageId: string;
  boardId: string;
  tool: "pen" | "highlighter";
  color: string;
  width: number;
  pressure: boolean;
  creationZoom: number;
  origin: { x: number; y: number };
  name: string;
}
export interface CubicInputBatch {
  actual: InkInputPoint[];
  predicted: InkInputPoint[];
  corrections?: InkInputPoint[];
}
export type CubicInputRequest =
  | { kind: "ready" }
  | { kind: "begin"; options: CubicInputOptions; batch: CubicInputBatch }
  | { kind: "push"; strokeId: string; batches: CubicInputBatch[] }
  | { kind: "seal"; strokeId: string; batches: CubicInputBatch[] }
  | {
      kind: "prepare";
      ink?: PortableInkV2;
      sourceHandle?: string;
      width: number;
      pressure: boolean;
    }
  | { kind: "release"; strokeId: string };
export interface CubicPaintChunk {
  start: number;
  end: number;
  commands: InkStrokeCommand[];
  path: string;
  statistics: InkStrokeResult;
  bounds: { x: number; y: number; width: number; height: number };
}
export interface CubicPaintDelta {
  strokeId: string;
  baseGeneration: number;
  generation: number;
  firstChunk: number;
  chunkCount: number;
  chunks: CubicPaintChunk[];
  snapshot: InkInputSnapshot;
  work: {
    copiedSegments: number;
    preparedChunks: number;
    filteredPoints: number;
    fitEvaluations: number;
  };
}
export interface CubicSealedStroke {
  node: JSONContent;
  frame: NodeLayout;
  source: PortableInkV2;
  geometry: {
    commands: InkStrokeCommand[];
    chunks: CubicPaintChunk[];
    path: string;
    statistics: InkStrokeResult;
    bounds: { x: number; y: number; width: number; height: number };
  };
  width: number;
  pressure: boolean;
  configuration: ReturnType<typeof inkInputConfiguration>;
}
export interface CubicInputResponse {
  sourceHandle?: string;
  paint?: CubicPaintDelta;
  sealed?: CubicSealedStroke;
  geometry?: ReturnType<typeof cubicInkGeometry>;
}

const summed = [
  "commands",
  "contours",
  "envelopeCurves",
  "fallbackLeaves",
  "sampledChecks",
  "leaves",
  "fallbackContours",
] as const;
const maximized = [
  "maximumDepth",
  "sampledEnvelopeError",
  "fallbackCenterBound",
  "arcErrorBound",
] as const;
const emptyStatistics = (): InkStrokeResult => ({
  commands: 0,
  contours: 0,
  envelopeCurves: 0,
  fallbackLeaves: 0,
  sampledChecks: 0,
  leaves: 0,
  maximumDepth: 0,
  fallbackContours: 0,
  sampledEnvelopeError: 0,
  fallbackCenterBound: 0,
  arcErrorBound: 0,
});
const finite = (v: number) => typeof v === "number" && Number.isFinite(v);
const identity = (v: string) =>
  typeof v === "string" && v.length > 0 && v.length <= 200;
const union = (
  a: CubicPaintChunk["bounds"] | null,
  b: CubicPaintChunk["bounds"],
) =>
  a
    ? {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
        height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y),
      }
    : { ...b };
function path(commands: InkStrokeCommand[], dx = 0, dy = 0) {
  return commands
    .map((command) =>
      command
        .map((value, index) =>
          index === 0 ? value : (value as number) + (index % 2 ? dx : dy),
        )
        .join(" "),
    )
    .join(" ");
}

class Stroke {
  readonly input: CompiledInkInput;
  readonly options: CubicInputOptions;
  private chunks: CubicPaintChunk[] = [];
  private prefixes: {
    statistics: InkStrokeResult;
    bounds: CubicPaintChunk["bounds"] | null;
  }[] = [{ statistics: emptyStatistics(), bounds: null }];
  private generation = 0;
  private sealed = false;
  constructor(
    options: CubicInputOptions,
    private kernel: CompiledInkStroke,
  ) {
    options = captureOwnedJSON(options);
    if (
      ![options.strokeId, options.pageId, options.boardId].every(identity) ||
      !["pen", "highlighter"].includes(options.tool) ||
      typeof options.pressure !== "boolean" ||
      !finite(options.width) ||
      options.width < 0.5 ||
      options.width > 40 ||
      !finite(options.creationZoom) ||
      options.creationZoom < 0.001 ||
      options.creationZoom > 1024 ||
      !options.origin ||
      ![options.origin.x, options.origin.y].every(finite) ||
      typeof options.color !== "string" ||
      typeof options.name !== "string"
    )
      throw new Error("Invalid cubic input author context");
    this.options = options;
    this.input = new CompiledInkInput({
      width: options.width,
      creationZoom: options.creationZoom,
      mode: options.pressure ? 1 : 0,
    });
  }
  private update(batches: CubicInputBatch[], finish: boolean) {
    if (this.sealed) throw new Error("Cubic stroke is already sealed");
    let dirty = Infinity,
      filteredPoints = 0,
      fitEvaluations = 0;
    const observe = (snapshot: InkInputSnapshot) => {
      const curve = snapshot.curveCount
        ? this.input.curves(
            Math.min(snapshot.firstChangedCurve, snapshot.curveCount - 1),
            1,
          )[0]
        : undefined;
      dirty = Math.min(dirty, curve?.firstRaw ?? 0);
      filteredPoints += snapshot.filteredPoints;
      fitEvaluations += snapshot.fitEvaluations;
    };
    for (const batch of batches) {
      // Preserve actual DOM/coalesced batch boundaries. Backpressure can combine
      // messages, but never changes input-kernel call order or loses real knots.
      for (const point of batch.corrections ?? [])
        observe(this.input.correct(point));
      observe(this.input.push(batch.actual, batch.predicted));
    }
    if (finish) observe(this.input.finish());
    const snapshot = this.input.snapshot(),
      count = this.input.strokeSegmentCount();
    if (!count) throw new Error("A cubic contact requires an actual point");
    const firstChunk = Math.floor(
      (Number.isFinite(dirty) ? dirty : 0) / CUBIC_INK_CHUNK_SEGMENTS,
    );
    const prefix = this.prefixes[firstChunk];
    if (!prefix) throw new Error("Cubic changed suffix has no retained prefix");
    const statistics = { ...prefix.statistics },
      kernel = this.kernel,
      start = firstChunk * CUBIC_INK_CHUNK_SEGMENTS;
    const changed = this.input
      .strokeSegments(start, count - start)
      .map((segment) => ({ points: segment.points, radius: segment.radius }));
    const plans: {
      start: number;
      end: number;
      segments: typeof changed;
      options: {
        tolerance: number;
        maxDepth: number;
        maxLeaves: number;
        maxCommands: number;
      };
      counts: InkStrokeResult;
    }[] = [];
    for (
      let offset = 0;
      offset < changed.length;
      offset += CUBIC_INK_CHUNK_SEGMENTS
    ) {
      const segments = changed.slice(offset, offset + CUBIC_INK_CHUNK_SEGMENTS),
        remainingCommands = CUBIC_INK_MAX_COMMANDS - statistics.commands,
        remainingLeaves = CUBIC_INK_MAX_LEAVES - statistics.leaves;
      if (remainingCommands <= 0 || remainingLeaves <= 0)
        throw new RangeError("Cubic whole-stroke geometry budget exhausted");
      const options = {
        tolerance: DEFAULT_OUTLINE_TOLERANCE,
        maxDepth: 20,
        maxLeaves: remainingLeaves,
        maxCommands: Math.min(CUBIC_INK_MAX_CHUNK_COMMANDS, remainingCommands),
      };
      const counts = kernel.counts(segments, options, {
        sourceWidth: this.options.width,
        width: this.options.width,
        pressure: this.options.pressure,
      });
      for (const key of summed) statistics[key] += counts[key];
      for (const key of maximized)
        statistics[key] = Math.max(statistics[key], counts[key]);
      plans.push({
        start: start + offset,
        end: start + offset + segments.length,
        segments,
        options,
        counts,
      });
    }
    const replacements = plans.map((plan) => {
      const built = kernel.build(plan.segments, plan.options, {
        sourceWidth: this.options.width,
        width: this.options.width,
        pressure: this.options.pressure,
      });
      if (
        [...summed, ...maximized].some(
          (key) => built.result[key] !== plan.counts[key],
        )
      )
        throw new Error("Cubic counts changed during preparation");
      return {
        start: plan.start,
        end: plan.end,
        commands: built.commands,
        path: path(built.commands),
        statistics: built.result,
        bounds: kernel.pathBounds(built.commands),
      };
    });
    const baseGeneration = this.generation;
    // Commit only after the complete changed suffix has passed counts/build.
    // Prefix admission is O(1), not a scan of every historical chunk each frame.
    this.chunks.length = firstChunk;
    this.prefixes.length = firstChunk + 1;
    for (const chunk of replacements) {
      const prior = this.prefixes.at(-1)!,
        next = { ...prior.statistics };
      for (const key of summed) next[key] += chunk.statistics[key];
      for (const key of maximized)
        next[key] = Math.max(next[key], chunk.statistics[key]);
      this.chunks.push(chunk);
      this.prefixes.push({
        statistics: next,
        bounds: chunk.commands.length
          ? union(prior.bounds, chunk.bounds)
          : prior.bounds,
      });
    }
    this.generation = snapshot.generation;
    return {
      strokeId: this.options.strokeId,
      baseGeneration,
      generation: this.generation,
      firstChunk,
      chunkCount: this.chunks.length,
      chunks: replacements,
      snapshot,
      work: {
        copiedSegments: changed.length,
        preparedChunks: replacements.length,
        filteredPoints,
        fitEvaluations,
      },
    } satisfies CubicPaintDelta;
  }
  push(batches: CubicInputBatch[]) {
    return { paint: this.update(batches, false) };
  }
  seal(batches: CubicInputBatch[]): CubicInputResponse {
    const paint = this.update(batches, true),
      o = this.options;
    const box = this.prefixes.at(-1)!.bounds ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      extent: [number, number] = [
        Math.max(1, box.width),
        Math.max(1, box.height),
      ];
    const source = cubicInkFromInput(this.input, {
      sourceID: o.strokeId,
      extent,
      brush: o.tool === "highlighter" ? "marker" : "pen",
      capture: true,
    });
    // This is one fixed pen-down source basis. A legal post-geometry affine
    // locates the final frame; sealing never refits or rewrites the center/raw.
    source.transform = [1, 0, 0, 1, -box.x, -box.y];
    validateCubicInk(source);
    const commands: InkStrokeCommand[] = [],
      chunks: CubicPaintChunk[] = [],
      statistics = emptyStatistics();
    for (const chunk of this.chunks) {
      for (const command of chunk.commands) commands.push(command);
      for (const key of summed) statistics[key] += chunk.statistics[key];
      for (const key of maximized)
        statistics[key] = Math.max(statistics[key], chunk.statistics[key]);
      chunks.push({
        ...chunk,
        path: path(chunk.commands, -box.x, -box.y),
        bounds: this.kernel.pathBounds(chunk.commands, source.transform),
      });
    }
    const first = this.input.raw(0, 1)[0],
      last = this.input.raw(this.input.snapshot().actualCount - 1, 1)[0];
    const node: JSONContent = {
      type: "drawing",
      attrs: {
        id: o.strokeId,
        name: o.name,
        tool: o.tool,
        color: o.color,
        fillColor: "none",
        strokeWidth: o.width,
        pressure: o.pressure,
        extent,
        points: [
          { x: first.x - box.x, y: first.y - box.y },
          { x: last.x - box.x, y: last.y - box.y },
        ],
        ink: source,
      },
    };
    const frame = {
      x: o.origin.x + box.x,
      y: o.origin.y + box.y,
      width: extent[0],
      height: extent[1],
    };
    this.sealed = true;
    let canonicalBounds: CubicPaintChunk["bounds"] | null = null;
    for (const chunk of chunks)
      if (chunk.commands.length)
        canonicalBounds = union(canonicalBounds, chunk.bounds);
    return {
      paint,
      sealed: {
        node,
        frame,
        source,
        geometry: {
          commands,
          chunks,
          path: chunks.map((chunk) => chunk.path).join(" "),
          statistics,
          bounds: canonicalBounds ?? { x: 0, y: 0, width: 0, height: 0 },
        },
        width: o.width,
        pressure: o.pressure,
        configuration: this.input.config,
      },
    };
  }
}

/** One thread owns real input state and derived vectors. Nothing here touches
 * React, a camera callback, saved pages or a second geometry source format. */
export class PortableCubicInputOwner {
  private strokes = new Map<string, Stroke>();
  private kernel = new CompiledInkStroke();
  private sources = new Map<string, { ink: PortableInkV2; bytes: number }>();
  private sourceBytes = 0;
  private sourceSerial = 0;
  private remember(source: PortableInkV2) {
    const ink = freezeOwnedJSON(source),
      seen = new Set<object>();
    const resident = (value: object): number => {
      if (seen.has(value)) return 0;
      seen.add(value);
      const metric = ownedJSONMetrics(value);
      if (!metric)
        throw new Error("Actual worker source lacks recursive owned metrics");
      return (
        metric.bytes +
        metric.children.reduce((total, child) => total + resident(child), 0)
      );
    };
    const bytes = resident(ink),
      handle = String(++this.sourceSerial);
    this.sources.set(handle, { ink, bytes });
    this.sourceBytes += bytes;
    while (this.sources.size > 128 || this.sourceBytes > 32 * 1024 * 1024) {
      const oldest = this.sources.keys().next().value!;
      this.sourceBytes -= this.sources.get(oldest)!.bytes;
      this.sources.delete(oldest);
    }
    return this.sources.has(handle) ? handle : undefined;
  }
  execute(request: CubicInputRequest): CubicInputResponse {
    if (request.kind === "ready") {
      new CompiledInkInput();
      new CompiledInkStroke();
      return {};
    }
    if (request.kind === "prepare") {
      let ink: PortableInkV2;
      if (request.ink) {
        ink = captureOwnedJSON(request.ink);
      } else {
        const held =
          request.sourceHandle && this.sources.get(request.sourceHandle);
        if (!held) {
          const error = new Error("Actual cubic worker source was evicted");
          Object.assign(error, { code: "CUBIC_SOURCE_MISSING" });
          throw error;
        }
        ink = held.ink;
        this.sources.delete(request.sourceHandle!);
        this.sources.set(request.sourceHandle!, held);
      }
      const geometry = cubicInkGeometry(ink, request.width, request.pressure);
      return {
        geometry,
        sourceHandle: request.ink ? this.remember(ink) : request.sourceHandle,
      };
    }
    if (request.kind === "release") {
      this.strokes.delete(request.strokeId);
      return {};
    }
    if (request.kind === "begin") {
      if (this.strokes.has(request.options.strokeId) || this.strokes.size >= 32)
        throw new Error(
          "Cubic input owner already holds this contact or is at capacity",
        );
      const stroke = new Stroke(request.options, this.kernel);
      this.strokes.set(request.options.strokeId, stroke);
      return stroke.push([request.batch]);
    }
    const stroke = this.strokes.get(request.strokeId);
    if (!stroke) throw new Error("Cubic input contact is not held");
    if (request.kind === "seal") {
      const result = stroke.seal(request.batches);
      return { ...result, sourceHandle: this.remember(result.sealed!.source) };
    }
    return stroke.push(request.batches);
  }
}
