import type { JSONContent } from "@tiptap/core";
export const richTextFormats: string[];
export const richTextAlignments: readonly [
  "left",
  "center",
  "right",
  "justify",
];
export const richTextFonts: { value: string }[];
export function markdownToRichText(
  source: string,
  options?: { allowComponentBlocks?: boolean },
): JSONContent;
export function richTextDocument(data: Record<string, unknown>): JSONContent;
export function validateRichTextData(data: Record<string, unknown>): void;
export function createRichTextNode(
  data: Record<string, unknown>,
  id?: string,
): JSONContent;
export function richTextStyle(
  data?: Record<string, unknown>,
): import("react").CSSProperties;

export const primitiveNodeTypes: Readonly<Record<string, string>>;
export function primitiveContentNode(
  kind: string,
  data: Record<string, unknown>,
  id?: string,
): JSONContent;
export function normalizeContentTree(node: JSONContent): JSONContent;
