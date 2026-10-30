import type { JSONContent } from "@tiptap/core";
export const LABEL_TOOLS: readonly ["rectangle", "ellipse", "arrow"];
export const DEFAULT_LABEL_SIZE: number;
export const MAX_LABEL_LENGTH: number;
export const LABEL_LINE_HEIGHT: number;
export const LABEL_SIZES: readonly number[];
export function labelCapable(node?: JSONContent | null): boolean;
export function labelPadding(tool: string, strokeWidth?: number): number;
export function labelBox(
  tool: string,
  width: number,
  height: number,
  strokeWidth?: number,
): { x: number; y: number; width: number; height: number };
export function estimateLabel(
  text: string,
  fontSize?: number,
  maxWidth?: number,
): { width: number; height: number };
export function labelledShapeSize(
  tool: string,
  label?: string,
  fontSize?: number,
  strokeWidth?: number,
): { width: number; height: number };
export function labelFitHeight(
  tool: string,
  label: string,
  fontSize: number | undefined,
  width: number,
  strokeWidth?: number,
): number;
