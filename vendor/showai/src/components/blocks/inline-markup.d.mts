export type InlineSegment =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: InlineSegment[] }
  | { type: "link"; href: string; children: InlineSegment[] }
  | { type: "note"; note: string; children: InlineSegment[] };

export function isSafeHref(href: unknown): boolean;
export function isExternalHref(href: string): boolean;
export function parseInline(source: string): InlineSegment[];
export function plainInline(source: string): string;
export function unsafeInlineLinks(source: string): string[];
