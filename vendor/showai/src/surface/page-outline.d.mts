import type { JSONContent } from "@tiptap/core";
import type { CustomBlockData } from "../components/custom/types";
export const PAGE_OUTLINE_PROTOCOL: 1;
export interface ManualOutlineEntry {
  id: string;
  title?: string;
  nodeId?: string;
  children?: ManualOutlineEntry[];
}
export interface NativePageOutline {
  version: 1;
  enabled: boolean;
  renderer?: CustomBlockData & { integrity: string };
  source:
    | {
        mode: "headings";
        maxLevel: number;
        overrides?: Record<string, { title?: string; hidden?: boolean }>;
      }
    | { mode: "manual"; entries: ManualOutlineEntry[] };
  initialState: "auto" | "expanded" | "collapsed";
  placement: "auto" | "floating" | "docked";
  width: number;
}
export interface PageOutlineItem {
  id: string;
  navigable: boolean;
  title: string;
  level: number;
  children: PageOutlineItem[];
}
export type OutlinePlacement = "margin" | "floating" | "docked" | "drawer";
export interface PageOutlineData {
  protocol: 1;
  pageId: string;
  items: PageOutlineItem[];
  activeItemId: string | null;
  expandedItemIds: string[];
  container: { placement: OutlinePlacement; width: number; height: number };
  theme: "light" | "dark";
  locale: string;
}
export interface PageOutlineComponentProps<P = Record<string, unknown>> {
  props: P;
  outline: PageOutlineData;
  navigate: (id: string) => void;
  setBranchExpanded: (id: string, expanded: boolean) => void;
  collapse: () => void;
}
export interface OutlineViewState {
  expanded?: boolean;
  pinned?: boolean;
  branches?: string[];
}
export function defaultPageOutline(): NativePageOutline;
export function pageOutlineNodes(page: JSONContent): Map<string, JSONContent>;
export function validatePageOutline(
  value: unknown,
  page: JSONContent,
): NativePageOutline;
export function buildPageOutline(
  page: JSONContent,
  config?: NativePageOutline,
): {
  items: PageOutlineItem[];
  targets: Map<string, string>;
  missing: string[];
};
export function flattenOutline(items: PageOutlineItem[]): PageOutlineItem[];
export function remapPageOutline(
  config: NativePageOutline,
  mapping: Map<string, string>,
  nextId?: () => string,
): NativePageOutline;
export function outlinePlacement(input: {
  width: number;
  gutter: number;
  panelWidth: number;
  widthMode: string;
  preferred?: string;
  pinned?: boolean;
  previous?: string;
}): OutlinePlacement;
