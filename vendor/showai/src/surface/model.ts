export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const GESTURE_IDLE = 220;

export function normalizedWheel(
  dx: number,
  dy: number,
  mode: number,
  height: number,
  shift = false,
) {
  const unit = mode === 1 ? 16 : mode === 2 ? height : 1;
  return {
    x: (shift && !dx ? dy : dx) * unit,
    y: (shift && !dx ? 0 : dy) * unit,
  };
}

export function zoomAt(
  camera: Camera,
  point: { x: number; y: number },
  scale: number,
  maximum = MAX_ZOOM,
): Camera {
  const next = Math.max(MIN_ZOOM, Math.min(maximum, scale));
  return {
    x: point.x - ((point.x - camera.x) * next) / camera.scale,
    y: point.y - ((point.y - camera.y) * next) / camera.scale,
    scale: next,
  };
}
