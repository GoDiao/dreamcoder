import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { NodeLayout } from "./types";
/** Pure COW append; does not normalize or certify the supplied body. */
export function appendNewPortableInk<T extends ShowDocument>(
  target: T,
  boardId: string,
  node: JSONContent,
  frame: NodeLayout,
): T;
/** Uses an actual source drawing/frame; existing target edits win. */
export function appendPortableInkFromSource<T extends ShowDocument>(
  target: T,
  source: ShowDocument,
  boardId: string,
  strokeId: string,
): T;
