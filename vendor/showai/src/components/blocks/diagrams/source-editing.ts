import { translator } from "../../../i18n";
import messages from "../../../i18n/messages/diagram";

const t = translator(messages);

/** Parse inert SVG only. HTML scripts and hosted resources never enter the app DOM. */
export function svgSource(source: string): string {
  const container = source.search(
    /\bclass\s*=\s*["'][^"']*\bdiagram-container\b/i,
  );
  const rest = source.slice(container < 0 ? 0 : container);
  const start = rest.search(/<svg\b/i);
  if (start < 0) throw new Error(t("error.missingSvg"));
  const svg = rest.slice(start);
  const tags =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  let depth = 0;
  for (const match of svg.matchAll(tags)) {
    if (/^<!/.test(match[0])) continue;
    if (/^<\/svg/i.test(match[0])) depth--;
    else if (!/\/\s*>$/.test(match[0])) depth++;
    if (depth === 0) return svg.slice(0, match.index! + match[0].length);
  }
  throw new Error(t("error.missingSvg"));
}

export function namespacedSvg(source: string) {
  return svgSource(source).replace(
    /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/i,
    (root) =>
      /\bxmlns\s*=/.test(root)
        ? root
        : root.replace(
            /\s*\/?>$/,
            (end) => ` xmlns="http://www.w3.org/2000/svg"${end}`,
          ),
  );
}

function svgDocument(source: string) {
  const svg = namespacedSvg(source);
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error(t("error.invalidXml"));
  return doc;
}

function textElements(doc: Document) {
  return [...doc.querySelectorAll("text")].flatMap((item) => {
    const spans = [...item.querySelectorAll("tspan")];
    return spans.length ? spans : [item];
  });
}

export function diagramLabels(source: string): string[] {
  return textElements(svgDocument(source)).map(
    (item) => item.textContent ?? "",
  );
}

export function replaceDiagramLabels(source: string, labels: string[]): string {
  const original = svgSource(source);
  const doc = svgDocument(source);
  const elements = textElements(doc);
  if (labels.length !== elements.length)
    throw new Error(t("error.structureChanged"));
  elements.forEach((element, i) => {
    const previous = element.textContent;
    if (previous === labels[i]) return;
    element.textContent = labels[i];
    // Archify's finder and accessible names use the same authored node labels.
    for (
      let node: Element | null = element;
      node && node !== doc.documentElement;
      node = node.parentElement
    ) {
      for (const attribute of ["data-focus-label", "aria-label"])
        if (node.getAttribute(attribute) === previous)
          node.setAttribute(attribute, labels[i]);
      const semanticFields = [
        "data-node-label",
        "data-node-sublabel",
        "data-node-tag",
      ].filter(
        (attribute) => previous && node.getAttribute(attribute) === previous,
      );
      if (semanticFields.length) {
        for (const attribute of semanticFields)
          node.setAttribute(attribute, labels[i]);
        const accessibleName = node.getAttribute("aria-label");
        if (accessibleName)
          node.setAttribute(
            "aria-label",
            accessibleName.replace(previous, () => labels[i]),
          );
        for (const title of node.querySelectorAll(":scope > title"))
          if (title.textContent?.includes(previous))
            title.textContent = title.textContent.replace(
              previous,
              () => labels[i],
            );
      }
      for (const title of node.querySelectorAll(":scope > title"))
        if (title.textContent === previous) title.textContent = labels[i];
    }
  });
  // XML textContent escaping preserves <, &, quotes and literal replacement tokens.
  const next = new XMLSerializer().serializeToString(doc.documentElement);
  return source.replace(original, () => next);
}

export function standaloneDiagramSvg(source: string): string {
  const doc = svgDocument(source);
  const styles = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n");
  const style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = styles;
  doc.documentElement.prepend(style);
  const html = source.match(/<html\b[^>]*>/i)?.[0] ?? "";
  for (const name of ["data-theme", "data-preset"]) {
    const value = html.match(new RegExp(`${name}="([^"]*)"`))?.[1];
    if (value) doc.documentElement.setAttribute(name, value);
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}
