/**
 * One-line type summaries of component props schemas for catalog entries.
 *
 * A signature is informational: page data stays a named JSON object and the
 * schema remains the validation source of truth. The text is deterministic for
 * a given id and schema, never contains a line break and never exceeds the
 * limit. Required fields come first; nested structures collapse to `{…}` and
 * trailing fields drop to `…` when the line would be too long.
 */
export const COMPONENT_SIGNATURE_LIMIT = 320;
const MAX_DEPTH = 3;
const ENUM_MEMBERS = 6;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function componentSignature(
  id,
  schema,
  limit = COMPONENT_SIGNATURE_LIMIT,
) {
  if (typeof id !== "string" || !id.trim())
    throw new Error("A component signature needs the component id.");
  if (!Number.isInteger(limit) || limit < 16)
    throw new Error("A signature limit must be an integer of at least 16.");
  const root = rootSchema(schema);
  for (let maxDepth = MAX_DEPTH; maxDepth >= 0; maxDepth--) {
    const text = renderRoot(id, root, { maxDepth });
    if (text.length <= limit) return text;
  }
  return truncateRoot(id, root, limit);
}

function renderRoot(id, root, context) {
  if (!hasProperties(root)) return `${id}: ${typeText(root, 1, context)}`;
  const fields = fieldTexts(root, 1, context);
  return fields.length ? `${id} { ${fields.join(", ")} }` : `${id} {}`;
}

function truncateRoot(id, root, limit) {
  const context = { maxDepth: 0 };
  if (!hasProperties(root)) return clip(renderRoot(id, root, context), limit);
  const fields = fieldTexts(root, 1, context);
  for (let count = fields.length - 1; count >= 0; count--) {
    const text = `${id} { ${[...fields.slice(0, count), "…"].join(", ")} }`;
    if (text.length <= limit) return text;
  }
  return clip(`${id} { … }`, limit);
}

function clip(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** A root `$ref` into the schema's own definitions is followed; nested refs print their name. */
function rootSchema(schema) {
  let current = schema;
  const seen = new Set();
  while (
    isRecord(current) &&
    typeof current.$ref === "string" &&
    !seen.has(current.$ref)
  ) {
    seen.add(current.$ref);
    const target = resolveRef(schema, current.$ref);
    if (!isRecord(target)) break;
    current = target;
  }
  return current;
}

function resolveRef(schema, ref) {
  if (!isRecord(schema) || !ref.startsWith("#/")) return undefined;
  let node = schema;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(node) || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

function typeText(schema, depth, context) {
  if (schema === true || schema === undefined) return "any";
  if (schema === false) return "never";
  if (!isRecord(schema)) return "any";
  if (typeof schema.$ref === "string") return refName(schema.$ref);
  if (Array.isArray(schema.enum)) return enumText(schema.enum);
  if (Object.hasOwn(schema, "const")) return literal(schema.const);
  const union = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : undefined;
  if (union)
    return (
      unique(union.map((member) => typeText(member, depth, context))).join(
        " | ",
      ) || "any"
    );
  if (Array.isArray(schema.allOf))
    return (
      unique(
        schema.allOf.map((member) => typeText(member, depth, context)),
      ).join(" & ") || "any"
    );
  const types = Array.isArray(schema.type)
    ? schema.type
    : typeof schema.type === "string"
      ? [schema.type]
      : [inferredType(schema)];
  return (
    unique(types.map((type) => singleType(type, schema, depth, context))).join(
      " | ",
    ) || "any"
  );
}

function inferredType(schema) {
  if (
    isRecord(schema.properties) ||
    schema.additionalProperties !== undefined ||
    Array.isArray(schema.required)
  )
    return "object";
  if (schema.items !== undefined) return "array";
  return "any";
}

function singleType(type, schema, depth, context) {
  if (type === "array") return arrayText(schema, depth, context);
  if (type === "object") return objectText(schema, depth, context);
  if (["string", "number", "integer", "boolean", "null"].includes(type))
    return type;
  return "any";
}

function arrayText(schema, depth, context) {
  const items = schema.items;
  if (Array.isArray(items))
    return `[${items.map((item) => typeText(item, depth, context)).join(", ")}]`;
  if (items === undefined || items === true) return "any[]";
  const text = typeText(items, depth, context);
  return topLevelUnion(text) ? `(${text})[]` : `${text}[]`;
}

function objectText(schema, depth, context) {
  if (!hasProperties(schema)) {
    const extra = schema.additionalProperties;
    if (isRecord(extra) || extra === true)
      return depth > context.maxDepth
        ? "{…}"
        : `Record<string, ${typeText(extra, depth + 1, context)}>`;
    return "object";
  }
  if (depth > context.maxDepth) return "{…}";
  const fields = fieldTexts(schema, depth + 1, context);
  return fields.length ? `{ ${fields.join(", ")} }` : "{}";
}

function fieldTexts(schema, depth, context) {
  const properties = schema.properties;
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key) => typeof key === "string")
      : [],
  );
  const keys = Object.keys(properties);
  return [
    ...keys.filter((key) => required.has(key)),
    ...keys.filter((key) => !required.has(key)),
  ].map(
    (key) =>
      `${fieldName(key)}${required.has(key) ? "" : "?"}: ${typeText(properties[key], depth, context)}`,
  );
}

function fieldName(key) {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

function enumText(members) {
  const texts = unique(members.map(literal));
  if (!texts.length) return "never";
  return texts.length > ENUM_MEMBERS
    ? [...texts.slice(0, ENUM_MEMBERS - 1), "…"].join(" | ")
    : texts.join(" | ");
}

function literal(value) {
  if (value === undefined) return "any";
  if (value === null || typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

function refName(ref) {
  const segment = ref.split("/").filter(Boolean).pop() ?? "";
  const name = segment
    .replaceAll("~1", "/")
    .replaceAll("~0", "~")
    .replace(/\s+/g, " ");
  return name && name !== "#" ? name : "any";
}

/** A `|` outside brackets, braces, parentheses and quotes makes the text a union. */
function topLevelUnion(text) {
  let depth = 0;
  let quote = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = "";
    } else if (char === '"') quote = char;
    else if ("{[(<".includes(char)) depth++;
    else if ("}])>".includes(char)) depth--;
    else if (char === "|" && depth === 0) return true;
  }
  return false;
}

function hasProperties(schema) {
  return isRecord(schema) && isRecord(schema.properties);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unique(items) {
  return [...new Set(items)];
}
