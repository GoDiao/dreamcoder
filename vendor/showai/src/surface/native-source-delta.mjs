import { captureOwnedJSON } from "../portable/owned-json.mjs";
/** Exact JSON transport edits. This carries existing source packets; it is not
 * an editing/causal protocol. The caller owns publication identity and receipt
 * validation. Neither inserted values nor mutable UI objects become baselines. */
const own = (value, key) => Object.hasOwn(value, key);
const object = (value) => value !== null && typeof value === "object";
const define = (value, key, child) => Object.defineProperty(value, key, {
  value: child, enumerable: true, writable: true, configurable: true,
});
const fail = (message) => { throw new TypeError(`Invalid native source delta: ${message}`); };
function cloneJSON(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!object(value)) return fail("non-JSON value");
  if (ancestors.has(value)) return fail("cyclic JSON value");
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = [];
    if (Object.keys(value).length !== value.length) fail("sparse or decorated array");
    for (let index = 0; index < value.length; index++) {
      if (!own(value, index)) fail("sparse array");
      result.push(cloneJSON(value[index], ancestors));
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("non-JSON object");
    result = {};
    for (const key of Object.keys(value)) define(result, key, cloneJSON(value[key], ancestors));
  }
  ancestors.delete(value);
  return result;
}

function equalJSON(one, two) {
  if (!object(one) || !object(two)) return one === two;
  if (Array.isArray(one) || Array.isArray(two)) return Array.isArray(one) && Array.isArray(two) && one.length === two.length && one.every((value, index) => equalJSON(value, two[index]));
  const keys = Object.keys(one);
  return keys.length === Object.keys(two).length && keys.every(key => own(two, key) && equalJSON(one[key], two[key]));
}
const stableID = value => object(value) && !Array.isArray(value)
  ? (typeof value.attrs?.id === "string" && value.attrs.id ? value.attrs.id : typeof value.id === "string" && value.id ? value.id : null) : null;
function uniqueArrayItems(values) {
  // Primitive/sample arrays have no identities. Mixed or duplicated identities
  // deliberately retain the conservative index comparison used before.
  if (!values.length || !stableID(values[0])) return null;
  const byID = new Map();
  for (const value of values) {
    const id = stableID(value);
    if (!id || byID.has(id)) return null;
    byID.set(id, value);
  }
  return byID;
}

/** Literal string keys are distinct (including NFC/NFD), object order is not.
 * No reference identity shortcut: callers may have edited an object in place. */
export function diffNativeSource(base, next) {
  const edits = [];
  const visit = (before, after, path) => {
    if (!object(before) || !object(after) || Array.isArray(before) !== Array.isArray(after)) {
      if (before !== after) edits.push({ op: "set", path, value: cloneJSON(after) });
      return;
    }
    if (Array.isArray(after)) {
      if (before.length !== after.length) {
        const limit = Math.min(before.length, after.length);
        let prefix = 0, suffix = 0;
        while (prefix < limit && equalJSON(before[prefix], after[prefix])) prefix++;
        while (suffix < limit - prefix && equalJSON(before[before.length - 1 - suffix], after[after.length - 1 - suffix])) suffix++;
        if (suffix) {
          edits.push({ op: "splice", path, index: prefix, deleteCount: before.length - prefix - suffix,
            items: cloneJSON(after.slice(prefix, after.length - suffix)) });
          return;
        }
      }
      for (let index = 0; index < after.length; index++) {
        if (!own(after, index)) fail("sparse array");
        if (index < before.length) visit(before[index], after[index], [...path, index]);
        else edits.push({ op: "set", path: [...path, index], value: cloneJSON(after[index]) });
      }
      if (after.length < before.length) edits.push({ op: "resize", path, length: after.length });
    } else {
      for (const key of Object.keys(before).sort()) if (!own(after, key)) edits.push({ op: "remove", path: [...path, key] });
      for (const key of Object.keys(after).sort()) {
        if (own(before, key)) visit(before[key], after[key], [...path, key]);
        else edits.push({ op: "set", path: [...path, key], value: cloneJSON(after[key]) });
      }
    }
  };
  visit(base, next, []);
  return edits;
}

/** Apply all edits before returning any result. Each touched ancestor is cloned
 * once, untouched private subtrees remain private, and base/edits are unchanged
 * even when a later edit is malformed. Never expose this result to mutable UI. */
function applySourceDelta(base, edits, inserted, mutableInsertedRoot) {
  if (!Array.isArray(edits)) fail("edits must be an array");
  let result = base;
  const owned = new WeakSet();
  const writable = (value) => {
    if (!object(value)) fail("path traverses a primitive");
    if (owned.has(value)) return value;
    const copy = Array.isArray(value) ? value.slice() : Object.fromEntries(Object.entries(value));
    owned.add(copy);
    return copy;
  };
  const keyFor = (parent, key, append = false) => {
    if (Array.isArray(parent)) {
      if (typeof key !== "number" || !Number.isSafeInteger(key) || key < 0 || key > parent.length || (!append && key === parent.length))
        fail("invalid array index");
    } else if (typeof key !== "string") fail("object path requires a literal string key");
    return key;
  };
  const parentAt = (path) => {
    result = writable(result);
    let parent = result;
    for (const key of path) {
      keyFor(parent, key);
      if (!own(parent, key)) fail("missing path ancestor");
      const child = writable(parent[key]);
      define(parent, key, child);
      parent = child;
    }
    return parent;
  };
  for (const edit of edits) {
    if (!object(edit) || !own(edit, "path") || !own(edit, "op") || !Array.isArray(edit.path) || !["set", "remove", "resize", "splice"].includes(edit.op)) fail("unknown edit");
    const expected = edit.op === "set" ? ["op", "path", "value"] : edit.op === "resize" ? ["op", "path", "length"] : edit.op === "splice" ? ["op", "path", "index", "deleteCount", "items"] : ["op", "path"];
    if (Object.keys(edit).length !== expected.length || expected.some(key => !own(edit, key))) fail("unexpected edit fields");
    const path = edit.path;
    if (edit.op === "set" && !path.length) { result = inserted(edit.value); if (mutableInsertedRoot && object(result)) owned.add(result); continue; }
    if (edit.op === "splice") {
      const parent = path.length ? parentAt(path.slice(0, -1)) : null, key = path.at(-1);
      if (parent) { keyFor(parent, key); if (!own(parent, key)) fail("missing splice target"); }
      const value = parent ? parent[key] : result;
      if (!Array.isArray(value) || !Number.isSafeInteger(edit.index) || edit.index < 0 || edit.index > value.length ||
        !Number.isSafeInteger(edit.deleteCount) || edit.deleteCount < 0 || edit.deleteCount > value.length - edit.index || !Array.isArray(edit.items))
        fail("splice requires an existing array and valid range");
      const items = inserted(edit.items);
      // No argument spreading: a large inserted JSON array must not exceed the
      // engine's function-argument limit. All values are already independent.
      const copy = value.slice(0, edit.index).concat(items, value.slice(edit.index + edit.deleteCount));
      owned.add(copy);
      if (parent) define(parent, key, copy); else result = copy;
      continue;
    }
    if (edit.op === "resize") {
      const parent = path.length ? parentAt(path.slice(0, -1)) : null;
      const key = path.at(-1);
      if (parent) { keyFor(parent, key); if (!own(parent, key)) fail("missing resize target"); }
      const value = parent ? parent[key] : result;
      if (!Array.isArray(value) || !Number.isSafeInteger(edit.length) || edit.length < 0 || edit.length > value.length) fail("resize must truncate an existing array");
      const copy = writable(value); copy.length = edit.length;
      if (parent) define(parent, key, copy); else result = copy;
      continue;
    }
    if (!path.length) fail("cannot remove the root");
    const parent = parentAt(path.slice(0, -1)), key = path.at(-1);
    keyFor(parent, key, edit.op === "set");
    if (edit.op === "remove") {
      if (Array.isArray(parent) || !own(parent, key)) fail("remove requires an existing object field");
      delete parent[key];
    } else define(parent, key, inserted(edit.value));
  }
  return result;
}

/** Mutable callers retain independent copies of every inserted value. */
export function applyNativeSourceDelta(base, edits) {
  return applySourceDelta(base, edits, cloneJSON, true);
}

/** Closed ownership boundary: both inputs become independent sealed JSON data
 * before edits execute. Only actually captured inserted branches may be reused;
 * every writable ancestor is local and the complete result seals before escape.
 * A root set is NOT mutable local ownership: later edits must path-copy it too. */
export function applyCapturedSourceDelta(base, edits) {
  const capturedBase = captureOwnedJSON(base), capturedEdits = captureOwnedJSON(edits);
  return captureOwnedJSON(applySourceDelta(capturedBase, capturedEdits, value => value, false));
}

/** After complete model normalization, retain only exactly equal old UI
 * subtrees. The next graph must already be independent of private transport
 * caches; changed leaves come exclusively from next, never a native baseline.
 * Optional undefined UI properties are compared as present, not missing. */
export function shareNativeSource(previous, next) {
  if (!object(previous) || !object(next) || Array.isArray(previous) !== Array.isArray(next)) return previous === next ? previous : next;
  const before = Object.keys(previous), after = Object.keys(next);
  let equal = before.length === after.length && (!Array.isArray(next) || previous.length === next.length);
  const candidates = Array.isArray(next) && uniqueArrayItems(next) ? uniqueArrayItems(previous) : null;
  let result = next;
  for (const key of after) {
    const present = own(previous, key), id = candidates ? stableID(next[key]) : null;
    // In identity mode a new ID has no previous owner. Falling back by index
    // could borrow a subtree from an old node that also survives elsewhere.
    const matched = candidates ? candidates.has(id) : present;
    const candidate = candidates ? candidates.get(id) : previous[key];
    const value = matched ? shareNativeSource(candidate, next[key]) : next[key];
    if (!present || value !== previous[key]) equal = false;
    if (value !== next[key]) {
      if (result === next) result = Array.isArray(next) ? next.slice() : Object.fromEntries(Object.entries(next));
      define(result, key, value);
    }
  }
  return equal ? previous : result;
}
