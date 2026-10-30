import { isInkNode, validatePortableInk } from "./portable-ink.mjs";
import { validateInkFragments, validateInkInput } from "./ink-input-contract.mjs";

export const INK_OPERATION_FORMAT = "showai-ink-operation-v1";
export const INK_CHECKPOINT_FORMAT = "showai-ink-checkpoint-v1";
const attributes = ["ink", "inkFragments", "color", "strokeWidth", "pressure"];
const fields = [...attributes, "node", "layout", "placement"];
const own = (object, key) => Object.hasOwn(object, key);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const finite = n => typeof n === "number" && Number.isFinite(n);
const id = value => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value);
const invalid = message => { throw new Error(`Invalid ink operation: ${message}`); };
const clone = value => JSON.parse(canonicalInkJSON(value));

/** Strict JSON, UTF-16 object-key order, and ECMAScript number formatting. */
export function canonicalInkJSON(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (finite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalInkJSON).join(",")}]`;
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${canonicalInkJSON(value[key])}`).join(",")}}`;
  return invalid("only finite JSON values are supported");
}

let inkDigestProvider = null;
const checkedDigest = value => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid("SHA-256 provider must return 64 lowercase hexadecimal characters synchronously");
  return value;
};
/** Install a trusted synchronous platform SHA-256 implementation. Input is the
 * exact existing source string; encode UTF-8 with isolated UTF-16 surrogates
 * replaced by U+FFFD, preserving NUL and Unicode normalization form. No provider
 * error is caught or silently retried with another implementation. Installation
 * publishes only after all known vectors pass; a failed replacement leaves the
 * previous provider active. Passing null restores the portable implementation. */
export function installInkDigestProvider(provider) {
  if (provider === null) { inkDigestProvider = null; return; }
  if (typeof provider !== "function") invalid("SHA-256 provider must be a function or null");
  const vectors = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["\0", "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d"],
    // i18n-exempt: UTF-8 known-answer vector, not UI text.
    ["中文🤔", "431406ad071587234a33f8c00aa72eb2e54e28dad036f7f4061ffbff82f966ee"],
    ["\ud800", "83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097"],
    ["\udc00", "83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097"],
    ["é", "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c"],
    ["e\u0301", "bf12767b0f2a56b2190075bae8169f656e3ce8d6357d4aff184bc6c7ea48f9f6"],
    ["a".repeat(63), "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34"],
    ["a".repeat(64), "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"],
    ["a".repeat(65), "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0"],
    ['{"a":[0,1e-8,1e+21],"z":"é"}', "0cd3dcf34ffcc62e2f24861f9f37733172d3b3b5c353018bdab1f9b8aa2ed77d"],
  ];
  for (const [source, expected] of vectors) if (checkedDigest(provider(source)) !== expected) invalid("SHA-256 provider failed its UTF-8 known-vector self-test");
  inkDigestProvider = provider;
}

/** Synchronous SHA-256 shared by every lexical kernel and wire call site. */
export function inkOperationDigest(value) {
  const source = typeof value === "string" ? value : canonicalInkJSON(value);
  return inkDigestProvider ? checkedDigest(inkDigestProvider(source)) : portableInkDigest(source);
}
function portableInkDigest(source) {
  const bytes = [];
  for (const ch of source) {
    const code = ch.codePointAt(0), c = code >= 0xd800 && code <= 0xdfff ? 0xfffd : code;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | c >> 6, 0x80 | c & 63);
    else if (c < 0x10000) bytes.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    else bytes.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
  }
  const bits = bytes.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; --i) bytes.push(Math.floor(bits / 2 ** (i * 8)) & 255);
  const constants = [], initial = [];
  for (let candidate = 2; constants.length < 64; ++candidate) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; ++divisor) if (candidate % divisor === 0) { prime = false; break; }
    if (!prime) continue;
    if (initial.length < 8) initial.push(Math.floor(Math.sqrt(candidate) * 2 ** 32) >>> 0);
    constants.push(Math.floor(Math.cbrt(candidate) * 2 ** 32) >>> 0);
  }
  const rotate = (v, n) => v >>> n | v << 32 - n, words = new Int32Array(64), result = initial;
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; ++i) words[i] = bytes[offset + i * 4] << 24 | bytes[offset + i * 4 + 1] << 16 | bytes[offset + i * 4 + 2] << 8 | bytes[offset + i * 4 + 3];
    for (let i = 16; i < 64; ++i) {
      const x = words[i - 15], y = words[i - 2];
      words[i] = words[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ x >>> 3) + words[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ y >>> 10);
    }
    let [a, b, c, d, e, f, g, h] = result;
    for (let i = 0; i < 64; ++i) {
      const t1 = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + constants[i] + words[i];
      const t2 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c);
      h = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { result[i] = result[i] + v >>> 0; });
  }
  return result.map(n => n.toString(16).padStart(8, "0")).join("");
}

function layout(value) {
  if (!value || !finite(value.x) || !finite(value.y) || !finite(value.width) || value.width <= 0 ||
      value.height !== undefined && (!finite(value.height) || value.height <= 0) ||
      value.rotation !== undefined && !finite(value.rotation)) invalid("invalid stroke layout");
}
export function validateInkOperationField(name, value) {
  if (![...fields, "alive"].includes(name)) invalid("unsupported field");
  return field(name, value);
}
function field(name, value) {
  if (attributes.includes(name) && value === null) return;
  if (name === "ink") validatePortableInk(value);
  else if (name === "inkFragments") { if (!Array.isArray(value) || value.length > 1024) invalid("invalid ink fragments"); value.forEach(validatePortableInk); }
  else if (name === "placement" && (!value || !id(value.parentId) || ![value.after, value.before].every(anchor => anchor === null || id(anchor)))) invalid("invalid stroke placement");
  else if (name === "node" && (!value?.attrs || !id(value.attrs.id) || attributes.some(key => own(value.attrs, key)))) invalid("node metadata must exclude mutable ink attributes");
  else if (name === "layout") layout(value);
  else if (name === "color" && (!id(value) || value.length > 128)) invalid("invalid color");
  else if (name === "strokeWidth" && (!finite(value) || value < 0.5 || value > 40)) invalid("invalid stroke width");
  else if (name === "pressure" && typeof value !== "boolean") invalid("invalid pressure flag");
}
function validateStrokeSourceVersions(stroke){
  if(stroke.registers.ink?.some(entry=>entry.value?.format==="showai-ink-v2")){
    if(stroke.registers.inkFragments?.some(entry=>entry.value!==null))invalid("cubic ink cannot retain inkFragments");
    if(stroke.registers.node?.some(entry=>Object.hasOwn(entry.value?.attrs??{},"inkInput")))invalid("cubic capture must be inside its atomic ink field");
  }
}

export function validateInkOperation(value) {
  canonicalInkJSON(value);
  if (value?.format !== INK_OPERATION_FORMAT || typeof value.actor !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value.actor) ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.id !== `${value.actor}:${value.sequence}` ||
      !id(value.pageId) || !id(value.boardId)) invalid("identity or version");
  if (!Array.isArray(value.parents) || new Set(value.parents).size !== value.parents.length ||
      value.parents.some(parent => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}:[1-9][0-9]*$/.test(parent) || parent === value.id)) invalid("causal parents");
  if (value.sequence > 1 && !value.parents.includes(`${value.actor}:${value.sequence - 1}`)) invalid("actor sequence must name its predecessor");
  if (!Array.isArray(value.changes) || !value.changes.length || value.changes.length > 100000) invalid("empty or excessive changes");
  const touched = new Set();
  for (const change of value.changes) {
    if (!id(change.strokeId) || touched.has(change.strokeId)) invalid("stroke identity must occur once per operation");
    touched.add(change.strokeId);
    if (change.kind === "create") {
      if (change.node?.attrs?.id !== change.strokeId || !isInkNode(change.node)) invalid("creation requires an ink node with the same stable id");
      if (change.node.attrs.ink) validatePortableInk(change.node.attrs.ink);
      validateInkFragments(change.node.attrs.ink, change.node.attrs.inkFragments);
      validateInkInput(change.node.attrs.inkInput, change.node.attrs.ink, change.node.attrs.inkFragments);
      layout(change.layout);
      if (change.placement) field("placement", change.placement);
    } else if (change.kind === "edit") {
      if (!change.patch || !Object.keys(change.patch).length || Object.keys(change.patch).some(key => !fields.includes(key))) invalid("unsupported edit field");
      Object.entries(change.patch).forEach(([key, value]) => field(key, value));
      if (change.patch.node && change.patch.node.attrs.id !== change.strokeId) invalid("metadata cannot change stroke identity");
    } else if (!["delete", "restore"].includes(change.kind)) invalid("unsupported change kind");
  }
  return value;
}

export function createInkOperation({ actor, sequence, pageId, boardId, parents = [], changes }) {
  return clone(validateInkOperation({ format: INK_OPERATION_FORMAT, id: `${actor}:${sequence}`, actor, sequence, pageId, boardId, parents: [...new Set(parents)].sort(compare), changes }));
}

/** Bootstrap once from an existing Board. It does not flatten or rasterize strokes. */
export function bootstrapInkOperation({ actor, pageId, boardId, nodes, layout }) {
  if (!nodes.length) return null;
  // The same imported snapshot must have one identity on every device. Distinct
  // snapshots require an explicit baseline reconciliation, never two creations.
  actor ??= `snapshot-${inkOperationDigest({ pageId, boardId, nodes, layout: Object.fromEntries(nodes.map(node => [node.attrs.id, layout[node.attrs.id]])) }).slice(0, 48)}`;
  return createInkOperation({ actor, sequence: 1, pageId, boardId, changes: nodes.map(node => ({ kind: "create", strokeId: node.attrs.id, node, layout: layout[node.attrs.id] })) });
}

export function emptyInkCheckpoint({ pageId, boardId }) {
  if (!id(pageId) || !id(boardId)) invalid("empty checkpoint scope");
  return { format: INK_CHECKPOINT_FORMAT, pageId, boardId, frontier: [], known: {}, strokes: [] };
}
export function inkNodeMetadata(node) {
  return { ...node, attrs: Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !attributes.includes(key))) };
}
const observed = (clock, operationId) => {
  const colon = operationId.lastIndexOf(":"), actor = operationId.slice(0, colon), sequence = Number(operationId.slice(colon + 1));
  return own(clock, actor) && clock[actor] >= sequence;
};

/** Checkpoints are local trusted accelerators, not self-authenticating remote
 * snapshots. Journal checksums detect corruption; remote batches replay source ops. */
export function validateInkCheckpoint(state) {
  if (state?.format !== INK_CHECKPOINT_FORMAT || !id(state.pageId) || !id(state.boardId) || !state.known || !Array.isArray(state.strokes) || !Array.isArray(state.frontier)) invalid("checkpoint");
  const known = state.known, operationIds = Object.keys(known);
  for (const operationId of operationIds) {
    const item = known[operationId], match = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,95}):([1-9][0-9]*)$/.exec(operationId);
    if (!match || !(item.anchor === true && item.hash === null || /^[a-f0-9]{64}$/.test(item.hash)) || !Number.isSafeInteger(item.level) || item.level < 1 || !item.clock || item.clock[match[1]] !== Number(match[2])) invalid("checkpoint causal identity");
    for (const [actor, sequence] of Object.entries(item.clock)) if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(actor) || !Number.isSafeInteger(sequence) || sequence < 1) invalid("checkpoint causal coverage");
  }
  if (new Set(state.frontier).size !== state.frontier.length || state.frontier.some(operationId => !own(known, operationId))) invalid("checkpoint frontier");
  for (const operationId of operationIds) if (!state.frontier.some(head => observed(known[head].clock, operationId))) invalid("checkpoint omits a causal head");
  for (const head of state.frontier) if (state.frontier.some(other => head !== other && observed(known[other].clock, head))) invalid("checkpoint frontier must be an antichain");
  const seen = new Set();
  for (const stroke of state.strokes) {
    if (!id(stroke.id) || seen.has(stroke.id) || !own(known, stroke.creationId) || !Array.isArray(stroke.creationOrder) || stroke.creationOrder.length !== 3 || stroke.creationOrder[0] !== known[stroke.creationId].level || stroke.creationOrder[1] !== stroke.creationId || !Number.isSafeInteger(stroke.creationOrder[2]) || stroke.creationOrder[2] < 0) invalid("checkpoint stroke identity");
    seen.add(stroke.id);
    if (!stroke.registers?.alive?.length || !stroke.registers.alive.some(entry => entry.value === false) && [...attributes.filter(key => key !== "inkFragments"), "node", "layout"].some(key => !stroke.registers?.[key]?.length)) invalid("checkpoint missing register");
    for (const [key, entries] of Object.entries(stroke.registers)) {
      if (![...fields, "alive"].includes(key) || !Array.isArray(entries) || !entries.length || new Set(entries.map(entry => entry.operationId)).size !== entries.length) invalid("checkpoint register");
      for (const entry of entries) {
        if (!own(known, entry.operationId) || !observed(known[entry.operationId].clock, stroke.creationId)) invalid("checkpoint register causality");
        if (key === "alive") { if (typeof entry.value !== "boolean") invalid("checkpoint liveness"); }
        else field(key, entry.value);
        if (key === "node" && entry.value.attrs.id !== stroke.id) invalid("checkpoint metadata identity");
      }
      if (entries.some(entry => entries.some(other => entry !== other && observed(known[other.operationId].clock, entry.operationId)))) invalid("checkpoint register heads must be concurrent");
    }
    validateStrokeSourceVersions(stroke);
  }
  return state;
}

/** Incremental replay: checkpoints retain causal metadata and current register heads,
 * not the historical sample payloads. Old operations remain in the durable journal
 * for selective undo and later peer reconciliation; this is not peer-safe GC. */
export class InkOperationReplica {
  constructor({ pageId, boardId, checkpoint }) {
    const state = checkpoint ? clone(validateInkCheckpoint(checkpoint)) : emptyInkCheckpoint({ pageId, boardId });
    this.pageId = state.pageId; this.boardId = state.boardId;
    this.known = new Map(Object.entries(state.known));
    this.strokes = new Map(state.strokes.map(stroke => [stroke.id, stroke]));
    this.frontier = new Set(state.frontier); this.version = 0; this.nextToken = 0; this.prepared = null;
    this.clock = Object.create(null); this.level = 0; this.levelCounts = new Map();
    for (const item of this.known.values()) {
      this.level = Math.max(this.level, item.level); this.levelCounts.set(item.level, (this.levelCounts.get(item.level) ?? 0) + 1);
      for (const [actor, sequence] of Object.entries(item.clock)) this.clock[actor] = Math.max(this.clock[actor] ?? 0, sequence);
    }
  }
  /** Prepare is copy-on-write for touched strokes/registers only. Existing sample
   * payloads and causal maps remain owned and are not cloned or revalidated. */
  prepare(operations) {
    if (this.prepared) invalid("a replica already has a prepared transaction");
    const pending = new Map(), known = new Map(), strokes = new Map(), touched = new Map(), undo = {};
    const getKnown = key => known.get(key) ?? this.known.get(key), getStroke = key => strokes.get(key) ?? this.strokes.get(key);
    const frontier = new Set(this.frontier);
    for (const operation of operations) {
    validateInkOperation(operation);
    if (operation.pageId !== this.pageId || operation.boardId !== this.boardId) invalid("cross-Board replay");
    const hash = inkOperationDigest(operation), existing = getKnown(operation.id), queued = pending.get(operation.id);
    if (existing?.anchor) {
      if (existing.hash === hash) { known.set(operation.id, { ...existing, anchor: false }); continue; }
      invalid(`operation is represented by a compact causal anchor; import its projection: ${operation.id}`);
    }
    if (existing && existing.hash !== hash || queued && queued.hash !== hash) invalid(`operation id collision: ${operation.id}`);
    if (!existing) pending.set(operation.id, { operation, hash });
    }
    while (pending.size) {
    const ready = [...pending.values()].filter(({ operation }) => operation.parents.every(parent => getKnown(parent))).sort((a, b) => compare(a.operation.id, b.operation.id));
    if (!ready.length) invalid(`missing causal dependency or cycle: ${[...pending.keys()].sort(compare).join(", ")}`);
    for (const { operation, hash } of ready) {
      const clock = Object.create(null);
      for (const parent of operation.parents) for (const [actor, sequence] of Object.entries(getKnown(parent).clock)) clock[actor] = Math.max(clock[actor] ?? 0, sequence);
      if ((clock[operation.actor] ?? 0) >= operation.sequence) invalid("operation sequence does not follow its observed actor clock");
      clock[operation.actor] = operation.sequence;
      const level = 1 + Math.max(0, ...operation.parents.map(parent => getKnown(parent).level));
      const inverses = [], beforeHeads = Object.create(null);
      const write = (stroke, key, value) => {
        const prior = beforeHeads[stroke.id] ??= Object.create(null);
        if (!own(prior, key)) prior[key] = (stroke.registers[key] ?? []).map(entry => ({ operationId: entry.operationId, valueHash: inkOperationDigest(entry.value) }));
        const entries = (stroke.registers[key] ?? []).filter(entry => !observed(clock, entry.operationId));
        stroke.registers[key] = [...entries, { operationId: operation.id, value: clone(value) }].sort((a, b) => compare(a.operationId, b.operationId));
        const keys = touched.get(stroke.id) ?? new Set(); keys.add(key); touched.set(stroke.id, keys);
      };
      for (const [index, change] of operation.changes.entries()) {
        let stroke = getStroke(change.strokeId);
        if (change.kind === "create") {
          if (stroke) invalid(`stroke id was already created (including tombstones): ${change.strokeId}`);
          stroke = { id: change.strokeId, creationId: operation.id, creationOrder: [level, operation.id, index], registers: {} };
          strokes.set(change.strokeId, stroke);
          write(stroke, "node", inkNodeMetadata(change.node)); write(stroke, "layout", change.layout); write(stroke, "alive", true);
          attributes.forEach(key => write(stroke, key, change.node.attrs[key] ?? null));
          if (change.placement) write(stroke, "placement", change.placement);
          inverses.push({ kind: "delete", strokeId: change.strokeId });
        } else {
          if (!stroke || !observed(clock, stroke.creationId)) invalid(`edit does not observe stroke creation: ${change.strokeId}`);
          if (!strokes.has(change.strokeId)) { stroke = { ...stroke, registers: { ...stroke.registers } }; strokes.set(change.strokeId, stroke); }
          if (change.kind === "edit") {
            const patch = { ...change.patch }, inverse = {};
            if (own(patch, "ink") && !own(patch, "inkFragments")) patch.inkFragments = stroke.registers.inkFragments?.[0]?.value ?? null;
            if (own(patch, "inkFragments") && !own(patch, "ink")) patch.ink = stroke.registers.ink?.[0]?.value ?? null;
            for (const [key, value] of Object.entries(patch)) {
              if (stroke.registers[key]?.length) inverse[key] = clone(stroke.registers[key][0].value);
              else if (attributes.includes(key)) inverse[key] = null;
              write(stroke, key, value);
            }
            if (Object.keys(inverse).length) inverses.push({ kind: "edit", strokeId: change.strokeId, patch: inverse });
          }
          else if (change.kind === "delete") {
            if (!stroke.registers.alive.some(entry => entry.value === false)) inverses.push({ kind: "restore", strokeId: change.strokeId });
            write(stroke, "alive", false);
          }
          else {
            if (!(stroke.registers.alive ?? []).some(entry => entry.value === false && observed(clock, entry.operationId))) invalid("restore must explicitly observe a deletion");
            write(stroke, "alive", true);
            inverses.push({ kind: "delete", strokeId: change.strokeId });
          }
        }
      }
      known.set(operation.id, { hash, clock, level });
      undo[operation.id] = { changes: inverses, beforeHeads };
      operation.parents.forEach(parent => frontier.delete(parent));
      frontier.add(operation.id); pending.delete(operation.id);
    }
    }
    const token = String(++this.nextToken), records = [];
    for (const stroke of strokes.values()) {
      validateStrokeSourceVersions(stroke);
      if (!stroke.registers.alive.some(entry => entry.value === false) && (!stroke.registers.node?.length || !stroke.registers.layout?.length)) invalid("restoring sparse ink requires its editable source");
      const primary = stroke.registers.ink?.[0]?.value, fragments = stroke.registers.inkFragments?.[0]?.value;
      if (primary && fragments) validateInkFragments(primary, fragments);
    }
    for (const [key, value] of known) records.push({ kind: "known", key, field: "", value });
    for (const [key, stroke] of strokes) {
      if (!this.strokes.has(key)) records.push({ kind: "stroke", key, field: "", value: { id: stroke.id, creationId: stroke.creationId, creationOrder: stroke.creationOrder } });
      for (const field of touched.get(key) ?? []) records.push({ kind: "register", key, field, value: stroke.registers[field] });
    }
    const clock = { ...this.clock };
    for (const item of known.values()) for (const [actor, sequence] of Object.entries(item.clock)) clock[actor] = Math.max(clock[actor] ?? 0, sequence);
    this.prepared = { token, known, strokes, frontier, clock };
    return { token, records: clone(records), frontier: [...frontier].sort(compare), clock, undo, appendedIds: [...known.keys()] };
  }
  /** Import actual compact causal heads, never a fabricated after-all operation.
   * Foreign anchors have a context and optional source hash, not an op body. */
  prepareImport(checkpoint) {
    if (this.prepared) invalid("a replica already has a prepared transaction");
    validateInkCheckpoint(checkpoint);
    if (checkpoint.pageId !== this.pageId || checkpoint.boardId !== this.boardId) invalid("cross-Board checkpoint import");
    const known = new Map(), strokes = new Map(), records = [];
    const getKnown = key => known.get(key) ?? this.known.get(key);
    const dominates = (one, two) => Object.entries(two).every(([actor, sequence]) => (one[actor] ?? 0) >= sequence);
    for (const [key, incoming] of Object.entries(checkpoint.known)) {
      const previous = this.known.get(key); let next = incoming;
      if (previous) {
        if (previous.sourceHash && incoming.sourceHash && previous.sourceHash !== incoming.sourceHash) invalid(`source event collision: ${key}`);
        if (previous.hash && incoming.hash && previous.hash !== incoming.hash) invalid(`operation id collision: ${key}`);
        if (previous.partial && dominates(incoming.clock, previous.clock)) next = { ...incoming, ...(previous.hash ? { hash: previous.hash, anchor: false } : {}) };
        else if (incoming.partial && dominates(previous.clock, incoming.clock)) next = previous;
        else {
          if (canonicalInkJSON(previous.clock) !== canonicalInkJSON(incoming.clock)) invalid(`operation context collision: ${key}`);
          next = previous.hash ? previous : incoming.hash ? incoming : previous;
        }
      }
      if (!previous || canonicalInkJSON(previous) !== canonicalInkJSON(next)) { known.set(key, clone(next)); records.push({ kind: "known", key, field: "", value: next }); }
    }
    for (const incoming of checkpoint.strokes) {
      const previous = this.strokes.get(incoming.id);
      if (previous && (previous.creationId !== incoming.creationId || canonicalInkJSON(previous.creationOrder) !== canonicalInkJSON(incoming.creationOrder))) invalid(`stroke creation identity collision: ${incoming.id}`);
      const next = previous ? { ...previous, registers: { ...previous.registers } } : { ...incoming, registers: {} };
      if (!previous) records.push({ kind: "stroke", key: next.id, field: "", value: { id: next.id, creationId: next.creationId, creationOrder: next.creationOrder } });
      for (const [field, heads] of Object.entries(incoming.registers)) {
        const entries = new Map((previous?.registers[field] ?? []).map(entry => [entry.operationId, entry]));
        for (const entry of heads) {
          if (entries.has(entry.operationId) && canonicalInkJSON(entries.get(entry.operationId).value) !== canonicalInkJSON(entry.value)) invalid(`field value collision: ${incoming.id}/${field}`);
          entries.set(entry.operationId, entry);
        }
        const merged = [...entries.values()].filter(entry => ![...entries.values()].some(other => entry !== other && observed(getKnown(other.operationId).clock, entry.operationId))).sort((a, b) => compare(a.operationId, b.operationId));
        if (canonicalInkJSON(previous?.registers[field] ?? []) !== canonicalInkJSON(merged)) {
          next.registers[field] = clone(merged); records.push({ kind: "register", key: next.id, field, value: merged });
        }
      }
      if (!previous || Object.keys(next.registers).some(field => next.registers[field] !== previous.registers[field])) strokes.set(next.id, next);
    }
    const candidateHeads = [...new Set([...this.frontier, ...checkpoint.frontier])];
    const frontier = new Set(candidateHeads.filter(head => !candidateHeads.some(other => head !== other && observed(getKnown(other).clock, head))));
    const clock = { ...this.clock };
    for (const item of known.values()) for (const [actor, sequence] of Object.entries(item.clock)) clock[actor] = Math.max(clock[actor] ?? 0, sequence);
    const token = String(++this.nextToken); this.prepared = { token, known, strokes, frontier, clock };
    return { token, records: clone(records), frontier: [...frontier].sort(compare), clock, appendedIds: [] };
  }
  actorSequence(actor) { return this.clock[actor] ?? 0; }
  compensationPlan(operation, inverse) {
    if (operation.pageId !== this.pageId || operation.boardId !== this.boardId || this.known.get(operation.id)?.hash !== inkOperationDigest(operation)) invalid("undo source identity differs from retained history");
    const changes = [], skipped = [];
    for (const change of inverse.changes) {
      const stroke = this.strokes.get(change.strokeId), active = field => stroke?.registers[field]?.length === 1 && stroke.registers[field][0].operationId === operation.id;
      const original = operation.changes.find(item => item.strokeId === change.strokeId);
      if (original?.kind === "create") {
        if (stroke && Object.values(stroke.registers).every(entries => entries.every(entry => entry.operationId === operation.id))) changes.push(change);
        else skipped.push({ strokeId: change.strokeId, field: "create" });
      } else if (change.kind === "edit") {
        const patch = {};
        for (const [field, value] of Object.entries(change.patch)) { if (active(field)) patch[field] = value; else skipped.push({ strokeId: change.strokeId, field }); }
        if (Object.keys(patch).length) changes.push({ ...change, patch });
      } else if (active("alive")) changes.push(change);
      else skipped.push({ strokeId: change.strokeId, field: "alive" });
    }
    return { pageId: this.pageId, boardId: this.boardId, changes: clone(changes), parents: [...this.frontier].sort(compare), skipped };
  }
  /** One logical action may own several sequential writes. Follow actual
   * prior register ownership, rather than writing intermediate inverse events
   * which would hide the older source heads from selective compensation. */
  compensationGroupPlan(sources) {
    if (!Array.isArray(sources) || !sources.length) invalid("empty compensation group");
    const group = new Map(), affected = new Map(), changes = [], sourcePhase = [], skipped = [];
    for (const source of sources) {
      const operation = validateInkOperation(source.operation), inverse = source.undo;
      if (operation.pageId !== this.pageId || operation.boardId !== this.boardId || this.known.get(operation.id)?.hash !== inkOperationDigest(operation)) invalid("group undo source identity differs from retained history");
      if (!inverse || !Array.isArray(inverse.changes)) invalid("group undo record is unavailable");
      if (group.has(operation.id) && canonicalInkJSON(group.get(operation.id)) !== canonicalInkJSON(source)) invalid("group undo source collision");
      group.set(operation.id, source);
      for (const change of operation.changes) {
        const fields = affected.get(change.strokeId) ?? new Set();
        for (const undo of inverse.changes.filter(item => item.strokeId === change.strokeId)) {
          if (undo.kind === "edit") Object.keys(undo.patch).forEach(field => fields.add(field));
          else if (["delete", "restore"].includes(undo.kind)) fields.add("alive");
        }
        affected.set(change.strokeId, fields);
      }
    }
    const inverseValue = (source, strokeId, field) => {
      const value = source.undo.changes.find(change => change.strokeId === strokeId);
      if (field === "alive" && value?.kind === "delete") return { found: true, value: false };
      if (field === "alive" && value?.kind === "restore") return { found: true, value: true };
      if (value?.kind === "edit" && own(value.patch, field)) return { found: true, value: value.patch[field] };
      return { found: false };
    };
    const forwardValue = (source, strokeId, field) => {
      const value = source.operation.changes.find(change => change.strokeId === strokeId);
      if (field === "alive" && value?.kind === "delete") return { found: true, value: false };
      if (field === "alive" && value?.kind === "restore") return { found: true, value: true };
      if (value?.kind === "edit" && own(value.patch, field)) return { found: true, value: value.patch[field] };
      return { found: false };
    };
    for (const [strokeId, wanted] of affected) {
      const stroke = this.strokes.get(strokeId);
      const skip = (field, reason) => { if (!skipped.some(item => item.strokeId === strokeId && item.field === field)) skipped.push({ strokeId, field, reason }); };
      if (!stroke) { skip("stroke", "source-unavailable"); continue; }
      const created = group.get(stroke.creationId)?.operation.changes.some(change => change.strokeId === strokeId && change.kind === "create");
      if (created) {
        if (Object.values(stroke.registers).every(heads => heads.every(head => group.has(head.operationId)))) {
          if (!stroke.registers.alive.some(head => head.value === false)) changes.push({ kind: "delete", strokeId });
        } else skip("create", "foreign-or-conflicting-current-head");
        continue;
      }
      const patch = {}, resolved = new Map();
      for (const field of wanted) {
        const current = stroke.registers[field];
        if (current?.length !== 1 || !group.has(current[0].operationId)) { skip(field, "foreign-or-conflicting-current-head"); continue; }
        let cursor = current[0].operationId, result, blocked = false;
        const visited = new Set();
        while (group.has(cursor)) {
          if (visited.has(cursor)) invalid("group undo prior-head cycle"); visited.add(cursor);
          const source = group.get(cursor), inverse = inverseValue(source, strokeId, field);
          if (!inverse.found) { skip(field, "inverse-unavailable"); blocked = true; break; }
          const prior = source.undo.beforeHeads?.[strokeId]?.[field];
          if (prior === undefined) {
            if (group.size === 1) { result = inverse.value; break; }
            skip(field, "prior-heads-unavailable"); blocked = true; break;
          }
          if (!Array.isArray(prior) || prior.length !== 1) { skip(field, "conflicting-prior-heads"); blocked = true; break; }
          const head = prior[0], known = this.known.get(head.operationId);
          if (!known || !observed(this.known.get(cursor).clock, head.operationId)) { skip(field, "prior-source-unavailable"); blocked = true; break; }
          if (head.valueHash !== inkOperationDigest(inverse.value)) invalid("group undo prior-head value hash differs");
          result = inverse.value;
          if (!group.has(head.operationId)) break;
          const forward = forwardValue(group.get(head.operationId), strokeId, field);
          if (!forward.found) { skip(field, "prior-group-field-unavailable"); blocked = true; break; }
          if (inkOperationDigest(forward.value) !== head.valueHash) invalid("group undo prior-head source identity differs");
          cursor = head.operationId;
        }
        if (!blocked && result !== undefined && canonicalInkJSON(result) !== canonicalInkJSON(current[0].value)) resolved.set(field, clone(result));
      }
      if (["ink", "inkFragments"].some(field => wanted.has(field)) && skipped.some(item => item.strokeId === strokeId && ["ink", "inkFragments"].includes(item.field))) {
        resolved.delete("ink"); resolved.delete("inkFragments");
        for (const field of ["ink", "inkFragments"]) if (wanted.has(field)) skip(field, "logical-geometry-conflict");
      }
      for (const [field, value] of resolved) if (field !== "alive") patch[field] = value;
      // The existing raw format permits one change per stroke per operation.
      // A liveness+source inverse therefore needs two real contiguous events,
      // committed together by the journal transaction before any publication.
      if (resolved.has("alive")) {
        changes.push({ kind: resolved.get("alive") ? "restore" : "delete", strokeId });
        if (Object.keys(patch).length) sourcePhase.push({ kind: "edit", strokeId, patch });
      } else if (Object.keys(patch).length) changes.push({ kind: "edit", strokeId, patch });
    }
    return { pageId: this.pageId, boardId: this.boardId, changes, phases: sourcePhase.length ? [changes, sourcePhase] : [changes], parents: [...this.frontier].sort(compare), skipped };
  }
  commit(token) {
    if (!this.prepared || this.prepared.token !== token) invalid("unknown prepared replica transaction");
    const { known, strokes, frontier, clock } = this.prepared;
    for (const [key, value] of known) {
      const previous = this.known.get(key);
      if (previous?.level !== value.level) {
        if (previous) { const count = this.levelCounts.get(previous.level) - 1; if (count) this.levelCounts.set(previous.level, count); else this.levelCounts.delete(previous.level); }
        this.levelCounts.set(value.level, (this.levelCounts.get(value.level) ?? 0) + 1);
      }
      this.known.set(key, value); this.level = Math.max(this.level, value.level);
    }
    // Import can replace an approximate compact anchor level with its real
    // lower level. Only that cold correction needs to revisit numeric levels.
    if (!this.levelCounts.has(this.level)) { this.level = 0; for (const level of this.levelCounts.keys()) this.level = Math.max(this.level, level); }
    for (const [key, value] of strokes) this.strokes.set(key, value);
    this.frontier = frontier; this.clock = clock; this.prepared = null; this.version++;
    return { frontier: [...frontier].sort(compare), version: this.version };
  }
  abort(token) {
    if (!this.prepared || this.prepared.token !== token) invalid("unknown prepared replica transaction");
    this.prepared = null;
  }
  append(operations) { const prepared = this.prepare(operations); this.commit(prepared.token); return prepared; }
  checkpoint() {
    return clone({ format: INK_CHECKPOINT_FORMAT, pageId: this.pageId, boardId: this.boardId,
      frontier: [...this.frontier].sort(compare), known: Object.fromEntries([...this.known].sort(([a], [b]) => compare(a, b))),
      strokes: [...this.strokes.values()].sort(strokeOrder) });
  }
  /** Cold-load ordering index. Deliberately excludes nodes, geometry and
   * historic contexts; live projection uses sparseCheckpoint instead. */
  projectionIndex() {
    return [...this.strokes.values()].sort(strokeOrder).map(stroke => clone({ id: stroke.id, born: stroke.creationOrder,
      ...(stroke.registers.placement ? { placement: stroke.registers.placement[0].value } : {}) }));
  }
  /** A projection read visits requested stroke records and their descriptors
   * only. Its global metadata is maintained during commit, never reconstructed
   * by scanning every historic event or unrelated sample payload. */
  sparseCheckpoint(ids) {
    if (!Array.isArray(ids) || ids.some(strokeId => !id(strokeId))) invalid("sparse projection stroke identities");
    const strokes = [], required = new Set(this.frontier);
    for (const strokeId of new Set(ids)) {
      const stroke = this.strokes.get(strokeId);
      if (!stroke) invalid(`sparse projection stroke is unavailable: ${strokeId}`);
      strokes.push(stroke); required.add(stroke.creationId);
      for (const heads of Object.values(stroke.registers)) for (const head of heads) required.add(head.operationId);
    }
    const known = Object.create(null);
    for (const operationId of required) {
      const descriptor = this.known.get(operationId);
      if (!descriptor) invalid(`sparse projection causal descriptor is unavailable: ${operationId}`);
      known[operationId] = descriptor;
    }
    return clone({ checkpoint: { format: INK_CHECKPOINT_FORMAT, pageId: this.pageId, boardId: this.boardId,
      frontier: [...this.frontier].sort(compare), known, strokes: strokes.sort(strokeOrder) }, clock: this.clock, level: this.level });
  }
  /** Explicit reads may materialize the whole Board; append does not. */
  materialize(ids) {
    const strokes = (ids ? ids.map(id => this.strokes.get(id)).filter(Boolean) : [...this.strokes.values()]).sort(strokeOrder);
    return materializeState({ pageId: this.pageId, boardId: this.boardId, frontier: [...this.frontier].sort(compare), strokes }, id => this.known.get(id));
  }
}
const strokeOrder = (a, b) => a.creationOrder[0] - b.creationOrder[0] || compare(a.creationOrder[1], b.creationOrder[1]) || a.creationOrder[2] - b.creationOrder[2];

export function inkCheckpointRecords(checkpoint) {
  const records = Object.entries(checkpoint.known).map(([key, value]) => ({ kind: "known", key, field: "", value }));
  for (const stroke of checkpoint.strokes) {
    records.push({ kind: "stroke", key: stroke.id, field: "", value: { id: stroke.id, creationId: stroke.creationId, creationOrder: stroke.creationOrder } });
    for (const [field, value] of Object.entries(stroke.registers)) records.push({ kind: "register", key: stroke.id, field, value });
  }
  return records;
}
export function inkCheckpointFromRecords({ pageId, boardId, frontier, records }) {
  const state = emptyInkCheckpoint({ pageId, boardId }), strokes = new Map();
  state.frontier = [...frontier];
  for (const record of records) {
    if (record.kind === "known") Object.defineProperty(state.known, record.key, { value: record.value, enumerable: true, writable: true, configurable: true });
    else if (record.kind === "stroke") strokes.set(record.key, { ...record.value, registers: {} });
  }
  for (const record of records) if (record.kind === "register") {
    const stroke = strokes.get(record.key); if (!stroke) invalid("indexed register has no stroke identity");
    Object.defineProperty(stroke.registers, record.field, { value: record.value, enumerable: true, writable: true, configurable: true });
  }
  state.strokes = [...strokes.values()].sort(strokeOrder); return state;
}
/** Offline/audit replay. Import records are the exact validated post-merge delta
 * durably committed at that point, not a newly authored after-all operation. */
export function replayInkJournalEvents(scope, events) {
  let replica = new InkOperationReplica(scope);
  for (const event of events) {
    if (event.kind === "operation") replica.append([event.operation]);
    else if (event.kind === "import") {
      const records = new Map(inkCheckpointRecords(replica.checkpoint()).map(record => [canonicalInkJSON([record.kind, record.key, record.field]), record]));
      for (const record of event.delta.records) records.set(canonicalInkJSON([record.kind, record.key, record.field]), record);
      replica = new InkOperationReplica({ checkpoint: inkCheckpointFromRecords({ ...scope, frontier: event.delta.frontier, records: [...records.values()] }) });
    } else invalid("unsupported journal event");
  }
  return replica.checkpoint();
}

export function checkpointInkOperations(operations, checkpoint) {
  if (!operations.length && !checkpoint) invalid("a scope is required for an empty operation set");
  const replica = new InkOperationReplica({ ...operations[0], checkpoint }); replica.append(operations); return replica.checkpoint();
}

export function materializeInkOperations(operations, checkpoint) {
  if (!operations.length && !checkpoint) invalid("a scope is required for an empty operation set");
  const replica = new InkOperationReplica({ ...operations[0], checkpoint }); replica.append(operations); return replica.materialize();
}
function materializeState(state, getKnown) {
  const conflicts = [], tombstones = [];
  const strokes = state.strokes.flatMap(stroke => {
    if (!stroke.registers.node?.length || !stroke.registers.layout?.length) { if (stroke.registers.alive.some(entry => entry.value === false)) { tombstones.push(stroke.id); return []; } invalid("visible ink is missing its source node"); }
    const node = clone(stroke.registers.node[0].value), heads = {}, local = [];
    let frame;
    for (const [key, entries] of Object.entries(stroke.registers)) {
      heads[key] = entries.map(entry => entry.operationId);
      if (new Set(entries.map(entry => canonicalInkJSON(entry.value))).size > 1) {
        const conflict = { strokeId: stroke.id, field: key, candidates: clone(entries) };
        local.push(conflict); conflicts.push(conflict);
      }
      if (key === "layout") frame = clone(entries[0].value);
      else if (attributes.includes(key)) {
        if (entries[0].value === null) delete node.attrs[key];
        else node.attrs[key] = clone(entries[0].value);
      }
    }
    for (const deletion of stroke.registers.alive.filter(entry => entry.value === false)) {
      for (const [key, entries] of Object.entries(stroke.registers)) {
        if (key === "alive") continue;
        const concurrent = entries.filter(entry => !observed(getKnown(deletion.operationId).clock, entry.operationId) && !observed(getKnown(entry.operationId).clock, deletion.operationId));
        if (concurrent.length) {
          const conflict = { strokeId: stroke.id, field: `delete/${key}`, candidates: clone([deletion, ...concurrent]) };
          local.push(conflict); conflicts.push(conflict);
        }
      }
    }
    // Any concurrent deletion hides the stroke; source data and delete/edit
    // conflicts survive. A snapshot consumer must explicitly resolve conflicts.
    return [{ id: stroke.id, node, layout: frame, ...(stroke.registers.placement ? { placement: clone(stroke.registers.placement[0].value) } : {}), deleted: stroke.registers.alive.some(entry => entry.value === false), heads, conflicts: local }];
  });
  return { pageId: state.pageId, boardId: state.boardId, frontier: state.frontier, strokes, tombstones, conflicts };
}

/** Selective undo never writes over a later or concurrent remote register head.
 * New concurrent arrivals can still produce explicit conflicts, never silent loss. */
export function inkCompensationPlan(operations, operationId) {
  const target = operations.find(operation => operation.id === operationId);
  if (!target) invalid("undo target is missing from retained journal");
  const state = checkpointInkOperations(operations), current = new Map(state.strokes.map(stroke => [stroke.id, stroke]));
  const clock = state.known[operationId].clock;
  const before = operations.filter(operation => operation.id !== operationId && observed(clock, operation.id));
  const previous = before.length ? new Map(materializeInkOperations(before).strokes.map(stroke => [stroke.id, stroke])) : new Map();
  const changes = [], skipped = [];
  for (const change of target.changes) {
    const stroke = current.get(change.strokeId), prior = previous.get(change.strokeId);
    const active = key => stroke.registers[key]?.length === 1 && stroke.registers[key][0].operationId === operationId;
    if (change.kind === "create") {
      if (Object.values(stroke.registers).every(entries => entries.every(entry => entry.operationId === operationId))) changes.push({ kind: "delete", strokeId: change.strokeId });
      else skipped.push({ strokeId: change.strokeId, field: "create" });
    } else if (change.kind === "edit") {
      const patch = {};
      for (const key of Object.keys(change.patch)) {
        if (active(key)) patch[key] = key === "layout" ? prior.layout : key === "node" ? inkNodeMetadata(prior.node) : prior.node.attrs[key] ?? null;
        else skipped.push({ strokeId: change.strokeId, field: key });
      }
      if (Object.keys(patch).length) changes.push({ kind: "edit", strokeId: change.strokeId, patch });
    } else if (active("alive")) changes.push({ kind: change.kind === "delete" ? "restore" : "delete", strokeId: change.strokeId });
    else skipped.push({ strokeId: change.strokeId, field: "alive" });
  }
  return { pageId: state.pageId, boardId: state.boardId, changes, parents: state.frontier, skipped };
}
export function compensateInkOperation(operations, operationId, identity) {
  const plan = inkCompensationPlan(operations, operationId);
  const parents = [...new Set([...plan.parents, ...(identity.sequence > 1 ? [`${identity.actor}:${identity.sequence - 1}`] : [])])];
  return { operation: plan.changes.length ? createInkOperation({ ...identity, pageId: plan.pageId, boardId: plan.boardId, parents, changes: plan.changes }) : null, skipped: plan.skipped };
}
