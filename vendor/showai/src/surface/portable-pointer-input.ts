import type { InkInputPoint } from "./ink-kernel/compiled-ink-input.mjs";
import type { CubicInputBatch } from "./portable-cubic-worker-model";

type PointerSample = Pick<
  globalThis.PointerEvent,
  | "pointerId"
  | "pointerType"
  | "timeStamp"
  | "clientX"
  | "clientY"
  | "pressure"
  | "tiltX"
  | "tiltY"
> &
  Partial<Pick<globalThis.PointerEvent, "azimuthAngle" | "altitudeAngle">>;
type PointerPacket = PointerSample & {
  getCoalescedEvents?: () => PointerSample[];
  getPredictedEvents?: () => PointerSample[];
};
/** Coordinates, zoom and direction are captured at pen-down. Camera movement
 * never refits already accepted source. Actual coalesced samples are retained,
 * including stationary pressure changes; only exact sensor duplicates vanish. */
export class PortablePointerInput {
  private nextId = 1;
  private startTime: number;
  private seen = new Map<string, InkInputPoint>();
  private origin: { x: number; y: number };
  private ax: { x: number; y: number };
  private ay: { x: number; y: number };
  private direction: { x: number; y: number } | undefined;
  constructor(
    first: PointerSample,
    point: (x: number, y: number) => { x: number; y: number },
    private ruler = false,
  ) {
    this.startTime = first.timeStamp;
    this.origin = point(first.clientX, first.clientY);
    const x = point(first.clientX + 1, first.clientY),
      y = point(first.clientX, first.clientY + 1);
    this.ax = { x: x.x - this.origin.x, y: x.y - this.origin.y };
    this.ay = { x: y.x - this.origin.x, y: y.y - this.origin.y };
    this.clientOrigin = { x: first.clientX, y: first.clientY };
    this.pointerId = first.pointerId;
  }
  readonly pointerId: number;
  private clientOrigin: { x: number; y: number };
  get worldOrigin() {
    return { ...this.origin };
  }
  private convert(sample: PointerSample, id: number): InkInputPoint {
    const dx = sample.clientX - this.clientOrigin.x,
      dy = sample.clientY - this.clientOrigin.y;
    let x = dx * this.ax.x + dy * this.ay.x,
      y = dx * this.ax.y + dy * this.ay.y;
    if (this.ruler) {
      const distance = Math.hypot(x, y);
      if (!this.direction && distance > 0 && id !== 0)
        this.direction = { x: x / distance, y: y / distance };
      if (this.direction) {
        const along = x * this.direction.x + y * this.direction.y;
        x = along * this.direction.x;
        y = along * this.direction.y;
      }
    }
    // W3C Pointer Events pressure is a normalized browser sensor value. It is
    // preserved as received, not claimed to have UITouch.force calibration.
    const force = sample.pointerType === "pen" ? sample.pressure : 1;
    const tx = Math.tan(((sample.tiltX ?? 0) * Math.PI) / 180),
      ty = Math.tan(((sample.tiltY ?? 0) * Math.PI) / 180);
    const nativeAzimuth = Number.isFinite(sample.azimuthAngle)
      ? sample.azimuthAngle!
      : Math.atan2(ty, tx);
    const azimuth =
      (nativeAzimuth + Math.atan2(this.ax.y, this.ax.x) + 2 * Math.PI) %
      (2 * Math.PI);
    const altitude = Number.isFinite(sample.altitudeAngle)
      ? sample.altitudeAngle!
      : Math.atan2(1, Math.hypot(tx, ty));
    return {
      id,
      x,
      y,
      time: (sample.timeStamp - this.startTime) / 1000,
      force,
      azimuth,
      altitude,
      expectedProperties: 0,
      estimationIndex: 0,
      updatesTimedOut: false,
    };
  }
  batch(packet: PointerPacket, actual = true): CubicInputBatch {
    const result: CubicInputBatch = {
      actual: [],
      predicted: [],
      corrections: [],
    };
    // Per Pointer Events, process the coalesced list OR its parent event.
    const coalesced = actual ? (packet.getCoalescedEvents?.() ?? []) : [];
    const samples = actual ? (coalesced.length ? coalesced : [packet]) : [];
    for (const sample of samples) {
      if (sample.pointerId !== this.pointerId) continue;
      const key = JSON.stringify([
          sample.timeStamp,
          sample.clientX,
          sample.clientY,
        ]),
        prior = this.seen.get(key),
        point = this.convert(sample, prior?.id ?? this.nextId);
      if (prior) {
        // Corrections retain the previously accepted position and identity.
        point.x = prior.x;
        point.y = prior.y;
        if (
          point.force !== prior.force ||
          point.azimuth !== prior.azimuth ||
          point.altitude !== prior.altitude
        ) {
          result.corrections!.push(point);
          this.seen.set(key, point);
        }
      } else {
        this.nextId++;
        this.seen.set(key, point);
        result.actual.push(point);
      }
    }
    const predictions = packet.getPredictedEvents?.() ?? [];
    // Forecasts are disposable and explicitly bounded to the nearest128
    // future samples. This never truncates/rejects the actual sensor batch.
    for (const sample of predictions.slice(0, 128)) {
      if (sample.pointerId === this.pointerId)
        result.predicted.push(this.convert(sample, 0));
    }
    return result;
  }
}
