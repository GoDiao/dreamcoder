import type { JSONContent } from "@tiptap/core";
import type { ShowDocument, WhiteboardPage } from "../types";
export function isSurface(document: ShowDocument): document is WhiteboardPage;
export function artifactVersion(document: ShowDocument): 1 | 2 | 3;
export function visitNodes(
  node: JSONContent,
  visitor: (node: JSONContent, parent: JSONContent | null) => void,
  parent?: JSONContent | null,
): void;
export function assignSurfaceIds(
  document: ShowDocument,
  options?: { repairLegacy?: boolean },
): ShowDocument;
export function fillSurfaceLayout(document: ShowDocument): ShowDocument;
export function upgradeDocument(
  document: ShowDocument,
  options?: { includeTitle?: boolean },
): WhiteboardPage;
export function reconcileSurface<T extends ShowDocument>(
  document: T,
  options?: { clone?: boolean; shareWith?: T },
): T;
export function findSurfaceNode(
  document: ShowDocument,
  id: string,
): { node: JSONContent; parent: JSONContent | null } | undefined;
export function orderedSurfaceNodes(document: ShowDocument): JSONContent[];
export function linearContent(document: ShowDocument): JSONContent;
export function remapSurfaceIds(
  document: ShowDocument,
  nextId?: () => string,
): ShowDocument;
export function nodePaths(document: ShowDocument): Record<string, string[]>;
export function placeTemplate(
  document: ShowDocument,
  template: ShowDocument,
  parentId?: string | null,
): ShowDocument;

export function isReconciledSurface(
  document: import("../types").ShowDocument,
): boolean;
