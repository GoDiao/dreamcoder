import type { JSONContent } from "@tiptap/core";
import { canonicalJson } from "./canonical";
import {
  mergeText,
  mergeValues,
  rebaseHistoryText,
  type MergeChoices,
} from "./catalog-merge";
import { validateDocument } from "../portable/validation.mjs";
import type { ShowDocument } from "./model";
import type { MergeConflict } from "../components/custom/types";
import { finishInkPageMerge, InkWireError, prepareInkPageMerge } from "../surface/ink-wire.mjs";

interface FlatNode {
  parent: string | null;
  node: JSONContent;
  children: string[];
}
interface FlatPage {
  readingOrders: Record<string, string[]>;
  fields: Record<string, unknown>;
  root: string;
  nodes: Record<string, FlatNode>;
}
export interface PageMergeConflict {
  path: string;
  kind: "value" | "text" | "structure";
  reason?: string;
  /** Fully retained ink variants may travel in the canonical page in-place. */
  domain?: "ink";
  retained?: boolean;
  ink?: { boardId?: string; strokeId?: string; field: string };
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
}
export interface PageMergeResult {
  document: ShowDocument;
  conflicts: PageMergeConflict[];
}

function flatten(document: ShowDocument): FlatPage {
  const nodes: Record<string, FlatNode> = Object.create(null);
  const visit = (node: JSONContent, parent: string | null): string => {
    const id = node.attrs?.id;
    if (typeof id !== "string" || !id || Object.hasOwn(nodes, id))
      throw new Error("Page merge requires unique stable node IDs.");
    const own = structuredClone(node);
    delete own.content;
    nodes[id] = { parent, node: own, children: [] };
    const children = node.content ?? [];
    if (
      !["paragraph", "heading", "codeBlock"].includes(node.type ?? "") &&
      children.some((child) => child.type !== "text")
    ) {
      nodes[id].children = children.map((child) => visit(child, id));
    } else if (node.content) nodes[id].node.content = structuredClone(children);
    return id;
  };
  const { content, updatedAt: _time, ...metadata } = document;
  const fields = structuredClone(metadata) as Record<string, unknown>;
  const readingOrders: Record<string, string[]> = Object.create(null);
  for (const [id, view] of Object.entries(
    (fields.surfaceViews as Record<string, { readingOrder?: string[] }>) ?? {},
  )) {
    readingOrders[id] = view.readingOrder ?? [];
    delete view.readingOrder;
  }
  return { fields, readingOrders, root: visit(content, null), nodes };
}

const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function textContent(
  value: JSONContent[] | undefined,
): { text: string; marks: unknown } | undefined {
  const items = value ?? [];
  if (
    !items.every(
      (item) => item.type === "text" && typeof item.text === "string",
    )
  )
    return undefined;
  const marks = items[0]?.marks;
  if (!items.every((item) => equal(item.marks, marks))) return undefined;
  return { text: items.map((item) => item.text).join(""), marks };
}

/** Order is separate from node identity; divergent moves stay explicit conflicts. */
function mergeOrder(
  base: string[],
  ours: string[],
  theirs: string[],
  members: Set<string>,
): { order: string[]; conflict: boolean } {
  const b = base.filter((id) => members.has(id));
  const o = ours.filter((id) => members.has(id));
  const t = theirs.filter((id) => members.has(id));
  const baseIds = new Set(base);
  const reorder = (side: string[]) => {
    const present = new Set(side);
    return !equal(
      side.filter((id) => baseIds.has(id)),
      base.filter((id) => present.has(id) && members.has(id)),
    );
  };
  const leftMoved = reorder(o),
    rightMoved = reorder(t);
  const preferred = leftMoved ? o : rightMoved ? t : b;
  if (
    leftMoved &&
    rightMoved &&
    !equal(
      o.filter((id) => baseIds.has(id)),
      t.filter((id) => baseIds.has(id)),
    )
  )
    return { order: [...new Set([...o, ...t, ...members])], conflict: true };
  const edges = new Map<string, Set<string>>(
    [...members].map((id) => [id, new Set()]),
  );
  const connect = (side: string[], additionsOnly: boolean) => {
    for (let index = 1; index < side.length; index++)
      if (
        !additionsOnly ||
        !baseIds.has(side[index - 1]) ||
        !baseIds.has(side[index])
      )
        edges.get(side[index - 1])!.add(side[index]);
  };
  connect(preferred, false);
  connect(o, !leftMoved);
  connect(t, !rightMoved);
  const rank = [...new Set([...preferred, ...o, ...t, ...members])];
  const priority = new Map(rank.map((id, index) => [id, index]));
  const degrees = new Map([...members].map((id) => [id, 0]));
  for (const children of edges.values())
    for (const child of children) degrees.set(child, degrees.get(child)! + 1);
  const ready: string[] = [];
  const insert = (id: string) => {
    let left = 0,
      right = ready.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (priority.get(ready[middle])! < priority.get(id)!) left = middle + 1;
      else right = middle;
    }
    ready.splice(left, 0, id);
  };
  for (const [id, degree] of degrees) if (degree === 0) insert(id);
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const child of edges.get(id)!) {
      const degree = degrees.get(child)! - 1;
      degrees.set(child, degree);
      if (degree === 0) insert(child);
    }
  }
  if (order.length !== members.size) return { order: rank, conflict: true };
  return { order, conflict: false };
}

export function mergePageContent(
  base: ShowDocument,
  ours: ShowDocument,
  theirs: ShowDocument,
  mode: "merge" | "history" = "merge",
  choices: MergeChoices = {},
): PageMergeResult {
  if (base.id !== ours.id || ours.id !== theirs.id)
    throw new Error("Page merge inputs must identify the same page.");
  const originalInputs = { base, ours, theirs };
  if (Object.hasOwn(choices, "/structure"))
    return {
      document: structuredClone(
        choices["/structure"] === "ours" ? ours : theirs,
      ),
      conflicts: [],
    };
  let inkPrepared;
  try { inkPrepared = mode === "merge" ? prepareInkPageMerge(base, ours, theirs) : null; }
  catch (error) {
    if (!(error instanceof InkWireError)) throw error;
    return { document: structuredClone(ours), conflicts: [{ path: "/ink", kind: "value", reason: error.message }] };
  }
  if (inkPrepared) { base = inkPrepared.base; ours = inkPrepared.ours; theirs = inkPrepared.theirs; }
  const b = flatten(base),
    o = flatten(ours),
    t = flatten(theirs);
  const metadata = mergeValues(b.fields, o.fields, t.fields, "/page", choices);
  const root = mergeValues(b.root, o.root, t.root, "/root", choices);
  const conflicts: PageMergeConflict[] = [
    ...metadata.conflicts,
    ...root.conflicts,
  ];
  const nodes: Record<string, FlatNode> = Object.create(null);
  for (const id of new Set([
    ...Object.keys(b.nodes),
    ...Object.keys(o.nodes),
    ...Object.keys(t.nodes),
  ])) {
    const before = b.nodes[id],
      left = o.nodes[id],
      right = t.nodes[id];
    const strip = (entry: FlatNode | undefined) =>
      entry ? { parent: entry.parent, node: entry.node } : undefined;
    const previous = strip(before),
      local = strip(left),
      remote = strip(right);
    let mergedText: string | undefined;
    const bt = textContent(before?.node.content),
      ot = textContent(left?.node.content),
      tt = textContent(right?.node.content);
    if (
      before &&
      left &&
      right &&
      ["paragraph", "heading", "codeBlock"].includes(before.node.type ?? "") &&
      bt &&
      ot &&
      tt &&
      equal(bt.marks, ot.marks) &&
      equal(ot.marks, tt.marks)
    ) {
      mergedText =
        ot.text === tt.text || bt.text === tt.text
          ? ot.text
          : bt.text === ot.text
            ? tt.text
            : mode === "history"
              ? rebaseHistoryText(bt.text, tt.text, ot.text)
              : mergeText(bt.text, ot.text, tt.text, "characters");
      if (mergedText !== undefined) {
        delete previous!.node.content;
        delete local!.node.content;
        delete remote!.node.content;
      }
    }
    const merged = mergeValues(
      previous,
      local,
      remote,
      `/nodes/${id}`,
      choices,
    );
    conflicts.push(...merged.conflicts);
    if (merged.value !== undefined) {
      const entry = merged.value as Omit<FlatNode, "children">;
      if (mergedText !== undefined)
        entry.node.content = mergedText
          ? [
              {
                type: "text",
                text: mergedText,
                ...(bt!.marks
                  ? { marks: bt!.marks as JSONContent["marks"] }
                  : {}),
              },
            ]
          : [];
      nodes[id] = { ...entry, children: [] };
    }
  }
  const childGroups = new Map<string, Set<string>>();
  for (const [id, entry] of Object.entries(nodes))
    if (entry.parent !== null) {
      const group = childGroups.get(entry.parent) ?? new Set<string>();
      group.add(id);
      childGroups.set(entry.parent, group);
    }
  for (const [id, entry] of Object.entries(nodes)) {
    const members = childGroups.get(id) ?? new Set<string>();
    const merged = mergeOrder(
      b.nodes[id]?.children ?? [],
      o.nodes[id]?.children ?? [],
      t.nodes[id]?.children ?? [],
      members,
    );
    const orderChoice = choices[`/nodes/${id}/order`];
    entry.children = orderChoice
      ? [
          ...new Set([
            ...((orderChoice === "ours" ? o : t).nodes[id]?.children ?? []),
            ...merged.order,
          ]),
        ].filter((child) => members.has(child))
      : merged.order;
    if (merged.conflict && !orderChoice)
      conflicts.push({
        path: `/nodes/${id}/order`,
        kind: "structure",
        base: b.nodes[id]?.children,
        ours: o.nodes[id]?.children,
        theirs: t.nodes[id]?.children,
      });
  }
  const fields = metadata.value as ShowDocument;
  fields.surfaceViews ??= {};
  for (const [id, entry] of Object.entries(nodes))
    if (entry.node.type === "surface") {
      const members = new Set(entry.children);
      const reading =
        entry.node.attrs?.kind === "page"
          ? { order: entry.children, conflict: false }
          : mergeOrder(
              b.readingOrders[id] ?? [],
              o.readingOrders[id] ?? [],
              t.readingOrders[id] ?? [],
              members,
            );
      fields.surfaceViews[id] ??= {
        initial: null,
        saved: [],
        readingOrder: [],
      };
      const readingChoice = choices[`/surfaceViews/${id}/readingOrder`];
      fields.surfaceViews[id].readingOrder = readingChoice
        ? [
            ...new Set([
              ...((readingChoice === "ours" ? o : t).readingOrders[id] ?? []),
              ...reading.order,
            ]),
          ].filter((child) => members.has(child))
        : reading.order;
      if (reading.conflict && !readingChoice)
        conflicts.push({
          path: `/surfaceViews/${id}/readingOrder`,
          kind: "structure",
          base: b.readingOrders[id],
          ours: o.readingOrders[id],
          theirs: t.readingOrders[id],
        });
    }
  const visited = new Set<string>();
  const assemble = (
    id: string,
    parent: string | null,
    depth: number,
  ): JSONContent => {
    const entry = nodes[id];
    if (!entry || entry.parent !== parent || visited.has(id) || depth > 64)
      throw new Error(
        "Merged page has missing parents, duplicate ownership or a cycle.",
      );
    visited.add(id);
    return {
      ...entry.node,
      ...(entry.children.length
        ? {
            content: entry.children.map((child) =>
              assemble(child, id, depth + 1),
            ),
          }
        : {}),
    };
  };
  let document: ShowDocument;
  try {
    document = {
      ...(metadata.value as ShowDocument),
      updatedAt: ours.updatedAt,
      content: assemble(root.value as string, null, 0),
    };
    if (visited.size !== Object.keys(nodes).length)
      throw new Error("Merged page contains detached nodes.");
    if (inkPrepared) {
      const projected = finishInkPageMerge(document, inkPrepared);
      document = projected.document;
      conflicts.push(...projected.conflicts.map(conflict => ({
        path: `/ink/${conflict.boardId ?? "board"}/${conflict.strokeId ?? ""}/${conflict.field}`,
        kind: "value" as const, reason: conflict.reason, domain: "ink" as const,
        retained: conflict.retained,
        ink: { boardId: conflict.boardId, strokeId: conflict.strokeId, field: conflict.field },
      })));
    }
    document = validateDocument(document);
  } catch (error) {
    // A structurally invalid merge remains a visible conflict and an intact local draft.
    conflicts.push({
      path: "/structure",
      kind: "structure",
      base: originalInputs.base.content,
      ours: originalInputs.ours.content,
      theirs: originalInputs.theirs.content,
    });
    if (
      !(error instanceof Error) ||
      error instanceof TypeError ||
      error instanceof ReferenceError
    )
      throw error;
    conflicts[conflicts.length - 1].reason = error.message;
    document = structuredClone(originalInputs.ours);
  }
  return { document, conflicts };
}

export function canCommitPageMerge(result: Pick<PageMergeResult, "conflicts">): boolean {
  return result.conflicts.every(conflict => conflict.domain === "ink" && conflict.retained === true);
}

export function describeMergeConflict(
  conflict: MergeConflict | PageMergeConflict,
): string {
  return `${conflict.path}: ${conflict.kind === "structure" ? "结构或顺序冲突" : conflict.kind === "text" ? "文字冲突" : "字段冲突"}`;
}
