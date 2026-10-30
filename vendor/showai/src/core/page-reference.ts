import type { JSONContent } from "@tiptap/core";
import type { AgentTarget } from "../agent-host/types";
import type { CanvasReference } from "../surface/agent-reference";
import type { ShowDocument } from "../types";
import { visitNodes } from "../surface/document.mjs";
import { richTextDocument } from "../components/rich-text/model.mjs";
import { plainText } from "../lib/document";

/** A person's explicit pointer at saved page content, handed to an Agent
 * conversation. It stays small: the Agent reads details by these IDs. */
export interface PageReference {
  type: "showai.reference";
  version: 1;
  kind: "selection" | "board" | "page";
  projectId: string;
  pageId: string;
  title: string;
  hash: string;
  revision?: string;
  /** Page blocks, addressable with page_read blockIds. */
  blockIds?: string[];
  /** Board objects; page_read blockIds or board_read element nodeId. */
  nodeIds?: string[];
  /** The Board (board_read boardId) the reference belongs to. */
  surfaceId?: string;
  /** Short text labels so the Agent and the person recognise the target. */
  labels: string[];
  position?: CanvasReference;
}

export const referenceLimits = { ids: 100, labels: 20, labelChars: 160 };

const clean = (text: string) =>
  text.replace(/\s+/g, " ").trim().slice(0, referenceLimits.labelChars);

function richTextChildren(node: JSONContent): JSONContent[] {
  if (node.type !== "widget" || node.attrs?.kind !== "text") return [];
  const data = node.attrs.data;
  return data && typeof data === "object"
    ? (richTextDocument(data).content ?? [])
    : [];
}

/** One label per text block of the referenced subtrees, in reading order. */
function collectLabels(node: JSONContent, labels: string[]) {
  if (labels.length >= referenceLimits.labels) return;
  const inner = richTextChildren(node);
  if (inner.length) {
    for (const child of inner) collectLabels(child, labels);
    return;
  }
  if (node.content?.some((child) => child.type === "text")) {
    const text = clean(plainText(node));
    if (text) labels.push(text);
    return;
  }
  for (const child of node.content ?? []) collectLabels(child, labels);
}

/** Map editor IDs to IDs page_read can address: text inside a rich text
 * component resolves to that component. Unknown IDs are reported. */
export function addressableIds(document: ShowDocument, ids: string[]) {
  const nodes = new Map<string, JSONContent>();
  const owners = new Map<string, string>();
  visitNodes(document.content, (node) => {
    const id = node.attrs?.id;
    if (typeof id !== "string" || ["doc", "text"].includes(node.type ?? ""))
      return;
    nodes.set(id, node);
    for (const child of richTextChildren(node))
      visitNodes(child, (inner) => {
        if (typeof inner.attrs?.id === "string") owners.set(inner.attrs.id, id);
      });
  });
  const resolved: string[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const target = nodes.has(id) ? id : owners.get(id);
    if (!target) missing.push(id);
    else if (!resolved.includes(target)) resolved.push(target);
  }
  return { ids: resolved, missing, nodes };
}

/** Build the reference to a saved page record from the target the built-in
 * Agent also receives. Text selections keep the selected text as labels. */
export function pageReference(
  projectId: string,
  record: { document: ShowDocument; hash: string; revision?: string },
  target: AgentTarget,
): PageReference {
  const { document } = record;
  const { ids, missing, nodes } = addressableIds(
    document,
    target.blockIds ?? [],
  );
  if (missing.length)
    throw new Error(
      `Referenced content is not in the saved page: ${missing.join(", ")}`,
    );
  if (target.surfaceId && !nodes.has(target.surfaceId))
    throw new Error(
      `Referenced Board is not in the saved page: ${target.surfaceId}`,
    );
  const labels: string[] = [];
  if (target.kind === "text" && target.text) {
    for (const line of target.text.split("\n")) {
      const text = clean(line);
      if (text && labels.length < referenceLimits.labels) labels.push(text);
    }
  } else {
    const scope = ids.length
      ? ids.map((id) => nodes.get(id)!)
      : [(target.surfaceId && nodes.get(target.surfaceId)) || document.content];
    for (const node of scope) collectLabels(node, labels);
  }
  const selected = ids.slice(0, referenceLimits.ids);
  const kind =
    target.kind === "board" ? "board" : selected.length ? "selection" : "page";
  return {
    type: "showai.reference",
    version: 1,
    kind,
    projectId,
    pageId: document.id,
    title: document.title,
    hash: record.hash,
    ...(record.revision ? { revision: record.revision } : {}),
    ...(selected.length
      ? kind === "board"
        ? { nodeIds: selected }
        : { blockIds: selected }
      : {}),
    ...(target.surfaceId ? { surfaceId: target.surfaceId } : {}),
    labels,
    ...(target.reference ? { position: target.reference } : {}),
  };
}

/** Opens the page in the desktop app and highlights the referenced content. */
export function referenceLink(reference: PageReference) {
  const ids =
    reference.blockIds ??
    reference.nodeIds ??
    (reference.surfaceId ? [reference.surfaceId] : []);
  const link = `showai://project/${encodeURIComponent(reference.projectId)}/page/${encodeURIComponent(reference.pageId)}`;
  return ids.length
    ? `${link}?blocks=${ids.map(encodeURIComponent).join(",")}`
    : link;
}

/** Short version label for people; Agents compare the full hash/revision. */
export const referenceVersion = (reference: PageReference) =>
  (reference.revision ?? reference.hash).slice(0, 7);

/** Paste-ready text: a heading for people, the app link and one JSON line. */
export function formatReference(reference: PageReference, heading: string) {
  return `${heading}\n${referenceLink(reference)}\n${JSON.stringify(reference)}`;
}
