import { namespacedSvg, svgSource } from "./source-editing";

export type DiagramPresentation = {
  title: "inside" | "outside" | "hidden";
  description: "inside" | "outside" | "hidden";
  notes: "inline" | "details" | "hidden";
  legend: boolean;
  controls: boolean;
};
export const originalDiagramPresentation: DiagramPresentation = {
  title: "inside",
  description: "inside",
  notes: "inline",
  legend: true,
  controls: true,
};
export const compactDiagramPresentation: DiagramPresentation = {
  title: "outside",
  description: "outside",
  notes: "hidden",
  legend: true,
  controls: true,
};
export function diagramPresentation(
  data: Record<string, unknown>,
): DiagramPresentation {
  return data.presentation
    ? {
        ...originalDiagramPresentation,
        ...(data.presentation as DiagramPresentation),
      }
    : originalDiagramPresentation;
}

function htmlText(markup: string) {
  // Only text enters this inert document; imported images and scripts are excluded.
  return (
    new DOMParser()
      .parseFromString(markup.replace(/<[^>]*>/g, ""), "text/html")
      .body.textContent?.trim() ?? ""
  );
}
function cardsText(source: string) {
  // Extract the authored cards without putting imported HTML into the app DOM.
  const start = source.search(
    /<div\b[^>]*class=["'][^"']*\bcards\b[^"']*["'][^>]*>/i,
  );
  if (start < 0) return [];
  const rest = source.slice(start);
  let depth = 0;
  for (const tag of rest.matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(tag[0]) ? -1 : 1;
    if (depth === 0)
      return [
        htmlText(
          rest
            .slice(0, tag.index! + tag[0].length)
            .replace(/<\/(?:h3|p|li)>/gi, "$& "),
        ),
      ].filter(Boolean);
  }
  return [];
}
export function diagramCaptions(source: string) {
  const doc = new DOMParser().parseFromString(
    namespacedSvg(source),
    "image/svg+xml",
  );
  const h1 = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const subtitle = source.match(
    /<p\b[^>]*class=["'][^"']*\bsubtitle\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
  );
  return {
    title: h1
      ? htmlText(h1[1])
      : (doc
          .querySelector(
            "svg > text.title, svg > g#title text.title, svg > title",
          )
          ?.textContent?.trim() ?? ""),
    description: subtitle
      ? htmlText(subtitle[1])
      : (doc
          .querySelector(
            "svg > text.subtitle, svg > text.title + text.detail, svg > g#title text.subtitle, svg > desc",
          )
          ?.textContent?.trim() ?? ""),
    notes: [
      ...doc.querySelectorAll(
        "svg > text.footnote, svg > g#footer, svg > g.footer, svg > g[data-graph-role=legend] + text.detail",
      ),
    ]
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean)
      .concat(cardsText(source)),
  };
}

/** Same source transformation is used by the live reader and the SVG exporter. */
export function diagramPresentationSource(
  source: string,
  presentation: DiagramPresentation,
) {
  if (
    JSON.stringify(presentation) === JSON.stringify(originalDiagramPresentation)
  )
    return source;
  const original = svgSource(source);
  const doc = new DOMParser().parseFromString(
    namespacedSvg(source),
    "image/svg+xml",
  );
  const svg = doc.documentElement;
  const mark = (selector: string, hidden: boolean) => {
    if (hidden)
      for (const el of doc.querySelectorAll(selector))
        el.setAttribute("data-showai-diagram-hidden", "true");
  };
  mark(
    "svg > text.title, svg > g#title > text.title",
    presentation.title !== "inside",
  );
  mark(
    "svg > text.subtitle, svg > text.title + text.detail, svg > g#title > text.subtitle",
    presentation.description !== "inside",
  );
  mark(
    "svg > g#footer, svg > g.footer, svg > text.footnote, svg > g[data-graph-role=legend] + text.detail",
    presentation.notes !== "inline",
  );
  mark(
    "svg > g#legend, svg > g.legend, svg > g[data-graph-role=legend]",
    !presentation.legend,
  );
  const style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent =
    "[data-showai-diagram-hidden=true]{display:none!important}";
  svg.prepend(style);
  // Crop only the caption band, keeping every node, port and edge coordinate intact.
  const removed = [
    ...doc.querySelectorAll(
      "svg > text[data-showai-diagram-hidden=true],svg > g#title > text[data-showai-diagram-hidden=true]",
    ),
  ].filter(
    (el) =>
      el.matches(".title,.subtitle") ||
      (el.matches(".detail") &&
        el.previousElementSibling?.matches("text.title")),
  );
  const box = svg.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
  if (box?.length === 4 && removed.length) {
    const bandEnd = Math.max(
      ...removed.map((el) => Number(el.getAttribute("y") ?? 0) + 12),
    );
    const nodeStarts = [
      ...doc.querySelectorAll(
        '[data-graph-role="node"],[data-graph-role="container"]',
      ),
    ]
      .map((el) => Number(el.getAttribute("data-graph-bounds")?.split(",")[1]))
      .filter(Number.isFinite);
    if (nodeStarts.length) {
      const crop = Math.min(bandEnd, Math.min(...nodeStarts) - 16);
      if (crop > box[1] && crop < box[1] + box[3])
        svg.setAttribute(
          "viewBox",
          `${box[0]} ${crop} ${box[2]} ${box[3] - (crop - box[1])}`,
        );
    }
  }
  return source.replace(original, () =>
    new XMLSerializer().serializeToString(svg),
  );
}

export function diagramPresentationCss(p: DiagramPresentation) {
  return `${p.title !== "inside" ? ".header h1,.frame>h1,.frame>.eyebrow,.header .pulse-dot{display:none!important}" : ""}
${p.description !== "inside" ? ".header>p.subtitle,.frame>p.subtitle{display:none!important}" : ""}
${p.title !== "inside" && p.description !== "inside" ? ".header,.header-row{margin:0!important;padding:0!important;min-height:0!important}.header:has(h1){display:none!important}" : ""}
${p.notes !== "inline" ? ".reader-rail,.cards,.frame>.notes,.frame>.source-note{display:none!important}" : ""}
${!p.controls ? ".toolbar,.diagram-nav,.zoom-controls,.diagram-controls,.view-controls,.rail-controls,.diagram-guide,.node-finder,.focus-chip,.node-outline{display:none!important}" : ""}
body{min-height:0!important;display:block!important;align-items:normal!important;padding:12px!important}
.diagram-container{margin-top:0!important}.container,.frame{margin-top:0!important}
`;
}
