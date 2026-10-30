export interface MindmapNode {
  id: string;
  parentId: string | null;
  label: string;
  collapsed?: boolean;
}
export interface MindmapData extends Record<string, unknown> {
  title?: string;
  description?: string;
  height?: number;
  layout?: "radial" | "tree";
  direction?: "right" | "left";
  nodes: MindmapNode[];
}
export interface PositionedMindmapNode extends MindmapNode {
  x: number;
  y: number;
  width: number;
  height: number;
  side: number;
  axis: "horizontal";
  depth: number;
  color: number;
}
export const MAX_MINDMAP_NODES: number;
export function validateMindmapData(data: Record<string, unknown>): MindmapData;
export function mindmapChildren(data: MindmapData, id: string): MindmapNode[];
export function addMindmapNode(
  data: MindmapData,
  selected: string,
  id: string,
  relation?: "child" | "sibling",
  before?: boolean,
): MindmapData;
export function removeMindmapNode(data: MindmapData, id: string): MindmapData;
export function promoteMindmapNode(data: MindmapData, id: string): MindmapData;
export function layoutMindmap(
  data: MindmapData,
  collapsed?: Set<string>,
): { nodes: PositionedMindmapNode[]; width: number; height: number };

export function mindmapConnectionPath(
  parent: PositionedMindmapNode,
  node: PositionedMindmapNode,
): string;
