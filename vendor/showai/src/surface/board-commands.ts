import {
  inkArchiveGroup,
  flattenInkArchiveChild,
} from "./ink-archive-group.mjs";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { NodeLayout } from "./types";
import { canonicalJson } from "../core/canonical";
import {
  indexSurfaceTree,
  type ArrowBindings,
  transformedBindings,
} from "./connections.mjs";
import { reconcileSurface, visitNodes } from "./document.mjs";

/** One logical transform, with untouched nodes and frames retaining identity. */
export function transformObjects<T extends ShowDocument>(
  source: T,
  frames: Record<string, NodeLayout>,
): T {
  const index = indexSurfaceTree(source.content);
  for (const id of Object.keys(frames)) {
    if (!index.get(id)?.parent || !source.layout?.[id])
      throw new Error(`Object has no editable frame: ${id}`);
  }
  const replace = new Map<string, JSONContent>();
  for (const id of Object.keys(frames)) {
    const resized = rescaledDrawing(
      index.get(id)!.node,
      source.layout![id],
      frames[id],
    );
    if (resized) replace.set(id, resized);
  }
  for (const id of Object.keys(frames)) {
    const node = replace.get(id) ?? index.get(id)!.node;
    if (
      node.type !== "drawing" ||
      node.attrs?.tool !== "arrow" ||
      !node.attrs.bindings
    )
      continue;
    const bindings = transformedBindings(
      node.attrs.bindings,
      new Set(Object.keys(frames)),
    );
    const attrs = { ...node.attrs };
    if (Object.keys(bindings).length) attrs.bindings = bindings;
    else delete attrs.bindings;
    replace.set(id, { ...node, attrs });
  }
  const walk = (node: JSONContent): JSONContent => {
    if (replace.has(node.attrs?.id)) return replace.get(node.attrs!.id)!;
    if (!node.content) return node;
    const content = node.content.map(walk);
    return content.some((child, i) => child !== node.content![i])
      ? { ...node, content }
      : node;
  };
  return reconcileSurface(
    {
      ...source,
      content: replace.size ? walk(source.content) : source.content,
      layout: { ...source.layout, ...frames },
      surfaceViews: { ...source.surfaceViews },
    },
    { clone: false },
  );
}

/**
 * A resized drawing keeps its stroke: points are rescaled into a viewbox with
 * the frame's own proportions, so the SVG never stretches line widths unevenly.
 */
export function rescaledDrawing(
  node: JSONContent,
  before: NodeLayout,
  after: NodeLayout,
): JSONContent | null {
  if (
    node.type !== "drawing" ||
    node.attrs?.tool === "arrow" ||
    node.attrs?.ink ||
    !Array.isArray(node.attrs?.extent)
  )
    return null;
  const width = after.width,
    height = after.height ?? before.height;
  if (
    !height ||
    (Math.abs(width - before.width) < 1e-6 &&
      Math.abs(height - (before.height ?? height)) < 1e-6)
  )
    return null;
  const [ex, ey] = node.attrs.extent as [number, number];
  const extent: [number, number] = [Math.max(1, width), Math.max(1, height)];
  const sx = extent[0] / ex,
    sy = extent[1] / ey;
  if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) return null;
  return {
    ...node,
    attrs: {
      ...node.attrs,
      extent,
      points: (node.attrs.points as { x: number; y: number }[]).map((p) => ({
        x: p.x * sx,
        y: p.y * sy,
      })),
    },
  };
}

/** A self-contained copy of sibling objects, independent of the source document. */
export interface BoardClip {
  format: "showai-board-clip";
  version: 1;
  nodes: JSONContent[];
  layout: Record<string, NodeLayout>;
  surfaceViews: NonNullable<ShowDocument["surfaceViews"]>;
}

/** Selected roots only; descendants travel inside their parent's subtree. */
function selectionRoots(
  index: ReturnType<typeof indexSurfaceTree>,
  ids: string[],
) {
  const selected = new Set(ids);
  return ids.filter((id) => {
    let parent = index.get(id)?.parent;
    while (parent) {
      if (selected.has(parent.attrs?.id)) return false;
      parent = index.get(parent.attrs?.id)?.parent ?? null;
    }
    return !!index.get(id);
  });
}

export function copyObjects(source: ShowDocument, ids: string[]): BoardClip {
  const index = indexSurfaceTree(source.content);
  const nodes = selectionRoots(index, ids).map((id) =>
    structuredClone(index.get(id)!.node),
  );
  const layout: BoardClip["layout"] = {},
    surfaceViews: BoardClip["surfaceViews"] = {};
  for (const node of nodes)
    visitNodes(node, (child) => {
      const id = child.attrs?.id;
      if (!id) return;
      if (source.layout?.[id]) layout[id] = structuredClone(source.layout[id]);
      if (source.surfaceViews?.[id])
        surfaceViews[id] = structuredClone(source.surfaceViews[id]);
    });
  return {
    format: "showai-board-clip",
    version: 1,
    nodes,
    layout,
    surfaceViews,
  };
}

export function isBoardClip(value: unknown): value is BoardClip {
  const clip = value as BoardClip;
  return (
    !!clip &&
    clip.format === "showai-board-clip" &&
    clip.version === 1 &&
    Array.isArray(clip.nodes) &&
    clip.nodes.every((node) => typeof node?.attrs?.id === "string") &&
    !!clip.layout &&
    typeof clip.layout === "object"
  );
}

/** Insert a clip with fresh identities; connections survive only between copied objects. */
export function pasteObjects<T extends ShowDocument>(
  source: T,
  parentId: string,
  clip: BoardClip,
  offset = { x: 24, y: 24 },
): { document: T; ids: string[] } {
  if (!clip.nodes.length) return { document: source, ids: [] };
  const document = structuredClone(source),
    target = indexSurfaceTree(document.content).get(parentId)?.node;
  if (!target || !["surface", "region"].includes(target.type ?? ""))
    throw new Error("Paste destination must be a container.");
  const mapping = new Map<string, string>(),
    copies = clip.nodes.map((node) => structuredClone(node)),
    roots = new Set(copies.map((node) => node.attrs!.id as string));
  for (const copy of copies)
    visitNodes(copy, (node) => {
      if (node.attrs?.id) {
        const id = crypto.randomUUID();
        mapping.set(node.attrs.id, id);
        node.attrs = { ...node.attrs, id };
      }
    });
  for (const copy of copies)
    visitNodes(copy, (node) => {
      if (!node.attrs?.bindings) return;
      const bindings: ArrowBindings = {};
      for (const key of ["start", "end"] as const) {
        const binding = node.attrs.bindings[key],
          targetId = binding && mapping.get(binding.targetId);
        if (targetId) bindings[key] = { ...binding, targetId };
      }
      if (Object.keys(bindings).length) node.attrs.bindings = bindings;
      else delete node.attrs.bindings;
    });
  document.layout ??= {};
  document.surfaceViews ??= {};
  for (const [old, id] of mapping) {
    const frame = clip.layout[old];
    if (frame)
      document.layout[id] = {
        ...structuredClone(frame),
        ...(roots.has(old)
          ? { x: frame.x + offset.x, y: frame.y + offset.y }
          : {}),
      };
    const views = clip.surfaceViews?.[old];
    if (views) {
      const viewIds = new Map(
        views.saved.map((v) => [v.id, crypto.randomUUID()]),
      );
      document.surfaceViews[id] = {
        initial: viewIds.get(views.initial!) ?? null,
        saved: views.saved.map((v) => ({
          ...v,
          id: viewIds.get(v.id)!,
          targets: v.targets
            .map((target) => mapping.get(target)!)
            .filter(Boolean),
        })),
        readingOrder: views.readingOrder
          .map((target) => mapping.get(target)!)
          .filter(Boolean),
      };
    }
  }
  target.content = [...(target.content ?? []), ...copies];
  return {
    document: reconcileSurface(document),
    ids: copies.map((node) => node.attrs!.id as string),
  };
}

export function duplicateObjects<T extends ShowDocument>(
  source: T,
  ids: string[],
  offset = { x: 24, y: 24 },
): { document: T; ids: string[] } {
  const index = indexSurfaceTree(source.content),
    roots = selectionRoots(index, ids);
  if (!roots.length) return { document: source, ids: [] };
  const parent = index.get(roots[0])?.parent;
  if (!parent || roots.some((id) => index.get(id)?.parent !== parent))
    throw new Error("Copy selection must share a parent.");
  return pasteObjects(
    source,
    parent.attrs!.id,
    copyObjects(source, roots),
    offset,
  );
}

export type StackOrder = "forward" | "backward" | "front" | "back";

/** Paint order is sibling order. Moves keep the relative order of the selection. */
export function reorderObjects<T extends ShowDocument>(
  source: T,
  ids: string[],
  order: StackOrder,
): T {
  const index = indexSurfaceTree(source.content),
    parent = index.get(ids[0])?.parent;
  if (!parent?.content || ids.some((id) => index.get(id)?.parent !== parent))
    return source;
  const selected = new Set(ids),
    children = [...parent.content];
  let next: JSONContent[];
  if (order === "front" || order === "back") {
    const moving = children.filter((node) => selected.has(node.attrs?.id)),
      rest = children.filter((node) => !selected.has(node.attrs?.id));
    next = order === "front" ? [...rest, ...moving] : [...moving, ...rest];
  } else {
    next = children;
    const forward = order === "forward";
    const positions = next
      .map((node, i) => (selected.has(node.attrs?.id) ? i : -1))
      .filter((i) => i >= 0);
    if (!forward) positions.reverse();
    for (const i of positions) {
      const j = forward ? i + 1 : i - 1;
      if (j < 0 || j >= next.length || selected.has(next[j].attrs?.id))
        continue;
      [next[i], next[j]] = [next[j], next[i]];
    }
  }
  if (next.every((node, i) => node === parent.content![i])) return source;
  const parentId = parent.attrs!.id;
  const walk = (node: JSONContent): JSONContent => {
    if (node.attrs?.id === parentId) return { ...node, content: next };
    if (!node.content) return node;
    const content = node.content.map(walk);
    return content.some((child, i) => child !== node.content![i])
      ? { ...node, content }
      : node;
  };
  return reconcileSurface(
    {
      ...source,
      content: walk(source.content),
      layout: { ...source.layout },
      surfaceViews: { ...source.surfaceViews },
    },
    { clone: false },
  );
}

export type AlignMode =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "distribute-x"
  | "distribute-y";
type Box = { x: number; y: number; width: number; height: number };

/** Translations that align or evenly space visual bounds; frames keep their size. */
export function alignOffsets(
  boxes: Record<string, Box>,
  mode: AlignMode,
): Record<string, { x: number; y: number }> {
  const entries = Object.entries(boxes);
  const result: Record<string, { x: number; y: number }> = {};
  if (entries.length < 2) return result;
  const left = Math.min(...entries.map(([, b]) => b.x)),
    right = Math.max(...entries.map(([, b]) => b.x + b.width)),
    top = Math.min(...entries.map(([, b]) => b.y)),
    bottom = Math.max(...entries.map(([, b]) => b.y + b.height));
  if (mode === "distribute-x" || mode === "distribute-y") {
    const horizontal = mode === "distribute-x";
    if (entries.length < 3) return result;
    const sorted = [...entries].sort(([, a], [, b]) =>
      horizontal ? a.x - b.x : a.y - b.y,
    );
    const total = sorted.reduce(
      (sum, [, b]) => sum + (horizontal ? b.width : b.height),
      0,
    );
    const gap =
      ((horizontal ? right - left : bottom - top) - total) /
      (sorted.length - 1);
    let cursor = horizontal ? left : top;
    for (const [id, b] of sorted) {
      result[id] = horizontal
        ? { x: cursor - b.x, y: 0 }
        : { x: 0, y: cursor - b.y };
      cursor += (horizontal ? b.width : b.height) + gap;
    }
    return result;
  }
  for (const [id, b] of entries)
    result[id] = {
      x:
        mode === "left"
          ? left - b.x
          : mode === "right"
            ? right - b.x - b.width
            : mode === "center"
              ? (left + right) / 2 - b.x - b.width / 2
              : 0,
      y:
        mode === "top"
          ? top - b.y
          : mode === "bottom"
            ? bottom - b.y - b.height
            : mode === "middle"
              ? (top + bottom) / 2 - b.y - b.height / 2
              : 0,
    };
  return result;
}

/** Move sibling objects into a free region, keeping their position on the Board. */
export function adoptIntoRegion<T extends ShowDocument>(
  source: T,
  regionId: string,
  ids: string[],
  contentOffset: { x: number; y: number },
): T {
  const document = structuredClone(source),
    index = indexSurfaceTree(document.content),
    region = index.get(regionId);
  const frame = document.layout?.[regionId];
  if (!region?.parent || region.node.type !== "region" || !frame) return source;
  const moving = ids.filter(
    (id) =>
      id !== regionId &&
      index.get(id)?.parent === region.parent &&
      !!document.layout?.[id],
  );
  if (!moving.length) return source;
  const selected = new Set(moving);
  region.parent.content = region.parent.content!.filter(
    (node) => !selected.has(node.attrs?.id),
  );
  region.node.content = [
    ...(region.node.content ?? []),
    ...moving.map((id) => index.get(id)!.node),
  ];
  for (const id of moving) {
    const child = document.layout![id];
    document.layout![id] = {
      ...child,
      x: child.x - frame.x - contentOffset.x,
      y: child.y - frame.y - contentOffset.y,
    };
  }
  return reconcileSurface(document);
}

/** Wrap siblings in a new free region sized to their visual bounds. */
export function groupObjects<T extends ShowDocument>(
  source: T,
  ids: string[],
  bounds: Box,
  contentOffset: { x: number; y: number },
  name = "区域", // i18n-exempt: default region name saved into documents
): { document: T; id: string } | null {
  const index = indexSurfaceTree(source.content),
    roots = selectionRoots(index, ids),
    parent = index.get(roots[0])?.parent;
  if (
    !roots.length ||
    !parent ||
    roots.some((id) => index.get(id)?.parent !== parent)
  )
    return null;
  const document = structuredClone(source),
    id = crypto.randomUUID();
  const container = indexSurfaceTree(document.content).get(
    parent.attrs!.id,
  )!.node;
  // The region takes the stacking position of the selection's top object.
  const lastIndex = Math.max(
    ...roots.map((root) =>
      container.content!.findIndex((node) => node.attrs?.id === root),
    ),
  );
  container.content!.splice(lastIndex + 1, 0, {
    type: "region",
    attrs: { id, name },
    content: [],
  });
  document.layout![id] = {
    x: bounds.x - contentOffset.x,
    y: bounds.y - contentOffset.y,
    width: Math.max(120, bounds.width + contentOffset.x * 2),
    height: Math.max(40, bounds.height + contentOffset.y * 2),
    mode: "free",
    gap: 24,
  };
  const grouped = adoptIntoRegion(
    reconcileSurface(document),
    id,
    roots,
    contentOffset,
  );
  return { document: grouped, id };
}

/** Return a free region's children to its parent at the same Board position. */
export function ungroupRegion<T extends ShowDocument>(
  source: T,
  regionId: string,
  contentOffset: { x: number; y: number },
): { document: T; ids: string[] } | null {
  const document = structuredClone(source),
    index = indexSurfaceTree(document.content),
    region = index.get(regionId),
    frame = document.layout?.[regionId];
  if (
    !region?.parent ||
    region.node.type !== "region" ||
    frame?.mode !== "free"
  )
    return null;
  const archive = inkArchiveGroup(region.node);
  const children = (region.node.content ?? []).map((child) => {
    if (!archive) return child;
    const local = document.layout![child.attrs!.id];
    if (!local) throw new Error("Archive child has no frame");
    const flattened = flattenInkArchiveChild(child, local, archive, frame);
    document.layout![child.attrs!.id] = flattened.frame;
    return flattened.node;
  });
  const position = region.parent.content!.indexOf(region.node);
  region.parent.content!.splice(position, 1, ...children);
  const ids: string[] = [];
  for (const child of children) {
    const id = child.attrs?.id,
      local = id && document.layout?.[id];
    if (!local) continue;
    ids.push(id);
    document.layout![id] = {
      ...local,
      x: archive ? local.x : local.x + frame.x + contentOffset.x,
      y: archive ? local.y : local.y + frame.y + contentOffset.y,
    };
  }
  return { document: reconcileSurface(document), ids };
}

/** Locked objects keep their frame against pointer gestures until unlocked. */
export function setObjectsLocked<T extends ShowDocument>(
  source: T,
  ids: string[],
  locked: boolean,
): T {
  const layout = { ...source.layout };
  let changed = false;
  for (const id of ids) {
    const frame = layout[id];
    if (!frame || !!frame.locked === locked) continue;
    const next = { ...frame };
    if (locked) next.locked = true;
    else delete next.locked;
    layout[id] = next;
    changed = true;
  }
  return changed
    ? reconcileSurface(
        { ...source, layout, surfaceViews: { ...source.surfaceViews } },
        { clone: false },
      )
    : source;
}

export function removeObjects<T extends ShowDocument>(
  source: T,
  ids: string[],
): T {
  const selected = new Set(ids);
  const walk = (node: JSONContent): JSONContent => {
    if (!node.content) return node;
    const content = node.content
      .filter((child) => !selected.has(child.attrs?.id))
      .map(walk);
    return content.length !== node.content.length ||
      content.some((child, i) => child !== node.content![i])
      ? { ...node, content }
      : node;
  };
  return reconcileSurface(
    {
      ...source,
      content: walk(source.content),
      layout: { ...source.layout },
      surfaceViews: { ...source.surfaceViews },
    },
    { clone: false },
  );
}

/** Preserve independent edits; reject changes to the gesture's geometry or ancestry. */
export function canCommitBoardGesture(
  original: ShowDocument,
  latest: ShowDocument | undefined,
  ids: string[],
) {
  if (!latest) return false;
  const same = (a: unknown, b: unknown) =>
    a === b || canonicalJson(a) === canonicalJson(b);
  const index = indexSurfaceTree(original.content),
    latestIndex = indexSurfaceTree(latest.content),
    frames = new Set<string>();
  for (const id of ids) {
    if (!latest.layout?.[id]) return false;
    let entry = index.get(id);
    if (!entry) return false;
    // A fixed Page/Board's contents do not determine its outer frame, and a
    // transform writes only that frame. Its latest contents can stay intact.
    const fixedSurface =
      entry.node.type === "surface" &&
      original.layout?.[id]?.heightMode !== "auto";
    if (!fixedSurface && !same(entry.node, latestIndex.get(id)?.node))
      return false;
    while (entry) {
      const key: string | undefined = entry.node.attrs?.id;
      const actual: ReturnType<typeof latestIndex.get> = key
        ? latestIndex.get(key)
        : undefined;
      if (
        !actual ||
        entry.node.type !== actual.node.type ||
        !same(entry.node.attrs, actual.node.attrs) ||
        entry.parent?.attrs?.id !== actual.parent?.attrs?.id
      )
        return false;
      if (key && (original.layout?.[key] || latest.layout?.[key]))
        frames.add(key);
      entry = entry.parent?.attrs?.id
        ? index.get(entry.parent.attrs.id)
        : undefined;
    }
  }
  return [...frames].every((id) =>
    same(original.layout?.[id], latest.layout?.[id]),
  );
}

/** Selection stays among siblings in the active Board's explicit coordinate layers. */
export function boardSelectionScope(
  index: ReturnType<typeof indexSurfaceTree>,
  layout: ShowDocument["layout"],
  surfaceId: string | undefined,
  id: string,
) {
  const parent = index.get(id)?.parent;
  if (!parent || !surfaceId) return null;
  if (parent.type === "surface")
    return parent.attrs?.id === surfaceId && parent.attrs?.kind === "board"
      ? surfaceId
      : null;
  if (parent.type !== "region" || layout?.[parent.attrs!.id]?.mode !== "free")
    return null;
  let owner: JSONContent | null = parent;
  while (owner && owner.type !== "surface")
    owner = index.get(owner.attrs?.id)?.parent ?? null;
  return owner?.attrs?.id === surfaceId ? (parent.attrs!.id as string) : null;
}
