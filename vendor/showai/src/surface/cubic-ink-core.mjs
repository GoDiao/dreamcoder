import { CompiledInkStroke } from "./ink-kernel/ink-stroke-kernel.mjs";
import {
  CUBIC_INK_FORMAT,
  DEFAULT_OUTLINE_TOLERANCE,
  validateCubicInk,
} from "./portable-ink-v2.mjs";
let compiled;
const kernel = () => (compiled ??= new CompiledInkStroke());
export const CUBIC_INK_CHUNK_SEGMENTS = 128;
export const CUBIC_INK_MAX_COMMANDS = 1_000_000;
export const CUBIC_INK_MAX_CHUNK_COMMANDS = 100_000;
export const CUBIC_INK_MAX_LEAVES = 100_000;
// Logical retained-cost charge, not a promise about an engine's process RSS.
// Entries contain detached derived values and never retain the source ink.
const MAX_CACHE_BYTES = 32 * 1024 * 1024,
  MAX_CACHE_ENTRIES = 128;
const immutable = new WeakSet(),
  validatedFrozenSources = new WeakSet(),
  cache = new WeakMap(),
  retained = new Map(),
  derived = new WeakMap(),
  geometryIDs = new WeakMap();
let nextCacheID = 0,
  retainedBytes = 0;
function cacheable(value) {
  if (!value || typeof value !== "object") return true;
  if (immutable.has(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  if (
    Array.isArray(value)
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  )
    return false;
  if (
    !Object.isFrozen(value) ||
    !Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) =>
        Object.hasOwn(descriptor, "value") && cacheable(descriptor.value),
    )
  )
    return false;
  immutable.add(value);
  return true;
}
function trimCache() {
  while (retainedBytes > MAX_CACHE_BYTES || retained.size > MAX_CACHE_ENTRIES) {
    const id = retained.keys().next().value,
      entry = retained.get(id);
    retained.delete(id);
    retainedBytes -= entry.bytes;
  }
}
function remember(ink, key, geometry) {
  const old = cache.get(ink),
    prior = old && retained.get(old.id);
  if (prior) {
    retained.delete(old.id);
    retainedBytes -= prior.bytes;
  }
  const id = ++nextCacheID,
    bytes =
      geometry.commands.length * 96 +
      geometry.path.length * 2 +
      geometry.chunks.length * 256;
  cache.set(ink, { key, id });
  geometryIDs.set(geometry, id);
  retained.set(id, { geometry, bytes });
  retainedBytes += bytes;
  trimCache();
}
function cacheQuery(geometry, query) {
  const id = geometryIDs.get(geometry),
    entry = retained.get(id);
  if (entry) {
    const bytes = query.polygons.reduce(
      (sum, polygon) => sum + polygon.length * 48 + 32,
      0,
    );
    entry.bytes += bytes;
    retainedBytes += bytes;
    trimCache();
  }
}
const sumFields = [
  "commands",
  "contours",
  "envelopeCurves",
  "fallbackLeaves",
  "sampledChecks",
  "leaves",
  "fallbackContours",
];
const maxFields = [
  "maximumDepth",
  "sampledEnvelopeError",
  "fallbackCenterBound",
  "arcErrorBound",
];
function boundsUnion(prior, next) {
  if (!prior) return { ...next };
  const x = Math.min(prior.x, next.x),
    y = Math.min(prior.y, next.y);
  return {
    x,
    y,
    width: Math.max(prior.x + prior.width, next.x + next.width) - x,
    height: Math.max(prior.y + prior.height, next.y + next.height) - y,
  };
}
function validStyle(width, pressure) {
  if (
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    width < 0.5 ||
    width > 40 ||
    typeof pressure !== "boolean"
  )
    throw new Error("Invalid cubic ink style");
}
function mapCommand(command, m) {
  const result = [command[0]];
  for (let i = 1; i < command.length; i += 2)
    result.push(
      m[0] * command[i] + m[2] * command[i + 1] + m[4],
      m[1] * command[i] + m[3] * command[i + 1] + m[5],
    );
  return result;
}
export function cubicInkGeometry(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  validStyle(width, pressure);
  const key = width + ":" + pressure,
    previous = cache.get(ink),
    entry = previous && retained.get(previous.id);
  if (entry && previous.key === key) {
    retained.delete(previous.id);
    retained.set(previous.id, entry);
    return entry.geometry;
  }
  if (!validatedFrozenSources.has(ink)) validateCubicInk(ink);
  const commands = [],
    chunks = [],
    statistics = Object.fromEntries(
      [...sumFields, ...maxFields].map((field) => [field, 0]),
    );
  const plan = [];
  // Admit the whole source before retaining any derived command arrays. The
  // fixed block limits are real consumer limits, never reset whole budgets.
  for (
    let start = 0;
    start < ink.segments.length;
    start += CUBIC_INK_CHUNK_SEGMENTS
  ) {
    const end = Math.min(start + CUBIC_INK_CHUNK_SEGMENTS, ink.segments.length);
    const remainingCommands = CUBIC_INK_MAX_COMMANDS - statistics.commands,
      remainingLeaves = CUBIC_INK_MAX_LEAVES - statistics.leaves;
    if (remainingCommands <= 0 || remainingLeaves <= 0)
      throw new RangeError("Cubic ink whole-stroke budget exhausted");
    const segments = ink.segments.slice(start, end),
      options = {
        tolerance: ink.outlineTolerance,
        maxDepth: 20,
        maxLeaves: remainingLeaves,
        maxCommands: Math.min(CUBIC_INK_MAX_CHUNK_COMMANDS, remainingCommands),
      },
      style = { sourceWidth: ink.width, width, pressure };
    const counts = kernel().counts(segments, options, style);
    for (const field of sumFields) statistics[field] += counts[field];
    for (const field of maxFields)
      statistics[field] = Math.max(statistics[field], counts[field]);
    plan.push({ start, end, segments, options, style, counts });
  }
  let bounds = null;
  for (const { start, end, segments, options, style, counts } of plan) {
    const geometry = kernel().build(segments, options, style);
    if (
      [...sumFields, ...maxFields].some(
        (field) => geometry.result[field] !== counts[field],
      )
    )
      throw new Error("Cubic ink changed during derived preparation");
    for (const command of geometry.commands) {
      Object.freeze(command);
      commands.push(command);
    }
    Object.freeze(geometry.commands);
    const box = Object.freeze(
      kernel().pathBounds(geometry.commands, ink.transform),
    );
    if (geometry.commands.length) bounds = boundsUnion(bounds, box);
    chunks.push(
      Object.freeze({
        start,
        end,
        commands: geometry.commands,
        statistics: Object.freeze(geometry.result),
        bounds: box,
      }),
    );
  }
  const result = Object.freeze({
    commands: Object.freeze(commands),
    chunks: Object.freeze(chunks),
    path: commands
      .map((command) => mapCommand(command, ink.transform).join(" "))
      .join(" "),
    statistics: Object.freeze(statistics),
    bounds: Object.freeze(bounds ?? { x: 0, y: 0, width: 0, height: 0 }),
  });
  if (cacheable(ink)) {
    validatedFrozenSources.add(ink);
    remember(ink, key, result);
  }
  return result;
}
/** The partition is derived only: all source segments/pressure knots remain
 * unchanged. All chunks must be unioned in ONE nonzero-opacity composite. */
export function cubicInkChunks(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  return cubicInkGeometry(ink, width, pressure).chunks;
}
export function cubicInkQueryGeometry(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  return cubicInkQueryFromGeometry(ink, cubicInkGeometry(ink, width, pressure));
}
export function cubicInkQueryFromGeometry(ink, geometry) {
  let query = derived.get(geometry);
  if (!query) {
    query = kernel().pathGeometry(
      geometry.commands,
      ink.transform,
      Math.max(1e-9, ink.outlineTolerance * 0.25),
    );
    for (const polygon of query.polygons) {
      for (const point of polygon) Object.freeze(point);
      Object.freeze(polygon);
    }
    Object.freeze(query.polygons);
    Object.freeze(query.bounds);
    Object.freeze(query);
    derived.set(geometry, query);
    cacheQuery(geometry, query);
  }
  return query;
}
export function cubicInkBounds(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  return cubicInkGeometry(ink, width, pressure).bounds;
}
export function cubicInkHit(
  ink,
  point,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  return cubicInkHitFromGeometry(
    ink,
    cubicInkGeometry(ink, width, pressure),
    point,
  );
}
export function cubicInkHitFromGeometry(ink, geometry, point) {
  return {
    ...kernel().pathHit(
      geometry.commands,
      point,
      ink.transform,
      Math.max(1e-9, ink.outlineTolerance * 0.25),
    ),
    area: ink.extent[0] * ink.extent[1],
  };
}
/** Export the finished actual shared input as one editable center/radius
 * authority. Browser and native author adapters use this format; archived v1
 * strokes retain their original interpretation and are never converted here. */
export function cubicInkFromInput(
  input,
  {
    sourceID,
    extent,
    origin = { x: 0, y: 0 },
    brush = "pen",
    opacity = brush === "marker" ? 0.35 : 1,
    outlineTolerance = DEFAULT_OUTLINE_TOLERANCE,
    capture = true,
  },
) {
  const snapshot = input.snapshot();
  if (!snapshot.finished || snapshot.predictedCount)
    throw new Error("Finish actual input before durable cubic ink export");
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y))
    throw new Error("Invalid cubic ink origin");
  const segments = input.strokeSegments().map((s) => {
    if (s.containsPredictions)
      throw new Error("Predictions cannot be persisted");
    return {
      points: s.points.map((p) => [p[0] - origin.x, p[1] - origin.y]),
      radius: s.radius,
    };
  });
  const ink = {
    format: CUBIC_INK_FORMAT,
    geometryVersion: 1,
    brushVersion: 1,
    brush,
    strokeCount: 1,
    width: input.config.width,
    opacity,
    extent: [...extent],
    transform: [1, 0, 0, 1, 0, 0],
    outlineTolerance,
    segments,
  };
  if (capture)
    ink.capture = {
      format: "showai-input-capture-v1",
      sourceID,
      configuration: { ...input.config },
      raw: input
        .raw()
        .map((p) => [
          p.x - origin.x,
          p.y - origin.y,
          p.time,
          p.force,
          p.azimuth,
          p.altitude,
          p.id,
          p.expectedProperties,
          p.estimationIndex,
          p.updatesTimedOut ? 1 : 0,
        ]),
    };
  return validateCubicInk(ink);
}
