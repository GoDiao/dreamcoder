import type { JSONContent } from "@tiptap/core";
export function isBoardShape(node?: JSONContent | null): boolean;
export function boardFingerNavigates(
  pointerType: string,
  preferences: { native: boolean; device?: string; fingerDrawing: boolean },
): boolean;
export function fingerNavigatesBoard(pointerType: string): boolean;
