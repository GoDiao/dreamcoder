import {
  NAVIGATE_EVENT,
  pageLink,
  parsePageLink,
  type NavigationDetail,
  type NavigationTarget,
} from "./page-link.mjs";

/** Written into each page of a site export: the project and each page's file. */
export interface SiteRoutes {
  projectId: string;
  pages: Record<string, string>;
}

export function parseSiteRoutes(raw: string | null | undefined) {
  if (!raw) return null;
  const value = JSON.parse(raw) as Partial<SiteRoutes>;
  if (
    typeof value.projectId !== "string" ||
    !value.pages ||
    typeof value.pages !== "object"
  )
    throw new Error("The site page list is unreadable.");
  return value as SiteRoutes;
}

const blockSelector = (id: string) =>
  `[data-block-id="${CSS.escape(id)}"],[data-surface-id="${CSS.escape(id)}"]`;

/** Scroll to the first linked block and briefly outline each of them. */
export function revealBlocks(
  root: HTMLElement,
  ids: string[],
  behavior: ScrollBehavior = "smooth",
) {
  const found = ids
    .map((id) => root.querySelector<HTMLElement>(blockSelector(id)))
    .filter((element): element is HTMLElement => !!element);
  found[0]?.scrollIntoView({ block: "center", behavior });
  for (const element of found) {
    element.classList.remove("portable-link-target");
    void element.offsetWidth;
    element.classList.add("portable-link-target");
    element.addEventListener(
      "animationend",
      () => element.classList.remove("portable-link-target"),
      { once: true },
    );
  }
  return found.length > 0;
}

/**
 * Follow page links inside a reader. The page itself scrolls to the linked
 * blocks, a site export opens its own page file, and every other page link
 * goes to the ShowAI app (or the conversation host's link handler).
 */
export function installReaderLinks(
  root: HTMLElement,
  page: { pageId: string; projectId?: string },
  site: SiteRoutes | null,
) {
  const projectId = page.projectId ?? site?.projectId;
  type Route = { here: true } | { url: string } | { app: string };
  const resolve = (target: NavigationTarget): Route | null => {
    const pageId = target.pageId ?? page.pageId;
    const sameProject =
      !target.projectId || !projectId || target.projectId === projectId;
    if (pageId === page.pageId && sameProject) return { here: true };
    const file = sameProject && site?.pages[pageId];
    if (file)
      return {
        url: `./${file}${target.blockIds[0] ? `#${encodeURIComponent(target.blockIds[0])}` : ""}`,
      };
    const project = target.projectId ?? projectId;
    return project
      ? {
          app: pageLink({
            projectId: project,
            pageId,
            blockIds: target.blockIds,
          }),
        }
      : null;
  };
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = event
      .composedPath()
      .find(
        (entry): entry is HTMLAnchorElement =>
          entry instanceof HTMLAnchorElement && entry.hasAttribute("href"),
      );
    const target = anchor && parsePageLink(anchor.getAttribute("href"));
    if (!target) return;
    const route = resolve(target);
    // Links to other pages keep their default: the browser hands them to the app.
    if (!route || "app" in route) return;
    event.preventDefault();
    if ("here" in route) revealBlocks(root, target.blockIds);
    else if (event.metaKey || event.ctrlKey) window.open(route.url, "_blank");
    else location.assign(route.url);
  };
  const request = (event: Event) => {
    const detail = (event as CustomEvent<NavigationDetail>).detail;
    const route = detail?.target && resolve(detail.target);
    if (!route) return;
    event.preventDefault();
    if ("here" in route) revealBlocks(root, detail.target.blockIds);
    else if ("url" in route) location.assign(route.url);
    else {
      // An anchor inside the reader reaches a conversation host's link handler.
      const anchor = window.document.createElement("a");
      anchor.href = route.app;
      anchor.hidden = true;
      root.append(anchor);
      anchor.click();
      anchor.remove();
    }
  };
  root.addEventListener("click", click);
  root.addEventListener(NAVIGATE_EVENT, request);
  return () => {
    root.removeEventListener("click", click);
    root.removeEventListener(NAVIGATE_EVENT, request);
  };
}

/** A page opened from another page's link shows the block named in its hash. */
export function revealLinkedBlock(root: HTMLElement) {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return () => {};
  let attempts = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  const timer = setInterval(() => {
    const found = revealBlocks(root, [id], "auto");
    if (found || ++attempts > 20) clearInterval(timer);
    // Components finish rendering after the first pass and can move the block.
    if (found)
      settle = setTimeout(() => {
        const element = root.querySelector(blockSelector(id));
        const box = element?.getBoundingClientRect();
        if (box && (box.bottom < 0 || box.top > window.innerHeight))
          element!.scrollIntoView({ block: "center" });
      }, 600);
  }, 120);
  return () => {
    clearInterval(timer);
    clearTimeout(settle);
  };
}
