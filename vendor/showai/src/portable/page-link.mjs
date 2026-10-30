// ShowAI page links: showai://project/PROJECT/page/PAGE[?blocks=ID,ID]
// Pages store them as ordinary link hrefs; the workbench, readers and the
// desktop app resolve them. A link names saved IDs only, never content.

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const PAGE_LINK_BLOCKS = 100;
/** Bubbling DOM event that asks the surrounding host to follow a link. */
export const NAVIGATE_EVENT = "showai:navigate";

const id = (value) => typeof value === "string" && ID.test(value);

/** The project, page and blocks a page link names, or null for anything else. */
export function parsePageLink(href) {
  if (
    typeof href !== "string" ||
    href.length > 8192 ||
    !href.startsWith("showai://project/")
  )
    return null;
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/");
  if (
    url.hostname !== "project" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    parts.length !== 4 ||
    parts[0] !== "" ||
    parts[2] !== "page" ||
    !id(parts[1]) ||
    !id(parts[3]) ||
    [...url.searchParams.keys()].some((key) => key !== "blocks")
  )
    return null;
  const blocks = url.searchParams.getAll("blocks");
  if (blocks.length > 1) return null;
  const blockIds = blocks.length ? blocks[0].split(",") : [];
  if (blockIds.length > PAGE_LINK_BLOCKS || !blockIds.every(id)) return null;
  return { projectId: parts[1], pageId: parts[3], blockIds };
}

export function pageLink({ projectId, pageId, blockIds = [] }) {
  if (!id(projectId) || !id(pageId))
    throw new Error("Page links need a project ID and a page ID.");
  if (blockIds.length > PAGE_LINK_BLOCKS || !blockIds.every(id))
    throw new Error(
      `Page links name at most ${PAGE_LINK_BLOCKS} valid block IDs.`,
    );
  const link = `showai://project/${projectId}/page/${pageId}`;
  return blockIds.length ? `${link}?blocks=${blockIds.join(",")}` : link;
}

/**
 * A navigation request from a link or a component. Missing project or page
 * IDs mean the page that holds the request. Returns null when invalid.
 */
export function navigationTarget(value) {
  if (typeof value === "string") {
    if (value.startsWith("#"))
      return id(value.slice(1)) ? { blockIds: [value.slice(1)] } : null;
    return parsePageLink(value);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { projectId, pageId, blockId } = value;
  if (
    Object.keys(value).some(
      (key) => !["projectId", "pageId", "blockId"].includes(key),
    ) ||
    (projectId !== undefined && !id(projectId)) ||
    (pageId !== undefined && !id(pageId)) ||
    (blockId !== undefined && !id(blockId)) ||
    (projectId !== undefined && pageId === undefined) ||
    (pageId === undefined && blockId === undefined)
  )
    return null;
  return {
    ...(projectId ? { projectId } : {}),
    ...(pageId ? { pageId } : {}),
    blockIds: blockId ? [blockId] : [],
  };
}

/** Ask the host around `source` to follow a target; true when a host took it. */
export function requestNavigation(source, target, modifiers) {
  const event = new CustomEvent(NAVIGATE_EVENT, {
    bubbles: true,
    composed: true,
    cancelable: true,
    detail: { target, ...(modifiers ? { modifiers } : {}) },
  });
  return !source.dispatchEvent(event);
}
