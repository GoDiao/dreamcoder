import type { JSONContent } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { ownSourceValue } from "../surface/source-runtime";

const serialized = new WeakMap<Node, JSONContent>();

/** ProseMirror nodes are immutable; unchanged subtrees keep their JSON identity. */
export function editorNodeJSON(node: Node): JSONContent {
  const cached = serialized.get(node);
  if (cached) return cached;
  const json: JSONContent = { type: node.type.name };
  if (Object.keys(node.attrs).length) json.attrs = node.attrs;
  if (node.content.size) {
    json.content = [];
    node.content.forEach((child) => json.content!.push(editorNodeJSON(child)));
  }
  if (node.marks.length) json.marks = node.marks.map((mark) => mark.toJSON());
  if (node.isText) json.text = node.text;
  // PM attrs may include mutable widget data: never freeze or publish their
  // aliases. Cached child JSON is already owned and remains shared.
  const snapshot = ownSourceValue(json);
  serialized.set(node, snapshot);
  return snapshot;
}

function sameNode(node: Node, json: JSONContent): boolean {
  const previous = serialized.get(node);
  if (previous === json) return true;
  if (
    !previous ||
    previous.type !== json.type ||
    previous.text !== json.text ||
    (previous.attrs !== json.attrs &&
      JSON.stringify(previous.attrs) !== JSON.stringify(json.attrs)) ||
    (previous.marks !== json.marks &&
      JSON.stringify(previous.marks) !== JSON.stringify(json.marks)) ||
    node.childCount !== (json.content?.length ?? 0)
  )
    return false;
  for (let index = 0; index < node.childCount; index++)
    if (!sameNode(node.child(index), json.content![index])) return false;
  return true;
}

/** A local echo needs no parsing; external changes still use position mapping. */
export function sameEditorContent(node: Node, json: JSONContent): boolean {
  if (
    json.type !== node.type.name ||
    node.childCount !== (json.content?.length ?? 0)
  )
    return false;
  for (let index = 0; index < node.childCount; index++)
    if (!sameNode(node.child(index), json.content![index])) return false;
  return true;
}
