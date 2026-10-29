import type { JSONContent } from "@tiptap/core";
import type { BoardTool, DrawingStyle, NodeLayout } from "./types";
import type { Point, SnapIndex } from "./geometry.mjs";
export function finishBoardDrawing(
  tool: BoardTool,
  style: DrawingStyle,
  gesture: {
    origin: Point;
    release: Point;
    points: Point[];
    scale: number;
    moved: boolean;
    snap?: SnapIndex;
  },
  modifiers?: {
    shiftKey?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  },
): { node: JSONContent; frame: NodeLayout };
