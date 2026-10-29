export interface PageLinkTarget {
  projectId: string;
  pageId: string;
  blockIds: string[];
}
/** Missing IDs mean the page that holds the request. */
export interface NavigationTarget {
  projectId?: string;
  pageId?: string;
  blockIds: string[];
}
export interface NavigationModifiers {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}
export interface NavigationDetail {
  target: NavigationTarget;
  modifiers?: NavigationModifiers;
}
export const PAGE_LINK_BLOCKS: number;
export const NAVIGATE_EVENT: "showai:navigate";
export function parsePageLink(href: unknown): PageLinkTarget | null;
export function pageLink(target: {
  projectId: string;
  pageId: string;
  blockIds?: string[];
}): string;
export function navigationTarget(value: unknown): NavigationTarget | null;
export function requestNavigation(
  source: EventTarget,
  target: NavigationTarget,
  modifiers?: NavigationModifiers,
): boolean;
