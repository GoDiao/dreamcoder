import type { Point } from "./geometry.mjs";
import { smoothPath } from "./drawing-geometry.mjs";

/** A pressure stroke shares the saved centerline and keeps mouse strokes uniform. */
export function pressureOutline(points: Point[], width: number) {
  const sides = points.map((point, index) => {
    const before = points[Math.max(0, index - 1)],
      after = points[Math.min(points.length - 1, index + 1)];
    const dx = after.x - before.x,
      dy = after.y - before.y,
      length = Math.hypot(dx, dy) || 1;
    const radius =
      (width * (0.2 + 0.8 * Math.max(0, Math.min(1, point.pressure ?? 1)))) / 2;
    return [
      {
        x: point.x - (dy / length) * radius,
        y: point.y + (dx / length) * radius,
      },
      {
        x: point.x + (dy / length) * radius,
        y: point.y - (dx / length) * radius,
      },
    ];
  });
  return (
    smoothPath([
      ...sides.map((p) => p[0]),
      ...sides.map((p) => p[1]).reverse(),
    ]) + " Z"
  );
}
