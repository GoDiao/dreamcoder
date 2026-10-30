import type { ShowDocument } from "../types";
import type { NodeLayout } from "./types";
import { indexSurfaceTree } from "./connections.mjs";
import { frameBounds } from "./geometry.mjs";
import { shapeIntersects } from "./drawing-geometry.mjs";

/** Only sibling annotations share a Page's coordinate system. Locked ink stays put. */
export function overlappingPageAnnotations(
  document: ShowDocument,
  moving: string[],
  measured: Record<string, NodeLayout>,
) {
  const index = indexSurfaceTree(document.content);
  const pages = moving.filter(
    (id) =>
      index.get(id)?.node.type === "surface" &&
      index.get(id)?.node.attrs?.kind === "page" &&
      measured[id],
  );
  return Object.keys(measured).filter((id) => {
    const entry = index.get(id);
    if (!entry || measured[id].locked || moving.includes(id)) return false;
    const node = entry.node;
    if (!(node.type === "drawing" || (node.attrs?.nativeInk ?? node.attrs?.data?.nativeInk))) return false;
    return pages.some(
      (page) =>
        index.get(page)?.parent === entry.parent &&
        shapeIntersects(node, measured[id], frameBounds(measured[page]), false),
    );
  });
}
