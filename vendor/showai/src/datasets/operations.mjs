// Shared data (dataset) operations: id-addressed paths, a structural diff and a
// precondition-checked apply. The same code runs in the workbench, the CLI/MCP
// host and the sync merge, so it stays dependency-free.
//
// A path is an array of segments: an object key (string), an array index
// (number) or an array element selected by its `id` ({ id }). Writes carry the
// value their author started from (`before`, or `absent: true`); a write whose
// starting value no longer matches the current one is a conflict unless the
// current value already equals the written one. Different records and different
// fields therefore merge, while two different writes to one field never
// silently replace each other.

export const MAX_OPERATIONS = 5000;
const MAX_DEPTH = 64;
const ABSENT = Symbol("absent");

const fail = (message) => {
  const error = new Error(message);
  error.code = "INVALID_DATA";
  throw error;
};

export function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

export function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** JSON equality; object key order is irrelevant. */
export function equalValues(a, b) {
  if (a === b) return true;
  if (a === ABSENT || b === ABSENT) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++)
      if (!equalValues(a[index], b[index])) return false;
    return true;
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    if (
      keys.length !==
      Object.keys(b).filter((key) => b[key] !== undefined).length
    )
      return false;
    return keys.every((key) => key in b && equalValues(a[key], b[key]));
  }
  return false;
}

/** A record identity: a non-empty string or finite number `id`. */
export function recordId(value) {
  if (!isPlainObject(value)) return undefined;
  const id = value.id;
  if (typeof id === "string" && id) return id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return undefined;
}

/** Arrays whose every element is a record with a unique id merge per record. */
export function isKeyedArray(value) {
  if (!Array.isArray(value)) return false;
  const seen = new Set();
  for (const item of value) {
    const id = recordId(item);
    if (id === undefined || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function validSegment(segment) {
  if (typeof segment === "string")
    return segment.length > 0 && segment.length <= 200;
  if (typeof segment === "number")
    return Number.isInteger(segment) && segment >= 0;
  return (
    isPlainObject(segment) &&
    Object.keys(segment).length === 1 &&
    ((typeof segment.id === "string" && segment.id.length > 0) ||
      (typeof segment.id === "number" && Number.isFinite(segment.id)))
  );
}

export function validatePath(path, label = "path") {
  if (!Array.isArray(path) || path.length > MAX_DEPTH)
    fail(`${label} must be an array of at most ${MAX_DEPTH} segments.`);
  for (const segment of path) {
    if (!validSegment(segment))
      fail(
        `${label} segments are object keys, array indexes or { "id": … } record selectors.`,
      );
    if (
      typeof segment === "string" &&
      ["__proto__", "constructor", "prototype"].includes(segment)
    )
      fail(`${label} uses a reserved key.`);
  }
  return path;
}

/** Text form for messages and Agents: objectives[id=promo].keyResults[0].due */
export function formatPath(path) {
  let text = "";
  for (const segment of path) {
    if (typeof segment === "number") text += `[${segment}]`;
    else if (typeof segment === "string")
      text += /^[A-Za-z_$][\w$-]*$/.test(segment)
        ? `${text ? "." : ""}${segment}`
        : `[${JSON.stringify(segment)}]`;
    else text += `[id=${segment.id}]`;
  }
  return text || "(root)";
}

/** Parses formatPath output; arrays pass through after validation. */
export function parsePath(input) {
  if (Array.isArray(input)) return validatePath(input);
  if (typeof input !== "string") fail("A path must be an array or text.");
  const path = [];
  const pattern =
    /\.?([A-Za-z_$][\w$-]*)|\[(\d+)\]|\[id=([^\]]+)\]|\["((?:[^"\\]|\\.)*)"\]/gy;
  let index = 0;
  if (input === "" || input === "(root)") return path;
  while (index < input.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(input);
    if (!match) fail(`Cannot read path "${input}" at character ${index + 1}.`);
    if (match[1] !== undefined) path.push(match[1]);
    else if (match[2] !== undefined) path.push(Number(match[2]));
    else if (match[3] !== undefined) path.push({ id: match[3] });
    else path.push(JSON.parse(`"${match[4]}"`));
    index = pattern.lastIndex;
  }
  return validatePath(path);
}

function elementIndex(array, id) {
  const wanted = String(id);
  return array.findIndex((item) => recordId(item) === wanted);
}

/**
 * Finds the container and slot a path names. `missing` is the number of leading
 * segments that resolved before a container was absent.
 */
function locate(root, path) {
  let parent = undefined,
    slot = undefined,
    value = root;
  for (let depth = 0; depth < path.length; depth++) {
    const segment = path[depth];
    if (value === ABSENT) return { found: false, missing: depth - 1 };
    if (typeof segment === "string") {
      if (!isPlainObject(value))
        return { found: false, missing: depth, invalid: true };
      parent = value;
      slot = segment;
      value = Object.prototype.hasOwnProperty.call(value, segment)
        ? value[segment]
        : ABSENT;
    } else {
      if (!Array.isArray(value))
        return { found: false, missing: depth, invalid: true };
      const index =
        typeof segment === "number" ? segment : elementIndex(value, segment.id);
      parent = value;
      slot = index;
      value = index >= 0 && index < value.length ? value[index] : ABSENT;
    }
  }
  return { found: value !== ABSENT, parent, slot, value };
}

/** The value a path names, or undefined when it does not exist. */
export function valueAt(root, path) {
  const result = locate(root, path);
  return result.found ? result.value : undefined;
}

export function hasPath(root, path) {
  return locate(root, path).found;
}

const isRecordSelector = (segment) => isPlainObject(segment);

// ---------------------------------------------------------------------------
// Diff

function longestIncreasing(values) {
  // Indexes into `values` of one longest strictly increasing subsequence.
  const tails = [],
    previous = new Array(values.length);
  for (let index = 0; index < values.length; index++) {
    let low = 0,
      high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]] < values[index]) low = middle + 1;
      else high = middle;
    }
    previous[index] = low ? tails[low - 1] : -1;
    tails[low] = index;
  }
  const result = new Set();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index])
    result.add(index);
  return result;
}

function selectorFor(item) {
  const id = item.id;
  return { id: typeof id === "number" ? id : String(id) };
}

/**
 * Operations that turn `base` into `next`. Objects diff per key, arrays of
 * records diff per id (with insert/remove/move), anything else is replaced as
 * one value. Every write carries its starting value.
 */
export function diffValues(base, next, path = []) {
  const operations = [];
  const visit = (before, after, at) => {
    if (equalValues(before, after)) return;
    if (isPlainObject(before) && isPlainObject(after)) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const key of [...keys].sort()) {
        const has = Object.prototype.hasOwnProperty;
        const inBefore = has.call(before, key) && before[key] !== undefined,
          inAfter = has.call(after, key) && after[key] !== undefined;
        if (inBefore && !inAfter)
          operations.push({
            op: "remove",
            path: [...at, key],
            before: cloneValue(before[key]),
          });
        else if (!inBefore && inAfter)
          operations.push({
            op: "set",
            path: [...at, key],
            value: cloneValue(after[key]),
            absent: true,
          });
        else if (inBefore && inAfter)
          visit(before[key], after[key], [...at, key]);
      }
      return;
    }
    if (
      Array.isArray(before) &&
      Array.isArray(after) &&
      (before.length || after.length) &&
      isKeyedArray(before) &&
      isKeyedArray(after)
    ) {
      const beforeIndex = new Map(
        before.map((item, index) => [recordId(item), index]),
      );
      const afterIds = new Set(after.map((item) => recordId(item)));
      for (const item of before)
        if (!afterIds.has(recordId(item)))
          operations.push({
            op: "remove",
            path: [...at, selectorFor(item)],
            before: cloneValue(item),
          });
      const common = after.filter((item) => beforeIndex.has(recordId(item)));
      const stable = longestIncreasing(
        common.map((item) => beforeIndex.get(recordId(item))),
      );
      const stableIds = new Set(
        [...stable].map((index) => recordId(common[index])),
      );
      // Order among the elements kept in both; predecessors exist when applied in this order.
      const keptBefore = before.filter((item) => afterIds.has(recordId(item)));
      const predecessorBefore = new Map(
        keptBefore.map((item, index) => [
          recordId(item),
          index ? keptBefore[index - 1] : null,
        ]),
      );
      after.forEach((item, index) => {
        const id = recordId(item),
          predecessor = index ? after[index - 1].id : null;
        if (!beforeIndex.has(id))
          operations.push({
            op: "insert",
            path: at,
            value: cloneValue(item),
            after: predecessor,
          });
        else if (!stableIds.has(id)) {
          const from = predecessorBefore.get(id);
          operations.push({
            op: "move",
            path: [...at, selectorFor(item)],
            after: predecessor,
            from: from ? from.id : null,
          });
        }
      });
      for (const item of common)
        visit(before[beforeIndex.get(recordId(item))], item, [
          ...at,
          selectorFor(item),
        ]);
      return;
    }
    operations.push(
      before === undefined
        ? { op: "set", path: at, value: cloneValue(after), absent: true }
        : after === undefined
          ? { op: "remove", path: at, before: cloneValue(before) }
          : {
              op: "set",
              path: at,
              value: cloneValue(after),
              before: cloneValue(before),
            },
    );
  };
  visit(base, next, path);
  return operations;
}

// ---------------------------------------------------------------------------
// Validation

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function anchor(value, label) {
  if (
    value !== null &&
    !(typeof value === "string" && value) &&
    !(typeof value === "number" && Number.isFinite(value))
  )
    fail(`${label} must be a record id or null.`);
}

export function validateOperations(operations) {
  if (!Array.isArray(operations)) fail("operations must be an array.");
  if (operations.length > MAX_OPERATIONS)
    fail(`At most ${MAX_OPERATIONS} operations can be applied at once.`);
  return operations.map((operation, index) => {
    const label = `operations[${index}]`;
    if (!isPlainObject(operation)) fail(`${label} must be an object.`);
    const path = parsePath(operation.path ?? []);
    const allowed = {
      set: ["value", "before", "absent"],
      remove: ["before"],
      insert: ["value", "after", "index"],
      move: ["after", "from"],
    };
    if (!hasOwn(allowed, operation.op))
      fail(`${label}.op must be set, remove, insert or move.`);
    for (const key of Object.keys(operation))
      if (
        key !== "op" &&
        key !== "path" &&
        !allowed[operation.op].includes(key)
      )
        fail(`${label} has an unknown field: ${key}.`);
    const result = { op: operation.op, path };
    if (operation.op === "set" || operation.op === "insert") {
      if (!hasOwn(operation, "value") || operation.value === undefined)
        fail(`${label}.value is required.`);
      result.value = operation.value;
    }
    if (hasOwn(operation, "before")) result.before = operation.before;
    if (operation.absent !== undefined) {
      if (operation.absent !== true) fail(`${label}.absent must be true.`);
      if (hasOwn(operation, "before"))
        fail(`${label} cannot have both before and absent.`);
      result.absent = true;
    }
    if (operation.op === "remove" || operation.op === "move") {
      if (!path.length) fail(`${label} cannot ${operation.op} the root value.`);
    }
    if (operation.op === "move") {
      if (!isRecordSelector(path.at(-1)))
        fail(`${label}.path must end in an { "id": … } record selector.`);
      if (!hasOwn(operation, "after"))
        fail(`${label}.after is required (a record id or null).`);
      anchor(operation.after, `${label}.after`);
      result.after = operation.after;
      if (hasOwn(operation, "from")) {
        anchor(operation.from, `${label}.from`);
        result.from = operation.from;
      }
    }
    if (operation.op === "insert") {
      if (hasOwn(operation, "after") && hasOwn(operation, "index"))
        fail(`${label} uses either after or index.`);
      if (hasOwn(operation, "after")) {
        anchor(operation.after, `${label}.after`);
        result.after = operation.after;
      }
      if (hasOwn(operation, "index")) {
        if (!Number.isInteger(operation.index) || operation.index < 0)
          fail(`${label}.index must be a non-negative integer.`);
        result.index = operation.index;
      }
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Apply

function describe(value) {
  return value === ABSENT ? undefined : cloneValue(value);
}

function conflict(operation, reason, theirs, extra = {}) {
  return {
    op: operation.op,
    path: operation.path,
    reason,
    ...(operation.absent
      ? { base: undefined }
      : hasOwn(operation, "before")
        ? { base: cloneValue(operation.before) }
        : {}),
    ...(operation.op === "set" || operation.op === "insert"
      ? { mine: cloneValue(operation.value) }
      : {}),
    theirs: describe(theirs),
    ...extra,
  };
}

function expectation(operation) {
  if (operation.absent) return { known: true, value: ABSENT };
  if (hasOwn(operation, "before"))
    return { known: true, value: operation.before };
  return { known: false };
}

function placeAfter(array, item, after) {
  if (after === null) {
    array.unshift(item);
    return;
  }
  const index = after === undefined ? -1 : elementIndex(array, after);
  if (index < 0) array.push(item);
  else array.splice(index + 1, 0, item);
}

/**
 * Applies operations to a copy of `root`. Returns the new value, the list of
 * conflicts and whether anything changed. With `atomic` (default) nothing is
 * applied when any operation conflicts.
 */
export function applyOperations(root, operations, options = {}) {
  const atomic = options.atomic !== false;
  let value = cloneValue(root);
  const conflicts = [];
  let changed = false,
    applied = 0;
  for (const operation of operations) {
    const path = operation.path;
    if (operation.op === "set") {
      if (!path.length) {
        const expected = expectation(operation);
        if (
          expected.known &&
          !equalValues(value, expected.value) &&
          !equalValues(value, operation.value)
        ) {
          conflicts.push(conflict(operation, "changed", value));
          continue;
        }
        if (!equalValues(value, operation.value)) {
          value = cloneValue(operation.value);
          changed = true;
        }
        applied++;
        continue;
      }
      const target = locate(value, path);
      if (
        target.parent === undefined ||
        (!target.found && target.missing !== undefined)
      ) {
        conflicts.push(
          conflict(operation, target.invalid ? "invalid" : "missing", ABSENT),
        );
        continue;
      }
      const current = target.found ? target.value : ABSENT;
      if (equalValues(current, operation.value)) {
        applied++;
        continue;
      }
      const expected = expectation(operation);
      if (expected.known && !equalValues(current, expected.value)) {
        conflicts.push(
          conflict(
            operation,
            current === ABSENT ? "removed" : "changed",
            current,
          ),
        );
        continue;
      }
      const segment = path.at(-1);
      if (typeof segment === "string")
        target.parent[segment] = cloneValue(operation.value);
      else {
        if (!target.found) {
          conflicts.push(conflict(operation, "removed", ABSENT));
          continue;
        }
        if (
          isRecordSelector(segment) &&
          recordId(operation.value) !== String(segment.id)
        )
          fail(`A record at ${formatPath(path)} must keep its id.`);
        target.parent[target.slot] = cloneValue(operation.value);
      }
      changed = true;
      applied++;
    } else if (operation.op === "remove") {
      const target = locate(value, path);
      if (!target.found) {
        applied++;
        continue;
      }
      const expected = expectation(operation);
      if (expected.known && !equalValues(target.value, expected.value)) {
        conflicts.push(conflict(operation, "changed", target.value));
        continue;
      }
      if (typeof path.at(-1) === "string") delete target.parent[path.at(-1)];
      else target.parent.splice(target.slot, 1);
      changed = true;
      applied++;
    } else if (operation.op === "insert") {
      const target = locate(value, path);
      if (!target.found || !Array.isArray(target.value)) {
        conflicts.push(
          conflict(
            operation,
            target.found ? "invalid" : "missing",
            target.found ? target.value : ABSENT,
          ),
        );
        continue;
      }
      const array = target.value;
      const id = recordId(operation.value);
      if (id !== undefined) {
        const existing = elementIndex(array, id);
        if (existing >= 0) {
          if (equalValues(array[existing], operation.value)) applied++;
          else conflicts.push(conflict(operation, "exists", array[existing]));
          continue;
        }
      }
      const item = cloneValue(operation.value);
      if (hasOwn(operation, "index"))
        array.splice(Math.min(operation.index, array.length), 0, item);
      else
        placeAfter(
          array,
          item,
          hasOwn(operation, "after") ? operation.after : undefined,
        );
      changed = true;
      applied++;
    } else if (operation.op === "move") {
      const target = locate(value, path);
      if (!target.found) {
        applied++;
        continue;
      }
      // Order is soft: a missing anchor appends, and moves never discard content.
      const array = target.parent,
        index = target.slot;
      const predecessor = index ? (recordId(array[index - 1]) ?? null) : null;
      const wanted = operation.after === null ? null : String(operation.after);
      if (predecessor === wanted || wanted === recordId(target.value)) {
        applied++;
        continue;
      }
      const [item] = array.splice(index, 1);
      placeAfter(array, item, operation.after);
      changed = true;
      applied++;
    }
  }
  if (atomic && conflicts.length)
    return { value: cloneValue(root), conflicts, changed: false, applied: 0 };
  return { value, conflicts, changed, applied };
}

/**
 * Gives operations without a starting value the one `base` had, and splits a
 * coarse replacement of an object or record list into per-field writes, so a
 * write prepared against `base` merges with changes made since.
 */
export function refineOperations(operations, base) {
  const refined = [];
  for (const operation of operations) {
    const known = operation.absent || hasOwn(operation, "before");
    if (operation.op === "set" && !known) {
      const target = locate(base, operation.path);
      const before = target.found ? target.value : ABSENT;
      if (
        before !== ABSENT &&
        ((isPlainObject(before) && isPlainObject(operation.value)) ||
          (Array.isArray(before) &&
            Array.isArray(operation.value) &&
            isKeyedArray(before) &&
            isKeyedArray(operation.value)))
      )
        refined.push(...diffValues(before, operation.value, operation.path));
      else if (before === ABSENT) refined.push({ ...operation, absent: true });
      else refined.push({ ...operation, before: cloneValue(before) });
    } else if (operation.op === "remove" && !known) {
      const target = locate(base, operation.path);
      refined.push(
        target.found
          ? { ...operation, before: cloneValue(target.value) }
          : operation,
      );
    } else if (operation.op === "move" && !hasOwn(operation, "from")) {
      const target = locate(base, operation.path);
      refined.push(
        target.found
          ? {
              ...operation,
              from: target.slot
                ? (recordId(target.parent[target.slot - 1]) ?? null)
                : null,
            }
          : operation,
      );
    } else refined.push(operation);
  }
  return refined;
}

/** True when `path` equals `prefix` or lies under it. */
export function pathWithin(path, prefix) {
  if (path.length < prefix.length) return false;
  return prefix.every((segment, index) => equalValues(segment, path[index]));
}

/** Stable text key for a path, used to index held conflicts. */
export function pathKey(path) {
  return JSON.stringify(
    path.map((segment) =>
      isPlainObject(segment) ? { id: String(segment.id) } : segment,
    ),
  );
}
