import { shareNativeSource } from "./native-source-delta.mjs";
import { remapPageOutline } from "./page-outline.mjs";
import {
  isResource,
  fillResource,
  reconcileResource,
  resourceNodes,
  insertResourceTemplate,
} from "./containers.mjs";
// Shared by Core, Agent, the editor and standalone exports. No DOM dependencies.
export const isSurface = (document) => document.content?.type === "surface";
export const artifactVersion = (document) =>
  isResource(document) ? 3 : isSurface(document) ? 2 : 1;

export function visitNodes(node, visitor, parent = null) {
  visitor(node, parent);
  if (Array.isArray(node.content))
    node.content.forEach((child) => visitNodes(child, visitor, node));
}

function stableId(seed) {
  let hash = 2166136261;
  for (const char of seed)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `node-${(hash >>> 0).toString(16)}`;
}

export function assignSurfaceIds(document, { repairLegacy = false } = {}) {
  const used = new Set();
  visitNodes(document.content, (node) => {
    if (node.attrs?.id) used.add(node.attrs.id);
  });
  const seen = new Set();
  const reserved = new Set(["__proto__", "prototype", "constructor"]);
  const walk = (node, path) => {
    const previous = node.attrs?.id;
    if (
      (!["surface", "doc", "text"].includes(node.type) ||
        (node.type === "surface" && isResource(document))) &&
      (!previous ||
        (repairLegacy && (seen.has(previous) || reserved.has(previous))))
    ) {
      let id = stableId(`${document.id}:${path}`);
      while (used.has(id)) id += "-copy";
      used.add(id);
      node = { ...node, attrs: { ...node.attrs, id } };
    }
    if (node.attrs?.id) seen.add(node.attrs.id);
    if (Array.isArray(node.content)) {
      const content = node.content.map((child, index) => walk(child, `${path}/${index}`));
      if (content.some((child, index) => child !== node.content[index]))
        node = { ...node, content };
    }
    return node;
  };
  const content = walk(document.content, "");
  if (content !== document.content) document.content = content;
  return document;
}

export function findSurfaceNode(document, id) {
  let result;
  visitNodes(document.content, (node, parent) => {
    if (node.attrs?.id === id) result = { node, parent };
  });
  return result;
}

export function fillSurfaceLayout(document) {
  if (isResource(document)) return fillResource(document);
  if (!isSurface(document)) return document;
  document.layout ??= {};
  const walk = (parent) => {
    let right = 0;
    for (const node of parent.content ?? []) {
      const id = node.attrs?.id;
      const positioned =
        parent.type === "surface" ||
        (parent.type === "region" &&
          document.layout[parent.attrs.id]?.mode === "free");
      if (id && (positioned || node.type === "region")) {
        if (!Object.hasOwn(document.layout, id))
          document.layout[id] = {
            x: right,
            y: 0,
            width: node.type === "region" ? 920 : 360,
            ...(node.type === "region"
              ? { mode: "flow", columns: 2, gap: 24 }
              : {}),
          };
        right = Math.max(
          right,
          document.layout[id].x + document.layout[id].width + 64,
        );
      }
      if (node.type === "region") walk(node);
    }
  };
  walk(document.content);
  document.views ??= {
    initial: null,
    saved: [],
    readingOrder: (document.content.content ?? []).map((node) => node.attrs.id),
  };
  return document;
}

/** Preserve existing content identities. Migration is deterministic and read-only. */
export function upgradeDocument(source, { includeTitle = true } = {}) {
  const document = structuredClone(source);
  if (isSurface(document)) return fillSurfaceLayout(assignSurfaceIds(document));
  assignSurfaceIds(document, { repairLegacy: true });
  const nodes = document.content.content ?? [];
  const body = nodes.filter((node) => !node.attrs?.canvas);
  const used = new Set();
  visitNodes(document.content, (node) => {
    if (node.attrs?.id) used.add(node.attrs.id);
  });
  const unique = (name) => {
    let id = stableId(`${document.id}:${name}`);
    while (used.has(id)) id += "-copy";
    used.add(id);
    return id;
  };
  const regions = [],
    layout = {};
  if (body.length || (includeTitle && document.title)) {
    const id = unique("initial-region");
    if (includeTitle && document.title)
      body.unshift({
        type: "heading",
        attrs: { id: unique("legacy-title"), level: 1 },
        content: [{ type: "text", text: document.title }],
      });
    regions.push({
      type: "region",
      attrs: {
        id,
        name:
          includeTitle && document.title
            ? document.title.slice(0, 200)
            : "内容区域", // i18n-exempt: default region name saved into documents
      },
      content: body,
    });
    layout[id] = { x: 0, y: 0, width: 1000, mode: "flow", columns: 2, gap: 24 };
  }
  for (const node of nodes.filter((node) => node.attrs?.canvas)) {
    const id = node.attrs.id;
    regions.push({
      type: "region",
      attrs: { id, name: "内容区域" }, // i18n-exempt: default region name saved into documents
      content: node.content ?? [],
    });
    layout[id] = { ...node.attrs.canvas, mode: "flow", columns: 2, gap: 24 };
  }
  document.content = { type: "surface", content: regions };
  document.layout = layout;
  document.views = {
    initial: null,
    saved: [],
    readingOrder: regions.map((node) => node.attrs.id),
  };
  return document;
}

/** Cleanup is explicit after structural edits; the file validator rejects dangling refs. */
const reconciledDocuments = new WeakSet();
export const isReconciledSurface = (document) =>
  reconciledDocuments.has(document);
export function reconcileSurface(source, options = {}) {
  if (options.shareWith && options.clone === false)
    throw new TypeError("Structural sharing requires an independent normalization clone");
  const normalized = reconcileSurfaceDocument(source, options);
  const document = options.shareWith ? shareNativeSource(options.shareWith, normalized) : normalized;
  reconciledDocuments.add(document);
  return document;
}
function reconcileSurfaceDocument(source, { clone = true } = {}) {
  // clone:false retains its mutable-command-root contract. Frozen readable
  // roots first get their own draft; maps and missing-ID paths are always COW.
  const draft = clone ? structuredClone(source) : Object.isFrozen(source) ? { ...source } : source;
  if (!clone) {
    if (draft.layout) draft.layout = { ...draft.layout };
    if (draft.surfaceViews) draft.surfaceViews = { ...draft.surfaceViews };
  }
  const document = fillSurfaceLayout(assignSurfaceIds(draft));
  if (isResource(document)) return reconcileResource(document);
  if (!isSurface(document)) return document;
  const ids = new Set(),
    regions = new Set();
  visitNodes(document.content, (node) => {
    if (node.attrs?.id) ids.add(node.attrs.id);
    if (node.type === "region") regions.add(node.attrs.id);
  });
  for (const id of Object.keys(document.layout)) {
    if (!ids.has(id)) delete document.layout[id];
    else if (!regions.has(id)) {
      const { mode, columns, gap, ...frame } = document.layout[id];
      if (mode !== undefined || columns !== undefined || gap !== undefined)
        document.layout[id] = frame;
    }
  }
  const roots = (document.content.content ?? []).map((node) => node.attrs.id);
  const rootIds = new Set(roots);
  const saved = document.views.saved
    .map((view) => ({
      ...view,
      targets: view.targets.filter((id) => ids.has(id)),
    }))
    .filter((view) => view.targets.length);
  document.views = {
    ...document.views,
    initial: saved.some((view) => view.id === document.views.initial)
      ? document.views.initial
      : null,
    saved,
    readingOrder: [
      ...new Set([
        ...document.views.readingOrder.filter((id) => rootIds.has(id)),
        ...roots,
      ]),
    ],
  };
  return document;
}

export function orderedSurfaceNodes(document) {
  if (isResource(document)) return resourceNodes(document);
  if (!isSurface(document)) return document.content.content ?? [];
  const nodes = document.content.content ?? [];
  const order = document.views?.readingOrder ?? [];
  const byId = new Map(nodes.map((node) => [node.attrs?.id, node]));
  const ordered = new Set(order);
  return [
    ...order.map((id) => byId.get(id)).filter(Boolean),
    ...nodes.filter((node) => !ordered.has(node.attrs.id)),
  ];
}

export function linearContent(document) {
  const flatten = (node) =>
    ["region", "richText", "surface"].includes(node.type)
      ? (node.type === "surface" && isResource(document)
          ? resourceNodes(document, node)
          : (node.content ?? [])
        ).flatMap(flatten)
      : [node];
  return {
    type: "doc",
    content: orderedSurfaceNodes(document).flatMap(flatten),
  };
}

/** All IDs and every reference are remapped together when instantiating a template. */
export function remapSurfaceIds(source, nextId = () => crypto.randomUUID()) {
  const document = structuredClone(source),
    mapping = new Map();
  visitNodes(document.content, (node) => {
    if (
      ["doc", "text"].includes(node.type) ||
      (node.type === "surface" && !isResource(document))
    )
      return;
    const old = node.attrs?.id,
      id = nextId();
    if (old) mapping.set(old, id);
    node.attrs = { ...node.attrs, id };
  });
  visitNodes(document.content, (node) => {
    if (node.attrs?.outline) node.attrs.outline = remapPageOutline(node.attrs.outline, mapping, nextId);
    if (!node.attrs?.bindings) return;
    const bindings = {};
    for (const key of ["start", "end"]) {
      const binding = node.attrs.bindings[key],
        targetId = binding && mapping.get(binding.targetId);
      if (targetId) bindings[key] = { ...binding, targetId };
    }
    if (Object.keys(bindings).length) node.attrs.bindings = bindings;
    else delete node.attrs.bindings;
  });
  if (isSurface(document)) {
    document.layout = Object.fromEntries(
      Object.entries(document.layout ?? {}).map(([id, value]) => [
        mapping.get(id) ?? id,
        value,
      ]),
    );
    if (isResource(document)) {
      document.surfaceViews = Object.fromEntries(
        Object.entries(document.surfaceViews ?? {}).map(([id, views]) => {
          const viewIds = new Map(
            views.saved.map((view) => [view.id, nextId()]),
          );
          return [
            mapping.get(id),
            {
              initial: viewIds.get(views.initial) ?? null,
              saved: views.saved.map((view) => ({
                ...view,
                id: viewIds.get(view.id),
                targets: view.targets.map((target) => mapping.get(target)),
              })),
              readingOrder: views.readingOrder.map((target) =>
                mapping.get(target),
              ),
            },
          ];
        }),
      );
      return document;
    }
    const views = document.views ?? {
      initial: null,
      saved: [],
      readingOrder: [],
    };
    const viewIds = new Map(views.saved.map((view) => [view.id, nextId()]));
    document.views = {
      initial: viewIds.get(views.initial) ?? null,
      saved: views.saved.map((view) => ({
        ...view,
        id: viewIds.get(view.id),
        targets: view.targets.map((id) => mapping.get(id) ?? id),
      })),
      readingOrder: views.readingOrder.map((id) => mapping.get(id) ?? id),
    };
  }
  return document;
}

export function nodePaths(document) {
  const paths = {};
  const walk = (node, ancestors) => {
    if (node.attrs?.id) paths[node.attrs.id] = ancestors;
    const next = node.attrs?.id ? [...ancestors, node.attrs.id] : ancestors;
    node.content?.forEach((child) => walk(child, next));
  };
  walk(document.content, []);
  return paths;
}

export function placeTemplate(source, template, parentId = null) {
  if (isResource(source) || isResource(template))
    return insertResourceTemplate(source, template, parentId);
  const page = upgradeDocument(source),
    incoming = remapSurfaceIds(upgradeDocument(template));
  const parent = parentId
    ? findSurfaceNode(page, parentId)?.node
    : page.content;
  if (!parent || !["surface", "region"].includes(parent.type))
    throw new Error("Template destination must be a whiteboard or region.");
  const siblings = parent.content ?? [],
    roots = incoming.content.content ?? [];
  const offset = Math.max(
    0,
    ...siblings.map((node) => {
      const frame = page.layout[node.attrs.id];
      return frame ? frame.x + frame.width + 64 : 0;
    }),
  );
  const minX = roots.length
    ? Math.min(...roots.map((node) => incoming.layout[node.attrs.id].x))
    : 0;
  const minY = roots.length
    ? Math.min(...roots.map((node) => incoming.layout[node.attrs.id].y))
    : 0;
  for (const node of roots) {
    incoming.layout[node.attrs.id].x += offset - minX;
    incoming.layout[node.attrs.id].y -= minY;
  }
  parent.content = [...siblings, ...roots];
  Object.assign(page.layout, incoming.layout);
  page.views.saved.push(...incoming.views.saved);
  if (!parentId) page.views.readingOrder.push(...incoming.views.readingOrder);
  return reconcileSurface(page);
}
