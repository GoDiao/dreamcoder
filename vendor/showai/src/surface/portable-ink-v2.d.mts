import type { PortableInkV2, CubicInkCapture } from "./portable-ink.mjs";
export const CUBIC_INK_FORMAT: "showai-ink-v2";
export const DEFAULT_OUTLINE_TOLERANCE: number;
export function validateCubicInk(ink: unknown): PortableInkV2;
export function validateCubicInkCapture(
  capture: unknown,
  width: number,
): CubicInkCapture;
