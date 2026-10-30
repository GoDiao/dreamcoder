import { applyOperations } from "../core/diff";
import { createResource } from "../surface/containers.mjs";
import type { ShowDocument } from "../core/model";
/** The shared shallow authoring path used by MCP page_create and native hosts. */
export function blocksDocument(
  blocks: { kind: string; data: Record<string, unknown> }[],
  title = "未命名页面",
  kind: "page" | "board" = "page",
): ShowDocument {
  const now = new Date().toISOString();
  const blank = createResource(
    {
      id: "pending",
      title,
      icon: "",
      cover: "none",
      parentId: null,
      favorite: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
      content: { type: "doc", content: [{ type: "paragraph" }] },
      comments: [],
    },
    kind,
  );
  // The blocks replace the empty starter text a new Page carries.
  for (const starter of blank.content.content ?? [])
    delete blank.layout?.[starter.attrs?.id];
  blank.content.content = [];
  return applyOperations(
    blank,
    blocks.map((block) => ({
      type: "component.insert" as const,
      kind: block.kind,
      data: block.data,
    })),
  );
}
