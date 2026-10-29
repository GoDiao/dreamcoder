import { frameAnchor, frameHeight } from "./geometry.mjs";
import { indexSurfaceTree } from "./connections.mjs";
import { DEFAULT_LABEL_SIZE, labelledShapeSize } from "./drawing-label.mjs";

export const DEFAULT_DRAWING_COLOR = "#252629";
const strokeDefaults = {
  pen: 2.5,
  highlighter: 16,
  rectangle: 2,
  ellipse: 2,
  arrow: 2,
};

/** The edge midpoint of `frame` that faces `toward`, as a normalized anchor. */
export function facingAnchor(frame, toward) {
  const height = frameHeight(frame) || 1;
  const dx = (toward.x - (frame.x + frame.width / 2)) / (frame.width || 1),
    dy = (toward.y - (frame.y + height / 2)) / height;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: dx >= 0 ? 1 : 0, y: 0.5 }
    : { x: 0.5, y: dy >= 0 ? 1 : 0 };
}

const center = (frame) => ({
  x: frame.x + frame.width / 2,
  y: frame.y + frameHeight(frame) / 2,
});
const localExtent = (points) => [
  Math.max(1, ...points.map((p) => p.x)),
  Math.max(1, ...points.map((p) => p.y)),
];

/**
 * Fill the drawing fields an author may omit, using what was supplied:
 * default color and stroke, shape geometry from its frame (or a frame sized to
 * its label), freehand extents from points, and arrow anchors facing the other
 * endpoint. `framed` holds ids whose frame the author set explicitly; other
 * frames are placeholders from automatic placement. Run before validation; bound
 * arrow geometry is resolved afterwards by reconcileConnections.
 */
export function completeDrawings(document, { framed, fresh }) {
  const layout = (document.layout ??= {});
  const index = indexSurfaceTree(document.content);
  const drawings = [...index.values()]
    .map(({ node }) => node)
    .filter((node) => node.type === "drawing" && !node.attrs?.ink);
  const incomplete = (attrs) =>
    attrs.color === undefined ||
    attrs.strokeWidth === undefined ||
    !Array.isArray(attrs.extent) ||
    !Array.isArray(attrs.points) ||
    Object.values(attrs.bindings ?? {}).some(
      (binding) => binding && binding.anchor === undefined,
    );
  const sized = (id, width, height) => {
    layout[id] = { ...(layout[id] ?? { x: 0, y: 0 }), width, height };
  };
  const arrows = [];
  for (const node of drawings) {
    const attrs = node.attrs,
      id = attrs.id;
    if (!fresh.has(id) && !incomplete(attrs)) continue;
    const explicit = framed.has(id) && layout[id];
    attrs.color ??= DEFAULT_DRAWING_COLOR;
    attrs.strokeWidth ??= strokeDefaults[attrs.tool] ?? 2;
    if (attrs.tool === "arrow") {
      arrows.push(node);
      continue;
    }
    if (attrs.tool === "rectangle" || attrs.tool === "ellipse") {
      if (!Array.isArray(attrs.extent) || !Array.isArray(attrs.points)) {
        if (!explicit) {
          const size = Array.isArray(attrs.extent)
            ? { width: attrs.extent[0], height: attrs.extent[1] }
            : labelledShapeSize(
                attrs.tool,
                attrs.label,
                attrs.labelSize ?? DEFAULT_LABEL_SIZE,
                attrs.strokeWidth,
              );
          sized(id, size.width, size.height);
        } else if (layout[id].height === undefined)
          layout[id].height = Math.max(
            72,
            labelledShapeSize(
              attrs.tool,
              attrs.label,
              attrs.labelSize ?? DEFAULT_LABEL_SIZE,
              attrs.strokeWidth,
            ).height,
          );
        const frame = layout[id];
        attrs.extent ??= [frame.width, frameHeight(frame)];
        attrs.points ??= [
          { x: 0, y: 0 },
          { x: attrs.extent[0], y: attrs.extent[1] },
        ];
      } else if (!explicit) sized(id, attrs.extent[0], attrs.extent[1]);
      continue;
    }
    if (Array.isArray(attrs.points) && attrs.points.length) {
      attrs.extent ??= localExtent(attrs.points);
      if (!explicit) sized(id, attrs.extent[0], attrs.extent[1]);
    }
  }
  for (const node of arrows) {
    const attrs = node.attrs,
      id = attrs.id;
    const bindings = attrs.bindings ?? {};
    const explicit = framed.has(id) && layout[id];
    const targetFrame = (key) =>
      bindings[key]?.targetId !== undefined
        ? layout[bindings[key].targetId]
        : undefined;
    if (Array.isArray(attrs.points) && attrs.points.length) {
      attrs.extent ??= localExtent(attrs.points);
      if (!explicit) sized(id, attrs.extent[0], attrs.extent[1]);
    } else if (targetFrame("start") && targetFrame("end")) {
      // Core resolves bound geometry; a minimal placeholder satisfies validation.
      attrs.extent ??= [1, 1];
      attrs.points = [
        { x: 0, y: 0 },
        { x: attrs.extent[0], y: attrs.extent[1] },
      ];
      if (!layout[id]) layout[id] = { x: 0, y: 0, width: 1, height: 1 };
    } else
      throw new Error(
        `Arrow ${id} needs points, or bindings to existing objects at both ends.`,
      );
    const freeEnd = (key) => {
      const frame = layout[id],
        point = key === "start" ? attrs.points[0] : attrs.points.at(-1);
      return frameAnchor(frame, {
        x: point.x / attrs.extent[0],
        y: point.y / attrs.extent[1],
      });
    };
    for (const [key, other] of [
      ["start", "end"],
      ["end", "start"],
    ]) {
      const binding = bindings[key];
      if (!binding || binding.anchor !== undefined) continue;
      const frame = targetFrame(key);
      if (!frame)
        throw new Error(
          `Arrow ${id} binds its ${key} to ${binding.targetId}, which has no frame in this container.`,
        );
      const otherFrame = targetFrame(other);
      binding.anchor = facingAnchor(
        frame,
        otherFrame ? center(otherFrame) : freeEnd(other),
      );
    }
  }
  return document;
}
