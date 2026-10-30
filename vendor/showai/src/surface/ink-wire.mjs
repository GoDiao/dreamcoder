import { canonicalInkJSON, inkNodeMetadata, inkOperationDigest, materializeInkOperations, validateInkCheckpoint, validateInkOperationField, validateInkOperation, InkOperationReplica } from "./ink-operations.mjs";
import { isInkNode } from "./portable-ink.mjs";

export const INK_WIRE_FORMAT = "showai-ink-state-v1";
export class InkWireError extends Error { constructor(message) { super(`Ink causal state: ${message}`); this.name = "InkWireError"; this.code = "INK_CAUSAL_CONFLICT"; } }
const fields = ["node", "ink", "inkFragments", "color", "strokeWidth", "pressure", "layout", "placement", "alive"];
const own = (value, key) => Object.hasOwn(value, key);
const clone = value => JSON.parse(canonicalInkJSON(value));
const hash = value => inkOperationDigest(value ?? null);
const equal = (a, b) => canonicalInkJSON(a ?? null) === canonicalInkJSON(b ?? null);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = message => { throw new InkWireError(message); };
const dotPattern = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,95}):([1-9][0-9]*)$/;
function dotParts(dot) { const match = dotPattern.exec(dot); if (!match || !Number.isSafeInteger(Number(match[2]))) fail("invalid edit dot"); return [match[1], Number(match[2])]; }
const seen = (clock, dot) => { const [actor, sequence] = dotParts(dot); return (clock[actor] ?? 0) >= sequence; };
const joinClock = (...clocks) => {
  const result = Object.create(null);
  for (const clock of clocks) for (const [actor, sequence] of Object.entries(clock)) result[actor] = Math.max(result[actor] ?? 0, sequence);
  return result;
};
const aliveHash = hash(true), deletedHash = hash(false);
const isDeleted = stroke => stroke?.fields?.alive?.some(([, digest]) => digest === deletedHash) ?? false;
const birthOrder = (a, b) => a[0] - b[0] || compare(a[1], b[1]) || a[2] - b[2];

function clock(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 512) fail("invalid causal clock");
  for (const [actor, sequence] of Object.entries(value)) if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(actor) || !Number.isSafeInteger(sequence) || sequence < 1) fail("invalid causal clock entry");
}
export function validateInkWireState(value) {
  canonicalInkJSON(value);
  if (value?.format !== INK_WIRE_FORMAT || !Number.isSafeInteger(value.level) || value.level < 0 || !value.strokes || !value.contexts || Object.keys(value.strokes).length > 100000) fail("unsupported format or excessive state");
  clock(value.clock);
  for (const [dot, context] of Object.entries(value.contexts)) { dotParts(dot); clock(context); if (!seen(context, dot) || Object.entries(context).some(([actor, sequence]) => (value.clock[actor] ?? 0) < sequence)) fail("context exceeds its causal clock"); }
  for (const [dot, level] of Object.entries(value.levels ?? {})) if (!own(value.contexts, dot) || !Number.isSafeInteger(level) || level < 1) fail("invalid event level");
  for (const [dot, digest] of Object.entries(value.digests ?? {})) if (!own(value.contexts, dot) || !/^[a-f0-9]{64}$/.test(digest)) fail("invalid event digest");
  for (const [dot, digest] of Object.entries(value.eventDigests ?? {})) if (!own(value.contexts, dot) || !/^[a-f0-9]{64}$/.test(digest)) fail("invalid snapshot edit digest");
  for (const [id, stroke] of Object.entries(value.strokes)) {
    if (!id || ["__proto__", "prototype", "constructor"].includes(id) || !Array.isArray(stroke.born) || stroke.born.length !== 3 || !Number.isSafeInteger(stroke.born[0]) || stroke.born[0] < 1 || !Number.isSafeInteger(stroke.born[2]) || stroke.born[2] < 0) fail("invalid stroke identity");
    dotParts(stroke.born[1]);
    if (stroke.unplaced !== undefined && stroke.unplaced !== true) fail("invalid placement conflict marker");
    if (!stroke.fields?.alive?.length) fail("missing liveness heads");
    for (const [field, heads] of Object.entries(stroke.fields)) {
      if (!fields.includes(field) || !Array.isArray(heads) || !heads.length || heads.length > 64) fail("invalid field heads");
      const dots = new Set();
      for (const head of heads) {
        if (!Array.isArray(head) || head.length !== 2 || !own(value.contexts, head[0]) || !/^[a-f0-9]{64}$/.test(head[1]) || dots.has(head[0])) fail("invalid head reference");
        dots.add(head[0]);
        if (field === "alive" && ![aliveHash, deletedHash].includes(head[1])) fail("invalid liveness digest");
      }
    }
    if (!isDeleted(stroke) && fields.filter(field => field !== "inkFragments").some(field => !stroke.fields[field]?.length)) fail("visible stroke is missing field heads");
    for (const [field, values] of Object.entries(stroke.variants ?? {})) {
      if (!fields.includes(field) || !values || Array.isArray(values)) fail("invalid conflict variants");
      for (const [digest, variant] of Object.entries(values)) {
        if (hash(variant) !== digest || !stroke.fields[field]?.some(([, candidate]) => digest === candidate)) fail("variant digest differs from its head");
        if (field !== "alive") validateInkOperationField(field, variant);
      }
    }
  }
  return value;
}

function boards(document) {
  const result = new Map();
  const discover = node => {
    if (node.type === "surface" && node.attrs?.kind === "board") {
      const records = new Map(); let index = 0;
      const visit = parent => {
        const children = parent.content ?? [];
        for (let i = 0; i < children.length; ++i) {
          const child = children[i];
          if (child.type === "surface") continue;
          if (isInkNode(child)) {
            const anchor = direction => {
              for (let n = i + direction; n >= 0 && n < children.length; n += direction) if (!isInkNode(children[n])) return children[n].attrs?.id ?? null;
              return null;
            };
            records.set(child.attrs.id, { node: child, layout: document.layout?.[child.attrs.id] ?? null,
              placement: { parentId: parent.attrs.id, after: anchor(-1), before: anchor(1) }, siblings: children, siblingIndex: i, index: index++ });
          } else visit(child);
        }
      };
      visit(node); result.set(node.attrs.id, { board: node, records });
    }
    node.content?.forEach(discover);
  };
  discover(document.content); return result;
}
function fieldValue(record, field) {
  if (field === "alive") return !!record;
  if (!record) return null;
  if (field === "node") return inkNodeMetadata(record.node);
  if (field === "layout" || field === "placement") return record[field];
  return record.node.attrs[field] ?? null;
}
function empty() { return { format: INK_WIRE_FORMAT, clock: {}, level: 0, contexts: {}, levels: {}, digests: {}, eventDigests: {}, strokes: {} }; }
function bootstrap(record) {
  if (record?.board.attrs.inkState) {
    const current = clone(validateInkWireState(record.board.attrs.inkState));
    for (const stroke of Object.values(current.strokes)) if (!isDeleted(stroke) && !stroke.fields.inkFragments) stroke.fields.inkFragments = stroke.fields.ink.map(([dot]) => [dot, hash(null)]);
    return current;
  }
  const state = empty(); if (!record?.records.size) return state;
  const dot = `snapshot-${hash([...record.records].map(([id, value]) => [id, fields.map(field => fieldValue(value, field))])).slice(0, 48)}:1`;
  const [actor] = dotParts(dot); state.clock[actor] = 1; state.contexts[dot] = { [actor]: 1 }; state.level = 1; state.levels[dot] = 1;
  for (const [id, value] of record.records) state.strokes[id] = { born: [1, dot, value.index], fields: Object.fromEntries(fields.map(field => [field, [[dot, hash(fieldValue(value, field))]]])) };
  return state;
}
function prune(state) {
  const referenced = new Set(Object.values(state.strokes).flatMap(stroke => Object.values(stroke.fields).flat().map(([dot]) => dot)));
  state.contexts = Object.fromEntries([...referenced].sort(compare).map(dot => [dot, state.contexts[dot]]));
  state.levels = Object.fromEntries([...referenced].filter(dot => state.levels?.[dot]).sort(compare).map(dot => [dot, state.levels[dot]]));
  state.digests = Object.fromEntries([...referenced].filter(dot => state.digests?.[dot]).sort(compare).map(dot => [dot, state.digests[dot]]));
  state.eventDigests = Object.fromEntries([...referenced].filter(dot => state.eventDigests?.[dot]).sort(compare).map(dot => [dot, state.eventDigests[dot]]));
  return state;
}
function compactDeleted(stroke) { stroke.fields = { alive: stroke.fields.alive }; delete stroke.variants; delete stroke.unplaced; }
// Placement registers describe authored ordering bounds. A concurrent generic
// object may enter that interval without changing the stroke's authored value.
// Retain the real anchor values so import can verify those bounds explicitly.
function fieldMatches(record, stroke, field) {
  const heads = stroke.fields[field] ?? [];
  if (heads.some(([, digest]) => digest === hash(fieldValue(record, field)))) return true;
  if (field !== "placement" || !record) return false;
  return heads.some(([, digest]) => {
    const placement = stroke.variants?.placement?.[digest];
    if (!placement || placement.parentId !== record.placement.parentId) return false;
    const index = id => record.siblings.findIndex(node => node.attrs?.id === id);
    const after = placement.after === null ? -1 : index(placement.after);
    const before = placement.before === null ? record.siblings.length : index(placement.before);
    return (placement.after === null || after >= 0) && before >= 0 && after < record.siblingIndex && record.siblingIndex < before;
  });
}
function placementMoved(before, after) {
  if (!before || !after) return false;
  if (before.placement.parentId !== after.placement.parentId) return true;
  const positions = new Map(after.siblings.map((node, index) => [node.attrs?.id, index]));
  return before.siblings.some((node, index) => !isInkNode(node) && positions.has(node.attrs?.id) &&
    (index < before.siblingIndex) !== (positions.get(node.attrs.id) < after.siblingIndex));
}
function metadataMatches(record, state) {
  for (const [id, stroke] of Object.entries(state.strokes)) {
    const current = record?.records.get(id);
    if (isDeleted(stroke) !== !current) return false;
    if (current && fields.some(field => !fieldMatches(current, stroke, field))) return false;
  }
  return [...record.records.keys()].every(id => own(state.strokes, id));
}

/** A page save may enrich an editor draft with persisted causal identities.
 * Unchanged fields must retain every candidate and tombstone; pending editable
 * field changes may legitimately supersede their older annotation. */
export function inkWireDraftCommitMetadataMatches(draft, committed) {
  if(draft?.id!==committed?.id)return false;
  const beforeBoards=boards(draft),afterBoards=boards(committed);
  for(const [id,record]of afterBoards){
    const state=bootstrap(record);
    if(!metadataMatches(record,state))return false;
    const before=beforeBoards.get(id);
    if(!before?.board.attrs.inkState)continue;
    const original=bootstrap(before);
    if(Object.entries(original.clock).some(([actor,sequence])=>(state.clock[actor]??0)<sequence))return false;
    for(const [strokeID,stroke]of Object.entries(original.strokes)){
      const current=before.records.get(strokeID),saved=state.strokes[strokeID];
      if(!saved)return false;
      const deleting=!current && !isDeleted(stroke);
      for(const [field,heads]of Object.entries(stroke.fields)){
        if(field!=="alive" && (!current || deleting))continue;
        const intended=hash(fieldValue(current,field));
        // A stale head on a locally edited field is expected until the real
        // writer stamps it. It must not make unrelated conflicts disposable.
        if(!heads.some(([,digest])=>digest===intended))continue;
        const retained=new Set((saved.fields[field]??[]).map(([,digest])=>digest));
        if(heads.some(([,digest])=>!retained.has(digest)))return false;
      }
    }
  }
  return [...beforeBoards.keys()].every(id=>afterBoards.has(id));
}
function reconcile(record, baseline, identity, conflicts) {
  const before = bootstrap(baseline), supplied = record?.board.attrs.inkState;
  const suppliedValid = supplied ? validateInkWireState(supplied) : null;
  const authored = new Map(), forced = new Map();
  if (identity) {
    for (const id of new Set([...record.records.keys(), ...(baseline?.records.keys() ?? [])])) {
      const current = record.records.get(id), previous = baseline?.records.get(id);
      authored.set(id, fields.filter(field => !equal(fieldValue(current, field), fieldValue(previous, field))));
    }
    for (const change of identity.changes ?? []) forced.set(change.strokeId, [...new Set([...(forced.get(change.strokeId) ?? []), ...(change.kind === "edit" ? Object.keys(change.patch) : change.kind === "create" ? fields : ["alive"])])]);
  }
  // A current client may already have stamped its journal identity. Every
  // changed canonical field must actually have a fresh matching head.
  const alreadyStamped = suppliedValid && [...authored].every(([id, changed]) => changed.every(field => !equal(suppliedValid.strokes[id]?.fields[field], before.strokes[id]?.fields[field]))) && [...forced].every(([id, changed]) => changed.every(field => suppliedValid.strokes[id]?.fields[field]?.some(([dot]) => dot === `${identity.actor}:${identity.sequence}`)));
  if (identity && alreadyStamped && Object.entries(before.clock).every(([actor, sequence]) => (suppliedValid.clock[actor] ?? 0) >= sequence) && metadataMatches(record, suppliedValid)) return clone(suppliedValid);
  const state = identity ? before : suppliedValid ? clone(suppliedValid) : before;
  const changed = [];
  for (const id of new Set([...Object.keys(state.strokes), ...record.records.keys()])) {
    const current = record.records.get(id), stroke = state.strokes[id];
    if (!current) { if (stroke && (!isDeleted(stroke) || forced.get(id)?.includes("alive"))) changed.push({ id, values: { alive: false }, current }); continue; }
    if (!stroke) { changed.push({ id, values: Object.fromEntries(fields.map(field => [field, fieldValue(current, field)])), current }); continue; }
    if (isDeleted(stroke) && !identity) {
      conflicts.push({ strokeId: id, field: "alive", retained: false, reason: "An unstamped snapshot cannot restore deleted ink." }); continue;
    }
    const placementMatches = stroke.fields.placement?.some(([, digest]) => digest === hash(fieldValue(current, "placement")));
    if (stroke.unplaced && !identity && !placementMatches) conflicts.push({ strokeId: id, field: "placement", retained: false, reason: "Ink placement still requires structural resolution." });
    if (placementMatches) delete stroke.unplaced;
    const values = Object.fromEntries(fields.filter(field => !(field === "placement" && stroke.unplaced && !identity) && (authored.get(id)?.includes(field) || forced.get(id)?.includes(field) || field === "placement" && !placementMatches && placementMoved(baseline?.records.get(id), current) || !fieldMatches(current, stroke, field))).map(field => [field, fieldValue(current, field)]));
    if (own(values, "ink") || own(values, "inkFragments")) { values.ink = fieldValue(current, "ink"); values.inkFragments = fieldValue(current, "inkFragments"); }
    if (Object.keys(values).length) changed.push({ id, values, current });
  }
  if (!changed.length) return prune(state);
  const actor = identity?.actor ?? `legacy-${hash([state.clock, changed.map(({ id, values }) => [id, values])]).slice(0, 48)}`;
  const sequence = identity?.sequence ?? 1, dot = `${actor}:${sequence}`;
  dotParts(dot);
  if ((state.clock[actor] ?? 0) >= sequence) fail("fresh edits require a new persisted actor sequence");
  // Unknown legacy writers have no stable device ID. Bound their fallback
  // provenance rather than silently discard causal history to save bytes.
  if (!identity && Object.keys(state.clock).filter(key => key.startsWith("legacy-")).length >= 128) fail("legacy edits require a current client with a stable writer identity");
  state.clock[actor] = sequence; state.contexts[dot] = { ...state.clock }; state.level++; state.levels ??= {}; state.levels[dot] = state.level;
  state.eventDigests ??= {};
  state.eventDigests[dot] = identity?.format === "showai-ink-operation-v1" ? hash(identity) : hash({ format: "showai-ink-snapshot-edit-v1", dot, context: state.contexts[dot], changes: changed.map(({ id, values }) => [id, values]) });
  if (identity?.format === "showai-ink-operation-v1") { state.digests ??= {}; state.digests[dot] = hash(identity); }
  for (const { id, values, current } of changed) {
    const stroke = state.strokes[id] ?? { born: [state.level, dot, current.index], fields: {} };
    for (const [field, value] of Object.entries(values)) { stroke.fields[field] = [[dot, hash(value)]]; if (field === "placement") { (stroke.variants ??= {}).placement = { [hash(value)]: clone(value) }; } else if (stroke.variants) delete stroke.variants[field]; }
    if (own(values, "placement")) delete stroke.unplaced;
    if (values.alive === false) compactDeleted(stroke);
    state.strokes[id] = stroke;
  }
  return prune(state);
}

/** Save-boundary API. The baseline is the exact CAS-checked author source.
 * A persisted native journal or host counter supplies identity; it is never invented here. */
export function stampInkDocument(document, baseline, identity) {
  dotParts(`${identity.actor}:${identity.sequence}`);
  const next = clone(document), current = boards(next), previous = boards(baseline ?? { content: { type: "doc" } });
  for (const [id, record] of current) {
    if (!record.records.size && !previous.get(id)?.records.size && !record.board.attrs.inkState && !previous.get(id)?.board.attrs.inkState) continue;
    record.board.attrs.inkState = reconcile(record, previous.get(id), identity, []);
  }
  return next;
}
export function inkWireClockForActor(document, actor) {
  return Math.max(0, ...[...boards(document).values()].map(record => record.board.attrs.inkState?.clock?.[actor] ?? 0));
}
export function hasInkWireContent(document) {
  return [...boards(document).values()].some(record => record.records.size || record.board.attrs.inkState);
}
/** Persistent conflict UI can derive badges/candidates from the saved page,
 * rather than depending on a transient sync receipt. */
export function inkWireConflicts(document) {
  const conflicts = [];
  for (const [boardId, record] of boards(document)) {
    const state = record.board.attrs.inkState; if (!state) continue; validateInkWireState(state);
    for (const [strokeId, stroke] of Object.entries(state.strokes)) {
      const local = [];
      // Current hashes/contexts already say whether there is a conflict. Only
      // genuine competing values need their editable source values verified;
      // uncontested geometry must not be rehashed merely to hide an empty badge.
      for (const [field, heads] of Object.entries(stroke.fields)) if (new Set(heads.map(([, digest]) => digest)).size > 1) local.push({ field, reason: "Concurrent ink field edits require resolution." });
      for (const [dot, digest] of stroke.fields.alive) if (digest === deletedHash) {
        for (const [field, heads] of Object.entries(stroke.fields)) if (field !== "alive" && heads.some(([other]) => !seen(state.contexts[dot], other) && !seen(state.contexts[other], dot))) local.push({ field: `delete/${field}`, reason: "An ink deletion overlaps a concurrent edit." });
      }
      if (local.length) {
        const retained = Object.entries(stroke.fields).every(([field, heads]) => heads.every(([, digest]) => valueLookup(strokeId, field, digest, [{ record, state }]).found));
        for (const conflict of local) conflicts.push({ boardId, strokeId, field: conflict.field, retained, reason: conflict.reason });
      }
      if (stroke.unplaced) conflicts.push({ boardId, strokeId, field: "placement", retained: false, reason: "Ink placement still requires structural resolution." });
    }
  }
  return conflicts;
}

/** Read-only candidate values for retained-conflict inspectors. Geometry is kept
 * as editable source; callers should summarize it rather than stringify samples. */
export function inkWireResolutionCandidates(document) {
  const result = [], conflicts = inkWireConflicts(document);
  for (const conflict of conflicts) {
    if (!conflict.retained) continue;
    const record = boards(document).get(conflict.boardId), state = record.board.attrs.inkState;
    const field = conflict.field.startsWith("delete/") ? "alive" : conflict.field;
    if (result.some(item => item.boardId === conflict.boardId && item.strokeId === conflict.strokeId && item.field === field)) continue;
    const stroke = state.strokes[conflict.strokeId], candidates = new Map();
    for (const [dot, digest] of stroke.fields[field] ?? []) {
      const resolved = valueLookup(conflict.strokeId, field, digest, [{record, state}]);
      if (!resolved.found) continue;
      if (!candidates.has(digest)) candidates.set(digest, { hash: digest, value: clone(resolved.value), dots: [] });
      candidates.get(digest).dots.push(dot);
    }
    if (field === "alive" && conflict.field.startsWith("delete/")) candidates.set(aliveHash, { hash: aliveHash, value: true, dots: [] });
    result.push({ boardId: conflict.boardId, strokeId: conflict.strokeId, field, candidates: [...candidates.values()] });
  }
  return result;
}

function mergeHeads(one, two, contexts) {
  const candidates = new Map();
  for (const head of [...(one ?? []), ...(two ?? [])]) {
    if (candidates.has(head[0]) && candidates.get(head[0])[1] !== head[1]) fail("one operation dot names conflicting values");
    candidates.set(head[0], head);
  }
  return [...candidates.values()].filter(head => ![...candidates.values()].some(other => other[0] !== head[0] && seen(contexts[other[0]], head[0]))).sort((a, b) => compare(a[0], b[0]));
}
function valueLookup(id, field, digest, sources) {
  if (field === "alive") return { found: true, value: digest === aliveHash };
  for (const { record, state } of sources) {
    const value = fieldValue(record?.records.get(id), field);
    if (hash(value) === digest) return { found: true, value };
    const variant = state.strokes[id]?.variants?.[field];
    if (variant && own(variant, digest)) return { found: true, value: variant[digest] };
  }
  return { found: false };
}
function joinBoard(id, base, left, right, conflicts) {
  const baseline = bootstrap(base), one = reconcile(left, base, undefined, conflicts), two = reconcile(right, base, undefined, conflicts);
  const state = empty(); state.clock = joinClock(one.clock, two.clock); state.level = Math.max(one.level, two.level);
  for (const [dot, level] of Object.entries({ ...one.levels, ...two.levels })) state.levels[dot] = Math.max(one.levels?.[dot] ?? level, two.levels?.[dot] ?? level);
  for (const property of ["digests", "eventDigests"]) {
    for (const [dot, value] of Object.entries(two[property] ?? {})) if (one[property]?.[dot] !== undefined && !equal(one[property][dot], value)) fail("one edit dot names different source events");
    state[property] = { ...one[property], ...two[property] };
  }
  state.contexts = { ...one.contexts };
  for (const [dot, context] of Object.entries(two.contexts)) {
    if (state.contexts[dot] && !equal(state.contexts[dot], context)) fail("one dot names conflicting causal contexts");
    state.contexts[dot] = context;
  }
  const sources = [{ record: left, state: one }, { record: right, state: two }, { record: base, state: baseline }], visible = [];
  for (const strokeId of new Set([...Object.keys(one.strokes), ...Object.keys(two.strokes)])) {
    const a = one.strokes[strokeId], b = two.strokes[strokeId];
    if (a && b && !equal(a.born, b.born)) conflicts.push({ boardId: id, strokeId, field: "creation", retained: false, reason: "Different creations reused a stable ink ID." });
    const stroke = { born: [...[a?.born, b?.born].filter(Boolean).sort(birthOrder)[0]], fields: {}, ...(a?.unplaced || b?.unplaced ? { unplaced: true } : {}) };
    for (const field of fields) {
      const heads = mergeHeads(a?.fields[field], b?.fields[field], state.contexts);
      if (heads.length) stroke.fields[field] = heads;
    }
    const local = [], selected = {};
    for (const [field, heads] of Object.entries(stroke.fields)) {
      const hashes = new Set(heads.map(([, digest]) => digest));
      if (hashes.size > 1) local.push({ boardId: id, strokeId, field, retained: true, reason: "Concurrent ink field edits require resolution." });
      if (field !== "alive") {
        const resolved = valueLookup(strokeId, field, heads[0][1], sources);
        if (resolved.found) selected[field] = clone(resolved.value);
      }
    }
    for (const [dot, digest] of stroke.fields.alive) if (digest === deletedHash) {
      for (const [field, heads] of Object.entries(stroke.fields)) if (field !== "alive" && heads.some(([other]) => !seen(state.contexts[dot], other) && !seen(state.contexts[other], dot))) local.push({ boardId: id, strokeId, field: `delete/${field}`, retained: true, reason: "An ink deletion overlaps a concurrent edit." });
    }
    const deleted = isDeleted(stroke);
    if (deleted && !local.length) compactDeleted(stroke);
    else {
      const variants = {};
      for (const [field, heads] of Object.entries(stroke.fields)) if (field !== "alive") {
        const values = {};
        for (const [, digest] of heads) {
          const resolved = valueLookup(strokeId, field, digest, sources);
          if (resolved.found && (field === "placement" || deleted || digest !== hash(selected[field]))) values[digest] = clone(resolved.value);
          else if (!resolved.found) local.push({ boardId: id, strokeId, field, retained: false, reason: "A referenced ink value is unavailable; source copies are retained." });
        }
        if (Object.keys(values).length) variants[field] = values;
      }
      if (Object.keys(variants).length) stroke.variants = variants;
      if (!deleted) {
        if (!selected.node || !selected.layout || !selected.placement) local.push({ boardId: id, strokeId, field: "node", retained: false, reason: "Visible ink is missing its canonical source value." });
        else {
          const node = selected.node;
          for (const field of ["ink", "inkFragments", "color", "strokeWidth", "pressure"]) { if (selected[field] === null) delete node.attrs[field]; else if (selected[field] !== undefined) node.attrs[field] = selected[field]; }
          visible.push({ id: strokeId, node, layout: selected.layout, placement: selected.placement, born: stroke.born });
        }
      }
    }
    state.strokes[strokeId] = stroke; conflicts.push(...local);
  }
  visible.sort((a, b) => birthOrder(a.born, b.born));
  return { id, state: prune(state), visible };
}

export function prepareInkPageMerge(base, ours, theirs) {
  const b = boards(base), o = boards(ours), t = boards(theirs), ids = new Set([...b.keys(), ...o.keys(), ...t.keys()]);
  const plans = [], conflicts = [], removedIds = new Set();
  for (const id of ids) {
    const before = b.get(id), left = o.get(id), right = t.get(id);
    if (![before, left, right].some(record => record?.records.size || record?.board.attrs.inkState)) continue;
    // Container deletion itself belongs to the existing structural merge.
    if (!left || !right) continue;
    for (const record of [before, left, right]) record?.records.forEach((_, id) => removedIds.add(id));
    plans.push(joinBoard(id, before, left, right, conflicts));
  }
  if (!plans.length) return null;
  const planned = new Set(plans.map(plan => plan.id));
  const strip = document => {
    const result = clone(document);
    const visit = node => {
      if (planned.has(node.attrs?.id)) delete node.attrs.inkState;
      if (node.content) node.content = node.content.filter(child => !removedIds.has(child.attrs?.id)).map(visit);
      return node;
    };
    result.content = visit(result.content);
    result.layout = Object.fromEntries(Object.entries(result.layout ?? {}).filter(([id]) => !removedIds.has(id)));
    return result;
  };
  return { base: strip(base), ours: strip(ours), theirs: strip(theirs), plans, conflicts };
}

export function finishInkPageMerge(document, prepared) {
  const result = clone(document), nodes = new Map(), conflicts = [...prepared.conflicts];
  const visit = node => { if (node.attrs?.id) nodes.set(node.attrs.id, node); node.content?.forEach(visit); }; visit(result.content);
  for (const plan of prepared.plans) {
    const board = nodes.get(plan.id);
    if (!board || board.attrs?.kind !== "board") { if (plan.visible.length) conflicts.push({ boardId: plan.id, field: "placement", retained: false, reason: "The target Board was removed." }); continue; }
    board.attrs.inkState = plan.state;
    const groups = new Map();
    for (const stroke of plan.visible) {
      let parent = nodes.get(stroke.placement.parentId);
      if (!parent) { conflicts.push({ boardId: plan.id, strokeId: stroke.id, field: "placement", retained: false, reason: "The ink parent was removed." }); plan.state.strokes[stroke.id].unplaced = true; parent = board; }
      const group = groups.get(parent) ?? []; group.push(stroke); groups.set(parent, group);
      result.layout ??= {}; result.layout[stroke.id] = stroke.layout;
    }
    for (const [parent, ink] of groups) {
      const existing = parent.content ?? [], ids = new Set([...existing.map(node => node.attrs.id), ...ink.map(stroke => stroke.id)]);
      const edges = new Map([...ids].map(id => [id, new Set()])), degree = new Map([...ids].map(id => [id, 0]));
      const connect = (a, b) => { if (a && b && ids.has(a) && ids.has(b) && a !== b && !edges.get(a).has(b)) { edges.get(a).add(b); degree.set(b, degree.get(b) + 1); } };
      for (let i = 1; i < existing.length; ++i) connect(existing[i - 1].attrs.id, existing[i].attrs.id);
      for (const stroke of ink) { connect(stroke.placement.after, stroke.id); connect(stroke.id, stroke.placement.before); }
      const rank = new Map([...existing.map(node => node.attrs.id), ...ink.map(stroke => stroke.id)].map((id, i) => [id, i]));
      const ready = [...ids].filter(id => degree.get(id) === 0), ordered = [];
      while (ready.length) {
        ready.sort((a, b) => rank.get(a) - rank.get(b)); const id = ready.shift(); ordered.push(id);
        for (const next of edges.get(id)) { degree.set(next, degree.get(next) - 1); if (degree.get(next) === 0) ready.push(next); }
      }
      const byId = new Map([...existing.map(node => [node.attrs.id, node]), ...ink.map(stroke => [stroke.id, stroke.node])]);
      if (ordered.length !== ids.size) {
        conflicts.push({ boardId: plan.id, field: "placement", retained: false, reason: "Concurrent ink placement and object ordering form a cycle." });
        for (const stroke of ink) plan.state.strokes[stroke.id].unplaced = true;
        parent.content = [...existing, ...ink.map(stroke => stroke.node)];
      }
      else parent.content = ordered.map(id => byId.get(id));
    }
    // Reading order is authored independently of paint order. Reconcile the
    // membership even when the final ink stroke was deleted; projection must
    // never invent a semantic reorder while updating ink state.
    const view = result.surfaceViews?.[board.attrs.id];
    if (view) {
      const ids = (board.content ?? []).map(node => node.attrs.id), valid = new Set(ids), seen = new Set();
      view.readingOrder = [...(view.readingOrder ?? []), ...ids].filter(id => valid.has(id) && !seen.has(id) && seen.add(id));
    }
  }
  return { document: result, conflicts };
}

/** Explicit resolution is an authored edit with a real persisted identity. The
 * selected value may equal the visible value; its new causal dot still matters. */
function prepareResolution(document, choices) {
  const next = clone(document), forced = [];
  const locate = id => {
    const visit = (node, parent) => node.attrs?.id === id ? { node, parent } : node.content?.map(child => visit(child, node)).find(Boolean);
    return visit(next.content, null);
  };
  const insert = (node, placement) => {
    const parent = locate(placement.parentId)?.node; if (!parent) fail("resolution target parent was removed");
    const children = parent.content ??= [];
    let index = placement.before ? children.findIndex(child => child.attrs?.id === placement.before) : -1;
    if (index < 0 && placement.after) { const after = children.findIndex(child => child.attrs?.id === placement.after); if (after >= 0) index = after + 1; }
    children.splice(index < 0 ? children.length : index, 0, node);
  };
  for (const choice of choices) {
    const record = boards(next).get(choice.boardId), state = record?.board.attrs.inkState, stroke = state?.strokes[choice.strokeId];
    const retainedRestore = choice.field === "alive" && choice.hash === aliveHash && inkWireConflicts(next).some(item => item.boardId === choice.boardId && item.strokeId === choice.strokeId && item.field.startsWith("delete/") && item.retained);
    if (!retainedRestore && !stroke?.fields[choice.field]?.some(([, digest]) => digest === choice.hash)) fail("resolution does not name a current candidate");
    const resolved = valueLookup(choice.strokeId, choice.field, choice.hash, [{ record, state }]);
    if (!resolved.found) fail("resolution source is unavailable");
    let found = locate(choice.strokeId);
    if (choice.field === "alive") {
      if (!resolved.value) {
        if (found?.parent) found.parent.content = found.parent.content.filter(child => child !== found.node);
        if (next.layout) delete next.layout[choice.strokeId];
        forced.push({ kind: "delete", strokeId: choice.strokeId });
      } else {
        if (!found) {
          const values = {};
          for (const field of fields.filter(field => field !== "alive")) {
            const candidate = stroke.fields[field]?.[0], value = candidate && valueLookup(choice.strokeId, field, candidate[1], [{ record, state }]);
            if (!value?.found) fail("restoring erased source requires its retained journal or conflict variant");
            values[field] = clone(value.value);
          }
          const node = values.node;
          for (const field of ["ink", "inkFragments", "color", "strokeWidth", "pressure"]) { if (values[field] !== null) node.attrs[field] = values[field]; }
          insert(node, values.placement); next.layout ??= {}; next.layout[choice.strokeId] = values.layout;
        }
        forced.push({ kind: "restore", strokeId: choice.strokeId });
      }
      continue;
    }
    if (!found) fail("resolve deletion by keeping or restoring the stroke before choosing its fields");
    const value = clone(resolved.value);
    if (choice.field === "layout") next.layout[choice.strokeId] = value;
    else if (choice.field === "placement") { found.parent.content = found.parent.content.filter(child => child !== found.node); insert(found.node, value); }
    else if (choice.field === "node") {
      const attributes = Object.fromEntries(["ink", "inkFragments", "color", "strokeWidth", "pressure"].filter(key => own(found.node.attrs, key)).map(key => [key, found.node.attrs[key]]));
      const node = { ...value, attrs: { ...value.attrs, ...attributes } };
      found.parent.content = found.parent.content.map(child => child === found.node ? node : child);
    } else if (value === null) delete found.node.attrs[choice.field];
    else found.node.attrs[choice.field] = value;
    const patch = { [choice.field]: value };
    if (["ink", "inkFragments"].includes(choice.field)) {
      const counterpart = choice.field === "ink" ? "inkFragments" : "ink";
      const dot = stroke.fields[choice.field].find(([, digest]) => digest === choice.hash)[0];
      const companion = stroke.fields[counterpart]?.find(([source]) => source === dot);
      const source = companion && valueLookup(choice.strokeId, counterpart, companion[1], [{ record, state }]);
      if (!source?.found) fail("logical ink fragments have no matching source event");
      patch[counterpart] = clone(source.value);
      if (source.value === null) delete found.node.attrs[counterpart]; else found.node.attrs[counterpart] = clone(source.value);
    }
    forced.push({ kind: "edit", strokeId: choice.strokeId, patch });
  }
  return { document: next, changes: forced };
}
export function resolveInkWireFields(document, choices, identity) {
  const prepared = prepareResolution(document, choices);
  return stampInkDocument(prepared.document, document, { ...identity, changes: prepared.changes });
}
/** Validated author intent only. The native journal supplies the real actor,
 * sequence and observed parents atomically; this function allocates no identity. */
export function inkWireResolutionPlan(document, choices) {
  if (!Array.isArray(choices) || !choices.length || new Set(choices.map(choice => choice.boardId)).size !== 1) fail("one native resolution plan requires one Board");
  const prepared = prepareResolution(document, choices), changes = new Map();
  for (const change of prepared.changes) {
    const previous = changes.get(change.strokeId);
    if (previous && (previous.kind !== "edit" || change.kind !== "edit")) fail("resolve liveness before choosing its other fields");
    changes.set(change.strokeId, previous ? { ...change, patch: { ...previous.patch, ...change.patch } } : change);
  }
  return { boardId: choices[0].boardId, changes: [...changes.values()] };
}

/** Foreign checkpoints are sparse causal anchors, not synthesized operations.
 * The initial legacy snapshot uses the same deterministic wire bootstrap as all hosts. */
export function inkCheckpointFromDocument(document, boardId) {
  const record = boards(document).get(boardId); if (!record) fail("Board is missing");
  const state = bootstrap(record);
  if (!metadataMatches(record, state)) fail("unstamped source must be reconciled against its actual baseline before journal import");
  return checkpointFromWireState(document.id, boardId, state, (id, field, digest) => valueLookup(id, field, digest, [{ record, state }]));
}
function checkpointFromWireState(pageId, boardId, state, lookup) {
  const known = {}, strokes = [];
  const births = new Map(Object.values(state.strokes).map(stroke => [stroke.born[1], stroke.born[0]]));
  for (const [dot, context] of Object.entries(state.contexts)) known[dot] = { anchor: true, hash: state.digests?.[dot] ?? null, ...(state.eventDigests?.[dot] ? { sourceHash: state.eventDigests[dot] } : {}), clock: clone(context), level: births.get(dot) ?? state.levels?.[dot] ?? Math.max(1, state.level) };
  for (const [actor, sequence] of Object.entries(state.clock)) {
    const dot = `${actor}:${sequence}`;
    known[dot] ??= { anchor: true, partial: true, hash: null, clock: { [actor]: sequence }, level: Math.max(1, state.level) };
  }
  for (const [id, stroke] of Object.entries(state.strokes)) {
    const [actor, sequence] = dotParts(stroke.born[1]);
    known[stroke.born[1]] ??= { anchor: true, partial: true, hash: null, clock: { [actor]: sequence }, level: stroke.born[0] };
    if (known[stroke.born[1]].partial) known[stroke.born[1]].level = stroke.born[0];
    const registers = {};
    for (const [field, heads] of Object.entries(stroke.fields)) registers[field] = heads.map(([operationId, digest]) => {
      const resolved = lookup(id, field, digest);
      if (!resolved.found) fail("incoming field source is unavailable");
      return { operationId, value: clone(resolved.value) };
    });
    strokes.push({ id, creationId: stroke.born[1], creationOrder: stroke.born, registers });
  }
  const candidates = [...new Set(Object.values(state.strokes).flatMap(stroke => Object.values(stroke.fields).flat().map(([dot]) => dot)))];
  const frontier = candidates.filter(dot => !candidates.some(other => dot !== other && seen(known[other].clock, dot))).sort(compare);
  return validateInkCheckpoint({ format: "showai-ink-checkpoint-v1", pageId, boardId, frontier, known, strokes });
}

/** Format current touched records identically for full and sparse publishers. */
function wireProjection(checkpoint, materialized, placementFor, metadata) {
  const state = empty(), byId = new Map(materialized.strokes.map(stroke => [stroke.id, stroke])), visible = [], deleted = [];
  if (metadata) { state.clock = clone(metadata.clock); state.level = metadata.level; }
  else for (const item of Object.values(checkpoint.known)) { state.clock = joinClock(state.clock, item.clock); state.level = Math.max(state.level, item.level); }
  for (const source of checkpoint.strokes) {
    const stroke = { born: source.creationOrder, fields: {} }, current = byId.get(source.id), registers = { ...source.registers };
    if (!registers.placement && current && !current.deleted) {
      const placement = placementFor(source.id);
      if (!placement) fail(`missing canonical placement for sparse stroke: ${source.id}`);
      validateInkOperationField("placement", placement);
      registers.placement = [{ operationId: source.creationId, value: placement }];
    }
    const variants = {};
    for (const [field, heads] of Object.entries(registers)) {
      if (!fields.includes(field)) continue;
      stroke.fields[field] = heads.map(entry => {
        const descriptor = checkpoint.known[entry.operationId]; state.contexts[entry.operationId] = descriptor.clock; state.levels[entry.operationId] = descriptor.level;
        if (descriptor.hash) state.digests[entry.operationId] = descriptor.hash;
        if (descriptor.sourceHash || descriptor.hash) state.eventDigests[entry.operationId] = descriptor.sourceHash ?? descriptor.hash;
        return [entry.operationId, hash(entry.value)];
      });
      if (field !== "alive") {
        const values = {};
        for (const entry of heads) if (field === "placement" || current?.deleted || !current || hash(entry.value) !== hash(field === "placement" ? current.placement ?? registers.placement?.[0]?.value : fieldValue({ node: current.node, layout: current.layout }, field))) values[hash(entry.value)] = clone(entry.value);
        if (Object.keys(values).length) variants[field] = values;
      }
    }
    const hasConflict = materialized.conflicts.some(conflict => conflict.strokeId === source.id);
    if (isDeleted(stroke) && !hasConflict) compactDeleted(stroke);
    else if (Object.keys(variants).length) stroke.variants = variants;
    state.strokes[source.id] = stroke;
    if (isDeleted(stroke)) deleted.push(source.id);
    if (current && !current.deleted) visible.push({ id: source.id, node: current.node, layout: current.layout, placement: current.placement ?? registers.placement[0].value, born: source.creationOrder });
  }
  // Checkpoint record/key order is an index detail; born order is the original
  // logical paint order, including adjacent ink inside a transparent group.
  visible.sort((a, b) => birthOrder(a.born, b.born));
  return { state: prune(state), visible, deleted, conflicts: materialized.conflicts };
}

/** Native coalesced saves export the retained replica's original dots, not the
 * identity of whichever stroke happened to trigger the final checkpoint. */
export function inkWireDocumentFromCheckpoint(document, boardId, checkpoint) {
  validateInkCheckpoint(checkpoint);
  if (checkpoint.pageId !== document.id || checkpoint.boardId !== boardId) fail("checkpoint projection scope differs");
  const next = clone(document), record = boards(next).get(boardId); if (!record) fail("Board is missing");
  const projection = wireProjection(checkpoint, materializeInkOperations([], checkpoint), strokeId =>
    record.records.get(strokeId)?.placement ?? { parentId: boardId, after: record.board.content?.filter(node => !isInkNode(node)).at(-1)?.attrs?.id ?? null, before: null });
  const removedIds = new Set(record.records.keys());
  const strip = node => { if (node.content) node.content = node.content.filter(child => !removedIds.has(child.attrs?.id)).map(strip); return node; };
  next.content = strip(next.content); next.layout = Object.fromEntries(Object.entries(next.layout ?? {}).filter(([id]) => !removedIds.has(id)));
  return finishInkPageMerge(next, { plans: [{ id: boardId, state: projection.state, visible: projection.visible }], conflicts: [] }).document;
}

/** A retained-replica delta replaces only the requested wire stroke entries.
 * Merge scoped metadata maps into the prior Board state; pruning and complete
 * exports belong to an idle/full-document boundary. Parent existence, anchor
 * cycles and generic sibling order are checked by the tree splicer, using the
 * explicit placements returned here. Missing legacy placement must be supplied
 * from the actual canonical tree; this helper cannot infer absent parents. */
export function inkWireDeltaFromReplica(replica, ids, { placements = {} } = {}) {
  const sparse = replica.sparseCheckpoint(ids), requested = [...new Set(ids)];
  const projection = wireProjection(sparse.checkpoint, replica.materialize(requested), strokeId => placements[strokeId], sparse);
  return { pageId: replica.pageId, boardId: replica.boardId, ids: requested, ...projection };
}

/** Convert an ordinary canonical editor draft into author intent against the
 * exact document that editor observed. Imported/stamped heads pass through;
 * no clock from the currently retained journal is falsely attributed to it.
 * A sparse tombstone restore has two ordered plans: source hydration, liveness.
 * The durable adapter allocates each real operation ID and local predecessor. */
export function inkWireEditPlans(baseline, next) {
  if (!baseline || baseline.id !== next?.id) fail("edit plan requires the same author page baseline");
  const beforeBoards = boards(baseline), afterBoards = boards(next), plans = [];
  for (const boardId of new Set([...beforeBoards.keys(), ...afterBoards.keys()])) {
    const before = beforeBoards.get(boardId), after = afterBoards.get(boardId), state = bootstrap(before);
    if (before && !metadataMatches(before, state)) fail("edit author baseline is unstamped");
    const supplied = after?.board.attrs.inkState ? bootstrap(after) : null;
    const heads = [...new Set(Object.values(state.strokes).flatMap(stroke => Object.values(stroke.fields).flat().map(([dot]) => dot)))];
    const parents = heads.filter(dot => !heads.some(other => dot !== other && seen(state.contexts[other], dot))).sort(compare);
    const changes = [], restores = [];
    const stamped = (id, field, value) => {
      if (!supplied) return false;
      const previous = state.strokes[id], source = supplied.strokes[id], incoming = source?.fields[field];
      // Global clock coverage can include an unseen native predecessor. Only
      // heads of this field prove its older value was already superseded.
      // A compact deletion supplies the coverage of discarded source fields.
      const covered = previous?.fields[field] ?? (isDeleted(previous) ? previous.fields.alive : undefined);
      if (field === "alive" && value === true && isDeleted(source)) return false;
      const freshRestore = isDeleted(previous) && !isDeleted(source) && source?.fields.alive.some(([dot, digest]) => digest === aliveHash && !previous.fields.alive.some(([old]) => seen(state.contexts[old], dot)));
      return !!incoming?.some(([dot, digest]) => digest === hash(value) && (field !== "alive" && freshRestore || !covered?.some(([old]) => seen(state.contexts[old], dot))));
    };
    for (const id of new Set([...Object.keys(state.strokes), ...(before?.records.keys() ?? []), ...(after?.records.keys() ?? [])])) {
      const old = before?.records.get(id), current = after?.records.get(id), previous = state.strokes[id];
      if (!current) {
        if (old && !stamped(id, "alive", false)) changes.push({ kind: "delete", strokeId: id });
        continue;
      }
      if (!previous) {
        if (!stamped(id, "alive", true)) changes.push({ kind: "create", strokeId: id, node: clone(current.node), layout: clone(current.layout), placement: clone(current.placement) });
        continue;
      }
      const restoring = isDeleted(previous), patch = {};
      for (const field of fields.filter(field => field !== "alive")) {
        const value = fieldValue(current, field);
        if ((restoring || !equal(fieldValue(old, field), value)) && !stamped(id, field, value)) patch[field] = clone(value);
      }
      if (own(patch, "ink") || own(patch, "inkFragments")) {
        patch.ink = clone(fieldValue(current, "ink")); patch.inkFragments = clone(fieldValue(current, "inkFragments"));
      }
      if (Object.keys(patch).length) changes.push({ kind: "edit", strokeId: id, patch });
      if (restoring && !stamped(id, "alive", true)) restores.push({ kind: "restore", strokeId: id });
    }
    if (changes.length) plans.push({ boardId, parents, changes });
    if (restores.length) plans.push({ boardId, parents, changes: restores });
  }
  return plans;
}

/** Import only real source heads from a draft which may also contain ordinary
 * unstamped edits. Missing canonical source cannot be guessed from its hash.
 * The authoring adapter imports these anchors before appending editPlans. */
export function inkWireImportCheckpoints(baseline, next) {
  if (!baseline || baseline.id !== next?.id) fail("draft import requires the same author page baseline");
  const beforeBoards = boards(baseline), afterBoards = boards(next), result = [];
  for (const boardId of new Set([...beforeBoards.keys(), ...afterBoards.keys()])) {
    const before = beforeBoards.get(boardId), after = afterBoards.get(boardId), original = bootstrap(before);
    if (before && !metadataMatches(before, original)) fail("edit author baseline is unstamped");
    const supplied = after?.board.attrs.inkState ? bootstrap(after) : null;
    const state = supplied ? mergeImportWireStates(original, supplied) : original;
    const sources = [{ record: after, state: supplied ?? state }, { record: before, state: original }, { record: after, state }];
    result.push({ boardId, checkpoint: checkpointFromWireState(next.id, boardId, state, (id, field, digest) => valueLookup(id, field, digest, sources)) });
  }
  return result;
}

// A raw coalesced draft may retain an older wire envelope than the latest author
// receipt. Join only its real causal heads; canonical mutations are never
// reconciled through synthetic legacy events at this boundary.
function mergeImportWireStates(one, two) {
  const state = empty(); state.clock = joinClock(one.clock, two.clock); state.level = Math.max(one.level, two.level);
  for (const property of ["digests", "eventDigests"]) {
    for (const [dot, value] of Object.entries(two[property] ?? {})) if (one[property]?.[dot] !== undefined && !equal(one[property][dot], value)) fail("one edit dot names different source events");
    state[property] = { ...one[property], ...two[property] };
  }
  state.contexts = { ...one.contexts };
  for (const [dot, context] of Object.entries(two.contexts)) {
    if (state.contexts[dot] && !equal(state.contexts[dot], context)) fail("one dot names conflicting causal contexts");
    state.contexts[dot] = context;
  }
  for (const [dot, level] of Object.entries({ ...one.levels, ...two.levels })) state.levels[dot] = Math.max(one.levels?.[dot] ?? level, two.levels?.[dot] ?? level);
  for (const id of new Set([...Object.keys(one.strokes), ...Object.keys(two.strokes)])) {
    const a = one.strokes[id], b = two.strokes[id];
    if (a && b && !equal(a.born, b.born)) fail("different creations reused a stable ink ID");
    const stroke = { born: clone(a?.born ?? b.born), fields: {} }, variants = {};
    for (const field of fields) {
      const heads = mergeHeads(a?.fields[field], b?.fields[field], state.contexts);
      if (!heads.length) continue;
      stroke.fields[field] = heads;
      for (const [digest, value] of Object.entries({ ...a?.variants?.[field], ...b?.variants?.[field] })) if (heads.some(([, hash]) => hash === digest)) (variants[field] ??= {})[digest] = value;
    }
    if (Object.keys(variants).length) stroke.variants = variants;
    if (a?.unplaced || b?.unplaced) stroke.unplaced = true;
    state.strokes[id] = stroke;
  }
  return validateInkWireState(state);
}

/** Hydrate only causal metadata from an authenticated predecessor receipt.
 * Native updates may have added other stamped strokes while the editor still
 * carries this predecessor's raw placement hashes. Join real observed heads;
 * never rewrite visible values or invent events to make a baseline pass. */
export function inkWireHydrateAuthorBaseline(document, confirmedStates) {
  const result = clone(document);
  for (const [id, record] of boards(result)) {
    if (!own(confirmedStates, id) || confirmedStates[id] == null) continue;
    const state = mergeImportWireStates(bootstrap(record), validateInkWireState(confirmedStates[id]));
    if (!metadataMatches(record, state)) fail("author baseline differs from its confirmed predecessor");
    record.board.attrs.inkState = state;
  }
  return result;
}

/** Return the latest editor-visible author branch using exact committed source
 * operations. Causal parents may cover unseen native edits, but their stroke
 * registers are never imported into this receipt or attributed to the UI. */
export function inkWireAuthorReceipt(authorBaseline, rawDraft, actualOperations, actualJournalCheckpoint) {
  const journal = validateInkCheckpoint(actualJournalCheckpoint), { pageId, boardId } = journal;
  if (authorBaseline?.id !== pageId || rawDraft?.id !== pageId || !Array.isArray(actualOperations)) fail("author receipt scope differs");
  const incoming = inkWireImportCheckpoints(authorBaseline, rawDraft).find(item => item.boardId === boardId);
  if (!incoming) fail("author receipt Board is missing");
  const partial = incoming.checkpoint, author = boards(rawDraft).get(boardId);
  if (!author) fail("author receipt target Board was removed");
  const targets = new Set(actualOperations.map(operation => operation.id)), touched = new Map(), parents = new Set(partial.frontier);
  const cover = (id, field) => { const keys = touched.get(id) ?? new Set(); keys.add(field); touched.set(id, keys); };
  for (const operation of actualOperations) {
    validateInkOperation(operation);
    if (operation.pageId !== pageId || operation.boardId !== boardId) fail("author operation scope differs");
    const descriptor = journal.known[operation.id];
    if (!descriptor || descriptor.hash !== inkOperationDigest(operation)) fail("author operation is not the committed source");
    const expected = {};
    for (const parent of operation.parents) {
      const source = journal.known[parent]; if (!source) fail("committed author dependency is unavailable");
      for (const [actor, sequence] of Object.entries(source.clock)) expected[actor] = Math.max(expected[actor] ?? 0, sequence);
      if (!targets.has(parent)) {
        const previous = partial.known[parent];
        if (previous?.hash && source.hash && previous.hash !== source.hash) fail("author dependency identity differs");
        partial.known[parent] = { ...clone(source), anchor: true }; parents.add(parent);
      }
    }
    expected[operation.actor] = operation.sequence;
    if (!equal(expected, descriptor.clock)) fail("committed author context differs from original parents");
    for (const change of operation.changes) {
      const current = author.records.get(change.strokeId);
      if (change.kind === "create") {
        if (!current || !equal(change.node, current.node) || !equal(change.layout, current.layout) || change.placement && !equal(change.placement, current.placement)) fail("author create does not match its visible source");
        fields.forEach(field => cover(change.strokeId, field));
      } else if (change.kind === "delete") {
        if (current) fail("author deletion still has visible source"); cover(change.strokeId, "delete");
      } else if (change.kind === "restore") {
        if (!current) fail("author restore has no visible source"); cover(change.strokeId, "restore");
      } else {
        if (!current) fail("author edit target is not in its draft");
        for (const [field, value] of Object.entries(change.patch)) {
          if (!equal(value, fieldValue(current, field))) fail("author field does not match its visible source");
          cover(change.strokeId, field);
        }
      }
    }
  }
  for (const plan of inkWireEditPlans(authorBaseline, rawDraft).filter(plan => plan.boardId === boardId)) for (const change of plan.changes) {
    const covered = touched.get(change.strokeId);
    if (change.kind === "edit") { if (Object.keys(change.patch).some(field => !covered?.has(field))) fail("author receipt omits a changed field"); }
    else if (change.kind === "create") { if (!fields.every(field => covered?.has(field))) fail("author receipt omits its created source"); }
    else if (!covered?.has(change.kind)) fail("author receipt omits liveness intent");
  }
  partial.frontier = [...parents].filter(dot => ![...parents].some(other => dot !== other && seen(partial.known[other].clock, dot))).sort(compare);
  const replica = new InkOperationReplica({ checkpoint: partial }); replica.append(actualOperations);
  const result = inkWireDocumentFromCheckpoint(rawDraft, boardId, replica.checkpoint());
  // Projection is scoped to this Board. Raw non-ink content and other Boards
  // remain the editor's current draft, without a full-journal value overlay.
  return result;
}
