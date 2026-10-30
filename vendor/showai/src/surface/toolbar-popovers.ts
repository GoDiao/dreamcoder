/** Keep secondary-strip menus in the top layer so scrolling never clips them. */
export function toolbarPopovers(toolbar: HTMLElement) {
  let opened: {
    details: HTMLDetailsElement;
    popup: HTMLElement;
    style: string | null;
  } | null = null;
  const close = () => {
    if (!opened) return;
    const { details, popup, style } = opened;
    opened = null;
    if (popup.matches(":popover-open")) popup.hidePopover();
    popup.removeAttribute("popover");
    if (style === null) popup.removeAttribute("style");
    else popup.setAttribute("style", style);
    details.open = false;
  };
  const place = () => {
    if (!opened) return;
    const { details, popup } = opened;
    if (!details.isConnected) {
      close();
      return;
    }
    const anchor = details.querySelector("summary")!.getBoundingClientRect();
    const size = popup.getBoundingClientRect(),
      edge = toolbar.dataset.dock;
    let x = anchor.left,
      y = anchor.top - size.height - 10;
    if (edge === "top") y = anchor.bottom + 10;
    if (edge === "left") {
      x = anchor.right + 10;
      y = anchor.top;
    }
    if (edge === "right") {
      x = anchor.left - size.width - 10;
      y = anchor.top;
    }
    popup.style.left = `${Math.max(8, Math.min(x, innerWidth - size.width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(y, innerHeight - size.height - 8))}px`;
  };
  const toggle = (event: Event) => {
    const details = event.target;
    if (
      !(details instanceof HTMLDetailsElement) ||
      !details.closest(".board-toolbar-secondary")
    )
      return;
    if (!details.open) {
      if (opened?.details === details) close();
      return;
    }
    if (opened?.details === details) return;
    const popup = details.querySelector<HTMLElement>(":scope > div");
    if (!popup) return;
    close();
    opened = { details, popup, style: popup.getAttribute("style") };
    popup.setAttribute("popover", "manual");
    Object.assign(popup.style, {
      position: "fixed",
      inset: "auto",
      margin: "0",
      transform: "none",
      maxWidth: "calc(100vw - 16px)",
      maxHeight: "calc(100dvh - 16px)",
      overflow: "auto",
    });
    popup.showPopover();
    place();
  };
  const outside = (event: Event) => {
    if (opened && !opened.details.contains(event.target as Node)) close();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !opened) return;
    const summary = opened.details.querySelector("summary");
    close();
    summary?.focus();
    event.stopPropagation();
    event.preventDefault();
  };
  toolbar.addEventListener("toggle", toggle, true);
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", key, true);
  document.addEventListener("scroll", place, true);
  window.addEventListener("resize", place);
  const observer = new MutationObserver(() => {
    if (toolbar.hasAttribute("data-dragging")) close();
    else place();
  });
  observer.observe(toolbar, {
    attributes: true,
    attributeFilter: ["data-dock", "data-dragging"],
  });
  return () => {
    close();
    observer.disconnect();
    toolbar.removeEventListener("toggle", toggle, true);
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", key, true);
    document.removeEventListener("scroll", place, true);
    window.removeEventListener("resize", place);
  };
}
