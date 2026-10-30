import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { LayoutMode, NodeLayout } from "./types";
import {
  findSurfaceNode,
  reconcileSurface,
  upgradeDocument,
  visitNodes,
} from "./document.mjs";
import { translator } from "../i18n";
import messages from "../i18n/messages/surface";
import { isOwnedSource, ownSourceValue } from "./source-runtime";

/** Text/widget transactions already carry schema-assigned IDs. Structural
 * commands retain explicit reconciliation; typing only copies its edited path. */
export interface NodeEditOptions {
  /** false skips normalization only while block structure stays unchanged. */
  normalize?: boolean;
  /** Mutable attribute record only; existing nested values/children stay
   * read-only. Replace a nested value with its own draft to edit it. */
  attributesOnly?: boolean;
}
/** Layout/view references follow block identities and hierarchy, not text,
 * inline marks or widget data. Only proven owned branches can skip comparison.
 * A structural edit still crosses the same COW reconciliation boundary used by
 * the structural commands; ordinary typing does not normalize the page. */
function sameStructure(before: JSONContent, after: JSONContent): boolean {
  if (before === after && isOwnedSource(before)) return true;
  if (before.type !== after.type || before.attrs?.id !== after.attrs?.id)
    return false;
  if (before.type === "surface" && before.attrs?.kind !== after.attrs?.kind)
    return false;
  if (before.content === after.content && isOwnedSource(before.content))
    return true;
  const previous = (before.content ?? []).filter((node) => node.type !== "text");
  const next = (after.content ?? []).filter((node) => node.type !== "text");
  return previous.length === next.length &&
    previous.every((node, index) => sameStructure(node, next[index]));
}
function finishEdit(before: ShowDocument, source: ShowDocument, options: NodeEditOptions) {
  return options.normalize === false && sameStructure(before.content, source.content)
    ? source
    : reconcileSurface(source, { clone: false });
}

const t = translator(messages);

// i18n-exempt: default region name saved into documents
export function createRegion(name = "内容区域", mode: LayoutMode = "flow") {
  const id = crypto.randomUUID();
  return {
    node: {
      type: "region",
      attrs: { id, name },
      content:
        mode === "flow"
          ? [{ type: "paragraph", attrs: { id: crypto.randomUUID() } }]
          : [],
    } as JSONContent,
    frame: {
      x: 0,
      y: 0,
      width: 920,
      mode,
      columns: 2,
      gap: 24,
    } satisfies NodeLayout,
  };
}

export function editNode(
  source: ShowDocument,
  id: string,
  update: (node: JSONContent) => void,
  options: NodeEditOptions = {},
) {
  let changed = false;
  const walk = (node: JSONContent): JSONContent => {
    if (node.attrs?.id === id) {
      const copy = options.attributesOnly
        ? { ...node, attrs: { ...node.attrs } }
        : structuredClone(node);
      update(copy);
      changed = true;
      return ownSourceValue(copy);
    }
    if (!node.content) return node;
    const children = node.content.map(walk);
    return children.some((child, index) => child !== node.content![index])
      ? { ...node, content: children }
      : node;
  };
  const content = walk(source.content);
  if (!changed) return source;
  return finishEdit(source, { ...source, content }, options);
}

export function replaceChildren(
  source: ShowDocument,
  parentId: string,
  ids: string[],
  replacement: JSONContent[],
  options: NodeEditOptions = {},
) {
  const selected = new Set(ids);
  let changed = false;
  const walk = (node: JSONContent): JSONContent => {
    if (node.attrs?.id !== parentId) {
      if (!node.content) return node;
      const content = node.content.map(walk);
      return content.some((child, index) => child !== node.content![index])
        ? { ...node, content }
        : node;
    }
    const content = node.content ?? [],
      start = content.findIndex((child) => selected.has(child.attrs?.id));
    const index = start < 0 ? content.length : start;
    const next = [
      ...content.slice(0, index),
      ...ownSourceValue(replacement),
      ...content.slice(index).filter((child) => !selected.has(child.attrs?.id)),
    ];
    if (
      next.length === content.length &&
      next.every((child, index) => child === content[index])
    )
      return node;
    changed = true;
    return { ...node, content: next };
  };
  const content = walk(source.content);
  return changed ? finishEdit(source, { ...source, content }, options) : source;
}

export function addNode(
  source: ShowDocument,
  node: JSONContent,
  frame: NodeLayout,
  parentId: string | null = null,
) {
  const document = upgradeDocument(source);
  const parent = parentId
    ? findSurfaceNode(document, parentId)?.node
    : document.content;
  if (!parent || !["surface", "region"].includes(parent.type ?? ""))
    throw new Error(t("error.regionMissing"));
  parent.content = [...(parent.content ?? []), node];
  document.layout![node.attrs!.id] = frame;
  return reconcileSurface(document);
}

export function removeNode<T extends ShowDocument>(source: T, id: string) {
  const document = structuredClone(source),
    target = findSurfaceNode(document, id);
  if (!target?.parent) return source;
  target.parent.content = target.parent.content!.filter(
    (node) => node.attrs?.id !== id,
  );
  return reconcileSurface(document);
}

export function moveNode<T extends ShowDocument>(
  source: T,
  id: string,
  parentId: string | null,
  frame?: NodeLayout,
  index?: number,
) {
  const document = structuredClone(source),
    target = findSurfaceNode(document, id);
  const parent = parentId
    ? findSurfaceNode(document, parentId)?.node
    : document.content;
  if (
    !target?.parent ||
    !parent ||
    !["surface", "region"].includes(parent.type ?? "")
  )
    throw new Error(t("error.cannotMove"));
  const descendants = new Set<string>();
  visitNodes(target.node, (node) => {
    if (node.attrs?.id) descendants.add(node.attrs.id);
  });
  if (parentId && descendants.has(parentId))
    throw new Error(t("error.regionIntoSelf"));
  target.parent.content = target.parent.content!.filter(
    (node) => node.attrs?.id !== id,
  );
  const children = parent.content ?? [];
  children.splice(index ?? children.length, 0, target.node);
  parent.content = children;
  if (frame) document.layout![id] = frame;
  return reconcileSurface(document);
}

export function detachBlock(
  source: ShowDocument,
  parentId: string,
  block: JSONContent,
  frame: NodeLayout,
) {
  const document = structuredClone(source),
    parent = findSurfaceNode(document, parentId)?.node;
  if (!parent) return source;
  parent.content = parent.content?.filter(
    (node) => node.attrs?.id !== block.attrs?.id,
  );
  const node: JSONContent = ["widget", "image"].includes(block.type ?? "")
    ? block
    : {
        type: "richText",
        attrs: { id: crypto.randomUUID(), name: "文本" }, // i18n-exempt: default node name saved into documents
        content: [block],
      };
  return addNode(document, node, frame);
}

export function regionOptions(document: ShowDocument, excludedId?: string) {
  const excluded = new Set<string>();
  const node = excludedId && findSurfaceNode(document, excludedId)?.node;
  if (node)
    visitNodes(node, (item) => {
      if (item.attrs?.id) excluded.add(item.attrs.id);
    });
  const result: { id: string; name: string }[] = [];
  visitNodes(document.content, (item) => {
    if (item.type === "region" && !excluded.has(item.attrs!.id))
      result.push({
        id: item.attrs!.id,
        name: item.attrs?.name || t("node.region"),
      });
  });
  return result;
}

export interface DeletedNode {
  node: JSONContent;
  parentId: string | null;
  index: number;
  layout: NonNullable<ShowDocument["layout"]>;
  views: NonNullable<ShowDocument["views"]>;
}
export function captureDeletion(
  document: ShowDocument,
  id: string,
): DeletedNode | undefined {
  const target = findSurfaceNode(document, id);
  if (!target?.parent) return;
  const ids = new Set<string>();
  visitNodes(target.node, (node) => {
    if (node.attrs?.id) ids.add(node.attrs.id);
  });
  return {
    node: structuredClone(target.node),
    parentId: target.parent.type === "surface" ? null : target.parent.attrs!.id,
    index: target.parent.content!.indexOf(target.node),
    layout: Object.fromEntries(
      Object.entries(document.layout ?? {}).filter(([key]) => ids.has(key)),
    ),
    views: structuredClone(document.views!),
  };
}
export function restoreDeletion(source: ShowDocument, deleted: DeletedNode) {
  if (findSurfaceNode(source, deleted.node.attrs!.id)) return source;
  const document = structuredClone(source);
  const parent =
    (deleted.parentId && findSurfaceNode(document, deleted.parentId)?.node) ||
    document.content;
  parent.content ??= [];
  parent.content.splice(deleted.index, 0, structuredClone(deleted.node));
  Object.assign(document.layout!, deleted.layout);
  const restoredIds = new Set<string>();
  visitNodes(deleted.node, (node) => {
    if (node.attrs?.id) restoredIds.add(node.attrs.id);
  });
  for (const previous of deleted.views.saved) {
    const targets = previous.targets.filter((id) => restoredIds.has(id));
    if (!targets.length) continue;
    const current = document.views!.saved.find(
      (view) => view.id === previous.id,
    );
    if (current)
      current.targets = [...new Set([...current.targets, ...targets])];
    else document.views!.saved.push(structuredClone(previous));
  }
  if (
    !document.views!.initial &&
    document.views!.saved.some((view) => view.id === deleted.views.initial)
  )
    document.views!.initial = deleted.views.initial;
  const id = deleted.node.attrs!.id;
  if (parent.type === "surface") {
    const order = document.views!.readingOrder.filter((entry) => entry !== id);
    const index = deleted.views.readingOrder.indexOf(id);
    order.splice(index < 0 ? order.length : index, 0, id);
    document.views!.readingOrder = order;
  }
  return reconcileSurface(document);
}
