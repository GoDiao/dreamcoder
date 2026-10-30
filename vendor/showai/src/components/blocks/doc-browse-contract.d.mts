export type { InlineSegment } from "./inline-markup.mjs";
export {
  isSafeHref,
  isExternalHref,
  parseInline,
  plainInline,
} from "./inline-markup.mjs";

export type StructureKind = "dir" | "file" | "object" | "array" | "field";
export interface StructureNode {
  name: string;
  kind?: StructureKind;
  type?: string;
  badge?: string;
  summary?: string;
  detail?: string;
  example?: string;
  exampleLang?: string;
  children?: StructureNode[];
  open?: boolean;
}
export interface StructureItem {
  node: StructureNode;
  path: string;
  depth: number;
  parent: string | null;
  kind: StructureKind;
  children: string[];
}

export type CardTone = "brand" | "teal" | "warm" | "violet" | "rose" | "slate";
export interface CardGridData {
  title?: string;
  variant?: "tile" | "row";
  columns?: number;
  cards: {
    icon?: string;
    title: string;
    body: string;
    href?: string;
    tag?: string;
    tone?: CardTone;
  }[];
}

export declare const STRUCTURE_KINDS: readonly StructureKind[];
export declare const STRUCTURE_LIMITS: {
  siblings: number;
  nodes: number;
  depth: number;
};
export declare function pathSegment(name: string): string;
export declare function normalizePath(path: string): string;
export declare function nodeKind(node: StructureNode): StructureKind;
export declare function structureOutline(nodes: StructureNode[]): {
  items: Map<string, StructureItem>;
  roots: string[];
};
export declare const CARD_TONES: readonly CardTone[];
export declare const CARD_VARIANTS: readonly ("tile" | "row")[];
export declare function cardGridColumns(data: CardGridData): number;
export declare function validateDocBrowseData(
  kind: string,
  data: unknown,
): Record<string, unknown>;
