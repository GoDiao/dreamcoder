// Hover notes shared by every ShowAI text surface. Text uses
// [visible text]{note}; formulas use \note{part}{note} inside LaTeX. Parsing is
// pure so rich text import, inline markup, charts, the CLI and the portable
// reader agree on the same syntax.

/** Longest note a reader is expected to read in a hover bubble. */
export const NOTE_MAX = 1000;

const escaped = (source, index) => {
  let count = 0;
  for (let i = index - 1; i >= 0 && source[i] === "\\"; i--) count++;
  return count % 2 === 1;
};

/** Index just past the brace group opening at `start`, or -1 when unbalanced. */
function braceEnd(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Match `[label]{note}` starting at `start`. The label may contain inline
 * formulas such as `$x_t$`; the note may contain balanced braces, so formulas
 * like `$\bar{\alpha}_t$` work in notes too.
 */
export function matchNote(source, start = 0) {
  if (source[start] !== "[" || escaped(source, start)) return null;
  let i = start + 1;
  for (; i < source.length; i++) {
    const char = source[i];
    if (char === "\n") return null;
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "$") {
      const close = source.indexOf("$", i + 1);
      if (close === -1) return null;
      i = close;
      continue;
    }
    if (char === "[") return null;
    if (char === "]") break;
  }
  if (i >= source.length || source[i + 1] !== "{") return null;
  const label = source.slice(start + 1, i);
  const end = braceEnd(source, i + 1);
  if (!label.trim() || end === -1) return null;
  const note = source.slice(i + 2, end - 1).trim();
  if (!note || note.length > NOTE_MAX) return null;
  return { raw: source.slice(start, end), label, note, end };
}

/** First `[label]{note}` at or after `from`. */
export function findNote(source, from = 0) {
  for (
    let index = source.indexOf("[", from);
    index !== -1;
    index = source.indexOf("[", index + 1)
  ) {
    const match = matchNote(source, index);
    if (match) return { index, ...match };
  }
  return null;
}

/** Split plain text into literal text and annotated labels. */
export function noteSegments(source) {
  const text = String(source ?? "");
  const segments = [];
  let position = 0;
  for (let match = findNote(text); match; match = findNote(text, position)) {
    if (match.index > position)
      segments.push({ type: "text", text: text.slice(position, match.index) });
    segments.push({ type: "note", text: match.label, note: match.note });
    position = match.end;
  }
  if (position < text.length)
    segments.push({ type: "text", text: text.slice(position) });
  return segments;
}

/** Text as a reader sees it before hovering: labels stay, notes go. */
export const plainNotes = (source) =>
  noteSegments(source)
    .map((segment) => segment.text)
    .join("");

/** Notes in order of appearance, e.g. for a static summary or search. */
export const textNotes = (source) =>
  noteSegments(source)
    .filter((segment) => segment.type === "note")
    .map(({ text, note }) => ({ text, note }));

/**
 * Replace `\note{part}{text}` with a KaTeX data attribute placeholder. Notes
 * are returned separately because KaTeX attribute values cannot hold commas.
 */
export function prepareNoteLatex(latex) {
  const notes = [];
  const visit = (source) => {
    let out = "";
    let position = 0;
    const pattern = /\\note(?![A-Za-z])\s*/g;
    let match;
    while ((match = pattern.exec(source))) {
      if (escaped(source, match.index)) continue;
      const bodyStart = pattern.lastIndex;
      if (source[bodyStart] !== "{") continue;
      const bodyEnd = braceEnd(source, bodyStart);
      if (bodyEnd === -1) continue;
      let noteStart = bodyEnd;
      while (/\s/.test(source[noteStart] ?? "")) noteStart++;
      if (source[noteStart] !== "{") continue;
      const noteEnd = braceEnd(source, noteStart);
      if (noteEnd === -1) continue;
      const note = source.slice(noteStart + 1, noteEnd - 1).trim();
      const body = visit(source.slice(bodyStart + 1, bodyEnd - 1));
      out += source.slice(position, match.index);
      if (note && note.length <= NOTE_MAX) {
        notes.push(note);
        out += `\\htmlData{showai-note=${notes.length - 1}}{${body}}`;
      } else out += `{${body}}`;
      position = noteEnd;
      pattern.lastIndex = noteEnd;
    }
    return out + source.slice(position);
  };
  return { latex: visit(String(latex ?? "")), notes };
}

const attribute = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** Put note texts back on the KaTeX elements that carry their placeholders. */
export function attachLatexNotes(html, notes) {
  if (!notes.length) return html;
  return html.replace(/data-showai-note="(\d+)"/g, (whole, index) => {
    const note = notes[Number(index)];
    return note === undefined
      ? whole
      : `data-showai-note="${attribute(note)}" tabindex="0"`;
  });
}

/** Wrap a formula so the whole expression shows `note` on hover. */
export const annotateLatex = (latex, note) => `\\note{${latex}}{${note}}`;

/** `{ body, note }` when the whole formula is one `\note{body}{note}`. */
export function outerLatexNote(latex) {
  const source = String(latex ?? "").trim();
  const head = /^\\note\s*/.exec(source);
  if (!head || source[head[0].length] !== "{") return null;
  const bodyEnd = braceEnd(source, head[0].length);
  if (bodyEnd === -1) return null;
  let noteStart = bodyEnd;
  while (/\s/.test(source[noteStart] ?? "")) noteStart++;
  if (source[noteStart] !== "{") return null;
  const noteEnd = braceEnd(source, noteStart);
  if (noteEnd !== source.length) return null;
  return {
    body: source.slice(head[0].length + 1, bodyEnd - 1),
    note: source.slice(noteStart + 1, noteEnd - 1).trim(),
  };
}

/** Marked inline extension that reads [label]{note} as an annotation token. */
export const noteMarkdownExtension = {
  name: "annotation",
  level: "inline",
  start: (source) => findNote(source)?.index,
  tokenizer(source) {
    const match = matchNote(source);
    if (match)
      return {
        type: "annotation",
        raw: match.raw,
        note: match.note,
        tokens: this.lexer.inlineTokens(match.label),
      };
  },
};

/** True for an annotation mark whose note is missing, blank or too long. */
export const invalidNoteMark = (mark) =>
  mark?.type === "annotation" &&
  (typeof mark.attrs?.note !== "string" ||
    !mark.attrs.note.trim() ||
    mark.attrs.note.length > NOTE_MAX);
