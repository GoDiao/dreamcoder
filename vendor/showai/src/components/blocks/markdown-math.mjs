import { Marked } from "marked";
import katex from "katex";
import { attachLatexNotes, prepareNoteLatex } from "./note-markup.mjs";

// A private lexer keeps math from changing other consumers of marked (and code spans).
function formula(source, display, delimiter) {
  if (!source.startsWith(delimiter)) return;
  const close =
    delimiter === "\\(" ? "\\)" : delimiter === "\\[" ? "\\]" : delimiter;
  let end = source.indexOf(close, delimiter.length);
  while (end !== -1) {
    let escapes = 0;
    for (let i = end - 1; i >= 0 && source[i] === "\\"; i--) escapes++;
    if (escapes % 2 === 0) break;
    end = source.indexOf(close, end + close.length);
  }
  if (end === -1) return;
  const content = source.slice(delimiter.length, end);
  if (
    !content.trim() ||
    /`/.test(content) ||
    (!display &&
      (/\n/.test(content) || (delimiter === "$" && /^\s|\s$/.test(content))))
  )
    return;
  if (delimiter === "$" && source[1] === "$") return;
  if (
    delimiter === "$" &&
    /^\d/.test(content) &&
    /[\u3000-\u9fff]|\d\s+[A-Za-z]/.test(content)
  )
    return;
  return {
    type: display ? "mathBlock" : "mathInline",
    raw: source.slice(0, end + close.length),
    text: content,
    display,
  };
}

/** KaTeX HTML; `\note{part}{text}` marks parts that show a hover note. */
export function mathHtml(source, display = false) {
  const { latex, notes } = prepareNoteLatex(source);
  const html = katex.renderToString(latex, {
    displayMode: display,
    throwOnError: false,
    // Only the placeholders written by prepareNoteLatex need \htmlData.
    trust: notes.length
      ? (context) => context.command === "\\htmlData"
      : false,
    strict: false,
    output: "htmlAndMathml",
    maxExpand: 1000,
    maxSize: 20,
  });
  return attachLatexNotes(html, notes);
}

/** Block and inline math, shared by lexers that add their own syntax. */
export const mathExtensions = [
  {
    name: "mathBlock",
    level: "block",
    start: (source) => source.search(/(?:^|\n)[ \t]*(?:\$\$|\\\[)/),
    tokenizer(source) {
      const trimmed = source.replace(/^[ \t]{0,3}/, "");
      const token =
        formula(trimmed, true, "$$") ?? formula(trimmed, true, "\\[");
      if (
        !token ||
        !/^(?:[ \t]*\n|[ \t]*$)/.test(trimmed.slice(token.raw.length))
      )
        return;
      token.raw = source.slice(
        0,
        source.length - trimmed.length + token.raw.length,
      );
      return token;
    },
    renderer: (token) =>
      `<div class="sb-math-display">${mathHtml(token.text, true)}</div>`,
  },
  {
    name: "mathInline",
    level: "inline",
    start: (source) => source.search(/\$|\\[([]/),
    tokenizer(source) {
      return (
        formula(source, true, "$$") ??
        formula(source, true, "\\[") ??
        formula(source, false, "\\(") ??
        formula(source, false, "$")
      );
    },
    renderer: (token) =>
      `<span class="${token.display ? "sb-math-display" : "sb-math-inline"}">${mathHtml(token.text, token.display)}</span>`,
  },
];

export const mathMarkdown = new Marked({ extensions: mathExtensions });
