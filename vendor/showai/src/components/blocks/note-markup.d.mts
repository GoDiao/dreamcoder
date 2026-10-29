export type NoteMatch = {
  raw: string;
  label: string;
  note: string;
  end: number;
};
export type NoteSegment =
  | { type: "text"; text: string }
  | { type: "note"; text: string; note: string };

export const NOTE_MAX: number;
export function matchNote(source: string, start?: number): NoteMatch | null;
export function findNote(
  source: string,
  from?: number,
): (NoteMatch & { index: number }) | null;
export function noteSegments(source: unknown): NoteSegment[];
export function plainNotes(source: unknown): string;
export function textNotes(source: unknown): { text: string; note: string }[];
export function prepareNoteLatex(latex: string): {
  latex: string;
  notes: string[];
};
export function attachLatexNotes(html: string, notes: string[]): string;
export function annotateLatex(latex: string, note: string): string;
export function outerLatexNote(
  latex: string,
): { body: string; note: string } | null;
export const noteMarkdownExtension: import("marked").TokenizerAndRendererExtension | null;
export function invalidNoteMark(mark: unknown): boolean;
