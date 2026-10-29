import { validatePortableInk } from "./portable-ink.mjs";
const finite = (n, min, max) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
const reject = message => { throw new Error(`Invalid logical ink source: ${message}`); };
export function validateInkFragments(primary, fragments) {
  if (fragments === undefined) return;
  if(primary?.format==="showai-ink-v2")reject("cubic ink cannot have inkFragments");
  validatePortableInk(primary);
  if (!Array.isArray(fragments) || fragments.length > 1024) reject("fragment list");
  for (const fragment of fragments) {
    validatePortableInk(fragment);
    if(fragment.format!==primary.format)reject("fragment format must match its logical stroke");
    for (const field of ["brushVersion", "brush", "width", "opacity", "extent", "transform"])
      if (JSON.stringify(fragment[field]) !== JSON.stringify(primary[field])) reject(`fragment ${field} must match its logical stroke`);
  }
}
export function validateInkInput(input, primary, fragments = []) {
  if(primary?.format==="showai-ink-v2"){if(input!==undefined)reject("cubic ink capture belongs inside ink, not attrs.inkInput");return;}
  if (input === undefined) return;
  if (!input || input.format !== "showai-input-v1" || typeof input.sourceID !== "string" || !input.sourceID || input.sourceID.length > 256 || input.composite !== "single-opacity-coverage" || input.fragmentCount !== 1 + fragments.length || input.compositeOpacity !== primary?.opacity) reject("source identity, fragment count or opacity");
  if (Object.keys(input).some(key => !["format", "sourceID", "configuration", "raw", "curves", "fragmentCount", "compositeOpacity", "composite"].includes(key))) reject("unknown source field");
  const ranges = { width: [0.5, 40], creationZoom: [0.001, 1024], fitTolerance: [1e-6, 1e4], flattenTolerance: [1e-6, 1e4], positionWindow: [0, 1], jitterWindow: [0, 1], forceBackward: [0, 1e4], forceForward: [0, 1e4], forceTime: [0, 1], minimumFraction: [0, 10], maximumFraction: [0, 10], curveBlend: [0, 1], estimateTimeout: [0, 10] };
  const config = input.configuration;
  if (!config || config.version !== 1 || ![0, 1, 2].includes(config.mode) || Object.keys(config).some(key => !["version", "mode", ...Object.keys(ranges)].includes(key)) || Object.entries(ranges).some(([key, [min, max]]) => !finite(config[key], min, max)) || config.maximumFraction < config.minimumFraction || config.width !== primary.width) reject("input configuration");
  if (!Array.isArray(input.raw) || !input.raw.length || input.raw.length > 1e6 || !Array.isArray(input.curves) || input.curves.length > 1e6) reject("raw input/curve count");
  let time = -Infinity;
  for (const point of input.raw) {
    if (!Array.isArray(point) || point.length !== 10 || !finite(point[0], -1e6, 1e6) || !finite(point[1], -1e6, 1e6) || !finite(point[2], 0, 1e6) || point[2] < time || !finite(point[3], 0, 100) || !finite(point[4], -100, 100) || !finite(point[5], -100, 100) || point.slice(6, 9).some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff) || ![0, 1].includes(point[9])) reject("raw actual point");
    time = point[2];
  }
  for (const curve of input.curves) {
    if (!curve || Object.keys(curve).some(key => !["points", "firstRaw", "lastRaw", "steps"].includes(key)) || !Array.isArray(curve.points) || curve.points.length !== 8 || curve.points.some(value => !finite(value, -1e6, 1e6)) || !Number.isInteger(curve.firstRaw) || !Number.isInteger(curve.lastRaw) || curve.firstRaw < 0 || curve.lastRaw < curve.firstRaw || curve.lastRaw >= input.raw.length || !Number.isInteger(curve.steps) || curve.steps < 1 || curve.steps > 1e7) reject("fitted curve provenance");
  }
}
