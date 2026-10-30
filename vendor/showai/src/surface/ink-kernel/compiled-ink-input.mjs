import { CompiledInkKernel } from './compiled-ink.mjs';

export function inkInputConfiguration(options = {}) {
  const width = options.width ?? 3, creationZoom = options.creationZoom ?? 1, mode = options.mode ?? 1;
  const screen = Math.min(18, Math.max(2.6, width * creationZoom));
  return { width, creationZoom, fitTolerance: (mode === 2 ? 0.05 : 0.5) / (1 + 1.5 * (screen - 2.6) / 15.4) / creationZoom,
    flattenTolerance: 0.1 / creationZoom, positionWindow: mode === 2 ? 0.04 : 0.01, jitterWindow: mode === 2 ? 0.04 : 0.015,
    forceBackward: mode === 2 ? 0.75 * width : 0, forceForward: mode === 2 ? 0.5 * width : 0,
    forceTime: mode === 2 ? 0.04 : 0, minimumFraction: 0.25, maximumFraction: 1, curveBlend: 1,
    estimateTimeout: 0.2, ...options, mode, version: 1 };
}
const configFields = ['width', 'creationZoom', 'fitTolerance', 'flattenTolerance', 'positionWindow', 'jitterWindow', 'forceBackward', 'forceForward', 'forceTime', 'minimumFraction', 'maximumFraction', 'curveBlend', 'estimateTimeout'];
const pointFields = ['x', 'y', 'time', 'force', 'azimuth', 'altitude'];
const snapshotFields = ['actualCount', 'predictedCount', 'curveCount', 'finalizedCurves', 'firstChangedCurve', 'sampleCount', 'fragmentCount', 'finished', 'filteredPoints', 'fitEvaluations', 'generation'];

/** A persistent input instance owns memory separately from stateless geometry
 * preparation. Scratch resets cannot overwrite its retained actual samples. */
export class CompiledInkInput {
  constructor(options = {}, initialCapacity = 1024) {
    this.kernel = new CompiledInkKernel(); this.api = this.kernel.api;
    if (this.api.sa_input_sizeof_point() !== 64 || this.api.sa_input_sizeof_config() !== 112 || this.api.sa_input_sizeof_curve() !== 88 || this.api.sa_input_sizeof_snapshot() !== 48) throw new Error('Unsupported ink input ABI');
    this.config = inkInputConfiguration(options); this.capacity = initialCapacity;
    if (!Number.isInteger(this.config.mode) || this.config.mode < 0 || this.config.mode > 2) throw new RangeError('Ink input mode');
    if (!Number.isInteger(initialCapacity) || initialCapacity < 1 || initialCapacity > 1048576) throw new RangeError('Ink raw capacity');
    this.bytes = this.api.sa_input_state_bytes(initialCapacity); this.state = this.kernel.allocate(this.bytes);
    const config = this.kernel.allocate(112), view = new DataView(this.api.memory.buffer);
    configFields.forEach((field, i) => view.setFloat64(config + i * 8, this.config[field], true));
    view.setUint32(config + 104, this.config.mode, true); view.setUint32(config + 108, 1, true);
    this.kernel.check(this.api.sa_input_initialize(this.state, this.bytes, initialCapacity, config));
    this.scratch = this.kernel.offset;
  }
  resetScratch() { this.kernel.offset = this.scratch; }
  grow(required) {
    if (required <= this.capacity) return;
    if (required > 1048576) throw new RangeError('Ink input capacity exceeded; retain the current logical stroke before continuing');
    const capacity = Math.min(1048576, Math.max(required, this.capacity * 2)), bytes = this.api.sa_input_state_bytes(capacity);
    this.resetScratch(); const state = this.kernel.allocate(bytes);
    this.kernel.check(this.api.sa_input_relocate(this.state, state, bytes, capacity));
    this.state = state; this.capacity = capacity; this.bytes = bytes; this.scratch = this.kernel.offset;
  }
  writePoints(points) {
    const at = this.kernel.allocate(points.length * 64), view = new DataView(this.api.memory.buffer);
    points.forEach((point, i) => {
      const p = { force: 1, azimuth: 0, altitude: Math.PI / 2, expectedProperties: 0, estimationIndex: 0, updatesTimedOut: false, ...point };
      pointFields.forEach((field, k) => view.setFloat64(at + i * 64 + k * 8, p[field], true));
      const integers = [p.id ?? 0, p.expectedProperties, p.estimationIndex, p.updatesTimedOut ? 1 : 0];
      if (integers.some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff)) throw new RangeError('Ink point identity/flags');
      integers.forEach((value, k) => view.setUint32(at + i * 64 + 48 + k * 4, value, true));
    });
    return at;
  }
  push(actual, predicted = []) {
    this.grow(this.snapshot().actualCount + actual.length); this.resetScratch();
    const a = this.writePoints(actual), p = this.writePoints(predicted);
    this.kernel.check(this.api.sa_input_push(this.state, a, actual.length, p, predicted.length)); return this.snapshot();
  }
  correct(point) {
    this.resetScratch(); const p = this.writePoints([point]); this.kernel.check(this.api.sa_input_correct(this.state, p)); return this.snapshot();
  }
  finish() { this.kernel.check(this.api.sa_input_finish(this.state)); return this.snapshot(); }
  snapshot() {
    this.resetScratch(); const at = this.kernel.allocate(48); this.kernel.check(this.api.sa_input_snapshot(this.state, at));
    const values = new Uint32Array(this.api.memory.buffer, at, 12), result = Object.fromEntries(snapshotFields.map((name, i) => [name, values[i]]));
    result.finished = !!result.finished; return result;
  }
  raw(start = 0, count = this.snapshot().actualCount - start) {
    this.resetScratch(); const at = this.kernel.allocate(count * 64); this.kernel.check(this.api.sa_input_copy_raw(this.state, start, count, at, count));
    const view = new DataView(this.api.memory.buffer);
    return Array.from({ length: count }, (_, i) => ({ ...Object.fromEntries(pointFields.map((name, k) => [name, view.getFloat64(at + i * 64 + k * 8, true)])), id: view.getUint32(at + i * 64 + 48, true), expectedProperties: view.getUint32(at + i * 64 + 52, true), estimationIndex: view.getUint32(at + i * 64 + 56, true), updatesTimedOut: !!view.getUint32(at + i * 64 + 60, true) }));
  }
  curves(start = 0, count = this.snapshot().curveCount - start) {
    this.resetScratch(); const at = this.kernel.allocate(count * 88); this.kernel.check(this.api.sa_input_copy_curves(this.state, start, count, at, count));
    const view = new DataView(this.api.memory.buffer);
    return Array.from({ length: count }, (_, i) => ({ points: Array.from({ length: 8 }, (_, k) => view.getFloat64(at + i * 88 + k * 8, true)), firstRaw: view.getUint32(at + i * 88 + 64, true), lastRaw: view.getUint32(at + i * 88 + 68, true), sampleOffset: view.getUint32(at + i * 88 + 72, true), steps: view.getUint32(at + i * 88 + 76, true), containsPredictions: !!view.getUint32(at + i * 88 + 80, true) }));
  }
  sampleBytes(start = 0, count = this.snapshot().sampleCount - start) {
    this.resetScratch(); const at = this.kernel.allocate(count * 72); this.kernel.check(this.api.sa_input_copy_samples(this.state, start, count, at, count));
    return new Uint8Array(this.api.memory.buffer, at, count * 72).slice();
  }
  samples(start = 0, count = this.snapshot().sampleCount - start) {
    const bytes = this.sampleBytes(start, count), values = new Float64Array(bytes.buffer, bytes.byteOffset, count * 9);
    return Array.from({ length: count }, (_, i) => Array.from(values.subarray(i * 9, i * 9 + 9)));
  }
  fragmentRanges() {
    const snapshot = this.snapshot(); if (!snapshot.finished) throw new Error('Finish before durable export');
    return Array.from({ length: snapshot.fragmentCount }, (_, i) => {
      this.resetScratch(); const at = this.kernel.allocate(8); this.kernel.check(this.api.sa_input_fragment_range(this.state, i, at, at + 4));
      const v = new Uint32Array(this.api.memory.buffer, at, 2); return { start: v[0], count: v[1] };
    });
  }
  filtered(start = 0, count = this.snapshot().actualCount - start) {
    this.resetScratch(); const at = this.kernel.allocate(count * 72); this.kernel.check(this.api.sa_input_copy_filtered(this.state, start, count, at, count));
    const values = new Float64Array(this.api.memory.buffer, at, count * 9);
    return Array.from({ length: count }, (_, i) => Array.from(values.subarray(i * 9, i * 9 + 9)));
  }
  strokeSegmentCount() {
    this.resetScratch(); const at = this.kernel.allocate(4); this.kernel.check(this.api.sa_input_stroke_segment_count(this.state, at)); return new DataView(this.api.memory.buffer).getUint32(at, true);
  }
  strokeSegments(start = 0, count = this.strokeSegmentCount() - start) {
    this.resetScratch(); const at = this.kernel.allocate(count * 104); this.kernel.check(this.api.sa_input_copy_stroke_segments(this.state, start, count, at, count));
    const view = new DataView(this.api.memory.buffer);
    return Array.from({ length: count }, (_, i) => {const p=at+i*104,degree=view.getUint32(p+80,true);return {points:Array.from({length:degree+1},(_,j)=>[view.getFloat64(p+j*16,true),view.getFloat64(p+j*16+8,true)]),radius:[view.getFloat64(p+64,true),view.getFloat64(p+72,true)],firstRaw:view.getUint32(p+88,true),lastRaw:view.getUint32(p+92,true),containsPredictions:!!(view.getUint32(p+96,true)&1)};});
  }
  durableSource(sourceID, { origin = { x: 0, y: 0 }, opacity = 1 } = {}) {
    if (!this.snapshot().finished || typeof sourceID !== 'string' || !sourceID) throw new Error('A finished source stroke identity is required');
    if (![origin.x, origin.y, opacity].every(Number.isFinite) || opacity < 0 || opacity > 1) throw new RangeError('Ink source origin/opacity');
    const raw = this.raw().map(p => [p.x-origin.x, p.y-origin.y, p.time, p.force, p.azimuth, p.altitude, p.id, p.expectedProperties, p.estimationIndex, p.updatesTimedOut ? 1 : 0]);
    const curves = this.curves().map(c => ({ points: c.points.map((v, i) => v-(i%2 ? origin.y : origin.x)), firstRaw: c.firstRaw, lastRaw: c.lastRaw, steps: c.steps }));
    return { format: 'showai-input-v1', sourceID, configuration: { ...this.config }, raw, curves, fragmentCount: this.fragmentRanges().length, compositeOpacity: opacity, composite: 'single-opacity-coverage' };
  }
}
