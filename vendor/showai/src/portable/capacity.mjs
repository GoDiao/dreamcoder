import { capturedContentSummary } from "./owned-json.mjs";
/** Byte budgets for distinct architectural boundaries. Binary resources are measured decoded. */
const MiB = 1024 * 1024;
export const CAPACITY = Object.freeze({
  pageStructureBytes: 16 * MiB,
  resourceBytes: 64 * MiB,
  pageResourceBytes: 128 * MiB,
  componentPropsBytes: 8 * MiB,
  // A shared dataset becomes component props, so it shares their budget.
  datasetBytes: 8 * MiB,
  componentSourceBytes: 16 * MiB,
  componentAssetBytes: 128 * MiB,
  componentFiles: 200,
  compiledComponentBytes: 16 * MiB,
  artifactBytes: 256 * MiB,
  htmlBytes: 256 * MiB,
  authoringRequestBytes: 256 * MiB,
  publicationBytes: 256 * MiB,
  publicationTransferBytes: 512 * MiB,
  syncManifestBytes: 16 * MiB,
  syncObjectBytes: 64 * MiB,
  // The conversation renderer's limit is decimal bytes, unlike storage budgets.
  chatBytes: 1_000_000,
  mcpImageBytes: 8 * MiB,
});
/** Counts TextEncoder's output without allocating it; lone surrogates encode as U+FFFD. */
export const utf8Bytes = (value) => {
  let bytes = value.length;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) continue;
    if (code < 0x800) bytes += 1;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      (value.charCodeAt(index + 1) & 0xfc00) === 0xdc00
    ) {
      bytes += 2;
      index++;
    } else bytes += 2;
  }
  return bytes;
};
export function formatBytes(bytes) {
  return `${(bytes / MiB).toFixed(2)} MiB (${bytes} bytes)`;
}
export class CapacityError extends Error {
  constructor(kind, actualBytes, limitBytes) {
    super(
      `${kind} is ${formatBytes(actualBytes)}; limit is ${formatBytes(limitBytes)}.`,
    );
    this.name = "CapacityError";
    this.code = "CAPACITY_EXCEEDED";
    this.kind = kind;
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}
export function assertBytes(kind, bytes, maximum) {
  if (bytes > maximum) throw new CapacityError(kind, bytes, maximum);
}
/** Reject malformed encodings before allocating their decoded buffer. */
function canonicalPadding(encoded) {
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  return (
    !padding ||
    !(alphabet.indexOf(encoded.at(-padding - 1)) & (padding === 2 ? 15 : 3))
  );
}
export function base64Bytes(encoded) {
  if (
    typeof encoded !== "string" ||
    encoded.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new Error("Invalid base64 resource.");
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (!canonicalPadding(encoded))
    throw new Error("Non-canonical base64 resource.");
  return (encoded.length / 4) * 3 - padding;
}
/** Pure classification used while an actual independent JSON branch seals.
 * It does not admit a resource: the ordinary measurement gate checks limits. */
export function dataUrlContent(value) {
  if (typeof value !== "string") return null;
  const match = /^data:([\w.+\/-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[2].length % 4 || !canonicalPadding(match[2])) return null;
  return {
    value,
    bytes: base64Bytes(match[2]),
    structureBytes: utf8Bytes(JSON.stringify(`asset:${match[1]}:sha256`)),
  };
}
// Extra traversal evidence stays private: ordinary measurement report shape is
// unchanged, and a caller-created numeric report cannot assert a measured depth.
const measurementDepth = new WeakMap();
export const contentMeasurementDepth = (report) =>
  measurementDepth.get(report) ?? null;
/** Mirrors storage's whole-string data-URL extraction; URLs inside code remain structure. */
export function measureContent(value) {
  const held = capturedContentSummary(value);
  if (held) {
    if (held.maximumDepth > 64)
      throw new Error("Capacity input is nested too deeply.");
    let resourceBytes = 0;
    const resources = new Set(),
      visited = new Set(),
      pending = held.resources ? [held.resources] : [];
    while (pending.length) {
      const tree = pending.pop();
      if (visited.has(tree)) continue;
      visited.add(tree);
      if (Array.isArray(tree)) {
        for (const child of tree) pending.push(child);
        continue;
      }
      assertBytes(
        "Single resource (decoded)",
        tree.bytes,
        CAPACITY.resourceBytes,
      );
      if (!resources.has(tree.value)) {
        resources.add(tree.value);
        resourceBytes += tree.bytes;
      }
    }
    const result = {
      structureBytes: held.structureBytes,
      resourceBytes,
      resourceCount: resources.size,
      jsonBytes: held.jsonBytes,
      prettyJsonBytes: held.jsonBytes + held.prettyPadding,
    };
    measurementDepth.set(result, held.maximumDepth);
    return result;
  }
  let structureBytes = 0,
    resourceBytes = 0,
    jsonBytes = 0,
    prettyPadding = 0;
  const resources = new Set();
  let maximumDepth = 0;
  const addStructure = (bytes) => {
    structureBytes += bytes;
    jsonBytes += bytes;
  };
  const visit = (entry, depth = 0) => {
    if (depth > 64) throw new Error("Capacity input is nested too deeply.");
    maximumDepth = Math.max(maximumDepth, depth);
    if (typeof entry === "string") {
      const match = /^data:([\w.+\/-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
        entry,
      );
      if (match && match[2].length % 4 === 0 && canonicalPadding(match[2])) {
        const bytes = base64Bytes(match[2]);
        assertBytes("Single resource (decoded)", bytes, CAPACITY.resourceBytes);
        if (!resources.has(entry)) {
          resources.add(entry);
          resourceBytes += bytes;
        }
        structureBytes += utf8Bytes(JSON.stringify(`asset:${match[1]}:sha256`));
        // Canonical data URLs contain only ASCII and need no JSON escaping.
        jsonBytes += entry.length + 2;
      } else addStructure(utf8Bytes(JSON.stringify(entry)));
    } else if (Array.isArray(entry)) {
      addStructure(2 + Math.max(0, entry.length - 1));
      if (entry.length)
        prettyPadding += entry.length * (1 + 2 * (depth + 1)) + 1 + 2 * depth;
      entry.forEach((child) => visit(child, depth + 1));
    } else if (entry && typeof entry === "object") {
      const entries = Object.entries(entry);
      addStructure(2 + Math.max(0, entries.length - 1));
      if (entries.length)
        prettyPadding += entries.length * (2 + 2 * (depth + 1)) + 1 + 2 * depth;
      for (const [key, child] of entries) {
        addStructure(utf8Bytes(JSON.stringify(key)) + 1);
        visit(child, depth + 1);
      }
    } else addStructure(utf8Bytes(JSON.stringify(entry)));
  };
  visit(value);
  const result = {
    structureBytes,
    resourceBytes,
    resourceCount: resources.size,
    jsonBytes,
    prettyJsonBytes: jsonBytes + prettyPadding,
  };
  measurementDepth.set(result, maximumDepth);
  return result;
}
/** Local byte comparison only. A caller must separately prove that one
 * existing field changed and that its real base body satisfies all limits.
 * New/different resources require a whole-body deduplicated measurement. */
export function nonResourceReplacementDoesNotGrow(before, after) {
  const oldSize = measureContent(before),
    newSize = measureContent(after);
  return (
    !oldSize.resourceCount &&
    !newSize.resourceCount &&
    newSize.structureBytes <= oldSize.structureBytes &&
    newSize.jsonBytes <= oldSize.jsonBytes
  );
}
export function assertContent(
  value,
  kind = "Page structure",
  maximum = CAPACITY.pageStructureBytes,
) {
  return assertContentSizes(measureContent(value), kind, maximum);
}
/** Apply the same limits to an internally measured report or a proven upper
 * bound. Reports themselves are measurements, never document-validation proof. */
export function assertContentSizes(
  sizes,
  kind = "Page structure",
  maximum = CAPACITY.pageStructureBytes,
) {
  assertBytes(kind, sizes.structureBytes, maximum);
  assertBytes(
    "Page resources (decoded, unique URLs)",
    sizes.resourceBytes,
    CAPACITY.pageResourceBytes,
  );
  // Repeated URLs deduplicate in storage but expand in portable JSON and requests.
  assertBytes(
    "Authoring JSON (encoded resources included)",
    sizes.jsonBytes,
    CAPACITY.authoringRequestBytes,
  );
  return sizes;
}
export function assertCompiledComponent(component) {
  assertBytes(
    "Compiled component HTML",
    utf8Bytes(component.html),
    CAPACITY.compiledComponentBytes,
  );
  if (component.inline)
    assertBytes(
      "Compiled component inline code",
      utf8Bytes(component.inline.script) + utf8Bytes(component.inline.styles),
      CAPACITY.compiledComponentBytes,
    );
}
export function assertPackageFiles(files) {
  let sourceBytes = 0,
    assetBytes = 0,
    count = 0;
  for (const [name, bytes, text] of files) {
    count++;
    if (text) sourceBytes += bytes;
    else {
      assertBytes(`Component asset ${name}`, bytes, CAPACITY.resourceBytes);
      assetBytes += bytes;
    }
  }
  if (count > CAPACITY.componentFiles)
    throw new Error(
      `Component package has ${count} files; limit is ${CAPACITY.componentFiles}.`,
    );
  assertBytes(
    "Component source files",
    sourceBytes,
    CAPACITY.componentSourceBytes,
  );
  assertBytes(
    "Component assets (decoded)",
    assetBytes,
    CAPACITY.componentAssetBytes,
  );
  return { sourceBytes, assetBytes, files: count };
}
/** Bound body allocation for Worker and Node HTTP MCP before decoding JSON. */
export async function readCapacityText(request, maximum, kind) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new Error("Invalid Content-Length.");
    if (Number(declared) > maximum) {
      await request.body?.cancel();
      assertBytes(kind, Number(declared), maximum);
    }
  }
  if (!request.body) return "";
  const reader = request.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        assertBytes(kind, size, maximum);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
