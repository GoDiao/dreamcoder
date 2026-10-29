import { attachStyles } from "./cdn-styles";
import { mountReader } from "./reader-app";

let count = 0;

export interface CdnMountOptions {
  /** The page as a ShowAI artifact (JSON text or parsed object). */
  artifact: string | object;
  /** Reader options such as `{ "theme": "dark" }`. */
  options?: { theme?: "dark" | "light"; draft?: boolean };
  /**
   * The reader owns the whole document, like an exported HTML page: styles
   * apply to the page, the theme is set on <html> and the page menu is shown.
   * Otherwise `section` is an inline root inside a host page.
   */
  standalone?: boolean;
}

/**
 * Mounts a ShowAI page into `section` without a bundled reader. As an inline
 * root, page styles are scoped to the section, custom components run in its
 * shadow roots, and the theme is set on it.
 */
export function mount(
  section: HTMLElement,
  { artifact, options, standalone = false }: CdnMountOptions,
) {
  if (!section.id) section.id = `showai-cdn-${++count}`;
  if (!/^[A-Za-z][\w-]*$/.test(section.id))
    throw new Error("The ShowAI root needs a simple id.");
  if (!standalone) section.setAttribute("data-showai-inline-root", "");
  section
    .querySelectorAll(":scope > [data-showai-placeholder]")
    .forEach((placeholder) => placeholder.remove());
  const target = section.ownerDocument.createElement("div");
  target.id = `${section.id}-root`;
  section.append(target);
  const detachStyles = attachStyles(section, { scoped: !standalone });
  const raw =
    typeof artifact === "string" ? artifact : JSON.stringify(artifact);
  const readOptions = options ? JSON.stringify(options) : null;
  const unmount = mountReader(target, {
    inlineHost: standalone ? null : section,
    readArtifact: () => raw,
    readOptions: () => readOptions,
    setTheme: (theme) => {
      (standalone
        ? section.ownerDocument.documentElement
        : section
      ).dataset.theme = theme;
    },
  });
  return () => {
    unmount();
    detachStyles();
    target.remove();
  };
}
