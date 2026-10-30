import type { Camera } from "./model";

export const RELEASE_DISTANCE = 240;
export const HORIZONTAL_GAIN = 0.72;
// UIScrollView's normal deceleration: retain 99.8% of speed per millisecond.
const PAN_FRICTION = -Math.log(0.998) * 1000;
export class PanVelocity {
  private samples: { x: number; y: number; time: number }[] = [];
  add(x: number, y: number, time: number) {
    const last = this.samples.at(-1);
    if (last && (time <= last.time || (x === last.x && y === last.y))) return;
    this.samples.push({ x, y, time });
    while (this.samples.length > 2 && time - this.samples[0].time > 100)
      this.samples.shift();
  }
  release(time: number) {
    const first = this.samples[0],
      last = this.samples.at(-1);
    if (!first || !last || time - last.time > 80 || last.time - first.time < 8)
      return { x: 0, y: 0 };
    const elapsed = (last.time - first.time) / 1000;
    const x = (last.x - first.x) / elapsed,
      y = (last.y - first.y) / elapsed;
    const limit = Math.min(1, 3000 / Math.hypot(x, y));
    return { x: x * limit, y: y * limit };
  }
}
/** Integrate exponential drag exactly, so 60 Hz and 120 Hz travel equally far. */
export function momentumStep(
  velocity: { x: number; y: number },
  elapsed: number,
) {
  const decay = Math.exp(-PAN_FRICTION * Math.max(0, Math.min(0.064, elapsed)));
  const distance = (1 - decay) / PAN_FRICTION;
  return {
    x: velocity.x * distance,
    y: velocity.y * distance,
    velocity: { x: velocity.x * decay, y: velocity.y * decay },
  };
}
export interface SurfaceRegion {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SurfaceBounds {
  width: number;
  height: number;
  offsetX: number;
}
export interface SurfaceAnchor {
  id: string;
  label: string;
  x: number;
  minY: number;
  maxY: number;
}

/** Initially firm, then gradually easier to pull. Continuous at every distance. */
export function elasticDisplacement(distance: number) {
  const length = Math.abs(distance);
  return (
    Math.sign(distance) *
    (HORIZONTAL_GAIN * length - 50.4 * (1 - Math.exp(-length / 120)))
  );
}
/** Resume a pull from its currently displayed spring position without compressing it twice. */
export function elasticInput(displacement: number) {
  const target = Math.abs(displacement);
  let input = target / HORIZONTAL_GAIN;
  for (let iteration = 0; iteration < 8; iteration++)
    input = Math.max(
      0,
      input -
        (elasticDisplacement(input) - target) /
          (HORIZONTAL_GAIN - 0.42 * Math.exp(-input / 120)),
    );
  return Math.sign(displacement) * input;
}
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function panFrom(
  origin: Camera,
  delta: { x: number; y: number },
  anchor: SurfaceAnchor | null,
) {
  // Free panning tracks the input exactly; resistance only exists around a
  // reading anchor.
  if (!anchor)
    return {
      camera: { ...origin, x: origin.x + delta.x, y: origin.y + delta.y },
      released: true,
    };
  const startY = clamp(origin.y, anchor.minY, anchor.maxY);
  const rawX = anchor.x + elasticInput(origin.x - anchor.x) + delta.x,
    rawY = startY + elasticInput(origin.y - startY) + delta.y;
  const boundedY = clamp(rawY, anchor.minY, anchor.maxY);
  const overX = rawX - anchor.x,
    overY = rawY - boundedY;
  return {
    camera: {
      ...origin,
      x: anchor.x + elasticDisplacement(overX),
      y: boundedY + elasticDisplacement(overY),
    },
    released:
      Math.abs(overX) > RELEASE_DISTANCE || Math.abs(overY) > RELEASE_DISTANCE,
  };
}

/** Lock to a fully readable region without moving it more than a gentle nudge. */
export function snapRegion(
  region: SurfaceRegion,
  camera: Camera,
  bounds: SurfaceBounds,
) {
  const width = region.width * camera.scale,
    height = region.height * camera.scale;
  if (width > bounds.width + 1 || width < Math.min(140, bounds.width * 0.5))
    return null;
  const margin = Math.min(24, Math.max(0, (bounds.width - width) / 2));
  const minX = margin - bounds.offsetX - region.x * camera.scale;
  const maxX =
    bounds.width -
    margin -
    bounds.offsetX -
    (region.x + region.width) * camera.scale;
  const centerX = (minX + maxX) / 2;
  const x =
    Math.abs(camera.x - centerX) <= 48 ? centerX : clamp(camera.x, minX, maxX);
  if (Math.abs(x - camera.x) > 56) return null;
  const top = 48;
  const bottom = bounds.height - 76;
  const start = top - region.y * camera.scale;
  const end = bottom - (region.y + region.height) * camera.scale;
  const minY = Math.min(start, end),
    maxY = Math.max(start, end);
  let y = clamp(camera.y, minY, maxY);
  if (height <= bottom - top) {
    const centerY = (start + end) / 2;
    if (Math.abs(camera.y - centerY) <= 36) y = centerY;
  }
  if (Math.abs(y - camera.y) > 40) return null;
  return {
    camera: { ...camera, x, y },
    anchor: {
      id: region.id,
      label: region.label,
      x,
      minY,
      maxY,
    } satisfies SurfaceAnchor,
  };
}

export function nearestSnap(
  regions: SurfaceRegion[],
  camera: Camera,
  bounds: SurfaceBounds,
) {
  return (
    regions
      .map((region) => {
        const snap = snapRegion(region, camera, bounds);
        if (!snap) return null;
        const centerX =
          bounds.offsetX +
          camera.x +
          (region.x + region.width / 2) * camera.scale;
        const centerY =
          camera.y + (region.y + region.height / 2) * camera.scale;
        const score =
          Math.abs(centerX - bounds.width / 2) +
          Math.min(
            bounds.height,
            Math.abs(centerY - (bounds.height - 76) / 2),
          ) *
            0.18;
        return { ...snap, score };
      })
      .filter((candidate) => candidate !== null)
      .sort((a, b) => a.score - b.score)[0] ?? null
  );
}

/** Damped spring step, stable across ordinary 60 Hz and 120 Hz displays. */
export function springStep(
  position: number,
  velocity: number,
  target: number,
  elapsed: number,
) {
  const dt = Math.min(0.032, Math.max(0.001, elapsed));
  const nextVelocity =
    velocity + ((target - position) * 240 - velocity * 26) * dt;
  return { position: position + nextVelocity * dt, velocity: nextVelocity };
}
