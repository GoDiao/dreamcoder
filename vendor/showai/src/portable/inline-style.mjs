// Shared by the bundled inline exporter and the CDN reader so both fragment
// forms scope the reader's styles to their root in the same way.

/** Rewrites document-level selectors so reader CSS applies inside one root. */
export function scopeReaderCss(css) {
  return css
    .replace(/@charset[^;]+;/g, "")
    .replaceAll(":root", ":scope")
    .replace(/(?<![\w-])(?:html|body)(?=[,{])/g, ":scope");
}

// The conversation measures the fragment's outer height. A viewport-sized
// Page hides its content height behind an inner scrollbar, so let the active
// root Page grow naturally. Keep spatial Boards and embedded fixed frames
// bounded. Applying this at export time also adapts archived readers. Pages
// with native outlines wrap the root Page in .page-outline-shell; a visible
// outline keeps the Page as its own scroll container so it can track position.
export const INLINE_READER_OVERRIDES = `.portable-document { max-width: none; padding: 24px 0 12px; }
.portable-page-heading,
.container-page-heading:empty,
.container-page-heading:has(> .portable-page-heading:only-child) { display: none; }
.portable-options { display: none; }
.portable-app { min-height: 0; }
.portable-app:has(> .container-workspace > .container-main > .container-page.is-root),
.portable-app:has(> .container-workspace > .container-main > .page-outline-shell:not([data-outline-docked]) > .container-page.is-root),
.portable-app > .container-workspace:has(> .container-main > .container-page.is-root),
.portable-app > .container-workspace:has(> .container-main > .page-outline-shell:not([data-outline-docked]) > .container-page.is-root),
.portable-app > .container-workspace > .container-main > .page-outline-shell:not([data-outline-docked]):has(> .container-page.is-root) {
  height: auto;
}
.portable-app > .container-workspace > .container-main:has(> .container-page.is-root),
.portable-app > .container-workspace > .container-main:has(> .page-outline-shell:not([data-outline-docked]) > .container-page.is-root) {
  flex: none;
}
.portable-app > .container-workspace > .container-main > .container-page.is-root,
.portable-app > .container-workspace > .container-main > .page-outline-shell:not([data-outline-docked]) > .container-page.is-root {
  height: auto;
  overflow: visible;
  overscroll-behavior: auto;
  scrollbar-gutter: auto;
}`;

/** Wraps scoped reader CSS for the fragment root with the given id. */
export function inlineStyleSheet(id, css) {
  return `@scope (#${id}) {\n${css}\n${INLINE_READER_OVERRIDES}\n}`;
}
