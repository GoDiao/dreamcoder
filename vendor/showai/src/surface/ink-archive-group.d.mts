import type { JSONContent } from "@tiptap/core";
import type { NodeLayout } from "./types";
export interface InkArchiveGroup {
  version: 1;
  extent: [number, number];
  sourceDrawing: string;
}
export function inkArchiveGroup(node: JSONContent): InkArchiveGroup | null;
export function validateInkArchiveGroup(
  node: JSONContent,
): InkArchiveGroup | null;
export function inkArchiveGroupLayout(
  group: InkArchiveGroup,
  frame: NodeLayout,
): { width: number; height: number; scaleX: number; scaleY: number };
export function flattenInkArchiveChild(
  node: JSONContent,
  localFrame: NodeLayout,
  group: InkArchiveGroup,
  outerFrame: NodeLayout,
): { node: JSONContent; frame: NodeLayout };
