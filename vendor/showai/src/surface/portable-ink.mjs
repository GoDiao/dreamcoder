import { CompiledInkKernel } from "./ink-kernel/compiled-ink.mjs";
import { CUBIC_INK_FORMAT, validateCubicInk } from "./portable-ink-v2.mjs";
import {
  cubicInkGeometry,
  cubicInkQueryGeometry,
  cubicInkHit,
  cubicInkBounds,
} from "./cubic-ink.mjs";
export {
  CUBIC_INK_FORMAT,
  DEFAULT_OUTLINE_TOLERANCE,
} from "./portable-ink-v2.mjs";
export { cubicInkFromInput } from "./cubic-ink.mjs";
export {
  nativeBoardScenePatch,
  resolveNativeBoardScene,
} from "./native-board-scene.mjs";
let compiledKernel;
const geometryKernel = () => (compiledKernel ??= new CompiledInkKernel());
/** Portable brush v1. This module has no DOM, platform or storage dependencies. */
export const PORTABLE_INK_FORMAT = "showai-ink-v1";
export const isEditableDrawing = (node) =>
  node?.type === "drawing" &&
  (!node.attrs?.ink || isPortableInk(node.attrs.ink));
export function portableInkSamples(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  if (ink?.format === CUBIC_INK_FORMAT)
    throw new Error(
      "Cubic ink has center/radius elements, not editable v1 samples",
    );
  return geometryKernel().resolveSamples(ink, width, pressure);
}
export function portableNodeSamples(node) {
  return portableInkSamples(
    node.attrs.ink,
    node.attrs.strokeWidth,
    node.attrs.pressure ?? node.attrs.ink.brush !== "monoline",
  );
}

/** One logical stroke can exceed the bounded v1 fragment capacity. Keeping
 * fragments on the same node preserves selection, transforms and undo. */
export function portableNodeFragments(node) {
  if (!isPortableInk(node?.attrs?.ink))
    throw new Error("Expected portable ink node");
  const extra = node.attrs.inkFragments ?? [];
  if (
    node.attrs.ink.format === CUBIC_INK_FORMAT &&
    Object.hasOwn(node.attrs, "inkFragments")
  )
    throw new Error("Cubic ink cannot have v1 inkFragments");
  if (!Array.isArray(extra) || extra.some((ink) => !isPortableInk(ink)))
    throw new Error("Invalid logical ink fragments");
  return [node.attrs.ink, ...extra];
}

export function portableNodeBounds(node) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const ink of portableNodeFragments(node)) {
    const box = portableInkBounds(
      ink,
      node.attrs.strokeWidth,
      node.attrs.pressure,
    );
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function portableNodeHit(node, point) {
  let inside = false,
    distance = Infinity,
    solid = false;
  for (const ink of portableNodeFragments(node)) {
    const hit = portableInkHit(
      ink,
      point,
      node.attrs.strokeWidth,
      node.attrs.pressure,
    );
    inside ||= hit.inside;
    solid ||= hit.solid;
    distance = Math.min(distance, hit.distance);
  }
  return {
    inside,
    distance,
    solid,
    area: node.attrs.ink.extent[0] * node.attrs.ink.extent[1],
  };
}

export function inkFramePose(frame, extent) {
  const a = ((frame.rotation ?? 0) * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a),
    w = frame.width,
    h = frame.height;
  return [
    (c * w) / extent[0],
    (s * w) / extent[0],
    (-s * h) / extent[1],
    (c * h) / extent[1],
    frame.x + w / 2 - (c * w) / 2 + (s * h) / 2,
    frame.y + h / 2 - (s * w) / 2 - (c * h) / 2,
  ];
}
export function inkModelPoses(document, boardId, previous = {}) {
  const find = (node) =>
    node.attrs?.id === boardId ? node : node.content?.map(find).find(Boolean);
  const board = find(document.content),
    poses = { ...previous };
  let nested = false,
    complete = true;
  const visit = (node, direct) => {
    if (node.type === "surface") return;
    if (isInkNode(node)) {
      const id = node.attrs.id,
        extent =
          node.attrs.extent ??
          node.attrs.nativeInk?.extent ??
          node.attrs.data?.nativeInk?.extent,
        frame = document.layout?.[id];
      if (direct && frame?.height && extent)
        poses[id] = inkFramePose(frame, extent);
      else {
        nested = true;
        if (!poses[id]) complete = false;
      }
    } else node.content?.forEach((child) => visit(child, false));
  };
  board?.content?.forEach((node) => visit(node, true));
  return { poses, nested, complete };
}
/** Transfer only changed ink payloads; the small hierarchy names every current stroke.
 * Previous is the last native-acknowledged model, never a merely queued frame. */
export function inkScenePatch(document, boardId, previous) {
  const collect = (doc) => {
    const found = new Map();
    const find = (node) =>
      node.attrs?.id === boardId ? node : node.content?.map(find).find(Boolean);
    const walk = (node) => {
      if (node.type === "surface") return null;
      const id = node.attrs?.id;
      if (isInkNode(node)) {
        found.set(id, node);
        return { type: "ink-ref", attrs: { id } };
      }
      const content = node.content?.map(walk).filter(Boolean) ?? [];
      return content.length
        ? { type: node.type, attrs: { id }, content }
        : null;
    };
    const board = doc && find(doc.content);
    if (doc && !board) throw new Error("Ink Board no longer exists");
    const content = board?.content?.map(walk).filter(Boolean) ?? [];
    return { found, content };
  };
  const current = collect(document),
    old = collect(previous);
  return {
    document: {
      id: document.id,
      content: {
        type: "surface",
        attrs: { id: boardId, kind: "board" },
        content: current.content,
      },
      layout: Object.fromEntries(
        [...current.found.keys()]
          .map((id) => [id, document.layout?.[id]])
          .filter(([, frame]) => frame),
      ),
    },
    nodes: [...current.found]
      .filter(
        ([id, node]) =>
          old.found.get(id) !== node &&
          JSON.stringify(old.found.get(id)) !== JSON.stringify(node),
      )
      .map(([, node]) => node),
  };
}
export function portableInkColor(color, dark = false) {
  const c = /^#[0-9a-f]{6}$/i.test(color) ? parseInt(color.slice(1), 16) : 0;
  return dark && Math.max(c >>> 16, (c >>> 8) & 255, c & 255) < 64
    ? "#f2f2f2"
    : color;
}
const caches = new WeakMap();
const preparedGeometry = new WeakMap();
const finite = (x, min, max) =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
export const isPortableInk = (ink) =>
  ink?.format === PORTABLE_INK_FORMAT || ink?.format === CUBIC_INK_FORMAT;
export function createPortableInk(
  points,
  width,
  extent,
  brush = "pen",
  pressure = true,
) {
  return {
    format: PORTABLE_INK_FORMAT,
    brushVersion: 1,
    brush,
    strokeCount: 1,
    width,
    opacity: brush === "marker" ? 0.35 : 1,
    extent,
    transform: [1, 0, 0, 1, 0, 0],
    samples: points.map((p, i) => {
      const size =
        width *
        (p.pressure !== undefined
          ? 0.2 + 0.8 * Math.max(0, Math.min(1, p.pressure))
          : 1);
      return [
        p.x,
        p.y,
        i / 120,
        size,
        size,
        1,
        p.pressure ?? 1,
        0,
        Math.PI / 2,
      ];
    }),
  };
}
export function isInkNode(node) {
  return (
    !!(
      node.attrs?.ink ||
      node.attrs?.nativeInk ||
      node.attrs?.data?.nativeInk
    ) ||
    (node.type === "drawing" &&
      ["pen", "highlighter"].includes(node.attrs?.tool))
  );
}
export function portableNodeInk(node) {
  return (
    node.attrs.ink ??
    createPortableInk(
      node.attrs.points,
      node.attrs.strokeWidth,
      node.attrs.extent,
      node.attrs.tool === "highlighter" ? "marker" : "pen",
      node.attrs.pressure,
    )
  );
}
export function validatePortableInk(ink) {
  if (ink?.format === CUBIC_INK_FORMAT) return validateCubicInk(ink);
  if (!isPortableInk(ink) || ink.brushVersion !== 1 || ink.strokeCount !== 1)
    throw new Error("Unsupported portable ink brush/version.");
  if (
    Object.keys(ink).some(
      (k) =>
        ![
          "format",
          "brushVersion",
          "brush",
          "strokeCount",
          "width",
          "opacity",
          "extent",
          "samples",
          "transform",
          "mask",
          "sourceDrawing",
          "seed",
          "createdAt",
        ].includes(k),
    )
  )
    throw new Error("Unsupported portable ink field.");
  if (
    !["pen", "marker", "pencil", "monoline"].includes(ink.brush) ||
    !finite(ink.width, 0.5, 40) ||
    !finite(ink.opacity, 0, 1)
  )
    throw new Error("Invalid portable ink brush.");
  if (
    !Array.isArray(ink.extent) ||
    ink.extent.length !== 2 ||
    ink.extent.some((x) => !finite(x, 1, 1e6))
  )
    throw new Error("Invalid portable ink extent.");
  if (
    !Array.isArray(ink.transform) ||
    ink.transform.length !== 6 ||
    ink.transform.some((x) => !finite(x, -1e6, 1e6)) ||
    Math.abs(
      ink.transform[0] * ink.transform[3] - ink.transform[1] * ink.transform[2],
    ) < 1e-12
  )
    throw new Error("Invalid portable ink transform.");
  // x, y, time, nib width, nib height, opacity, force, azimuth, altitude.
  if (
    !Array.isArray(ink.samples) ||
    !ink.samples.length ||
    ink.samples.length > 20000
  )
    throw new Error("Portable ink requires 1–20000 samples.");
  let time = -Infinity;
  for (const p of ink.samples) {
    if (
      !Array.isArray(p) ||
      p.length !== 9 ||
      !finite(p[0], -1e6, 1e6) ||
      !finite(p[1], -1e6, 1e6) ||
      !finite(p[2], 0, 1e6) ||
      p[2] < time ||
      !finite(p[3], 0, 1e4) ||
      !finite(p[4], 0, 1e4) ||
      !finite(p[5], 0, 1) ||
      !finite(p[6], 0, 100) ||
      !finite(p[7], -100, 100) ||
      !finite(p[8], -100, 100)
    )
      throw new Error("Invalid portable ink sample.");
    time = p[2];
  }
  if (ink.mask !== undefined) {
    if (!Array.isArray(ink.mask) || ink.mask.length > 100000)
      throw new Error("Invalid ink mask.");
    for (const c of ink.mask)
      if (
        !Array.isArray(c) ||
        c.length !== { M: 3, L: 3, Q: 5, C: 7, Z: 1 }[c[0]] ||
        c.slice(1).some((x) => !finite(x, -1e6, 1e6))
      )
        throw new Error("Invalid ink mask command.");
  }
  if (
    (ink.seed !== undefined &&
      (!Number.isInteger(ink.seed) || !finite(ink.seed, 0, 4294967295))) ||
    (ink.createdAt !== undefined && !finite(ink.createdAt, -1e12, 1e12))
  )
    throw new Error("Invalid ink identity metadata.");
  if (
    ink.sourceDrawing !== undefined &&
    (typeof ink.sourceDrawing !== "string" ||
      !ink.sourceDrawing.startsWith(
        "data:application/vnd.showai.pencilkit;base64,",
      ) ||
      ink.sourceDrawing.length > 90e6)
  )
    throw new Error("Invalid original ink archive.");
  return ink;
}
export function portableInkBounds(
  ink,
  strokeWidth = ink.width,
  pressure = ink.brush !== "monoline",
) {
  if (ink?.format === CUBIC_INK_FORMAT) {
    const box = cubicInkBounds(ink, strokeWidth, pressure);
    return {
      ...box,
      width: Math.max(1, box.width),
      height: Math.max(1, box.height),
    };
  }
  return geometryKernel().bounds(ink, strokeWidth, pressure);
}

/** One filled contour prevents translucent marker segments darkening at joins. */
export function portableInkGeometry(
  ink,
  strokeWidth = ink.width,
  pressure = ink.brush !== "monoline",
) {
  if (ink?.format === CUBIC_INK_FORMAT) {
    const geometry = cubicInkGeometry(ink, strokeWidth, pressure);
    return {
      path: geometry.path,
      get polygons() {
        return cubicInkQueryGeometry(ink, strokeWidth, pressure).polygons;
      },
    };
  }
  let widths = caches.get(ink);
  if (!widths) caches.set(ink, (widths = new Map()));
  const key = strokeWidth + ":" + pressure;
  if (widths.has(key)) return widths.get(key);
  const { polygons, path, mask, prepared } = geometryKernel().geometry(
    ink,
    strokeWidth,
    pressure,
  );
  const result = { polygons, path, mask };
  preparedGeometry.set(result, prepared);
  // Do not accumulate every width visited by a slider.
  widths.clear();
  widths.set(key, result);
  return result;
}
export function portableInkHit(
  ink,
  point,
  strokeWidth = ink.width,
  pressure = ink.brush !== "monoline",
) {
  if (ink?.format === CUBIC_INK_FORMAT)
    return cubicInkHit(ink, point, strokeWidth, pressure);
  const geometry = portableInkGeometry(ink, strokeWidth, pressure);
  const kernel = geometryKernel();
  kernel.reset();
  const mask =
    ink.mask === undefined ? null : kernel.flattenMask(ink.mask, ink.transform);
  return {
    ...kernel.hit({ ...preparedGeometry.get(geometry), mask }, point),
    area: ink.extent[0] * ink.extent[1],
  };
}
