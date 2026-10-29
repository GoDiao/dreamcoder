import { inkKernelWasmBase64, inkKernelProvenance } from './ink-kernel-wasm.mjs';
export { inkKernelProvenance };
const brushes = { pen: 0, marker: 1, pencil: 2, monoline: 3 };
const operations = { M: [0, 2], L: [1, 2], Q: [2, 4], C: [3, 6], Z: [4, 0] };
let compiled;
const module = () => compiled ??= new WebAssembly.Module(Uint8Array.from(atob(inkKernelWasmBase64), value => value.charCodeAt(0)));
const number = value => String(Math.round(value * 10000) / 10000);

/** One instance owns scratch memory. Returned arrays are detached retained
 * copies, so preparing a subsequent stroke never mutates displayed geometry. */
export class CompiledInkKernel {
  constructor() {
    let exports;
    this.instance = new WebAssembly.Instance(module(), { env: {
      sin: Math.sin, cos: Math.cos, hypot: Math.hypot,
      memcpy(destination, source, length) { new Uint8Array(exports.memory.buffer).copyWithin(destination, source, source + length); return destination; },
      memset(destination, value, length) { new Uint8Array(exports.memory.buffer).fill(value, destination, destination + length); return destination; },
    } });
    exports = this.instance.exports;
    this.api = exports;
    if (exports.sa_ink_abi_version() !== 1 || exports.sa_ink_sizeof_sample() !== 72 || exports.sa_ink_sizeof_style() !== 72 || exports.sa_ink_sizeof_command() !== 56 || exports.sa_ink_sizeof_hit() !== 16) throw new Error('Unsupported compiled ink ABI layout');
    this.heap = Number(exports.__heap_base.value);
    this.offset = this.heap;
  }
  reset() { this.offset = this.heap; }
  allocate(size) {
    const offset = (this.offset + 7) & ~7, end = offset + size;
    if (!Number.isSafeInteger(size) || size < 0 || end > 268435456) throw new RangeError('Ink kernel scratch capacity exceeded');
    const pages = Math.ceil((end - this.api.memory.buffer.byteLength) / 65536);
    if (pages > 0) this.api.memory.grow(pages);
    this.offset = end;
    return offset;
  }
  check(status) { if (status !== 0) throw new Error(`Compiled ink kernel rejected operation (${status})`); }
  style(ink, width, pressure) {
    const offset = this.allocate(72), view = new DataView(this.api.memory.buffer);
    view.setFloat64(offset, ink.width, true); view.setFloat64(offset + 8, width, true);
    view.setUint32(offset + 16, brushes[ink.brush] ?? 0xffffffff, true); view.setUint32(offset + 20, pressure ? 1 : 0, true);
    if (!Array.isArray(ink.transform) || ink.transform.length !== 6) throw new Error('Ink requires an affine transform');
    ink.transform.forEach((value, i) => view.setFloat64(offset + 24 + i * 8, value, true));
    return offset;
  }
  samples(samples) {
    if (!Array.isArray(samples) || samples.length < 1 || samples.length > 20000 || samples.some(value => !Array.isArray(value) || value.length !== 9)) throw new Error('Ink requires 1–20000 nine-field samples');
    const offset = this.allocate(samples.length * 72);
    const values = new Float64Array(this.api.memory.buffer, offset, samples.length * 9);
    samples.forEach((sample, i) => values.set(sample, i * 9));
    return offset;
  }
  readCounts(offset) { const data = new Uint32Array(this.api.memory.buffer, offset, 3); return { points: data[0], contours: data[1], vertices: data[2] }; }
  resolveSamples(ink, width = ink.width, pressure = ink.brush !== 'monoline') {
    this.reset(); const samples = this.samples(ink.samples), style = this.style(ink, width, pressure), output = this.allocate(ink.samples.length * 72);
    this.check(this.api.sa_ink_resolve_samples(samples, ink.samples.length, style, output, ink.samples.length));
    const values = new Float64Array(this.api.memory.buffer, output, ink.samples.length * 9);
    return ink.samples.map((_, i) => Array.from(values.subarray(i * 9, i * 9 + 9)));
  }
  bounds(ink, width = ink.width, pressure = ink.brush !== 'monoline') {
    this.reset(); const samples = this.samples(ink.samples), style = this.style(ink, width, pressure), output = this.allocate(32);
    this.check(this.api.sa_ink_bounds(samples, ink.samples.length, style, output));
    const values = new Float64Array(this.api.memory.buffer, output, 4);
    return { x: values[0], y: values[1], width: values[2], height: values[3] };
  }
  prepare(ink, width = ink.width, pressure = ink.brush !== 'monoline', start = 0, length = ink.samples.length - start) {
    if (!Array.isArray(ink.samples) || ink.samples.length < 1 || ink.samples.length > 20000 || !Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > ink.samples.length) throw new Error('Invalid incremental ink range');
    const first = Math.max(0, start - 1), last = Math.max(start + length, Math.min(ink.samples.length, start + 1));
    const changed = ink.samples.slice(first, last), localStart = start - first;
    this.reset(); const samples = this.samples(changed), style = this.style(ink, width, pressure), countsOffset = this.allocate(12);
    this.check(this.api.sa_ink_geometry_counts(samples, changed.length, localStart, length, countsOffset));
    const counts = this.readCounts(countsOffset), pointOffset = this.allocate(counts.points * 16), contourOffset = this.allocate(counts.contours * 8), vertexOffset = this.allocate(counts.vertices * 8), boundsOffset = this.allocate(32);
    this.check(this.api.sa_ink_build(samples, changed.length, localStart, length, style, pointOffset, counts.points, contourOffset, counts.contours, vertexOffset, counts.vertices, boundsOffset));
    const points = new Float64Array(this.api.memory.buffer, pointOffset, counts.points * 2).slice();
    const contours = new Uint32Array(this.api.memory.buffer, contourOffset, counts.contours * 2).slice();
    const vertices = new Float32Array(this.api.memory.buffer, vertexOffset, counts.vertices * 2).slice();
    const rawBounds = new Float64Array(this.api.memory.buffer, boundsOffset, 4);
    const bounds = { x: rawBounds[0], y: rawBounds[1], width: rawBounds[2], height: rawBounds[3] };
    const mask = ink.mask === undefined ? null : this.flattenMask(ink.mask, ink.transform);
    return { points, contours, vertices, bounds, mask };
  }
  flattenMask(commands, affine) {
    if (!Array.isArray(commands) || commands.length > 100000) throw new Error('Invalid ink mask commands');
    const commandOffset = this.allocate(commands.length * 56), affineOffset = this.allocate(48), countsOffset = this.allocate(12);
    const view = new DataView(this.api.memory.buffer);
    commands.forEach((command, i) => {
      const spec = operations[command[0]];
      if (!spec || command.length !== spec[1] + 1) throw new Error('Invalid ink mask command');
      const offset = commandOffset + i * 56;
      view.setUint32(offset, spec[0], true); view.setUint32(offset + 4, 0, true);
      for (let k = 0; k < spec[1]; k++) view.setFloat64(offset + 8 + k * 8, command[k + 1], true);
    });
    new Float64Array(this.api.memory.buffer, affineOffset, 6).set(affine);
    this.check(this.api.sa_ink_mask_counts(commandOffset, commands.length, countsOffset));
    const counts = this.readCounts(countsOffset), pointsOffset = this.allocate(counts.points * 16), contoursOffset = this.allocate(Math.max(8, counts.contours * 8));
    this.check(this.api.sa_ink_flatten_mask(commandOffset, commands.length, affineOffset, pointsOffset, counts.points, contoursOffset, counts.contours));
    return { points: new Float64Array(this.api.memory.buffer, pointsOffset, counts.points * 2).slice(), contours: new Uint32Array(this.api.memory.buffer, contoursOffset, counts.contours * 2).slice() };
  }
  copyPrepared(geometry) {
    const pointOffset = this.allocate(geometry.points.byteLength), contourOffset = this.allocate(geometry.contours.byteLength);
    new Float64Array(this.api.memory.buffer, pointOffset, geometry.points.length).set(geometry.points);
    new Uint32Array(this.api.memory.buffer, contourOffset, geometry.contours.length).set(geometry.contours);
    let maskPointOffset = 0, maskContourOffset = 0;
    if (geometry.mask) {
      maskPointOffset = this.allocate(geometry.mask.points.byteLength); maskContourOffset = this.allocate(Math.max(8, geometry.mask.contours.byteLength));
      new Float64Array(this.api.memory.buffer, maskPointOffset, geometry.mask.points.length).set(geometry.mask.points);
      new Uint32Array(this.api.memory.buffer, maskContourOffset, geometry.mask.contours.length).set(geometry.mask.contours);
    }
    return [pointOffset, geometry.points.length / 2, contourOffset, geometry.contours.length / 2, maskPointOffset, geometry.mask?.points.length / 2 || 0, maskContourOffset, geometry.mask?.contours.length / 2 || 0];
  }
  hit(geometry, point) {
    this.reset(); const input = this.copyPrepared(geometry), output = this.allocate(16);
    this.check(this.api.sa_ink_hit(...input, point.x, point.y, output));
    const view = new DataView(this.api.memory.buffer);
    return { inside: view.getUint32(output, true) !== 0, distance: view.getFloat64(output + 8, true), solid: true };
  }
  segmentHit(geometry, start, end, radius = 0) {
    this.reset(); const input = this.copyPrepared(geometry), required = this.allocate(4), output = this.allocate(4);
    let status = this.api.sa_ink_segment_hit(...input, start.x, start.y, end.x, end.y, radius, 0, 0, required, output);
    if (status === 2) {
      const count = new Uint32Array(this.api.memory.buffer, required, 1)[0], scratch = this.allocate(count * 8);
      status = this.api.sa_ink_segment_hit(...input, start.x, start.y, end.x, end.y, radius, scratch, count, required, output);
    }
    this.check(status); return new Uint32Array(this.api.memory.buffer, output, 1)[0] !== 0;
  }
  geometry(ink, width = ink.width, pressure = ink.brush !== 'monoline') {
    const prepared = this.prepare(ink, width, pressure), polygons = [];
    for (let c = 0; c < prepared.contours.length; c += 2) {
      const offset = prepared.contours[c], count = prepared.contours[c + 1];
      polygons.push(Array.from({ length: count }, (_, i) => ({ x: prepared.points[(offset + i) * 2], y: prepared.points[(offset + i) * 2 + 1] })));
    }
    return { polygons, path: polygons.map(poly => 'M ' + poly.map(point => number(point.x) + ' ' + number(point.y)).join(' L ') + ' Z').join(' '), mask: ink.mask?.map(command => command[0] + ' ' + command.slice(1).map(number).join(' ')).join(' '), prepared };
  }
}
