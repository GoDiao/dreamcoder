import type { Marked, TokenizerAndRendererExtension } from "marked";
export const mathExtensions: TokenizerAndRendererExtension[];
export const mathMarkdown: Marked;
export function mathHtml(source: string, display?: boolean): string;
