import { freezeOwnedJSON, captureOwnedJSON } from "../portable/owned-json.mjs";
import { inkInputConfiguration } from "./ink-kernel/compiled-ink-input.mjs";

// Only this actual Worker receiver writes the cache. There is deliberately no
// public "adopt geometry"/claimed-proof method. Keys bind the actual immutable
// source graph plus style and persisted derivation parameters, not a nonce.
const sources = new WeakMap(),
  immutableData = new WeakSet(),
  retained = new Map(),
  geometryOwners = new WeakMap(),
  queryCharges = new WeakSet();
const MAX_BYTES = 32 * 1024 * 1024,
  MAX_ENTRIES = 128;
let retainedBytes = 0,
  nextGeometry = 0;
const geometryKey = (ink, width, pressure) =>
  JSON.stringify([width, pressure, ink.geometryVersion, ink.outlineTolerance]);
function immutable(value) {
  if (!value || typeof value !== "object") return;
  if (immutableData.has(value)) return;
  const array = Array.isArray(value),
    prototype = Object.getPrototypeOf(value);
  if (
    !Object.isFrozen(value) ||
    (array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null)
  )
    throw new Error(
      "Cubic preparation requires recursively immutable plain source data",
    );
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!Object.hasOwn(descriptor, "value"))
      throw new Error("Cubic preparation cannot cache an accessor source");
    immutable(descriptor.value);
  }
  immutableData.add(value);
}
function store(ink, width, pressure, geometry) {
  const key = geometryKey(ink, width, pressure),
    id = ++nextGeometry;
  let entries = sources.get(ink);
  if (!entries) {
    entries = new Map();
    sources.set(ink, entries);
  }
  const prior = entries.get(key),
    old = prior && retained.get(prior.id);
  if (old) {
    retainedBytes -= old.bytes;
    retained.delete(prior.id);
  }
  entries.set(key, { id, weak: new WeakRef(geometry) });
  while (entries.size > 8) entries.delete(entries.keys().next().value);
  const bytes =
    geometry.commands.length * 96 +
    geometry.path.length * 2 +
    geometry.chunks.length * 256;
  retained.set(id, { geometry, bytes });
  geometryOwners.set(geometry, id);
  retainedBytes += bytes;
  while (retained.size > MAX_ENTRIES || retainedBytes > MAX_BYTES) {
    const first = retained.keys().next().value;
    retainedBytes -= retained.get(first).bytes;
    retained.delete(first);
  }
}
export function preparedCubicGeometry(
  ink,
  width = ink.width,
  pressure = ink.brush !== "monoline",
) {
  const entry = sources.get(ink)?.get(geometryKey(ink, width, pressure));
  if (!entry) return undefined;
  const held = retained.get(entry.id);
  if (held) {
    retained.delete(entry.id);
    retained.set(entry.id, held);
    return held.geometry;
  }
  return entry.weak.deref();
}
// Charging a query cannot create a geometry/source proof. Only the actual
// receiver above can do that. Keep derived polygon allocations in the same LRU.
export function chargePreparedCubicQuery(geometry, query) {
  if (queryCharges.has(query)) return;
  const id = geometryOwners.get(geometry),
    entry = retained.get(id);
  if (!entry) return;
  const bytes = query.polygons.reduce(
    (total, polygon) => total + polygon.length * 48 + 32,
    0,
  );
  entry.bytes += bytes;
  retainedBytes += bytes;
  queryCharges.add(query);
  while (retained.size > MAX_ENTRIES || retainedBytes > MAX_BYTES) {
    const first = retained.keys().next().value;
    retainedBytes -= retained.get(first).bytes;
    retained.delete(first);
  }
}
export class CubicWorkerFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CubicWorkerFailure";
    this.code = code;
  }
}

/** Lazily created by a real editor, never by the synchronous Node/JSC reader.
 * A Worker has a private port; its producer result is frozen before callbacks
 * escape. Mutable/shallow-frozen source callers cannot create a cache binding.
 */
export function createPortableCubicClient() {
  let worker,
    disposed = false,
    active = null,
    serial = 0,
    broken;
  let remoteSources = new WeakMap();
  const high = [],
    low = [],
    pending = new Map(),
    listeners = new Set();
  function fail(error) {
    broken = error;
    worker?.terminate();
    worker = undefined;
    const jobs = [...pending.values(), ...high, ...low];
    pending.clear();
    high.length = low.length = 0;
    active = null;
    for (const job of jobs) {
      clearTimeout(job.timeout);
      job.reject(error);
    }
    for (const listener of listeners) listener(error);
  }
  function boot() {
    if (disposed)
      throw new CubicWorkerFailure(
        "CUBIC_RETIRED",
        "Cubic worker belongs to a retired editor",
      );
    if (worker) return worker;
    const current = new Worker(
      new URL("./portable-cubic-input-worker.ts", import.meta.url),
      { type: "module" },
    );
    worker = current;
    current.addEventListener("error", (event) => {
      if (worker !== current) return;
      fail(
        new CubicWorkerFailure(
          "CUBIC_WORKER_CRASH",
          event.message || "Cubic input worker stopped",
        ),
      );
    });
    current.addEventListener("messageerror", () => {
      if (worker === current)
        fail(
          new CubicWorkerFailure(
            "CUBIC_WORKER_MESSAGE",
            "Cubic worker response could not be decoded",
          ),
        );
    });
    current.addEventListener("message", (event) => {
      if (worker !== current || event.isTrusted === false) return;
      const job = pending.get(event.data?.id);
      if (!job) return;
      pending.delete(event.data.id);
      clearTimeout(job.timeout);
      active = null;
      try {
        if (!event.data.ok)
          job.reject(
            new CubicWorkerFailure(
              event.data.error?.code ?? "CUBIC_INPUT_FAILURE",
              event.data.error?.message ?? "Cubic input failed",
            ),
          );
        else {
          // UA structured cloning cannot transfer accessors. This actual private
          // producer's entire graph is sealed before any callback can alias it.
          let result = freezeOwnedJSON(event.data.result);
          const context = contexts.get(job.strokeId);
          if (result.paint) {
            const value = result.paint;
            if (
              !context ||
              value.strokeId !== job.strokeId ||
              value.baseGeneration !== context.generation ||
              value.generation <= context.generation ||
              !Number.isInteger(value.firstChunk) ||
              value.firstChunk < 0 ||
              value.firstChunk > context.chunks.length
            )
              throw new CubicWorkerFailure(
                "CUBIC_SUFFIX_BINDING",
                "Worker changed suffix does not belong to its actual retained contact",
              );
            context.chunks.length = value.firstChunk;
            for (const chunk of value.chunks) context.chunks.push(chunk);
            if (context.chunks.length !== value.chunkCount)
              throw new CubicWorkerFailure(
                "CUBIC_SUFFIX_BINDING",
                "Worker changed suffix has inconsistent chunk count",
              );
            context.generation = value.generation;
          }
          if (result.sealed) {
            const supplied = result.sealed.geometry;
            if (!context || supplied.chunks.length !== context.chunks.length)
              throw new CubicWorkerFailure(
                "CUBIC_SOURCE_BINDING",
                "Worker final geometry has inconsistent retained chunks",
              );
            const commands = [],
              chunks = supplied.chunks.map((chunk, index) => {
                const held = context.chunks[index];
                if (
                  chunk.start !== held.start ||
                  chunk.end !== held.end ||
                  JSON.stringify(chunk.statistics) !==
                    JSON.stringify(held.statistics)
                )
                  throw new CubicWorkerFailure(
                    "CUBIC_SOURCE_BINDING",
                    "Final geometry differs from its actual prepared source suffix",
                  );
                for (const command of held.commands) commands.push(command);
                return { ...chunk, commands: held.commands };
              });
            result = freezeOwnedJSON({
              ...result,
              sealed: {
                ...result.sealed,
                geometry: { ...supplied, commands, chunks },
              },
            });
          }
          if (job.ink && result.geometry) {
            if (result.sourceHandle)
              remoteSources.set(job.ink, {
                worker: current,
                handle: result.sourceHandle,
              });
            store(job.ink, job.width, job.pressure, result.geometry);
          }
          if (result.sealed) {
            const value = result.sealed;
            if (
              value.source?.capture?.sourceID !== job.strokeId ||
              value.node?.attrs?.ink !== value.source ||
              value.node.attrs.id !== job.strokeId ||
              value.width !== job.width ||
              value.pressure !== job.pressure ||
              JSON.stringify(value.configuration) !==
                JSON.stringify(job.configuration) ||
              JSON.stringify(value.source.capture.configuration) !==
                JSON.stringify(job.configuration)
            )
              throw new CubicWorkerFailure(
                "CUBIC_SOURCE_BINDING",
                "Worker source does not match its actual accepted contact and complete configuration",
              );
            if (result.sourceHandle)
              remoteSources.set(value.source, {
                worker: current,
                handle: result.sourceHandle,
              });
            immutableData.add(value.source);
            store(value.source, value.width, value.pressure, value.geometry);
          }
          job.resolve(result);
        }
      } catch (error) {
        job.reject(error);
        fail(error);
      }
      drain();
    });
    return current;
  }
  function drain() {
    if (active || disposed) return;
    const job = high.shift() ?? low.shift();
    if (!job) return;
    active = job;
    try {
      const current = boot();
      pending.set(job.id, job);
      job.timeout = setTimeout(() => {
        if (pending.has(job.id))
          fail(
            new CubicWorkerFailure(
              "CUBIC_WORKER_TIMEOUT",
              "Cubic input worker did not complete its accepted work",
            ),
          );
      }, 30000);
      current.postMessage({ id: job.id, request: job.request });
    } catch (error) {
      active = null;
      job.reject(error);
      fail(error);
    }
  }
  function send(request, binding = {}, priority = true) {
    if (disposed)
      return Promise.reject(
        new CubicWorkerFailure(
          "CUBIC_RETIRED",
          "Cubic worker belongs to a retired editor",
        ),
      );
    if (broken) return Promise.reject(broken);
    return new Promise((resolve, reject) => {
      (priority ? high : low).push({
        id: String(++serial),
        request,
        ...binding,
        resolve,
        reject,
      });
      drain();
    });
  }
  const contexts = new Map();
  return {
    ready: () => send({ kind: "ready" }),
    begin(options, batch) {
      const held = captureOwnedJSON(options),
        configuration = inkInputConfiguration({
          width: held.width,
          creationZoom: held.creationZoom,
          mode: held.pressure ? 1 : 0,
        });
      contexts.set(held.strokeId, {
        ...held,
        configuration,
        generation: 0,
        chunks: [],
      });
      return send(
        { kind: "begin", options: held, batch: captureOwnedJSON(batch) },
        {
          strokeId: held.strokeId,
          width: held.width,
          pressure: held.pressure,
          configuration,
        },
      );
    },
    push(strokeId, batches) {
      const context = contexts.get(strokeId);
      if (!context)
        return Promise.reject(new Error("Cubic input context is not held"));
      return send(
        { kind: "push", strokeId, batches: captureOwnedJSON(batches) },
        { strokeId, width: context.width, pressure: context.pressure },
      );
    },
    seal(strokeId, batches) {
      const context = contexts.get(strokeId);
      if (!context)
        return Promise.reject(new Error("Cubic input context is not held"));
      return send(
        { kind: "seal", strokeId, batches: captureOwnedJSON(batches) },
        {
          strokeId,
          width: context.width,
          pressure: context.pressure,
          configuration: context.configuration,
        },
      );
    },
    release(strokeId) {
      contexts.delete(strokeId);
      return send({ kind: "release", strokeId });
    },
    prepare(ink, width = ink.width, pressure = ink.brush !== "monoline") {
      if (disposed)
        return Promise.reject(
          new CubicWorkerFailure(
            "CUBIC_RETIRED",
            "Cubic worker belongs to a retired editor",
          ),
        );
      const known = preparedCubicGeometry(ink, width, pressure);
      if (known) return Promise.resolve(known);
      immutable(ink);
      const remote = remoteSources.get(ink),
        binding = { ink, width, pressure };
      const request =
        remote && remote.worker === worker
          ? { kind: "prepare", sourceHandle: remote.handle, width, pressure }
          : { kind: "prepare", ink, width, pressure };
      return send(request, binding, false)
        .catch((error) => {
          if (error.code !== "CUBIC_SOURCE_MISSING" || request.ink) throw error;
          remoteSources.delete(ink);
          return send(
            { kind: "prepare", ink, width, pressure },
            binding,
            false,
          );
        })
        .then((result) => result.geometry);
    },
    onFailure(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restart() {
      if (pending.size || high.length || low.length || active)
        throw new CubicWorkerFailure(
          "CUBIC_BUSY",
          "Accepted worker requests must settle before restart",
        );
      if (disposed)
        throw new CubicWorkerFailure(
          "CUBIC_RETIRED",
          "Cubic input editor retired",
        );
      worker?.terminate();
      worker = undefined;
      broken = undefined;
      contexts.clear();
      remoteSources = new WeakMap();
    },
    close() {
      disposed = true;
      worker?.terminate();
      worker = undefined;
      fail(
        new CubicWorkerFailure("CUBIC_RETIRED", "Cubic input editor retired"),
      );
      listeners.clear();
      contexts.clear();
    },
  };
}
