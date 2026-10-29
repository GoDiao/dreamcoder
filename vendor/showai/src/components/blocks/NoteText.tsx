import { noteSegments } from "./note-markup.mjs";
import { installNoteBubbles } from "./note-bubble";

/** Props that turn any element into a hover-note anchor. */
// Bundlers may drop bare side-effect imports of shared modules, so every
// anchor installs the (idempotent) document controller explicitly.
export const noteProps = (note: string, focusable = true) => {
  installNoteBubbles();
  return {
    className: "showai-note",
    "data-showai-note": note,
    ...(focusable ? { tabIndex: 0 } : {}),
  };
};

/**
 * Plain text whose `[label]{note}` parts show their note on hover, focus or
 * tap. Everything else stays literal text, so titles, labels and custom
 * component fields can opt in without accepting other markup.
 */
export function NoteText({
  text,
  focusable = true,
}: {
  text: unknown;
  /** False inside buttons and links, which already take focus. */
  focusable?: boolean;
}) {
  return (
    <>
      {noteSegments(text).map((segment, index) =>
        segment.type === "note" ? (
          <span key={index} {...noteProps(segment.note, focusable)}>
            {segment.text}
          </span>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

/** The same text inside SVG: annotated parts become tspans. */
export function NoteSvgText({ text }: { text: unknown }) {
  return (
    <>
      {noteSegments(text).map((segment, index) =>
        segment.type === "note" ? (
          <tspan key={index} {...noteProps(segment.note, false)}>
            {segment.text}
          </tspan>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}
