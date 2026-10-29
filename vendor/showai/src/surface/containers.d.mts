import type { JSONContent } from "@tiptap/core";
import type { ShowDocument, ContainerDocument } from "../types";
import type { PageViews, SurfaceKind } from "./types";
export function isResource(
  document: ShowDocument,
): document is ContainerDocument;
export function surfaceKind(node: JSONContent): SurfaceKind;
export function emptyViews(nodes?: JSONContent[]): PageViews;
export function surfaceViews(
  document: ShowDocument,
  node?: JSONContent,
): PageViews;
export function createSurface(
  kind?: SurfaceKind,
  name?: string,
  id?: string,
): JSONContent;
export function resourceNodes(
  document: ShowDocument,
  node?: JSONContent,
): JSONContent[];
export function fillResource<T extends ShowDocument>(document: T): T;
export function upgradeResource(
  document: ShowDocument,
  options?: { includeTitle?: boolean },
): ContainerDocument;
export function reconcileResource<T extends ShowDocument>(document: T): T;
export function setSurfaceViews(
  document: ShowDocument,
  id: string,
  views: PageViews,
): ContainerDocument;
export function wrapSurface(
  document: ShowDocument,
  id: string,
  kind: SurfaceKind,
): ContainerDocument;
export function insertResourceTemplate(
  document: ShowDocument,
  template: ShowDocument,
  parentId?: string | null,
): ContainerDocument;
export function createResource(
  document: ShowDocument,
  kind?: SurfaceKind,
): ContainerDocument;
