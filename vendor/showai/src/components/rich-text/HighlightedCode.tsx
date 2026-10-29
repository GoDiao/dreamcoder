import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { highlightCode } from "./code-highlighting";
import "./code-highlighting.css";

type Highlighter = typeof import("./code-highlighting");
type Token = ReturnType<typeof highlightCode>["children"][number];

// The grammar registry outweighs the rest of rich text. Load it only when a
// code block renders, so split builds fetch it on demand and page readers
// without code blocks can leave it out entirely.
let highlighter: Highlighter | undefined;
let loading: Promise<Highlighter> | undefined;
export function loadCodeHighlighter() {
  return (loading ??= import("./code-highlighting").then(
    (module) => (highlighter = module),
  ));
}

function renderTokens(nodes: readonly Token[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.value;
    if (node.type !== "element") return null;
    const classes = node.properties.className;
    return (
      <span
        key={index}
        className={Array.isArray(classes) ? classes.join(" ") : undefined}
      >
        {renderTokens(node.children)}
      </span>
    );
  });
}

/** Tokens are React text/spans, so code containing HTML stays inert. */
export function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language?: string | null;
}) {
  const [loaded, setLoaded] = useState(highlighter);
  useEffect(() => {
    if (!loaded) void loadCodeHighlighter().then(setLoaded);
  }, [loaded]);
  // Until the grammars arrive the same text shows unstyled.
  return useMemo(
    () =>
      loaded
        ? renderTokens(loaded.highlightCode(code, language).children)
        : code,
    [loaded, code, language],
  );
}
