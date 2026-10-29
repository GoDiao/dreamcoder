import shell from "./archify-shell.json";
import archify from "./archify-samples.json";
import design from "./design-samples.json";
import fireworks from "./fireworks-samples.json";
import licenses from "./licenses.json";
import fonts from "./editorial-fonts.json";
import { applyTemplate, renderCards } from "./archify-utils.mjs";
import { validateDiagramData, type DiagramFamily } from "./contract.mjs";
import {
  diagramPresentationCss,
  originalDiagramPresentation,
  type DiagramPresentation,
} from "./presentation";

export interface DiagramTemplate {
  id: string;
  name: string;
  source: string;
  upstreamPath: string;
  guide?: string;
  input?: unknown;
}

// Use the original shell, SVG and cards together; the reader's semantic controls
// depend on authored attributes that disappear in an image or a recreated graph.
export function listDiagramTemplates(kind: DiagramFamily): DiagramTemplate[] {
  if (kind === "archify")
    return archify.map((item) => {
      const meta = item.meta as Record<string, unknown>;
      return {
        id: item.id,
        name: item.name,
        upstreamPath: item.upstreamPath,
        input: item.input,
        source: applyTemplate(shell.html, {
          title: item.meta.title,
          subtitle: meta.subtitle,
          locale: meta.locale,
          visualPreset: item.meta.visual_preset || "classic",
          svg: item.svg,
          cards: renderCards(item.cards),
        }),
      };
    });
  return kind === "diagram-design" ? design : fireworks;
}

export function diagramSource(
  kind: DiagramFamily,
  data: Record<string, unknown>,
): string {
  validateDiagramData(kind, data);
  if (typeof data.source === "string") return data.source;
  return listDiagramTemplates(kind).find((item) => item.id === data.template)!
    .source;
}

export function diagramLicense(kind: DiagramFamily) {
  const item = licenses.find((item) => item.id === kind)!;
  return `${item.repository}\nCommit: ${item.commit}\n\n${item.text}\n${item.notices}`;
}

export function diagramStyledSource(kind: DiagramFamily, source: string) {
  if (kind !== "diagram-design" || source.includes("data:font/")) return source;
  const notice = Object.entries(fonts.licenses)
    .map(([name, license]) => `${name}\n${license}`)
    .join("\n\n")
    .replaceAll("--", "—");
  return `<!-- Offline font licenses\n${notice}\n--><style>${fonts.css}</style>${source}`;
}

/** Standalone HTML retains the captions moved outside the diagram reader. */
export function diagramExportDocument(
  html: string,
  title: string,
  description: string,
  notes: string[],
) {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  if (!title && !description && !notes.length) return html;
  // i18n-exempt: caption markup saved into the diagram source
  const caption = `<section style="max-width:1120px;margin:20px auto;font-family:system-ui,sans-serif">${title ? `<h2>${escape(title)}</h2>` : ""}${description ? `<p>${escape(description)}</p>` : ""}${notes.length ? `<details><summary>补充说明</summary>${notes.map((note) => `<p>${escape(note)}</p>`).join("")}</details>` : ""}</section>`;
  return /<body\b[^>]*>/i.test(html)
    ? html.replace(/<body\b[^>]*>/i, (body) => body + caption)
    : html.replace(/<style>/i, caption + "<style>");
}

/** Put this policy before all imported markup, including an authored head. */
export function diagramDocument(
  kind: DiagramFamily,
  source: string,
  presentation: DiagramPresentation = originalDiagramPresentation,
): string {
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  const simplified =
    JSON.stringify(presentation) !==
    JSON.stringify(originalDiagramPresentation);
  const fitSvg = /<html\b|<body\b/i.test(source)
    ? ""
    : "body{margin:0;padding:12px}body>svg{display:block;width:100%;height:auto}";
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><!--\n${diagramLicense(kind).replaceAll("--", "—")}\n-->${source}<style>${fitSvg}${simplified ? diagramPresentationCss(presentation) : ""}</style>`;
}

export function diagramSourceFiles(kind: DiagramFamily) {
  return {
    "diagram-templates.json": JSON.stringify(
      {
        family: kind,
        license: licenses.find((item) => item.id === kind),
        templates: listDiagramTemplates(kind),
      },
      null,
      2,
    ),
  };
}
