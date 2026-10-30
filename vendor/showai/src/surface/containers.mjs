import { bindingParent } from "./geometry.mjs";
import { reconcileConnections } from "./connections.mjs";
import {
  assignSurfaceIds,
  findSurfaceNode,
  visitNodes,
  upgradeDocument,
  remapSurfaceIds,
} from "./document.mjs";

export const isResource = (document) =>
  document.content?.type === "surface" &&
  ["page", "board"].includes(document.content.attrs?.kind);
export const surfaceKind = (node) =>
  node.attrs?.kind === "board" ? "board" : "page";
export const emptyViews = (nodes = []) => ({
  initial: null,
  saved: [],
  readingOrder: nodes.map((node) => node.attrs.id),
});
export const surfaceViews = (document, node = document.content) =>
  document.surfaceViews?.[node.attrs?.id] ??
  document.views ??
  emptyViews(node.content);
export function createSurface(
  kind = "page",
  name = kind === "page" ? "Page" : "Board",
  id = crypto.randomUUID(),
) {
  if (!["page", "board"].includes(kind))
    throw new Error("Surface kind must be page or board.");
  return {
    type: "surface",
    attrs: { id, kind, name },
    content:
      kind === "page"
        ? [
            {
              type: "richText",
              attrs: { id: crypto.randomUUID(), name: "富文本" }, // i18n-exempt: default node name saved into documents
              content: [
                { type: "paragraph", attrs: { id: crypto.randomUUID() } },
              ],
            },
          ]
        : [],
  };
}
export function resourceNodes(document, node = document.content) {
  const children = node.content ?? [];
  if (surfaceKind(node) === "page" || node.type !== "surface") return children;
  const order = surfaceViews(document, node).readingOrder;
  const nodes = new Map(children.map((node) => [node.attrs?.id, node]));
  const ordered = new Set(order);
  return [
    ...order.map((id) => nodes.get(id)).filter(Boolean),
    ...children.filter((child) => !ordered.has(child.attrs.id)),
  ];
}
export function fillResource(document) {
  if (!isResource(document)) return document;
  assignSurfaceIds(document);
  document.layout = { ...(document.layout ?? {}) };
  document.surfaceViews = { ...(document.surfaceViews ?? {}) };
  if (document.views === undefined) delete document.views;
  visitNodes(document.content, (parent) => {
    if (!["surface", "region"].includes(parent.type)) return;
    if (
      parent.type === "surface" &&
      !Object.hasOwn(document.surfaceViews, parent.attrs.id)
    )
      document.surfaceViews[parent.attrs.id] = emptyViews(parent.content);
    let right = 0;
    for (const node of parent.content ?? []) {
      if (!node.attrs?.id) continue;
      const positioned =
        parent.type === "surface"
          ? surfaceKind(parent) === "board"
          : document.layout[parent.attrs.id]?.mode === "free";
      if (positioned || ["surface", "region"].includes(node.type)) {
        if (!Object.hasOwn(document.layout, node.attrs.id))
          document.layout[node.attrs.id] = {
            x: right,
            y: 0,
            width:
              node.type === "surface"
                ? 760
                : node.type === "region"
                  ? 920
                  : 360,
            ...(node.type === "surface"
              ? {
                  height: 460,
                  heightMode:
                    surfaceKind(node) === "page" && !positioned
                      ? "auto"
                      : "fixed",
                }
              : {}),
            ...(node.type === "region"
              ? { mode: "flow", columns: 2, gap: 24 }
              : {}),
          };
        const frame = document.layout[node.attrs.id];
        right = Math.max(right, frame.x + frame.width + 48);
      }
    }
  });
  return document;
}
/** Adapts old documents without changing source bytes. Old whiteboards keep their positions. */
export function upgradeResource(source, { includeTitle = true } = {}) {
  const page = structuredClone(source);
  if (isResource(page)) return fillResource(page);
  const rootId = (() => {
    const ids = new Set();
    visitNodes(page.content, (n) => {
      if (n.attrs?.id) ids.add(n.attrs.id);
    });
    const base = `surface-${page.id.slice(0, 150)}`;
    let id = base,
      suffix = 0;
    while (ids.has(id)) id = `${base}-${++suffix}`;
    return id;
  })();
  if (page.content.type === "doc") {
    assignSurfaceIds(page, { repairLegacy: true });
    const layout = {};
    const ids = new Set();
    visitNodes(page.content, (node) => {
      if (node.attrs?.id) ids.add(node.attrs.id);
    });
    const content = (page.content.content ?? []).map((node) => {
      if (!node.attrs?.canvas) return node;
      const frame = node.attrs.canvas;
      let boardId = `${node.attrs.id.slice(0, 170)}-board`;
      while (ids.has(boardId)) boardId += "-copy";
      ids.add(boardId);
      const region = {
        type: "region",
        attrs: { id: node.attrs.id, name: "内容区域" }, // i18n-exempt: default region name saved into documents
        content: node.content ?? [],
      };
      layout[region.attrs.id] = {
        x: frame.x ?? 0,
        y: frame.y ?? 0,
        width: frame.width ?? 1000,
        mode: "flow",
        columns: 2,
        gap: 24,
      };
      layout[boardId] = {
        x: 0,
        y: 0,
        width: frame.width ?? 760,
        height: frame.height ?? 460,
        heightMode: "fixed",
      };
      return {
        type: "surface",
        attrs: { id: boardId, kind: "board", name: "Board" },
        content: [region],
      };
    });
    page.content = {
      type: "surface",
      attrs: {
        id: rootId,
        kind: "page",
        name: includeTitle && page.title ? page.title.slice(0, 200) : "Page",
      },
      content,
    };
    page.layout = layout;
    page.surfaceViews = {};
  } else {
    const board = upgradeDocument(page, { includeTitle });
    Object.assign(page, board);
    const children = page.content.content ?? [];
    // A single flowing region is a document, even when an earlier version stored it on a surface.
    if (
      children.length === 1 &&
      children[0].type === "region" &&
      (page.layout[children[0].attrs.id]?.mode ?? "flow") === "flow"
    ) {
      page.content.attrs = {
        id: rootId,
        kind: "page",
        name: includeTitle && page.title ? page.title.slice(0, 200) : "Page",
      };
      page.surfaceViews = { [rootId]: page.views };
      delete page.views;
      return fillResource(page);
    }
    const ids = new Set();
    visitNodes(page.content, (node) => {
      if (node.attrs?.id) ids.add(node.attrs.id);
    });
    let boardId = `${rootId}-board`;
    while (ids.has(boardId)) boardId += "-copy";
    page.content.attrs = { id: boardId, kind: "board", name: "Board" };
    page.surfaceViews = { [boardId]: page.views };
    page.content = {
      type: "surface",
      attrs: {
        id: rootId,
        kind: "page",
        name: includeTitle && page.title ? page.title.slice(0, 200) : "Page",
      },
      content: [page.content],
    };
    page.layout[boardId] = {
      x: 0,
      y: 0,
      width: 920,
      height: 520,
      heightMode: "fixed",
    };
  }
  delete page.views;
  return fillResource(page);
}
export function reconcileResource(document) {
  fillResource(document);
  const nodes = new Map(),
    parents = new Map();
  visitNodes(document.content, (node, parent) => {
    if (node.attrs?.id) {
      nodes.set(node.attrs.id, node);
      parents.set(node.attrs.id, parent);
    }
  });
  for (const [id, frame] of Object.entries(document.layout)) {
    const node = nodes.get(id);
    if (!node || node === document.content) {
      delete document.layout[id];
      continue;
    }
    const next = { ...frame };
    if (!bindingParent(parents.get(id), document.layout)) delete next.rotation;
    if (node.type !== "region") {
      delete next.mode;
      delete next.columns;
      delete next.gap;
    }
    if (node.type !== "surface") delete next.heightMode;
    if (
      node.type === "drawing" ||
      (node.type === "surface" && next.heightMode !== "auto")
    )
      delete next.contentSize;
    if (JSON.stringify(frame) !== JSON.stringify(next))
      document.layout[id] = next;
  }
  for (const id of Object.keys(document.surfaceViews)) {
    const container = nodes.get(id);
    if (container?.type !== "surface") {
      delete document.surfaceViews[id];
      continue;
    }
    const local = new Set();
    visitNodes(container, (node) => {
      if (node.attrs?.id) local.add(node.attrs.id);
    });
    const roots = (container.content ?? []).map((node) => node.attrs.id);
    const rootIds = new Set(roots);
    const before = document.surfaceViews[id];
    const saved = before.saved
      .map((view) => ({
        ...view,
        targets: view.targets.filter(
          (target) => local.has(target) && target !== id,
        ),
      }))
      .filter((view) => view.targets.length);
    document.surfaceViews[id] = {
      ...before,
      initial: saved.some((view) => view.id === before.initial)
        ? before.initial
        : null,
      saved,
      readingOrder: [
        ...new Set([
          ...before.readingOrder.filter((target) => rootIds.has(target)),
          ...roots,
        ]),
      ],
    };
  }
  return reconcileConnections(document);
}
export function setSurfaceViews(source, id, views) {
  const document = upgradeResource(source);
  const target = findSurfaceNode(document, id)?.node;
  if (target?.type !== "surface")
    throw new Error("View owner must be a surface.");
  document.surfaceViews[id] = structuredClone(views);
  return document;
}
export function wrapSurface(source, id, kind) {
  const document = upgradeResource(source),
    target = findSurfaceNode(document, id);
  if (target?.node.type !== "surface")
    throw new Error("Only a Page or Board can be wrapped.");
  if (
    target.node === document.content &&
    document.title &&
    ["Page", "Board"].includes(target.node.attrs.name)
  )
    target.node.attrs.name = document.title.slice(0, 200);
  const wrapper = createSurface(kind);
  wrapper.content = [target.node];
  if (target.parent) {
    target.parent.content[target.parent.content.indexOf(target.node)] = wrapper;
    const frame = document.layout[id];
    if (frame)
      document.layout[wrapper.attrs.id] = {
        ...frame,
        ...(kind === "board"
          ? { heightMode: "fixed", height: frame.height ?? 460 }
          : {}),
      };
  } else document.content = wrapper;
  document.layout[id] = {
    x: 0,
    y: 0,
    width: 760,
    height: 520,
    heightMode:
      kind === "page" && surfaceKind(target.node) === "page" ? "auto" : "fixed",
  };
  return reconcileResource(document);
}
export function insertResourceTemplate(source, template, parentId) {
  const document = upgradeResource(source),
    incoming = remapSurfaceIds(upgradeResource(template));
  if (incoming.title && ["Page", "Board"].includes(incoming.content.attrs.name))
    incoming.content.attrs.name = incoming.title.slice(0, 200);
  const parent = parentId
    ? findSurfaceNode(document, parentId)?.node
    : document.content;
  if (!parent || !["surface", "region"].includes(parent.type))
    throw new Error("Template destination must be a container.");
  parent.content ??= [];
  const x = Math.max(
    0,
    ...parent.content.map((node) => {
      const f = document.layout[node.attrs.id];
      return f ? f.x + f.width + 48 : 0;
    }),
  );
  parent.content.push(incoming.content);
  Object.assign(document.layout, incoming.layout);
  document.layout[incoming.content.attrs.id] = {
    x,
    y: 0,
    width: 760,
    height: 520,
    heightMode:
      surfaceKind(parent) === "page" && surfaceKind(incoming.content) === "page"
        ? "auto"
        : "fixed",
  };
  Object.assign(document.surfaceViews, incoming.surfaceViews);
  return reconcileResource(document);
}
export function createResource(source, kind = "page") {
  const document = {
    ...structuredClone(source),
    content: createSurface(kind),
    layout: {},
    surfaceViews: {},
  };
  delete document.views;
  return fillResource(document);
}
