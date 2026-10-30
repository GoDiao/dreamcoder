import { creationPoints, snapCreation } from "./drawing-geometry.mjs";
import { pointsBounds } from "./geometry.mjs";
import { createPortableInk } from "./portable-ink.mjs";

/** Release coordinates are authoritative even if no move/paint frame was delivered. */
export function finishBoardDrawing(tool, style, gesture, modifiers = {}) {
  const { origin, release, scale, snap } = gesture;
  const freehand = tool === "pen" || tool === "highlighter";
  const moved =
    gesture.moved ||
    Math.hypot(release.x - origin.x, release.y - origin.y) * scale >= 3;
  let points;
  if (!moved) {
    points = freehand
      ? [origin, { x: origin.x + 0.01, y: origin.y + 0.01 }]
      : tool === "arrow"
        ? [origin, { x: origin.x + 100, y: origin.y }]
        : [
            { x: origin.x - 100, y: origin.y - 100 },
            { x: origin.x + 100, y: origin.y + 100 },
          ];
  } else if (freehand) {
    points = [...gesture.points];
    const last = points.at(-1);
    if (!last || last.x !== release.x || last.y !== release.y)
      points.push(release);
    if (points.length === 1)
      points.push({ x: release.x + 0.01, y: release.y + 0.01 });
  } else {
    points = creationPoints(
      tool === "region" ? "rectangle" : tool,
      origin,
      release,
      modifiers,
    );
    // Command/Ctrl turns snapping off; Alt only draws from the center.
    if (
      snap &&
      ["rectangle", "ellipse", "region"].includes(tool) &&
      !modifiers.ctrlKey &&
      !modifiers.metaKey
    )
      points = snapCreation(points, snap, scale, modifiers.shiftKey).points;
  }
  if (points.length > 20000)
    points = [...points.slice(0, 19999), points.at(-1)];
  const bounds = pointsBounds(points);
  const frame = {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  };
  if (tool === "region")
    return {
      node: {
        type: "region",
        attrs: { id: crypto.randomUUID(), name: "区域" }, // i18n-exempt: default name saved into documents
        content: [],
      },
      frame: {
        ...frame,
        width: Math.max(120, frame.width),
        height: Math.max(40, frame.height),
        mode: "free",
        gap: 24,
      },
    };
  return {
    node: {
      type: "drawing",
      attrs: {
        id: crypto.randomUUID(),
        name: {
          pen: "笔画", // i18n-exempt: saved default name
          highlighter: "荧光笔", // i18n-exempt: saved default name
          rectangle: "矩形", // i18n-exempt: saved default name
          ellipse: "椭圆", // i18n-exempt: saved default name
          arrow: "箭头", // i18n-exempt: saved default name
        }[tool],
        tool,
        ...style,
        extent: [frame.width, frame.height],
        points: (freehand ? [points[0],points.at(-1)] : points).map((point) => ({
          x: point.x - frame.x,
          y: point.y - frame.y,
          ...(freehand && point.pressure !== undefined
            ? { pressure: point.pressure }
            : {}),
        })),
        ...(freehand
          ? {
              ink: createPortableInk(
                points.map((p) => ({
                  ...p,
                  x: p.x - frame.x,
                  y: p.y - frame.y,
                })),
                style.strokeWidth,
                [frame.width, frame.height],
                tool === "highlighter" ? "marker" : "pen",
                style.pressure,
              ),
            }
          : {}),
      },
    },
    frame,
  };
}
