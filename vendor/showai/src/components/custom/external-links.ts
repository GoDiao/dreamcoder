import { safeUrl } from "../blocks/helpers";

/** Validate at the host boundary; component messages are untrusted. */
export function componentExternalUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8192) return undefined;
  return safeUrl(value);
}

/** Serialized into the opaque frame. Keep this function self-contained. */
export function installComponentLinks(channel: string): void {
  document.addEventListener("click", (event) => {
    if (!event.isTrusted || event.defaultPrevented || event.button !== 0)
      return;
    // event.target is the shadow host for components with their own Shadow DOM.
    const anchor = event
      .composedPath()
      .find(
        (entry) =>
          entry instanceof HTMLAnchorElement && entry.hasAttribute("href"),
      ) as HTMLAnchorElement | undefined;
    if (!anchor || anchor.hasAttribute("download")) return;
    const url = anchor.getAttribute("href") ?? "";
    // Local files open in the workbench player; the frame itself cannot load them.
    if (/^file:/i.test(url)) {
      event.preventDefault();
      parent.postMessage({ channel, type: "showai:open-media", url }, "*");
      return;
    }
    // ShowAI page links are followed by the page around the frame.
    if (!/^https?:\/\//i.test(url) && !url.startsWith("showai://project/"))
      return;
    event.preventDefault();
    parent.postMessage({ channel, type: "showai:open-url", url }, "*");
  });
}

/** Use the same host navigation path as a normal external link. */
export function openComponentLink(value: unknown): boolean {
  const url = componentExternalUrl(value);
  if (!url || navigator.userActivation?.isActive !== true) return false;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.referrerPolicy = "no-referrer";
  anchor.click();
  return true;
}
