import { inlineStyleSheet, scopeReaderCss } from "./inline-style.mjs";

// The CDN build turns each stylesheet import into a registerStyle() call, so
// styles of lazily loaded blocks arrive with their chunk and reach every
// mounted reader.
const sheets: string[] = [];
type Target = { root: HTMLElement; scoped: boolean };
const targets = new Set<Target>();

function append({ root, scoped }: Target, css: string) {
  const style = root.ownerDocument.createElement("style");
  style.dataset.showaiReaderStyle = root.id;
  style.textContent = scoped
    ? inlineStyleSheet(root.id, scopeReaderCss(css))
    : css;
  // An inline root keeps its styles inside itself; a standalone page owns the
  // document, so its styles go to <head> like the bundled reader's.
  (scoped ? root : root.ownerDocument.head).append(style);
}

export function registerStyle(css: string) {
  sheets.push(css);
  for (const target of targets) append(target, css);
}

/** Applies every registered and future stylesheet for the reader in `root`. */
export function attachStyles(root: HTMLElement, { scoped = true } = {}) {
  const target = { root, scoped };
  targets.add(target);
  for (const css of sheets) append(target, css);
  return () => {
    targets.delete(target);
    root.ownerDocument
      .querySelectorAll(`style[data-showai-reader-style="${root.id}"]`)
      .forEach((style) => style.remove());
  };
}
