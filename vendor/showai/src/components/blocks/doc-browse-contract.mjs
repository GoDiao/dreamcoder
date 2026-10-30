// Shared contract for the structure-browser and card-grid built-ins.
// Validation runs in the workbench, the CLI and the portable reader, so it stays dependency-free.
import {
  isSafeHref,
  parseInline,
  unsafeInlineLinks,
} from "./inline-markup.mjs";

export {
  isSafeHref,
  isExternalHref,
  parseInline,
  plainInline,
} from "./inline-markup.mjs";

const fail = (message) => {
  throw new Error(message);
};
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function text(value, label, maximum) {
  if (typeof value !== "string" || !value.trim())
    fail(`${label} must be non-empty text.`);
  if (value.length > maximum)
    fail(`${label} must be at most ${maximum} characters.`);
}
function optionalText(value, label, maximum) {
  if (value !== undefined) text(value, label, maximum);
}
function list(value, label, maximum, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    fail(`${label} must be an array of ${minimum} to ${maximum} items.`);
  value.forEach((item, index) => {
    if (!isObject(item)) fail(`${label}[${index}] must be an object.`);
  });
  return value;
}
function known(value, keys, label) {
  for (const key of Object.keys(value))
    if (!keys.includes(key)) fail(`${label}.${key} is not a supported field.`);
}

function inlineLinks(value, label) {
  if (value === undefined) return;
  const [unsafe] = unsafeInlineLinks(value);
  if (unsafe !== undefined)
    fail(
      `${label} links to ${unsafe}; only http(s), mailto, # anchors, ShowAI page links and relative paths are allowed.`,
    );
}

// ---------------------------------------------------------------- structure-browser

export const STRUCTURE_KINDS = ["dir", "file", "object", "array", "field"];
const NODE_KEYS = [
  "name",
  "kind",
  "type",
  "badge",
  "summary",
  "detail",
  "example",
  "exampleLang",
  "children",
  "open",
];
export const STRUCTURE_LIMITS = { siblings: 60, nodes: 400, depth: 8 };

/** A node's path segment: its name without trailing slashes ("src/" → "src"). */
export const pathSegment = (name) => name.replace(/\/+$/, "") || name;
/** Normalizes a written path ("docs/", "/a//b") to the joined segments used as keys. */
export const normalizePath = (path) =>
  path.split("/").filter(Boolean).join("/");
/** Kind written on the node, or dir for nodes with children and file otherwise. */
export const nodeKind = (node) =>
  node.kind ?? (node.children?.length ? "dir" : "file");

/**
 * Flattens the nested nodes into depth-first order, keyed by path.
 * Each entry records its depth, parent path and child paths.
 */
export function structureOutline(nodes) {
  const items = new Map();
  const roots = [];
  const walk = (list, parent, depth, into) => {
    for (const node of list ?? []) {
      const path = (parent ? `${parent}/` : "") + pathSegment(node.name);
      const item = {
        node,
        path,
        depth,
        parent,
        kind: nodeKind(node),
        children: [],
      };
      items.set(path, item);
      into.push(path);
      walk(node.children, path, depth + 1, item.children);
    }
  };
  walk(nodes, null, 0, roots);
  return { items, roots };
}

function validateStructure(data) {
  optionalText(data.caption, "caption", 600);
  inlineLinks(data.caption, "caption");
  let count = 0;
  const paths = new Set();
  const walk = (nodes, label, parent, depth) => {
    if (depth > STRUCTURE_LIMITS.depth)
      fail(`${label} is nested deeper than ${STRUCTURE_LIMITS.depth} levels.`);
    list(nodes, label, STRUCTURE_LIMITS.siblings);
    nodes.forEach((node, index) => {
      const at = `${label}[${index}]`;
      count += 1;
      if (count > STRUCTURE_LIMITS.nodes)
        fail(`The structure has more than ${STRUCTURE_LIMITS.nodes} nodes.`);
      known(node, NODE_KEYS, at);
      text(node.name, `${at}.name`, 80);
      if (pathSegment(node.name).includes("/"))
        fail(`${at}.name may only end with "/"; it is one path segment.`);
      const path = (parent ? `${parent}/` : "") + pathSegment(node.name);
      if (paths.has(path))
        fail(
          `${at}.name repeats the path ${path}; sibling names must be unique.`,
        );
      paths.add(path);
      if (node.kind !== undefined && !STRUCTURE_KINDS.includes(node.kind))
        fail(`${at}.kind must be one of ${STRUCTURE_KINDS.join(", ")}.`);
      optionalText(node.type, `${at}.type`, 80);
      optionalText(node.badge, `${at}.badge`, 16);
      optionalText(node.summary, `${at}.summary`, 300);
      optionalText(node.detail, `${at}.detail`, 3000);
      optionalText(node.example, `${at}.example`, 6000);
      optionalText(node.exampleLang, `${at}.exampleLang`, 24);
      inlineLinks(node.summary, `${at}.summary`);
      inlineLinks(node.detail, `${at}.detail`);
      if (node.exampleLang !== undefined && node.example === undefined)
        fail(`${at}.exampleLang needs ${at}.example.`);
      if (node.open !== undefined && typeof node.open !== "boolean")
        fail(`${at}.open must be true or false.`);
      if (node.children !== undefined)
        walk(node.children, `${at}.children`, path, depth + 1);
    });
  };
  walk(data.nodes, "nodes", null, 1);
  if (data.initial !== undefined) {
    text(data.initial, "initial", 400);
    const path = normalizePath(data.initial);
    if (!paths.has(path))
      fail(`initial ${data.initial} does not match a node path.`);
  }
}

// ---------------------------------------------------------------- card-grid

export const CARD_TONES = ["brand", "teal", "warm", "violet", "rose", "slate"];
export const CARD_VARIANTS = ["tile", "row"];
const CARD_KEYS = ["icon", "title", "body", "href", "tag", "tone"];

/** Written column count, or a balanced default for the card count and variant. */
export function cardGridColumns(data) {
  if (data.columns) return data.columns;
  const count = data.cards.length;
  if (data.variant === "row") return count > 3 ? 2 : 1;
  return count === 4 ? 2 : Math.max(1, Math.min(3, count));
}

function validateCards(data) {
  if (data.variant !== undefined && !CARD_VARIANTS.includes(data.variant))
    fail(`variant must be one of ${CARD_VARIANTS.join(", ")}.`);
  if (
    data.columns !== undefined &&
    (!Number.isInteger(data.columns) || data.columns < 1 || data.columns > 4)
  )
    fail("columns must be an integer from 1 to 4.");
  list(data.cards, "cards", 24).forEach((card, index) => {
    const at = `cards[${index}]`;
    known(card, CARD_KEYS, at);
    text(card.title, `${at}.title`, 80);
    text(card.body, `${at}.body`, 400);
    optionalText(card.icon, `${at}.icon`, 8);
    optionalText(card.tag, `${at}.tag`, 16);
    if (card.tone !== undefined && !CARD_TONES.includes(card.tone))
      fail(`${at}.tone must be one of ${CARD_TONES.join(", ")}.`);
    if (card.href !== undefined) {
      text(card.href, `${at}.href`, 2000);
      if (!isSafeHref(card.href))
        fail(
          `${at}.href must be an http(s), mailto, # anchor, ShowAI page or relative link.`,
        );
      // The whole card is the link, so its body cannot hold another one.
      if (parseInline(card.body).some((segment) => segment.type === "link"))
        fail(`${at}.body cannot contain links when the card has an href.`);
    } else inlineLinks(card.body, `${at}.body`);
  });
}

export function validateDocBrowseData(kind, data) {
  if (!isObject(data)) fail("Component data must be an object.");
  optionalText(data.title, "title", 120);
  if (kind === "structure-browser") validateStructure(data);
  else if (kind === "card-grid") validateCards(data);
  else fail(`Unknown document browsing component ${kind}.`);
  return data;
}
