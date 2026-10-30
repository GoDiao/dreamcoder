import { mathHtml } from "./markdown-math.mjs";
import "./katex.css";
import "./note.css";

// One delegated controller per document shows the note of any element that
// carries data-showai-note: rich text, KaTeX parts, inline markup, SVG chart
// labels and custom components. The bubble is styled inline so pages whose
// stylesheet is scoped to a reader root still show it on document.body.

const SELECTOR = "[data-showai-note]";
const INSTALLED = Symbol.for("showai.noteBubbles");
const SHOW_DELAY = 120;
const HIDE_DELAY = 160;
const GAP = 8;
const MARGIN = 8;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Note text with `$...$` formulas rendered and line breaks kept. */
export function noteHtml(note: string): string {
  return note
    .split(/(\$[^$\n]+\$)/g)
    .map((part) =>
      /^\$[^$\n]+\$$/.test(part)
        ? mathHtml(part.slice(1, -1))
        : escapeHtml(part).replaceAll("\n", "<br>"),
    )
    .join("");
}

function noteTarget(node: EventTarget | null): Element | null {
  const element =
    node instanceof Element
      ? node
      : node instanceof Node
        ? node.parentElement
        : null;
  const target = element?.closest(SELECTOR) ?? null;
  return target?.getAttribute("data-showai-note")?.trim() ? target : null;
}

/** Install the hover/focus/tap controller once for a document. */
export function installNoteBubbles(
  doc: Document | undefined = globalThis.document,
) {
  if (!doc?.defaultView) return;
  const host = doc as Document & { [INSTALLED]?: boolean };
  if (host[INSTALLED]) return;
  host[INSTALLED] = true;
  const view = doc.defaultView;
  let bubble: HTMLDivElement | null = null;
  let current: Element | null = null;
  let pinned = false;
  let showTimer = 0;
  let hideTimer = 0;
  let pointer: { x: number; y: number } | null = null;
  const id = `showai-note-${Math.random().toString(36).slice(2, 9)}`;

  const element = () => {
    if (bubble?.isConnected) return bubble;
    bubble = doc.createElement("div");
    bubble.id = id;
    bubble.setAttribute("role", "tooltip");
    bubble.className = "showai-note-bubble";
    Object.assign(bubble.style, {
      position: "fixed",
      zIndex: "2147483000",
      maxWidth: "min(340px, calc(100vw - 16px))",
      padding: "8px 11px",
      borderRadius: "8px",
      background: "rgba(32, 33, 38, 0.96)",
      color: "#f6f6f4",
      font: "14px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
      letterSpacing: "0",
      textAlign: "left",
      whiteSpace: "normal",
      overflowWrap: "anywhere",
      boxShadow: "0 6px 24px rgba(0, 0, 0, 0.22)",
      pointerEvents: "auto",
      userSelect: "text",
      visibility: "hidden",
      left: "0px",
      top: "0px",
    } satisfies Partial<CSSStyleDeclaration>);
    bubble.addEventListener("pointerenter", () => view.clearTimeout(hideTimer));
    bubble.addEventListener("pointerleave", () => {
      if (!pinned) scheduleHide();
    });
    doc.body.append(bubble);
    return bubble;
  };

  const anchorRect = (target: Element) => {
    const rects = [...target.getClientRects()];
    if (pointer)
      for (const rect of rects)
        if (
          pointer.x >= rect.left - 2 &&
          pointer.x <= rect.right + 2 &&
          pointer.y >= rect.top - 2 &&
          pointer.y <= rect.bottom + 2
        )
          return rect;
    return rects[0] ?? target.getBoundingClientRect();
  };

  const place = () => {
    if (!current || !bubble) return;
    if (!current.isConnected) return hide();
    const rect = anchorRect(current);
    const width = view.innerWidth;
    const height = view.innerHeight;
    // The anchor scrolled away or collapsed: a bubble pointing at nothing misleads.
    if (
      (!rect.width && !rect.height) ||
      rect.bottom < 0 ||
      rect.top > height ||
      rect.right < 0 ||
      rect.left > width
    )
      return hide();
    const box = bubble.getBoundingClientRect();
    let top = rect.top - box.height - GAP;
    if (top < MARGIN) top = rect.bottom + GAP;
    if (top + box.height > height - MARGIN)
      top = Math.max(MARGIN, height - MARGIN - box.height);
    const left = Math.min(
      Math.max(MARGIN, rect.left + rect.width / 2 - box.width / 2),
      Math.max(MARGIN, width - MARGIN - box.width),
    );
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
  };

  function show(target: Element) {
    view.clearTimeout(hideTimer);
    view.clearTimeout(showTimer);
    const note = target.getAttribute("data-showai-note")?.trim();
    if (!note) return;
    const node = element();
    if (current && current !== target) release();
    current = target;
    node.innerHTML = noteHtml(note);
    node.style.visibility = "hidden";
    node.style.display = "block";
    target.setAttribute("aria-describedby", id);
    target.classList?.add("is-note-open");
    place();
    node.style.visibility = "visible";
  }
  function release() {
    if (!current) return;
    if (current.getAttribute("aria-describedby") === id)
      current.removeAttribute("aria-describedby");
    current.classList?.remove("is-note-open");
  }
  function hide() {
    view.clearTimeout(showTimer);
    view.clearTimeout(hideTimer);
    release();
    current = null;
    pinned = false;
    if (bubble) bubble.style.display = "none";
  }
  function scheduleHide() {
    view.clearTimeout(hideTimer);
    hideTimer = view.setTimeout(hide, HIDE_DELAY);
  }

  doc.addEventListener(
    "pointermove",
    (event) => {
      pointer = { x: event.clientX, y: event.clientY };
    },
    { passive: true, capture: true },
  );
  doc.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const target = noteTarget(event.target);
    if (!target) return;
    view.clearTimeout(hideTimer);
    if (target === current) return;
    view.clearTimeout(showTimer);
    showTimer = view.setTimeout(() => show(target), SHOW_DELAY);
  });
  doc.addEventListener("pointerout", (event) => {
    if (event.pointerType === "touch" || pinned) return;
    const from = noteTarget(event.target);
    if (!from) return;
    const to = event.relatedTarget;
    if (to instanceof Node && (from.contains(to) || bubble?.contains(to)))
      return;
    view.clearTimeout(showTimer);
    if (from === current) scheduleHide();
  });
  doc.addEventListener("focusin", (event) => {
    const target = noteTarget(event.target);
    if (target && (target as HTMLElement).matches?.(":focus-visible"))
      show(target);
  });
  doc.addEventListener("focusout", (event) => {
    if (noteTarget(event.target) === current && !pinned) scheduleHide();
  });
  // Touch has no hover: a tap opens the note, a tap elsewhere closes it.
  doc.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch") return;
    const target = noteTarget(event.target);
    if (target && target !== current) {
      pointer = { x: event.clientX, y: event.clientY };
      show(target);
      pinned = true;
    } else if (!bubble?.contains(event.target as Node)) hide();
  });
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && current) hide();
  });
  view.addEventListener("scroll", () => current && place(), {
    capture: true,
    passive: true,
  });
  view.addEventListener("resize", () => current && place());
}

if (typeof document !== "undefined") installNoteBubbles(document);
