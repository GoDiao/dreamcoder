export type DockEdge = "top" | "bottom" | "left" | "right";
export interface ToolbarDock {
  edge: DockEdge;
  position: number;
  floating?: { x: number; y: number };
}
const edges: DockEdge[] = ["bottom", "top", "left", "right"];
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

export function readToolbarDock(saved: string | null): ToolbarDock {
  const [edge, raw, x, y] = (saved ?? "").split(":");
  const position = Number(raw);
  return edges.includes(edge as DockEdge) && raw && Number.isFinite(position)
    ? {
        edge: edge as DockEdge,
        position: clamp(position, 0, 1),
        ...(x && y && [Number(x), Number(y)].every(Number.isFinite)
          ? {
              floating: {
                x: clamp(Number(x), 0, 1),
                y: clamp(Number(y), 0, 1),
              },
            }
          : {}),
      }
    : { edge: "bottom", position: 0.5 };
}

export function snapToolbar(
  point: { x: number; y: number },
  bounds: { width: number; height: number },
): ToolbarDock {
  const distances = {
    top: point.y,
    bottom: bounds.height - point.y,
    left: point.x,
    right: bounds.width - point.x,
  };
  const edge = edges.reduce((best, next) =>
    distances[next] < distances[best] ? next : best,
  );
  const horizontal = edge === "top" || edge === "bottom";
  return {
    edge,
    position: clamp(
      horizontal
        ? point.x / Math.max(1, bounds.width)
        : point.y / Math.max(1, bounds.height),
      0,
      1,
    ),
  };
}

export function toolbarCenter(
  dock: ToolbarDock,
  bounds: { width: number; height: number },
  size: { width: number; height: number },
  reserve = 0,
) {
  bounds = { ...bounds, height: Math.max(1, bounds.height - reserve) };
  if (dock.floating)
    return constrainToolbarPoint(
      { x: dock.floating.x * bounds.width, y: dock.floating.y * bounds.height },
      bounds,
      size,
    );
  const horizontal = dock.edge === "top" || dock.edge === "bottom";
  const xInset = Math.min(bounds.width / 2, size.width / 2 + 12),
    yInset = Math.min(bounds.height / 2, size.height / 2 + 12);
  return {
    x: horizontal
      ? clamp(bounds.width * dock.position, xInset, bounds.width - xInset)
      : dock.edge === "left"
        ? xInset
        : bounds.width - xInset,
    y: horizontal
      ? dock.edge === "top"
        ? yInset
        : bounds.height - yInset
      : clamp(bounds.height * dock.position, yInset, bounds.height - yInset),
  };
}

export function constrainToolbarPoint(
  point: { x: number; y: number },
  bounds: { width: number; height: number },
  size: { width: number; height: number },
) {
  const x = Math.min(bounds.width / 2, size.width / 2 + 12),
    y = Math.min(bounds.height / 2, size.height / 2 + 12);
  return {
    x: clamp(point.x, x, bounds.width - x),
    y: clamp(point.y, y, bounds.height - y),
  };
}

/** Enter only near an edge; a slightly wider release band prevents jitter. */
export function toolbarSnapTarget(
  point: { x: number; y: number },
  bounds: { width: number; height: number },
  previous: DockEdge | null = null,
  threshold = 44,
): ToolbarDock | null {
  const distances = {
    top: point.y,
    bottom: bounds.height - point.y,
    left: point.x,
    right: bounds.width - point.x,
  };
  const target = snapToolbar(point, bounds);
  const edge =
    previous && distances[previous] <= threshold * 1.4 ? previous : target.edge;
  return distances[edge] <= threshold * (edge === previous ? 1.4 : 1)
    ? {
        ...target,
        edge,
        position: clamp(
          edge === "top" || edge === "bottom"
            ? point.x / Math.max(1, bounds.width)
            : point.y / Math.max(1, bounds.height),
          0,
          1,
        ),
      }
    : null;
}

export const toolbarPropertiesReserve = (_edge: DockEdge) => 0;

export interface ToolbarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** The primary strip and its joined secondary strip, in surface coordinates. */
export function toolbarPanelRect(
  center: { x: number; y: number },
  size: { width: number; height: number },
  edge: DockEdge,
  secondary: boolean,
): ToolbarRect {
  const rect = {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    ...size,
  };
  if (!secondary) return rect;
  if (edge === "top" || edge === "bottom") {
    if (edge === "bottom") rect.y -= size.height;
    rect.height += size.height;
  } else {
    if (edge === "right") rect.x -= size.width;
    rect.width += size.width;
  }
  return rect;
}
export function toolbarEdgeGap(
  rect: ToolbarRect,
  bounds: { width: number; height: number },
  edge: DockEdge,
) {
  return {
    left: rect.x,
    right: bounds.width - rect.x - rect.width,
    top: rect.y,
    bottom: bounds.height - rect.y - rect.height,
  }[edge];
}
/** Snap when any part of the panel reaches an edge band, independent of the grab point. */
export function toolbarRectSnapTarget(
  rect: ToolbarRect,
  bounds: { width: number; height: number },
  threshold = 96,
): ToolbarDock | null {
  const edge = edges.reduce((best, next) =>
    toolbarEdgeGap(rect, bounds, next) < toolbarEdgeGap(rect, bounds, best)
      ? next
      : best,
  );
  if (toolbarEdgeGap(rect, bounds, edge) > threshold) return null;
  return {
    edge,
    position: clamp(
      edge === "top" || edge === "bottom"
        ? (rect.x + rect.width / 2) / Math.max(1, bounds.width)
        : (rect.y + rect.height / 2) / Math.max(1, bounds.height),
      0,
      1,
    ),
  };
}
