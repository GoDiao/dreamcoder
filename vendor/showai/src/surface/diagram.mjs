import { graphlib, layout as dagreLayout } from "@dagrejs/dagre";
import { bindingParent, frameHeight, objectCapabilities } from "./geometry.mjs";
import { indexSurfaceTree } from "./connections.mjs";
import { DEFAULT_DRAWING_COLOR, facingAnchor } from "./drawing-completion.mjs";
import {
  DEFAULT_LABEL_SIZE,
  estimateLabel,
  labelledShapeSize,
} from "./drawing-label.mjs";

const rankdir = { right: "LR", down: "TB", left: "RL", up: "BT" };
const shapeNames = { rectangle: "矩形", ellipse: "椭圆", arrow: "箭头" }; // i18n-exempt: saved default names

/**
 * Lay out a directed graph with dagre. Returns top-left positions so the
 * graph's bounding box starts at `origin`.
 */
export function layoutGraph(
  nodes,
  edges,
  { direction = "right", origin = { x: 0, y: 0 }, spacing = {} } = {},
) {
  if (!rankdir[direction])
    throw new Error("Diagram direction must be right, down, left or up.");
  const graph = new graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: rankdir[direction],
    nodesep: spacing.node ?? 48,
    ranksep: spacing.rank ?? 96,
    edgesep: 24,
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes)
    graph.setNode(node.id, { width: node.width, height: node.height });
  edges.forEach((edge, i) => {
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) return;
    const size = edge.label
      ? estimateLabel(edge.label, edge.labelSize ?? DEFAULT_LABEL_SIZE, 200)
      : { width: 0, height: 0 };
    graph.setEdge(
      edge.from,
      edge.to,
      { width: size.width + 12, height: size.height + 8, labelpos: "c" },
      edge.id ?? `edge-${i}`,
    );
  });
  dagreLayout(graph);
  const placed = nodes.map((node) => {
    const point = graph.node(node.id);
    return {
      id: node.id,
      x: point.x - node.width / 2,
      y: point.y - node.height / 2,
    };
  });
  const left = Math.min(...placed.map((p) => p.x)),
    top = Math.min(...placed.map((p) => p.y));
  return Object.fromEntries(
    placed.map((p) => [
      p.id,
      {
        x: Math.round(origin.x + p.x - left),
        y: Math.round(origin.y + p.y - top),
      },
    ]),
  );
}

const text = (value, path, max = 2000) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${path} must be non-empty text of at most ${max} characters.`);
  return value;
};
const number = (value, path, min, max) => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${path} must be a number from ${min} to ${max}.`);
  return value;
};
const identifier = (value, path) => {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new Error(`${path} must be a stable id of at most 200 characters.`);
  return value;
};

/**
 * Expand a nodes-and-edges description into native Board shapes and bound
 * arrows. Missing positions come from an automatic layout; missing sizes fit
 * the label. Returns the ids of the created shapes (framed) and arrows.
 */
export function insertDiagram(document, operation) {
  const index = indexSurfaceTree(document.content);
  const parent =
    operation.parentId == null
      ? document.content
      : index.get(operation.parentId)?.node;
  if (!parent)
    throw new Error(`Container ${operation.parentId} does not exist.`);
  document.layout ??= {};
  if (
    !bindingParent(parent, document.layout) ||
    (parent.type === "surface" && parent.attrs?.kind !== "board")
  )
    throw new Error(
      "diagram.insert needs a Board or a free-layout region as its parent.",
    );
  const nodes = operation.nodes,
    edges = operation.edges ?? [];
  if (!Array.isArray(nodes) || !nodes.length || nodes.length > 200)
    throw new Error("diagram.insert needs 1–200 nodes.");
  if (!Array.isArray(edges) || edges.length > 400)
    throw new Error("diagram.insert accepts at most 400 edges.");
  const used = new Set(index.keys());
  const created = new Set();
  const shapes = nodes.map((input, i) => {
    const path = `nodes[${i}]`;
    if (!input || typeof input !== "object")
      throw new Error(`${path} must be an object.`);
    const id = identifier(input.id, `${path}.id`);
    if (used.has(id)) throw new Error(`${path}.id ${id} is already in use.`);
    used.add(id);
    created.add(id);
    const shape = input.shape ?? "rectangle";
    if (!["rectangle", "ellipse"].includes(shape))
      throw new Error(`${path}.shape must be rectangle or ellipse.`);
    const label = text(input.label, `${path}.label`);
    const labelSize = number(input.labelSize, `${path}.labelSize`, 8, 160);
    const strokeWidth = number(input.strokeWidth, `${path}.strokeWidth`, 0.5, 40) ?? 2;
    const estimate = labelledShapeSize(
      shape,
      label,
      labelSize ?? DEFAULT_LABEL_SIZE,
      strokeWidth,
    );
    return {
      id,
      shape,
      label,
      labelSize,
      strokeWidth,
      name: text(input.name, `${path}.name`, 200),
      color: input.color,
      fillColor: input.fillColor,
      x: number(input.x, `${path}.x`, -1000000, 1000000),
      y: number(input.y, `${path}.y`, -1000000, 1000000),
      width: number(input.width, `${path}.width`, 1, 10000) ?? estimate.width,
      height: number(input.height, `${path}.height`, 1, 10000) ?? estimate.height,
    };
  });
  const positioned = shapes.filter(
    (shape) => shape.x !== undefined && shape.y !== undefined,
  ).length;
  if (positioned && positioned !== shapes.length)
    throw new Error(
      "Give every diagram node both x and y, or none of them for automatic layout.",
    );
  const siblings = new Set(
    (parent.content ?? [])
      .filter(
        (child) =>
          document.layout[child.attrs?.id] && objectCapabilities(child).bindTarget,
      )
      .map((child) => child.attrs.id),
  );
  const links = edges.map((input, i) => {
    const path = `edges[${i}]`;
    if (!input || typeof input !== "object")
      throw new Error(`${path} must be an object.`);
    for (const key of ["from", "to"]) {
      const id = identifier(input[key], `${path}.${key}`);
      if (!created.has(id) && !siblings.has(id))
        throw new Error(
          `${path}.${key} must name a node in this diagram or a framed object in the same container: ${id}.`,
        );
    }
    if (input.from === input.to)
      throw new Error(`${path} must connect two different objects.`);
    let id =
      input.id === undefined
        ? `${input.from}-to-${input.to}`.slice(0, 200)
        : identifier(input.id, `${path}.id`);
    if (input.id !== undefined && used.has(id))
      throw new Error(`${path}.id ${id} is already in use.`);
    for (let n = 2; used.has(id); n++) id = `${input.from}-to-${input.to}-${n}`;
    used.add(id);
    return {
      id,
      from: input.from,
      to: input.to,
      label: text(input.label, `${path}.label`),
      labelSize: number(input.labelSize, `${path}.labelSize`, 8, 160),
      strokeWidth: number(input.strokeWidth, `${path}.strokeWidth`, 0.5, 40),
      name: text(input.name, `${path}.name`, 200),
      color: input.color,
    };
  });
  let origin = operation.origin;
  if (origin !== undefined) {
    if (!origin || typeof origin !== "object")
      throw new Error("diagram.insert origin must be {x, y}.");
    origin = {
      x: number(origin.x, "origin.x", -1000000, 1000000) ?? 0,
      y: number(origin.y, "origin.y", -1000000, 1000000) ?? 0,
    };
  }
  let positions;
  if (positioned) {
    const offset = origin ?? { x: 0, y: 0 };
    positions = Object.fromEntries(
      shapes.map((s) => [s.id, { x: offset.x + s.x, y: offset.y + s.y }]),
    );
  } else {
    if (!origin) {
      const frames = [...siblings].map((id) => document.layout[id]);
      origin = frames.length
        ? {
            x: Math.max(...frames.map((f) => f.x + f.width)) + 120,
            y: Math.min(...frames.map((f) => f.y)),
          }
        : { x: 0, y: 0 };
    }
    if (operation.spacing !== undefined && (typeof operation.spacing !== "object" || !operation.spacing))
      throw new Error("diagram.insert spacing must be {node?, rank?}.");
    positions = layoutGraph(
      shapes,
      links.filter((l) => created.has(l.from) && created.has(l.to)),
      {
        direction: operation.direction ?? "right",
        origin,
        spacing: {
          node: number(operation.spacing?.node, "spacing.node", 0, 2000),
          rank: number(operation.spacing?.rank, "spacing.rank", 0, 2000),
        },
      },
    );
  }
  const content = (parent.content ??= []);
  for (const shape of shapes) {
    const attrs = {
      id: shape.id,
      name: shape.name ?? shape.label?.split("\n")[0].slice(0, 60) ?? shapeNames[shape.shape],
      tool: shape.shape,
      color: shape.color ?? DEFAULT_DRAWING_COLOR,
      fillColor: shape.fillColor ?? "none",
      strokeWidth: shape.strokeWidth,
      extent: [shape.width, shape.height],
      points: [
        { x: 0, y: 0 },
        { x: shape.width, y: shape.height },
      ],
    };
    if (shape.label) attrs.label = shape.label;
    if (shape.labelSize !== undefined) attrs.labelSize = shape.labelSize;
    content.push({ type: "drawing", attrs });
    document.layout[shape.id] = {
      ...positions[shape.id],
      width: shape.width,
      height: shape.height,
    };
  }
  for (const link of links) {
    const attrs = {
      id: link.id,
      name: link.name ?? link.label?.split("\n")[0].slice(0, 60) ?? shapeNames.arrow,
      tool: "arrow",
      color: link.color ?? DEFAULT_DRAWING_COLOR,
      fillColor: "none",
      strokeWidth: link.strokeWidth ?? 2,
      bindings: { start: { targetId: link.from }, end: { targetId: link.to } },
    };
    if (link.label) attrs.label = link.label;
    if (link.labelSize !== undefined) attrs.labelSize = link.labelSize;
    content.push({ type: "drawing", attrs });
  }
  return {
    document,
    shapeIds: shapes.map((s) => s.id),
    arrowIds: links.map((l) => l.id),
  };
}

/**
 * New frames for selected objects arranged along the arrows that connect
 * them, plus arrow anchors facing each other in the new arrangement. The
 * selection keeps its top-left corner. Returns null when fewer than two
 * connected objects are selected.
 */
export function tidyFrames(document, ids, direction = "right") {
  const index = indexSurfaceTree(document.content);
  const layout = document.layout ?? {};
  const nodes = ids
    .map((id) => index.get(id))
    .filter(
      (entry) =>
        entry &&
        layout[entry.node.attrs.id] &&
        objectCapabilities(entry.node).bindTarget &&
        !layout[entry.node.attrs.id].locked,
    );
  if (nodes.length < 2) return null;
  const parent = nodes[0].parent;
  if (nodes.some((entry) => entry.parent !== parent)) return null;
  const members = new Set(nodes.map((entry) => entry.node.attrs.id));
  const edges = (parent.content ?? [])
    .filter(
      (child) =>
        child.type === "drawing" &&
        child.attrs?.tool === "arrow" &&
        members.has(child.attrs.bindings?.start?.targetId) &&
        members.has(child.attrs.bindings?.end?.targetId),
    )
    .map((child) => ({
      id: child.attrs.id,
      from: child.attrs.bindings.start.targetId,
      to: child.attrs.bindings.end.targetId,
      label: child.attrs.label,
      labelSize: child.attrs.labelSize,
    }));
  if (!edges.length) return null;
  const current = nodes.map((entry) => layout[entry.node.attrs.id]);
  const origin = {
    x: Math.min(...current.map((f) => f.x)),
    y: Math.min(...current.map((f) => f.y)),
  };
  const positions = layoutGraph(
    nodes.map((entry) => ({
      id: entry.node.attrs.id,
      width: layout[entry.node.attrs.id].width,
      height: frameHeight(layout[entry.node.attrs.id]),
    })),
    edges,
    { direction, origin },
  );
  const frames = Object.fromEntries(
    nodes.map((entry) => {
      const id = entry.node.attrs.id;
      return [id, { ...layout[id], ...positions[id] }];
    }),
  );
  const middle = (frame) => ({
    x: frame.x + frame.width / 2,
    y: frame.y + frameHeight(frame) / 2,
  });
  const anchors = Object.fromEntries(
    edges.map((edge) => [
      edge.id,
      {
        start: facingAnchor(frames[edge.from], middle(frames[edge.to])),
        end: facingAnchor(frames[edge.to], middle(frames[edge.from])),
      },
    ]),
  );
  return { frames, anchors };
}
