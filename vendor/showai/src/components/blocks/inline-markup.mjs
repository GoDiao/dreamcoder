// Inline markup shared by documentation-style built-ins: **bold**, `code`,
// [label](href) and hover notes [label]{note}. Parsing is pure so contracts,
// the CLI and the portable reader agree on what counts as a link or a note;
// rendering never uses raw HTML.
import { findNote, plainNotes } from "./note-markup.mjs";
import { parsePageLink } from "../../portable/page-link.mjs";

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Links may only reach http(s), mailto, in-page anchors, ShowAI pages or relative paths. */
export function isSafeHref(href) {
  if (
    typeof href !== "string" ||
    !href.trim() ||
    /[\s\u0000-\u001f]/.test(href)
  )
    return false;
  if (/^(https?:\/\/[^/]|mailto:)/i.test(href) || parsePageLink(href))
    return true;
  // Anything else with a scheme (javascript:, data:, file:…) or a protocol-relative host is refused.
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//");
}

/** Http(s) links open in a new tab; mailto, anchors and relative paths stay in place. */
export const isExternalHref = (href) => /^https?:\/\//i.test(href);

/**
 * Split inline markup into segments. Bold and link labels keep nested
 * segments; links keep their raw href so validators can report unsafe targets
 * and renderers can fall back to the label.
 */
export function parseInline(source) {
  const out = [];
  const pattern = new RegExp(INLINE.source, "g");
  let position = 0;
  let match;
  for (;;) {
    pattern.lastIndex = position;
    match = pattern.exec(source);
    const note = findNote(source, position);
    if (note && (!match || note.index <= match.index)) {
      if (note.index > position)
        out.push({ type: "text", text: source.slice(position, note.index) });
      out.push({
        type: "note",
        note: note.note,
        children: parseInline(note.label),
      });
      position = note.end;
      continue;
    }
    if (!match) break;
    if (match.index > position)
      out.push({ type: "text", text: source.slice(position, match.index) });
    if (match[1] !== undefined)
      out.push({ type: "strong", children: parseInline(match[1]) });
    else if (match[2] !== undefined) out.push({ type: "code", text: match[2] });
    else
      out.push({
        type: "link",
        href: match[4],
        children: parseInline(match[3]),
      });
    position = pattern.lastIndex;
  }
  if (position < source.length)
    out.push({ type: "text", text: source.slice(position) });
  return out;
}

/** Inline markup reduced to its visible text; notes keep only their label. */
export const plainInline = (source) =>
  plainNotes(source).replace(
    INLINE,
    (_, bold, code, label) => bold ?? code ?? label,
  );

/** Unsafe link targets in the markup, in order of appearance. */
export function unsafeInlineLinks(source) {
  const found = [];
  const visit = (segments) => {
    for (const segment of segments) {
      if (segment.type === "link" && !isSafeHref(segment.href))
        found.push(segment.href);
      if (segment.children) visit(segment.children);
    }
  };
  visit(parseInline(source));
  return found;
}
