import { isResource, surfaceViews } from "./containers.mjs";

const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (id) =>
  typeof id === "string" &&
  id.trim().length > 0 &&
  id.length <= 200 &&
  !["__proto__", "constructor", "prototype"].includes(id);
const invalid = (message) => {
  throw new Error(`Invalid portable ink append: ${message}`);
};
const conflict = (id) => {
  const error = new Error(`Portable ink id already exists elsewhere: ${id}`);
  error.code = "CONFLICT";
  throw error;
};

// These helpers edit already supplied trees. Their local structure checks do
// not confer canonical/validated ownership or scan a stroke's large source.
function tree(document) {
  if (!record(document) || !isResource(document))
    invalid("a resource tree is required");
  if (document.layout !== undefined && !record(document.layout))
    invalid("layout must be an object");
  if (document.surfaceViews !== undefined && !record(document.surfaceViews))
    invalid("surfaceViews must be an object");
  const entries = [],
    active = new WeakSet();
  function visit(node, parent, board, path) {
    if (!record(node) || active.has(node))
      invalid("invalid or cyclic node tree");
    if (node.content !== undefined && !Array.isArray(node.content))
      invalid("node content must be an array");
    active.add(node);
    if (node.type === "surface")
      board = node.attrs?.kind === "board" ? node : null;
    entries.push({ node, parent, board, path });
    for (let i = 0; i < (node.content?.length ?? 0); i++)
      visit(node.content[i], node, board, [...path, i]);
    active.delete(node);
  }
  visit(document.content, null, null, []);
  return entries;
}
function boardEntry(entries, id) {
  if (!validId(id)) invalid("invalid Board id");
  const matches = entries.filter(({ node }) => node.attrs?.id === id);
  if (matches.length > 1) conflict(id);
  const entry = matches[0];
  return entry?.node.type === "surface" && entry.node.attrs?.kind === "board"
    ? entry
    : null;
}
function portableDrawing(node) {
  const ink = node?.attrs?.ink;
  return (
    record(node) &&
    node.type === "drawing" &&
    validId(node.attrs?.id) &&
    (node.attrs?.tool === undefined ||
      ["pen", "highlighter"].includes(node.attrs.tool)) &&
    record(ink) &&
    ink.brushVersion === 1 &&
    ink.strokeCount === 1 &&
    ((ink.format === "showai-ink-v1" &&
      ["pen", "marker", "pencil", "monoline"].includes(ink.brush) &&
      Array.isArray(ink.samples) &&
      ink.samples.length > 0) ||
      (ink.format === "showai-ink-v2" &&
        ink.geometryVersion === 1 &&
        ["pen", "marker", "monoline"].includes(ink.brush) &&
        Array.isArray(ink.segments) &&
        ink.segments.length > 0))
  );
}
function drawing(node, frame) {
  if (!portableDrawing(node))
    invalid("a portable v1/v2 drawing source is required");
  if (
    !record(frame) ||
    !Number.isFinite(frame.x) ||
    !Number.isFinite(frame.y) ||
    !Number.isFinite(frame.width) ||
    frame.width <= 0 ||
    (frame.height !== undefined &&
      (!Number.isFinite(frame.height) || frame.height <= 0)) ||
    (frame.rotation !== undefined && !Number.isFinite(frame.rotation))
  )
    invalid("a finite positive drawing frame is required");
}
function orderFor(document, board) {
  const views = surfaceViews(document, board);
  if (
    !record(views) ||
    !Array.isArray(views.readingOrder) ||
    views.readingOrder.some((id) => typeof id !== "string")
  )
    invalid("invalid Board reading order");
  return views;
}
function insertionIndex(target, source, id) {
  const index = source.indexOf(id);
  for (let i = index - 1; i >= 0; i--) {
    const found = target.indexOf(source[i]);
    if (found >= 0) return found + 1;
  }
  if (index === 0) return 0;
  for (let i = index + 1; i < source.length; i++) {
    const found = target.indexOf(source[i]);
    if (found >= 0) return found;
  }
  return target.length;
}
function inserted(values, index, value) {
  return [...values.slice(0, index), value, ...values.slice(index)];
}
function replaceAt(root, path, replacement) {
  if (path.length === 0) return replacement;
  const nodes = [root];
  for (const index of path) nodes.push(nodes.at(-1).content[index]);
  for (let i = path.length - 1; i >= 0; i--) {
    const parent = nodes[i],
      content = parent.content.slice();
    content[path[i]] = replacement;
    replacement = { ...parent, content };
  }
  return replacement;
}
function append(target, entry, node, frame, sourceOrder, sourceViewOrder) {
  const board = entry.node,
    children = board.content ?? [],
    id = node.attrs.id;
  const position = sourceOrder
    ? insertionIndex(
        children.map((child) => child.attrs?.id),
        sourceOrder,
        id,
      )
    : children.length;
  const views = orderFor(target, board),
    order = views.readingOrder;
  const viewPosition = sourceViewOrder
    ? insertionIndex(order, sourceViewOrder, id)
    : order.length;
  if (order.includes(id)) conflict(id);
  const updatedViews = {
    ...views,
    readingOrder: inserted(order, viewPosition, id),
  };
  const next = {
    ...target,
    content: replaceAt(target.content, entry.path, {
      ...board,
      content: inserted(children, position, node),
    }),
    layout: { ...(target.layout ?? {}), [id]: frame },
  };
  if (
    Object.hasOwn(target.surfaceViews ?? {}, board.attrs.id) ||
    target.views === undefined
  )
    next.surfaceViews = {
      ...(target.surfaceViews ?? {}),
      [board.attrs.id]: updatedViews,
    };
  else next.views = updatedViews;
  return next;
}

/** Strict resource-tree append. Inputs and the supplied ink/frame stay shared
 * and read-only; ordinary validation/save remains a separate boundary. */
export function appendNewPortableInk(target, boardId, node, frame) {
  drawing(node, frame);
  const entries = tree(target),
    entry = boardEntry(entries, boardId);
  if (!entry) return target;
  if (entries.some(({ node: current }) => current.attrs?.id === node.attrs.id))
    conflict(node.attrs.id);
  return append(target, entry, node, frame);
}

/** Reattach a genuinely supplied source stroke, preserving current target
 * edits and deleted Boards. Source-local frames require a direct Board child. */
export function appendPortableInkFromSource(target, source, boardId, strokeId) {
  if (!validId(strokeId)) invalid("invalid stroke id");
  const sourceEntries = tree(source),
    sourceBoard = boardEntry(sourceEntries, boardId);
  if (!sourceBoard) invalid("source Board is missing");
  const strokes = sourceEntries.filter(
    ({ node }) => node.attrs?.id === strokeId,
  );
  if (strokes.length > 1) conflict(strokeId);
  const stroke = strokes[0];
  if (!stroke || stroke.parent !== sourceBoard.node)
    invalid("source stroke must be a direct Board child");
  const node = stroke.node,
    frame = source.layout?.[strokeId];
  drawing(node, frame);
  const sourceViews = orderFor(source, sourceBoard.node);
  const entries = tree(target),
    entry = boardEntry(entries, boardId);
  if (!entry) return target;
  const existing = entries.filter(
    ({ node: current }) => current.attrs?.id === strokeId,
  );
  if (existing.length > 1) conflict(strokeId);
  if (existing.length) {
    if (existing[0].board === entry.node && portableDrawing(existing[0].node))
      return target;
    conflict(strokeId);
  }
  const sourceOrder = sourceBoard.node.content.map((child) => child.attrs?.id);
  const sourceViewOrder = [
    ...sourceViews.readingOrder,
    ...sourceOrder.filter((id) => !sourceViews.readingOrder.includes(id)),
  ];
  return append(target, entry, node, frame, sourceOrder, sourceViewOrder);
}
