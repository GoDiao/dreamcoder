import {
  CAPACITY,
  assertBytes,
  utf8Bytes,
  dataUrlContent,
} from "./capacity.mjs";
// One actual recursive ownership registry shared by source factories and their
// private validation adapters. Object.isFrozen(root) alone is never proof.
const owned = new WeakSet(),
  metrics = new WeakMap(),
  plainOwned = new WeakSet(),
  contentSummaries = new WeakMap();
export function freezeOwnedJSON(value) {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new TypeError("Invalid native source delta: non-JSON value");
  if (value && typeof value === "object" && !owned.has(value)) {
    for (const key of Object.keys(value)) freezeOwnedJSON(value[key]);
    const children = [],
      keys = Object.keys(value);
    let bytes = 48 + keys.length * 8;
    for (const key of keys) {
      const child = value[key];
      if (!Array.isArray(value)) bytes += key.length * 2;
      if (child && typeof child === "object") children.push(child);
      else bytes += typeof child === "string" ? child.length * 2 : 8;
    }
    metrics.set(
      value,
      Object.freeze({ bytes, children: Object.freeze(children) }),
    );
    Object.freeze(value);
    owned.add(value);
  }
  return value;
}
export const isOwnedJSON = (value) =>
  !!value && typeof value === "object" && owned.has(value);
export const ownedJSONMetrics = (value) => metrics.get(value);
/** Read-only evidence for this module's actual captured data. Generic freezing
 * cannot install it; caller-authored reports never enter this private map. */
export const capturedContentSummary = (value) =>
  value && typeof value === "object" ? contentSummaries.get(value) : undefined;

function summarizeCaptured(value, keys, array) {
  const length = keys.length;
  let structureBytes = 2 + Math.max(0, length - 1),
    jsonBytes = structureBytes,
    prettyPadding = length ? (array ? 3 : 4) * length + 1 : 0,
    prettyDepthFactor = length ? 2 * (length + 1) : 0,
    maximumDepth = 0,
    resourceLeaves = 0,
    resources;
  for (const key of keys) {
    if (!array) {
      const bytes = scalarBytes(key) + 1;
      structureBytes += bytes;
      jsonBytes += bytes;
    }
    const child = value[key];
    if (!child || typeof child !== "object") {
      const bytes = scalarBytes(child),
        resource = dataUrlContent(child);
      structureBytes += resource?.structureBytes ?? bytes;
      jsonBytes += bytes;
      maximumDepth = Math.max(maximumDepth, 1);
      if (resource) {
        resourceLeaves++;
        resources ??= [];
        resources.push(
          Object.freeze({ value: resource.value, bytes: resource.bytes }),
        );
      }
      continue;
    }
    const summary = contentSummaries.get(child);
    if (!summary)
      throw new Error("Captured JSON child has no actual content summary");
    structureBytes += summary.structureBytes;
    jsonBytes += summary.jsonBytes;
    prettyPadding += summary.prettyPadding + summary.prettyDepthFactor;
    prettyDepthFactor += summary.prettyDepthFactor;
    maximumDepth = Math.max(maximumDepth, 1 + summary.maximumDepth);
    if (summary.resources) {
      resources ??= [];
      resources.push(summary.resources);
    }
  }
  const tree = !resources
    ? null
    : resources.length === 1
      ? resources[0]
      : Object.freeze(resources);
  return Object.freeze({
    structureBytes,
    jsonBytes,
    prettyPadding,
    prettyDepthFactor,
    maximumDepth,
    resources: tree,
    bookkeepingBytes:
      resourceLeaves * 48 +
      (resources?.length > 1 ? 48 + resources.length * 8 : 0),
  });
}

// This proof is separate from generic recursive freezing: only an exclusive
// JSON.parse graph or an independent data capture can enter this registry.
function scalarBytes(value) {
  return utf8Bytes(JSON.stringify(value));
}
function capturePlain(
  value,
  exclusive,
  active,
  captured,
  depth,
  budget,
  candidate,
) {
  const charge = (bytes) => {
    if (!exclusive) {
      budget.bytes += bytes;
      assertBytes("Source JSON capture", budget.bytes, budget.maximum);
    }
  };
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    if (!exclusive) charge(scalarBytes(value));
    return value;
  }
  if (!value || typeof value !== "object")
    throw new TypeError(
      "Invalid native source delta: non-JSON value (expected finite plain data)",
    );
  // Reusing a sealed branch allocates no defensive copy. Its actual encoded
  // bytes remain subject to the complete document/artifact gates afterwards.
  if (plainOwned.has(value)) return value;
  if (depth > 64 || (!exclusive && active.has(value)))
    throw new TypeError("Expected acyclic JSON data within depth 64");
  if (!exclusive && captured.has(value)) {
    const result = captured.get(value);
    return result;
  }
  const array = Array.isArray(value),
    prototype = exclusive ? Object.prototype : Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null)
    throw new TypeError("Expected plain JSON objects");
  const keys = Object.keys(value);
  if (
    !exclusive &&
    array &&
    (keys.length !== value.length ||
      keys.some((key, index) => key !== String(index)))
  )
    throw new TypeError("Expected dense JSON arrays");
  const usable =
    !!candidate &&
    plainOwned.has(candidate) &&
    Array.isArray(candidate) === array;
  let equal = usable && keys.length === Object.keys(candidate).length;
  const result = exclusive ? value : array ? [] : {};
  charge(2 + Math.max(0, keys.length - 1));
  if (!exclusive) active.add(value);
  for (const key of keys) {
    if (!array && !exclusive) charge(scalarBytes(key) + 1);
    const prior =
      usable && Object.hasOwn(candidate, key) ? candidate[key] : undefined;
    const child = capturePlain(
      value[key],
      exclusive,
      active,
      captured,
      depth + 1,
      budget,
      prior,
    );
    equal = equal && Object.hasOwn(candidate, key) && child === prior;
    if (!exclusive || child !== value[key])
      Object.defineProperty(result, key, {
        value: child,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  if (!exclusive) active.delete(value);
  if (equal) {
    if (!exclusive) captured.set(value, candidate);
    return candidate;
  }
  // The source is now actual plain data; this sealing walk visits only new
  // immediate children. Previously proved branches are never re-frozen.
  freezeOwnedJSON(result);
  const summary = summarizeCaptured(result, keys, array);
  contentSummaries.set(result, summary);
  // Logical residency includes bookkeeping for the retained summary/index.
  // These graph estimates are separate from JavaScript heap measurement.
  const metric = metrics.get(result);
  metrics.set(
    result,
    Object.freeze({
      bytes: metric.bytes + 128 + summary.bookkeepingBytes,
      children: metric.children,
    }),
  );
  plainOwned.add(result);
  if (!exclusive) captured.set(value, result);
  return result;
}
export function captureOwnedJSON(
  value,
  maximumNewCopyBytes = CAPACITY.publicationTransferBytes,
) {
  if (
    !Number.isSafeInteger(maximumNewCopyBytes) ||
    maximumNewCopyBytes < 0 ||
    maximumNewCopyBytes > CAPACITY.publicationTransferBytes
  )
    throw new TypeError("Invalid source defensive capture budget");
  return capturePlain(value, false, new WeakSet(), new WeakMap(), 0, {
    bytes: 0,
    maximum: maximumNewCopyBytes,
  });
}
/** Parse, compare against actual sealed data, and seal before anything escapes.
 * The base may suggest reuse but every field is compared; no identity shortcut
 * grants ownership to mutable caller objects or accessor graphs. */
export function parseOwnedJSON(raw, base) {
  // This exclusive parse creates no extra defensive whole-graph copy. An
  // internal merged request can contain three independently legal documents;
  // the public artifact/P limits must not become a new whole-request limit.
  const candidate = base === undefined ? undefined : captureOwnedJSON(base);
  return capturePlain(
    JSON.parse(raw),
    true,
    new WeakSet(),
    new WeakMap(),
    0,
    { bytes: 0 },
    candidate,
  );
}

/** Exact sharing within independent, sealed JSON captures. The identity exit
 * is safe only after this factory's actual capture, including accessor inputs.
 * Reordered object arrays retain equal old leaves by their real unique IDs. */
export function shareCapturedJSON(base, target) {
  const before = captureOwnedJSON(base),
    after = captureOwnedJSON(target);
  const stableId = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const attrs = Object.hasOwn(value, "attrs") ? value.attrs : undefined;
    if (
      attrs &&
      typeof attrs === "object" &&
      Object.hasOwn(attrs, "id") &&
      typeof attrs.id === "string" &&
      attrs.id
    )
      return attrs.id;
    return Object.hasOwn(value, "id") &&
      typeof value.id === "string" &&
      value.id
      ? value.id
      : null;
  };
  const share = (one, two) => {
    if (
      (one && typeof one === "object" && !plainOwned.has(one)) ||
      (two && typeof two === "object" && !plainOwned.has(two))
    )
      throw new Error(
        "Exact sharing requires actual independently captured branches",
      );
    if (one === two) return one;
    if (
      !one ||
      !two ||
      typeof one !== "object" ||
      typeof two !== "object" ||
      Array.isArray(one) !== Array.isArray(two)
    )
      return two;
    const array = Array.isArray(two),
      keys = Object.keys(two);
    let sameBefore = Object.keys(one).length === keys.length,
      sameAfter = true,
      byId;
    if (array && one.length && stableId(one[0])) {
      byId = new Map();
      for (const child of one) {
        const id = stableId(child);
        if (!id || byId.has(id)) {
          byId = undefined;
          break;
        }
        byId.set(id, child);
      }
    }
    const result = array ? [] : {};
    for (const key of keys) {
      const prior = byId
          ? byId.get(stableId(two[key]))
          : Object.hasOwn(one, key)
            ? one[key]
            : undefined,
        child = share(prior, two[key]);
      Object.defineProperty(result, key, {
        value: child,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      sameBefore = sameBefore && Object.hasOwn(one, key) && child === one[key];
      sameAfter = sameAfter && child === two[key];
    }
    return sameBefore ? one : sameAfter ? two : result;
  };
  return captureOwnedJSON(share(before, after));
}
