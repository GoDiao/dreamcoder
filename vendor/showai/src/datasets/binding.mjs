// Bindings connect a page block to a project dataset. The block keeps only the
// binding and its own (local) values; the host resolves the component props
// from the dataset and splits the component's changes back into dataset
// operations and block changes. Components themselves need no host API.
//
// Two forms combine freely:
// - props:       the dataset value (or an object inside it) supplies the
//                component's top-level props, except the keys listed as local.
// - collections: records found along a path such as
//                "objectives[*].keyResults[*].tasks[*]" become items of an array
//                prop such as a database's rows, next to the block's own items.
//                Mapped fields write back to the source record; derived fields
//                are read-only; other fields are stored with the block.

import {
  cloneValue,
  diffValues,
  equalValues,
  formatPath,
  isPlainObject,
  parsePath,
  recordId,
  validatePath,
  valueAt,
} from "./operations.mjs";

export const BINDING_KEY = "$binding";
export const MAX_COLLECTIONS = 20;
export const MAX_PROJECTED_ITEMS = 20000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

const fail = (message) => {
  const error = new Error(message);
  error.code = "INVALID_DATA";
  throw error;
};
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isEmpty = (value) =>
  value === undefined || value === null || value === "";
/** Cell equality: an absent value and an empty text are the same cell. */
const sameCell = (a, b) => equalValues(a, b) || (isEmpty(a) && isEmpty(b));

export function readBinding(data) {
  const binding = isPlainObject(data) ? data[BINDING_KEY] : undefined;
  return isPlainObject(binding) ? binding : undefined;
}

export function hasBinding(data) {
  return readBinding(data) !== undefined;
}

/** The props object a component receives from its stored block data. */
export function componentProps(kind, data) {
  if (!isPlainObject(data)) return {};
  if (kind === "custom") return isPlainObject(data.props) ? data.props : {};
  const { [BINDING_KEY]: _binding, ...props } = data;
  return props;
}

/** Block data with new component props; `binding` null removes the binding. */
export function withComponentProps(
  kind,
  data,
  props,
  binding = readBinding(data),
) {
  const base = isPlainObject(data) ? data : {};
  if (kind === "custom") {
    const { [BINDING_KEY]: _old, ...envelope } = base;
    return binding
      ? { ...envelope, props, [BINDING_KEY]: binding }
      : { ...envelope, props };
  }
  return binding ? { ...props, [BINDING_KEY]: binding } : { ...props };
}

// ---------------------------------------------------------------------------
// Paths inside collections

/** "objectives[*].keyResults[*].tasks[*]" → per-level relative paths. */
export function parseCollectionPath(from) {
  if (typeof from !== "string" || !from.endsWith("[*]") || from.length > 500)
    fail(
      'A collection "from" path ends in [*], e.g. "objectives[*].tasks[*]".',
    );
  const parts = from.split("[*]");
  parts.pop();
  if (parts.length > 8) fail("A collection path can descend at most 8 levels.");
  return parts.map((part, index) => {
    const text = index ? part.replace(/^\./, "") : part;
    if (index && !text) fail(`Collection path "${from}" has an empty level.`);
    return parsePath(text);
  });
}

/** "../../title" → { up: 2, path: ["title"] } */
export function parseReference(reference, levels) {
  if (typeof reference !== "string" || !reference || reference.length > 300)
    fail(
      "A field reference must be text such as title, ../title or ../../area.",
    );
  let rest = reference,
    up = 0;
  while (rest.startsWith("../")) {
    up++;
    rest = rest.slice(3);
  }
  if (rest === "..") fail(`Reference "${reference}" must name a field.`);
  if (levels !== undefined && up >= levels)
    fail(`Reference "${reference}" climbs above the collection's first level.`);
  return { up, path: rest === "" ? [] : parsePath(rest) };
}

function readReference(chain, reference) {
  const element = chain[chain.length - 1 - reference.up];
  return reference.path.length ? valueAt(element, reference.path) : element;
}

// ---------------------------------------------------------------------------
// Validation

function validateCondition(condition, levels, label) {
  if (!isPlainObject(condition)) fail(`${label} must be an object.`);
  for (const key of Object.keys(condition))
    if (!["field", "exists", "equals", "notEquals", "in"].includes(key))
      fail(`${label} has an unknown field: ${key}.`);
  const result = { field: parseReference(condition.field, levels) };
  if (condition.exists !== undefined) {
    if (typeof condition.exists !== "boolean")
      fail(`${label}.exists must be boolean.`);
    result.exists = condition.exists;
  }
  if (own(condition, "equals")) result.equals = condition.equals;
  if (own(condition, "notEquals")) result.notEquals = condition.notEquals;
  if (own(condition, "in")) {
    if (!Array.isArray(condition.in)) fail(`${label}.in must be an array.`);
    result.in = condition.in;
  }
  return result;
}

function validateField(name, mapping, label) {
  const value = typeof mapping === "string" ? { from: mapping } : mapping;
  if (!isPlainObject(value))
    fail(`${label} must be a field name or { from, … }.`);
  for (const key of Object.keys(value))
    if (!["from", "map", "otherwise", "empty"].includes(key))
      fail(`${label} has an unknown field: ${key}.`);
  const reference = parseReference(value.from);
  if (reference.up)
    fail(
      `${label} writes back to its own record; use "derived" for ${value.from}.`,
    );
  if (!reference.path.length) fail(`${label}.from must name a field.`);
  if (value.map !== undefined && !isPlainObject(value.map))
    fail(`${label}.map must map shown values to stored values.`);
  if (value.empty !== undefined && !["remove", "keep"].includes(value.empty))
    fail(`${label}.empty must be "remove" or "keep".`);
  return {
    target: name,
    path: reference.path,
    ...(value.map ? { map: value.map } : {}),
    ...(own(value, "otherwise") ? { otherwise: value.otherwise } : {}),
    empty: value.empty ?? "keep",
  };
}

function validateDerivation(name, derivation, levels, label) {
  if (typeof derivation === "string")
    return { target: name, from: parseReference(derivation, levels) };
  if (!isPlainObject(derivation))
    fail(`${label} must be a reference or an object.`);
  const keys = Object.keys(derivation);
  if (own(derivation, "value") && keys.length === 1)
    return { target: name, value: derivation.value };
  if (own(derivation, "from") && keys.length === 1)
    return { target: name, from: parseReference(derivation.from, levels) };
  if (own(derivation, "template") && keys.length === 1) {
    if (
      typeof derivation.template !== "string" ||
      derivation.template.length > 1000
    )
      fail(`${label}.template must be text.`);
    const references = [...derivation.template.matchAll(/\{([^{}]+)\}/g)].map(
      (match) => ({
        text: match[0],
        reference: parseReference(match[1], levels),
      }),
    );
    return { target: name, template: derivation.template, references };
  }
  if (own(derivation, "lookup")) {
    for (const key of keys)
      if (!["lookup", "by", "key", "field"].includes(key))
        fail(`${label} has an unknown field: ${key}.`);
    if (typeof derivation.field !== "string")
      fail(`${label}.field names the field to show.`);
    return {
      target: name,
      lookup: parsePath(derivation.lookup),
      by: parseReference(derivation.by, levels),
      key: parsePath(derivation.key ?? "id"),
      field: parsePath(derivation.field),
    };
  }
  fail(
    `${label} uses one of: a reference, { value }, { from }, { template } or { lookup, by, field }.`,
  );
}

/** Validates and compiles a binding; throws INVALID_DATA with a reason. */
export function compileBinding(binding) {
  if (!isPlainObject(binding)) fail("A binding must be an object.");
  for (const key of Object.keys(binding))
    if (
      !["dataset", "project", "props", "collections", "overlay"].includes(key)
    )
      fail(`The binding has an unknown field: ${key}.`);
  if (typeof binding.dataset !== "string" || !ID.test(binding.dataset))
    fail("binding.dataset must be a dataset id.");
  if (
    binding.project !== undefined &&
    (typeof binding.project !== "string" || !ID.test(binding.project))
  )
    fail("binding.project must be a project id.");
  const compiled = {
    dataset: binding.dataset,
    project: binding.project,
    collections: [],
  };
  if (binding.props !== undefined) {
    if (!isPlainObject(binding.props)) fail("binding.props must be an object.");
    for (const key of Object.keys(binding.props))
      if (!["path", "local"].includes(key))
        fail(`binding.props has an unknown field: ${key}.`);
    const local = binding.props.local ?? [];
    if (
      !Array.isArray(local) ||
      local.some((key) => typeof key !== "string" || !key)
    )
      fail("binding.props.local lists top-level prop names.");
    compiled.props = {
      path:
        binding.props.path === undefined ? [] : parsePath(binding.props.path),
      local: new Set(local),
    };
  }
  const collections = binding.collections ?? [];
  if (!Array.isArray(collections) || collections.length > MAX_COLLECTIONS)
    fail(
      `binding.collections is a list of at most ${MAX_COLLECTIONS} mappings.`,
    );
  const keys = new Set();
  collections.forEach((collection, index) => {
    const label = `binding.collections[${index}]`;
    if (!isPlainObject(collection)) fail(`${label} must be an object.`);
    for (const key of Object.keys(collection))
      if (
        ![
          "key",
          "into",
          "from",
          "idField",
          "where",
          "fields",
          "derived",
          "defaults",
          "label",
        ].includes(key)
      )
        fail(`${label} has an unknown field: ${key}.`);
    if (typeof collection.key !== "string" || !KEY.test(collection.key))
      fail(`${label}.key is a short name such as tasks.`);
    if (keys.has(collection.key))
      fail(`${label}.key repeats ${collection.key}.`);
    keys.add(collection.key);
    if (typeof collection.into !== "string" || !collection.into)
      fail(
        `${label}.into names the array prop that receives the records, e.g. rows.`,
      );
    const levels = parseCollectionPath(collection.from);
    const idField = collection.idField ?? "id";
    if (typeof idField !== "string" || !idField)
      fail(`${label}.idField must be text.`);
    const targets = new Set();
    const claim = (name, part) => {
      if (name === idField) fail(`${label}.${part}.${name} is the item id.`);
      if (targets.has(name)) fail(`${label} maps ${name} more than once.`);
      targets.add(name);
    };
    const fields = [];
    if (collection.fields !== undefined) {
      if (!isPlainObject(collection.fields))
        fail(`${label}.fields must be an object.`);
      for (const [name, mapping] of Object.entries(collection.fields)) {
        claim(name, "fields");
        fields.push(validateField(name, mapping, `${label}.fields.${name}`));
      }
    }
    const derived = [];
    if (collection.derived !== undefined) {
      if (!isPlainObject(collection.derived))
        fail(`${label}.derived must be an object.`);
      for (const [name, derivation] of Object.entries(collection.derived)) {
        claim(name, "derived");
        derived.push(
          validateDerivation(
            name,
            derivation,
            levels.length,
            `${label}.derived.${name}`,
          ),
        );
      }
    }
    const defaults = collection.defaults ?? {};
    if (!isPlainObject(defaults)) fail(`${label}.defaults must be an object.`);
    for (const name of Object.keys(defaults)) claim(name, "defaults");
    const where =
      collection.where === undefined
        ? []
        : Array.isArray(collection.where)
          ? collection.where
          : [collection.where];
    compiled.collections.push({
      key: collection.key,
      into: collection.into,
      from: collection.from,
      levels,
      idField,
      label:
        typeof collection.label === "string"
          ? collection.label.slice(0, 200)
          : undefined,
      where: where.map((condition, position) =>
        validateCondition(
          condition,
          levels.length,
          `${label}.where[${position}]`,
        ),
      ),
      fields,
      derived,
      defaults,
    });
  });
  if (!compiled.props && !compiled.collections.length)
    fail("A binding needs props, collections or both.");
  if (binding.overlay !== undefined) {
    if (
      !isPlainObject(binding.overlay) ||
      Object.values(binding.overlay).some((value) => !isPlainObject(value))
    )
      fail("binding.overlay maps item ids to locally stored fields.");
  }
  compiled.overlay = binding.overlay ?? {};
  return compiled;
}

export function validateBinding(binding) {
  compileBinding(binding);
  return binding;
}

// ---------------------------------------------------------------------------
// Resolution

function matches(chain, condition) {
  const value = readReference(chain, condition.field);
  if (condition.exists === true && isEmpty(value)) return false;
  if (condition.exists === false && !isEmpty(value)) return false;
  if (own(condition, "equals") && !equalValues(value, condition.equals))
    return false;
  if (own(condition, "notEquals") && equalValues(value, condition.notEquals))
    return false;
  if (condition.in && !condition.in.some((item) => equalValues(item, value)))
    return false;
  return true;
}

function mapKey(key) {
  if (key === "true") return true;
  if (key === "false") return false;
  return key;
}

function readField(item, field) {
  const raw = valueAt(item, field.path);
  if (!field.map) return cloneValue(raw);
  for (const [key, stored] of Object.entries(field.map))
    if (equalValues(stored, raw)) return mapKey(key);
  return own(field, "otherwise")
    ? cloneValue(field.otherwise)
    : cloneValue(raw);
}

function derive(root, chain, derivation) {
  if (own(derivation, "value")) return cloneValue(derivation.value);
  if (derivation.from) return cloneValue(readReference(chain, derivation.from));
  if (derivation.template !== undefined) {
    let text = derivation.template;
    for (const part of derivation.references) {
      const value = readReference(chain, part.reference);
      text = text.replace(
        part.text,
        isEmpty(value)
          ? ""
          : typeof value === "string"
            ? value
            : JSON.stringify(value),
      );
    }
    return text;
  }
  const list = valueAt(root, derivation.lookup);
  if (!Array.isArray(list)) return undefined;
  const wanted = readReference(chain, derivation.by);
  if (isEmpty(wanted)) return undefined;
  const match = list.find((entry) => {
    const key = valueAt(entry, derivation.key);
    return !isEmpty(key) && String(key) === String(wanted);
  });
  return match === undefined
    ? undefined
    : cloneValue(valueAt(match, derivation.field));
}

function collect(root, collection, issues) {
  const found = [];
  const walk = (base, level, chain, path, writable, ids) => {
    const list = valueAt(base, collection.levels[level]);
    if (list === undefined) return;
    if (!Array.isArray(list)) {
      if (level === 0)
        issues.push({
          level: "warning",
          collection: collection.key,
          message: `${formatPath(collection.levels[0])} is not a list.`,
        });
      return;
    }
    list.forEach((element, index) => {
      if (found.length >= MAX_PROJECTED_ITEMS) return;
      const id = recordId(element);
      const segment = id === undefined ? index : { id: element.id };
      const nextChain = [...chain, element],
        nextPath = [...path, ...collection.levels[level], segment],
        nextIds = [...ids, id ?? `#${index}`];
      if (level + 1 < collection.levels.length) {
        if (isPlainObject(element))
          walk(
            element,
            level + 1,
            nextChain,
            nextPath,
            writable && id !== undefined,
            nextIds,
          );
        return;
      }
      if (!isPlainObject(element)) return;
      if (!collection.where.every((condition) => matches(nextChain, condition)))
        return;
      found.push({
        chain: nextChain,
        path: nextPath,
        writable: writable && id !== undefined,
        ids: nextIds,
      });
    });
  };
  walk(root, 0, [], [], true, []);
  if (found.length >= MAX_PROJECTED_ITEMS)
    issues.push({
      level: "warning",
      collection: collection.key,
      message: `Only the first ${MAX_PROJECTED_ITEMS} records are shown.`,
    });
  const counts = new Map();
  for (const entry of found)
    counts.set(entry.ids.at(-1), (counts.get(entry.ids.at(-1)) ?? 0) + 1);
  for (const entry of found)
    entry.key = `${collection.key}:${counts.get(entry.ids.at(-1)) > 1 ? entry.ids.join("/") : entry.ids.at(-1)}`;
  return found;
}

/**
 * Component props for a bound block, plus what the host needs to route
 * changes: every projected item by id and any issues to show.
 */
export function resolveBinding(
  kind,
  data,
  value,
  compiled = compileBinding(readBinding(data)),
) {
  const issues = [];
  const projected = new Map();
  const ownProps = componentProps(kind, data);
  let props;
  if (compiled.props) {
    const shared = valueAt(value, compiled.props.path);
    if (shared !== undefined && !isPlainObject(shared))
      issues.push({
        level: "error",
        message: `${formatPath(compiled.props.path)} in the dataset is not an object.`,
      });
    if (shared === undefined)
      issues.push({
        level: "warning",
        message: `${formatPath(compiled.props.path)} is missing in the dataset.`,
      });
    props = {};
    for (const [key, item] of Object.entries(
      isPlainObject(shared) ? shared : {},
    ))
      if (!compiled.props.local.has(key)) props[key] = cloneValue(item);
    for (const key of compiled.props.local)
      if (own(ownProps, key)) props[key] = ownProps[key];
  } else props = { ...ownProps };
  const targets = new Map();
  for (const collection of compiled.collections) {
    if (!targets.has(collection.into)) {
      const local = Array.isArray(props[collection.into])
        ? props[collection.into]
        : [];
      if (
        props[collection.into] !== undefined &&
        !Array.isArray(props[collection.into])
      )
        issues.push({
          level: "error",
          collection: collection.key,
          message: `${collection.into} is not a list.`,
        });
      targets.set(collection.into, { local, items: [] });
    }
    const target = targets.get(collection.into);
    for (const entry of collect(value, collection, issues)) {
      const item = entry.chain.at(-1);
      const row = { [collection.idField]: entry.key };
      Object.assign(row, cloneValue(collection.defaults));
      const stored = compiled.overlay[entry.key];
      const mapped = (field) =>
        collection.fields.some((entry) => entry.target === field) ||
        collection.derived.some((entry) => entry.target === field);
      for (const [field, cell] of Object.entries(stored ?? {}))
        if (!mapped(field) && field !== collection.idField)
          row[field] = cloneValue(cell);
      for (const field of collection.fields) {
        const cell = readField(item, field);
        if (cell !== undefined) row[field.target] = cell;
      }
      for (const derivation of collection.derived) {
        const cell = derive(value, entry.chain, derivation);
        if (cell !== undefined) row[derivation.target] = cell;
      }
      if (projected.has(entry.key)) {
        issues.push({
          level: "warning",
          collection: collection.key,
          message: `Item ${entry.key} appears twice; the later mapping is hidden.`,
        });
        continue;
      }
      projected.set(entry.key, {
        id: entry.key,
        collection,
        into: collection.into,
        row,
        source: entry.writable ? entry.path : null,
        label: collection.label,
        writable: entry.writable
          ? collection.fields.map((field) => field.target)
          : [],
        readOnly: [
          ...collection.derived.map((derivation) => derivation.target),
          ...(entry.writable
            ? []
            : collection.fields.map((field) => field.target)),
        ],
      });
      target.items.push(row);
    }
  }
  for (const [into, target] of targets) {
    const hidden = target.local.filter((item) =>
      projected.has(String(item?.[compiledIdField(compiled, into)])),
    );
    if (hidden.length)
      issues.push({
        level: "warning",
        message: `${hidden.length} local item(s) in ${into} share an id with mapped records and are hidden.`,
      });
    props[into] = [
      ...target.local.filter(
        (item) =>
          !projected.has(String(item?.[compiledIdField(compiled, into)])),
      ),
      ...target.items,
    ];
  }
  return { props, projected, issues, compiled };
}

function compiledIdField(compiled, into) {
  return (
    compiled.collections.find((collection) => collection.into === into)
      ?.idField ?? "id"
  );
}

// ---------------------------------------------------------------------------
// Writing back

function writeField(field, info, basisValue, next, rejected) {
  const path = [...info.source, ...field.path];
  const current = valueAt(basisValue, path);
  let stored = next;
  if (field.map) {
    const key = String(next);
    if (!own(field.map, key)) {
      rejected.push({
        id: info.id,
        field: field.target,
        reason: "unmapped",
        value: next,
      });
      return [];
    }
    stored = cloneValue(field.map[key]);
  }
  if (isEmpty(stored) && field.empty === "remove")
    return current === undefined
      ? []
      : [{ op: "remove", path, before: cloneValue(current) }];
  if (equalValues(stored, current)) return [];
  if (isEmpty(stored) && current === undefined) return [];
  return [
    current === undefined
      ? { op: "set", path, value: stored, absent: true }
      : { op: "set", path, value: stored, before: cloneValue(current) },
  ];
}

/**
 * Routes a component change. `basis` is the dataset value and props the
 * component last rendered from; writes carry the basis values, so a change
 * made elsewhere meanwhile becomes a conflict instead of being overwritten.
 */
export function splitBindingChange({ kind, data, value, nextProps, basis }) {
  const compiled = compileBinding(readBinding(data));
  const basisValue = basis ? basis.value : value;
  const resolved = resolveBinding(kind, data, basisValue, compiled);
  const previous = basis?.props ?? resolved.props;
  const ownProps = componentProps(kind, data);
  const nextOwn = { ...ownProps };
  const operations = [],
    rejected = [];
  const overlay = cloneValue(compiled.overlay);
  const sharedPath = compiled.props?.path;
  const isShared = (key) => !!compiled.props && !compiled.props.local.has(key);
  const intoKeys = new Set(
    compiled.collections.map((collection) => collection.into),
  );
  const sharedRoot = sharedPath ? valueAt(basisValue, sharedPath) : undefined;
  if (compiled.props && sharedRoot !== undefined && !isPlainObject(sharedRoot))
    fail(
      `${formatPath(sharedPath)} in the dataset is not an object; the change cannot be stored.`,
    );
  const created = {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(nextProps)]);
  for (const key of keys) {
    if (intoKeys.has(key)) continue;
    if (!isShared(key)) {
      if (own(nextProps, key)) nextOwn[key] = nextProps[key];
      else delete nextOwn[key];
      continue;
    }
    const after = own(nextProps, key) ? nextProps[key] : undefined;
    if (sharedRoot === undefined) {
      if (after !== undefined) created[key] = cloneValue(after);
      continue;
    }
    operations.push(
      ...diffValues(sharedRoot[key], after, [...sharedPath, key]),
    );
  }
  for (const into of intoKeys) {
    if (!own(nextProps, into)) continue;
    const items = nextProps[into];
    if (!Array.isArray(items)) {
      rejected.push({ field: into, reason: "not-a-list" });
      continue;
    }
    const idField = compiledIdField(compiled, into);
    const previousItems = new Map(
      (Array.isArray(previous[into]) ? previous[into] : []).map((item) => [
        String(item?.[idField]),
        item,
      ]),
    );
    const local = [],
      seen = new Set();
    for (const item of items) {
      const id = isPlainObject(item) ? String(item[idField]) : undefined;
      const info = id === undefined ? undefined : resolved.projected.get(id);
      if (!info || info.into !== into) {
        local.push(item);
        continue;
      }
      seen.add(id);
      const before = previousItems.get(id) ?? info.row;
      const collection = info.collection;
      for (const field of new Set([
        ...Object.keys(before),
        ...Object.keys(item),
      ])) {
        if (
          field === idField ||
          !own(item, field) ||
          sameCell(before[field], item[field])
        )
          continue;
        const mapping = collection.fields.find(
          (entry) => entry.target === field,
        );
        if (mapping) {
          if (!info.source) rejected.push({ id, field, reason: "read-only" });
          else
            operations.push(
              ...writeField(mapping, info, basisValue, item[field], rejected),
            );
        } else if (collection.derived.some((entry) => entry.target === field))
          rejected.push({ id, field, reason: "derived" });
        else {
          const cells = (overlay[id] ??= {});
          if (
            own(collection.defaults, field)
              ? sameCell(item[field], collection.defaults[field])
              : isEmpty(item[field])
          )
            delete cells[field];
          else cells[field] = cloneValue(item[field]);
          if (!Object.keys(cells).length) delete overlay[id];
        }
      }
    }
    for (const [id, info] of resolved.projected)
      if (info.into === into && !seen.has(id))
        rejected.push({ id, reason: "removed" });
    // Local items hidden behind a mapped record keep their stored form.
    const stored = Array.isArray(
      isShared(into) ? sharedRoot?.[into] : ownProps[into],
    )
      ? isShared(into)
        ? sharedRoot[into]
        : ownProps[into]
      : [];
    for (const item of stored)
      if (resolved.projected.has(String(item?.[idField]))) local.push(item);
    if (!isShared(into)) nextOwn[into] = local;
    else if (sharedRoot === undefined) created[into] = local;
    else
      operations.push(
        ...diffValues(sharedRoot[into], local, [...sharedPath, into]),
      );
  }
  // The shared object itself is missing; create it with the shared keys.
  if (compiled.props && sharedRoot === undefined && Object.keys(created).length)
    operations.push({
      op: "set",
      path: sharedPath,
      value: created,
      absent: true,
    });
  const binding = { ...readBinding(data) };
  if (Object.keys(overlay).length) binding.overlay = overlay;
  else delete binding.overlay;
  const nextData = withComponentProps(kind, data, nextOwn, binding);
  return {
    operations,
    rejected,
    data: equalValues(nextData, data) ? data : nextData,
  };
}

/** Plain block data with the resolved props, for exports and for detaching. */
export function snapshotBinding(kind, data, value) {
  const { props } = resolveBinding(kind, data, value);
  return withComponentProps(kind, data, props, null);
}

/**
 * Converts a block into a dataset and a binding: the shared keys move into
 * the dataset value, the local keys stay with the block.
 */
export function shareBlock(kind, data, datasetId, local = []) {
  const props = componentProps(kind, data);
  const value = {},
    kept = {};
  for (const [key, item] of Object.entries(props)) {
    if (local.includes(key)) kept[key] = item;
    else value[key] = cloneValue(item);
  }
  const binding = { dataset: datasetId, props: { local: [...local] } };
  return {
    value,
    data: withComponentProps(kind, data, kept, binding),
    binding,
  };
}

/** Keys that usually stay per view when a built-in block is shared. */
export function defaultLocalKeys(kind) {
  if (kind === "database") return ["title", "view", "groupBy", "calendar"];
  return [];
}

// ---------------------------------------------------------------------------
// Suggestions

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Record lists reachable through record lists, as collection paths. */
export function findCollections(value, limit = 40) {
  const results = [];
  const visit = (node, prefix, depth) => {
    if (depth > 4 || results.length >= limit || !isPlainObject(node)) return;
    for (const [key, item] of Object.entries(node)) {
      if (
        !Array.isArray(item) ||
        !item.length ||
        !item.every((entry) => isPlainObject(entry))
      )
        continue;
      const from = `${prefix}${prefix ? "." : ""}${/^[A-Za-z_$][\w$-]*$/.test(key) ? key : JSON.stringify([key])}[*]`;
      const fields = new Map();
      for (const entry of item)
        for (const [field, cell] of Object.entries(entry)) {
          const kind =
            typeof cell === "string" && DAY.test(cell)
              ? "date"
              : Array.isArray(cell)
                ? "list"
                : typeof cell;
          if (!fields.has(field)) fields.set(field, new Set());
          fields.get(field).add(kind);
        }
      results.push({
        from,
        count: item.length,
        fields: Object.fromEntries(
          [...fields].map(([field, kinds]) => [field, [...kinds]]),
        ),
      });
      // Every nested record list continues the path.
      const nested = new Set();
      for (const entry of item)
        for (const [field, cell] of Object.entries(entry))
          if (
            Array.isArray(cell) &&
            cell.length &&
            cell.every((part) => isPlainObject(part))
          )
            nested.add(field);
      for (const field of nested) {
        const merged = {
          [field]: item.flatMap((entry) =>
            Array.isArray(entry[field]) ? entry[field] : [],
          ),
        };
        visit(merged, from, depth + 1);
      }
    }
  };
  visit(value, "", 0);
  return results;
}

/**
 * A starting mapping from dated records into a database: the date column
 * reads the first date field, the first text column reads title or name and
 * a checkbox column reads done (or status "done").
 */
export function suggestCollections(value, columns) {
  const dateColumn = columns.find((column) => column.type === "date");
  const textColumn = columns.find((column) => column.type === "text");
  const checkColumn = columns.find((column) => column.type === "checkbox");
  const used = new Set();
  return findCollections(value)
    .map((candidate) => {
      const dateField = Object.entries(candidate.fields).find(([, kinds]) =>
        kinds.includes("date"),
      )?.[0];
      if (!dateField || !dateColumn) return undefined;
      const fields = { [dateColumn.id]: { from: dateField, empty: "remove" } };
      const titleField = ["title", "name", "label"].find((name) =>
        candidate.fields[name]?.includes("string"),
      );
      if (textColumn && titleField) fields[textColumn.id] = titleField;
      if (checkColumn) {
        if (candidate.fields.done?.includes("boolean"))
          fields[checkColumn.id] = "done";
        else if (candidate.fields.status?.includes("string"))
          fields[checkColumn.id] = {
            from: "status",
            map: { true: "done", false: "todo" },
            otherwise: false,
          };
      }
      let key =
        candidate.from
          .replace(/\[\*\]/g, "")
          .split(".")
          .at(-1)
          .replace(/[^A-Za-z0-9_-]/g, "") || "items";
      if (!/^[A-Za-z]/.test(key)) key = `c${key}`;
      key = key.slice(0, 32);
      while (used.has(key)) key = `${key}x`;
      used.add(key);
      return {
        key,
        into: "rows",
        from: candidate.from,
        where: { field: dateField, exists: true },
        fields,
        count: candidate.count,
      };
    })
    .filter(Boolean);
}

/** Checks a resolved block against database columns: mapped targets must exist. */
export function bindingTargetIssues(compiled, columns) {
  if (!Array.isArray(columns)) return [];
  const ids = new Set(columns.map((column) => column?.id));
  const issues = [];
  for (const collection of compiled.collections) {
    if (collection.into !== "rows") continue;
    for (const name of [
      ...collection.fields.map((f) => f.target),
      ...collection.derived.map((d) => d.target),
      ...Object.keys(collection.defaults),
    ])
      if (!ids.has(name))
        issues.push({
          level: "warning",
          collection: collection.key,
          message: `Column ${name} is mapped but not in the table.`,
        });
  }
  return issues;
}

export { validatePath };

/**
 * A page moving to another project keeps reading the datasets of the project
 * they belong to. Returns a new document when any binding changed.
 */
export function retargetBindings(
  document,
  sourceProjectId,
  destinationProjectId,
) {
  let changed = false;
  const visit = (node) => {
    let next = node;
    const binding =
      node?.type === "widget" ? readBinding(node.attrs?.data) : undefined;
    if (binding) {
      const owner = binding.project ?? sourceProjectId;
      const { project: _project, ...rest } = binding;
      const updated =
        owner === destinationProjectId ? rest : { ...rest, project: owner };
      if (!equalValues(updated, binding)) {
        changed = true;
        next = {
          ...node,
          attrs: {
            ...node.attrs,
            data: { ...node.attrs.data, [BINDING_KEY]: updated },
          },
        };
      }
    }
    if (Array.isArray(next?.content)) {
      const content = next.content.map(visit);
      if (content.some((child, index) => child !== next.content[index]))
        next = { ...next, content };
    }
    return next;
  };
  const content = visit(document.content);
  return changed ? { ...document, content } : document;
}
