import type { Node } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/core";
export interface TextInsertionPoint {
  before: JSONContent[];
  after: JSONContent[];
}
export function splitForComponent(
  document: Node,
  position: number,
): TextInsertionPoint {
  const before: JSONContent[] =
    document.cut(0, position).toJSON().content ?? [];
  const after: JSONContent[] = document.cut(position).toJSON().content ?? [];
  const empty = (node?: JSONContent): boolean =>
    (node?.type === "paragraph" && !node.content?.length) ||
    (node?.type === "richText" &&
      !Object.keys(node.attrs?.data ?? {}).length &&
      (node.content ?? []).every(empty));
  if (empty(before.at(-1))) before.pop();
  if (empty(after[0])) after.shift();
  const seen = new Set<string>();
  const unique = (node: JSONContent) => {
    const id = node.attrs?.id;
    if (id) {
      if (seen.has(id)) node.attrs = { ...node.attrs, id: crypto.randomUUID() };
      seen.add(node.attrs!.id);
    }
    node.content?.forEach(unique);
  };
  before.forEach(unique);
  after.forEach(unique);
  return { before, after };
}
