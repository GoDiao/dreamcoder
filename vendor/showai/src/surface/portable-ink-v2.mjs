/** Canonical cubic circular-sweep source. Pure validation: no DOM, WebAssembly
 * instantiation, host provider, derived outline, mesh or raster is required. */
export const CUBIC_INK_FORMAT = "showai-ink-v2";
export const DEFAULT_OUTLINE_TOLERANCE = 0.0025;
const finite = (n, min, max) =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
const reject = (message) => {
  throw new Error(`Invalid cubic ink: ${message}`);
};
const object = (value, keys, label) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    reject(label);
};
const array = (value, min, max, label) => {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    reject(label);
  for (let i = 0; i < value.length; i++)
    if (!Object.hasOwn(value, i)) reject(label);
};
const configRanges = {
  width: [0.5, 40],
  creationZoom: [0.001, 1024],
  fitTolerance: [1e-6, 1e4],
  flattenTolerance: [1e-6, 1e4],
  positionWindow: [0, 1],
  jitterWindow: [0, 1],
  forceBackward: [0, 1e4],
  forceForward: [0, 1e4],
  forceTime: [0, 1],
  minimumFraction: [0, 10],
  maximumFraction: [0, 10],
  curveBlend: [0, 1],
  estimateTimeout: [0, 10],
};
export function validateCubicInkCapture(capture, width) {
  object(
    capture,
    ["format", "sourceID", "configuration", "raw"],
    "capture fields",
  );
  if (
    capture.format !== "showai-input-capture-v1" ||
    typeof capture.sourceID !== "string" ||
    !capture.sourceID ||
    capture.sourceID.length > 256 ||
    /[\u0000-\u001f]/.test(capture.sourceID)
  )
    reject("capture identity");
  const c = capture.configuration;
  object(
    c,
    ["version", "mode", ...Object.keys(configRanges)],
    "capture configuration",
  );
  if (
    c.version !== 1 ||
    ![0, 1, 2].includes(c.mode) ||
    Object.entries(configRanges).some(
      ([k, [lo, hi]]) => !finite(c[k], lo, hi),
    ) ||
    c.maximumFraction < c.minimumFraction ||
    c.width !== width
  )
    reject("capture configuration");
  array(capture.raw, 1, 1048576, "actual raw records");
  let time = -Infinity,
    id = 0;
  for (const p of capture.raw) {
    array(p, 10, 10, "actual raw fields");
    if (
      !finite(p[0], -1e6, 1e6) ||
      !finite(p[1], -1e6, 1e6) ||
      !finite(p[2], 0, 1e6) ||
      p[2] < time ||
      !finite(p[3], 0, 100) ||
      !finite(p[4], -100, 100) ||
      !finite(p[5], -100, 100) ||
      !Number.isInteger(p[6]) ||
      p[6] <= id ||
      p[6] > 0xffffffff ||
      !Number.isInteger(p[7]) ||
      p[7] < 0 ||
      p[7] > 7 ||
      !Number.isInteger(p[8]) ||
      p[8] < 0 ||
      p[8] > 0xffffffff ||
      ![0, 1].includes(p[9])
    )
      reject("actual raw value/identity; predictions are not a capture format");
    time = p[2];
    id = p[6];
  }
  return capture;
}
export function validateCubicInk(ink) {
  object(
    ink,
    [
      "format",
      "geometryVersion",
      "brushVersion",
      "brush",
      "strokeCount",
      "width",
      "opacity",
      "extent",
      "transform",
      "outlineTolerance",
      "segments",
      "capture",
    ],
    "source fields (samples, fragments, outline, mask and raster are unsupported)",
  );
  if (
    ink.format !== CUBIC_INK_FORMAT ||
    ink.geometryVersion !== 1 ||
    ink.brushVersion !== 1 ||
    ink.strokeCount !== 1 ||
    !["pen", "marker", "monoline"].includes(ink.brush)
  )
    reject("format/brush/version");
  if (
    !finite(ink.width, 0.5, 40) ||
    !finite(ink.opacity, 0, 1) ||
    !finite(ink.outlineTolerance, 1e-8, 1000)
  )
    reject("width/opacity/outline tolerance");
  array(ink.extent, 2, 2, "extent");
  if (ink.extent.some((n) => !finite(n, 1, 1e6))) reject("extent");
  array(ink.transform, 6, 6, "affine");
  if (
    ink.transform.some((n) => !finite(n, -1e6, 1e6)) ||
    Math.abs(
      ink.transform[0] * ink.transform[3] - ink.transform[1] * ink.transform[2],
    ) < 1e-12
  )
    reject("affine");
  array(ink.segments, 1, 100000, "center/radius element count");
  for (const segment of ink.segments) {
    object(
      segment,
      ["points", "radius"],
      "element fields; prediction/derived fields are unsupported",
    );
    array(segment.points, 1, 4, "Bezier controls");
    for (const p of segment.points) {
      array(p, 2, 2, "Bezier control");
      if (p.some((n) => !finite(n, -1e6, 1e6))) reject("Bezier control");
    }
    array(segment.radius, 2, 2, "linear radius");
    if (
      segment.radius.some((n) => !finite(n, 0, 1e4)) ||
      (segment.points.length === 1 && segment.radius[0] !== segment.radius[1])
    )
      reject("linear radius/point");
  }
  if (ink.capture !== undefined)
    validateCubicInkCapture(ink.capture, ink.width);
  return ink;
}
