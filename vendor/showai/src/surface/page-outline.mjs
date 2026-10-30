/** Portable Page outline contract. Derived trees never become stored page content. */
export const PAGE_OUTLINE_PROTOCOL = 1;
const reserved = new Set(["__proto__", "prototype", "constructor"]);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const id = (value, limit = 200) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  !reserved.has(value);
const text = (node) => node.text ?? (node.content ?? []).map(text).join("");
export function defaultPageOutline() {
  return {
    version: 1,
    enabled: true,
    source: { mode: "headings", maxLevel: 3 },
    initialState: "auto",
    placement: "auto",
    width: 220,
  };
}
export function pageOutlineNodes(page) {
  const nodes = new Map();
  function visit(node) {
    if (node.attrs?.id) nodes.set(node.attrs.id, node);
    if (["surface", "widget", "stepper"].includes(node.type)) return;
    node.content?.forEach(visit);
  }
  page.content?.forEach(visit);
  return nodes;
}
export function validatePageOutline(value, page) {
  const fail = (message) => {
    throw new Error(`Page outline: ${message}`);
  };
  if (page.type !== "surface" || page.attrs?.kind !== "page")
    fail("only Page can have an outline.");
  if (
    !object(value) ||
    value.version !== 1 ||
    typeof value.enabled !== "boolean"
  )
    fail("requires version 1 and enabled.");
  if (!["auto", "expanded", "collapsed"].includes(value.initialState))
    fail("invalid initialState.");
  if (!["auto", "floating", "docked"].includes(value.placement))
    fail("invalid placement.");
  if (!Number.isFinite(value.width) || value.width < 180 || value.width > 480)
    fail("width must be 180–480.");
  if (value.renderer !== undefined) {
    const r = value.renderer;
    if (
      !object(r) ||
      typeof r.componentId !== "string" ||
      typeof r.version !== "string" ||
      typeof r.integrity !== "string" ||
      !/^[a-z][a-z0-9-]{0,79}$/.test(r.componentId) ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\w.-]+)?$/.test(
        r.version,
      ) ||
      !/^sha256-[a-f0-9]{64}$/.test(r.integrity) ||
      !object(r.props)
    )
      fail("renderer requires an exact component revision and props.");
    if (
      r.scope !== undefined &&
      !["builtin", "project", "global", "published"].includes(r.scope)
    )
      fail("invalid renderer scope.");
  }
  const source = value.source;
  if (!object(source)) fail("source is required.");
  if (source.mode === "headings") {
    if (
      !Number.isInteger(source.maxLevel) ||
      source.maxLevel < 1 ||
      source.maxLevel > 6
    )
      fail("maxLevel must be 1–6.");
    if (source.overrides !== undefined) {
      if (!object(source.overrides)) fail("overrides must be an object.");
      for (const [key, override] of Object.entries(source.overrides)) {
        if (
          !id(key) ||
          !object(override) ||
          (override.title !== undefined &&
            (typeof override.title !== "string" ||
              override.title.length > 2000)) ||
          (override.hidden !== undefined &&
            typeof override.hidden !== "boolean")
        )
          fail("invalid heading override.");
      }
    }
  } else if (source.mode === "manual") {
    const ids = new Set();
    let count = 0;
    const visit = (entries, depth = 0) => {
      if (!Array.isArray(entries) || depth > 24)
        fail("manual entries must be a tree up to 24 levels.");
      for (const entry of entries) {
        if (
          ++count > 3000 ||
          !object(entry) ||
          !id(entry.id, 240) ||
          ids.has(entry.id)
        )
          fail("manual entries require unique IDs (at most 3000).");
        ids.add(entry.id);
        if (
          entry.title !== undefined &&
          (typeof entry.title !== "string" || entry.title.length > 2000)
        )
          fail("invalid entry title.");
        if (entry.nodeId !== undefined && !id(entry.nodeId))
          fail("invalid entry target.");
        if (!entry.nodeId && !entry.title?.trim())
          fail("groups require a title.");
        if (entry.children !== undefined) visit(entry.children, depth + 1);
      }
    };
    visit(source.entries);
  } else fail("source mode must be headings or manual.");
  return value;
}
export function buildPageOutline(page, config = page.attrs?.outline) {
  if (!config || page.attrs?.kind !== "page")
    return { items: [], targets: new Map(), missing: [] };
  const nodes = pageOutlineNodes(page),
    targets = new Map(),
    missing = [];
  const title = (node) =>
    (text(node).trim() || node.attrs?.name || node.type || "").slice(0, 2000);
  if (config.source.mode === "manual") {
    const visit = (entries, level) =>
      entries.flatMap((entry) => {
        const node = entry.nodeId ? nodes.get(entry.nodeId) : undefined;
        if (entry.nodeId && !node) missing.push(entry.id);
        const unnamedMissing = !!entry.nodeId && !node && !entry.title?.trim();
        const children = visit(
          entry.children ?? [],
          unnamedMissing ? level : level + 1,
        );
        if (unnamedMissing) return children;
        if (!node && !children.length) return [];
        if (node) targets.set(entry.id, entry.nodeId);
        return [
          {
            id: entry.id,
            navigable: !!node,
            title: entry.title?.trim() || (node ? title(node) : ""),
            level,
            children,
          },
        ];
      });
    return { items: visit(config.source.entries, 1), targets, missing };
  }
  const items = [],
    stack = [];
  for (const [nodeId, node] of nodes) {
    if (node.type !== "heading" || node.attrs.level > config.source.maxLevel)
      continue;
    const override = config.source.overrides?.[nodeId];
    const label = (override?.title ?? text(node)).trim();
    const hidden = !!override?.hidden || !label;
    const item = {
      id: `heading:${nodeId}`,
      navigable: true,
      hidden,
      title: label.slice(0, 2000),
      level: node.attrs.level,
      children: [],
    };
    while (stack.length && stack.at(-1).level >= item.level) stack.pop();
    (stack.at(-1)?.children ?? items).push(item);
    stack.push(item);
    if (!hidden) targets.set(item.id, nodeId);
  }
  const project = (values) =>
    values.flatMap(({ hidden, ...item }) => {
      const children = project(item.children);
      return hidden ? children : [{ ...item, children }];
    });
  return { items: project(items), targets, missing };
}
export function flattenOutline(items) {
  return items.flatMap((item) => [item, ...flattenOutline(item.children)]);
}
/** Copies remap identities; projections remove targets outside their retained Page. */
export function remapPageOutline(config, mapping, nextId) {
  const next = structuredClone(config);
  if (next.source.mode === "headings" && next.source.overrides) {
    next.source.overrides = Object.fromEntries(
      Object.entries(next.source.overrides).flatMap(([id, value]) =>
        mapping.has(id) ? [[mapping.get(id), value]] : [],
      ),
    );
  } else if (next.source.mode === "manual") {
    const visit = (entries) =>
      entries.flatMap((entry) => {
        const children = visit(entry.children ?? []);
        const nodeId = entry.nodeId ? mapping.get(entry.nodeId) : undefined;
        if (entry.nodeId && !nodeId && !children.length) return [];
        return [
          {
            id: nextId ? nextId() : entry.id,
            ...(entry.title !== undefined
              ? { title: entry.title }
              : entry.nodeId && !nodeId
                ? { title: entry.nodeId }
                : {}),
            ...(nodeId ? { nodeId } : {}),
            ...(children.length ? { children } : {}),
          },
        ];
      });
    next.source.entries = visit(next.source.entries);
  }
  return next;
}
export function outlinePlacement({
  width,
  gutter,
  panelWidth,
  widthMode,
  preferred = "auto",
  pinned = false,
  previous,
}) {
  if (
    width < 640 ||
    ((pinned || preferred === "docked") && width - panelWidth < 560)
  )
    return "drawer";
  if (pinned || preferred === "docked") return "docked";
  if (preferred === "floating" || widthMode === "full") return "floating";
  return gutter >= panelWidth + 16 + (previous === "margin" ? 0 : 24)
    ? "margin"
    : "floating";
}
