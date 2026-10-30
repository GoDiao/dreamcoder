// Canonical pure WASM geometry stays in one implementation. Actual editor
// workers may supply a separately proved, immutable derived result; standalone
// Node/JSC/SSR/readers continue through the same synchronous core.
export * from "./cubic-ink-core.mjs";
import {
  cubicInkGeometry as compute,
  cubicInkQueryFromGeometry,
  cubicInkHitFromGeometry,
} from "./cubic-ink-core.mjs";
import {
  preparedCubicGeometry,
  chargePreparedCubicQuery,
} from "./portable-cubic-client.mjs";
export function cubicInkGeometry(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  const prepared = preparedCubicGeometry(ink, width, pressure);
  if (prepared) return prepared;
  const observe =
    typeof window === "undefined" ? undefined : window.__showaiNativePerf;
  if (typeof observe !== "function") return compute(ink, width, pressure);
  const start = performance.now();
  try {
    return compute(ink, width, pressure);
  } finally {
    try {
      observe("surface.cubic.prepare.sync", performance.now() - start);
    } catch {
      /* Diagnostics do not change geometry results. */
    }
  }
}
export function cubicInkChunks(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  return cubicInkGeometry(ink, width, pressure).chunks;
}
export function cubicInkBounds(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  return cubicInkGeometry(ink, width, pressure).bounds;
}
export function cubicInkQueryGeometry(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  const geometry = cubicInkGeometry(ink, width, pressure),
    query = cubicInkQueryFromGeometry(ink, geometry);
  chargePreparedCubicQuery(geometry, query);
  return query;
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
