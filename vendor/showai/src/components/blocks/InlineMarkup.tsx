import type { ReactNode } from "react";
import {
  isExternalHref,
  isSafeHref,
  parseInline,
  type InlineSegment,
} from "./inline-markup.mjs";
import { noteProps } from "./NoteText";

/** Wraps plain and code text, e.g. to highlight search matches. */
export type InlineMark = (text: string, key: string) => ReactNode;

function render(
  segments: InlineSegment[],
  links: boolean,
  key: string,
  mark?: InlineMark,
): ReactNode[] {
  return segments.map((segment, index) => {
    const id = `${key}.${index}`;
    if (segment.type === "text")
      return mark ? mark(segment.text, id) : segment.text;
    if (segment.type === "code")
      return (
        <code key={id}>{mark ? mark(segment.text, id) : segment.text}</code>
      );
    if (segment.type === "strong")
      return (
        <strong key={id}>{render(segment.children, links, id, mark)}</strong>
      );
    if (segment.type === "note")
      return (
        <span key={id} {...noteProps(segment.note)}>
          {render(segment.children, links, id, mark)}
        </span>
      );
    const label = render(segment.children, false, id, mark);
    if (!links || !isSafeHref(segment.href))
      return <span key={id}>{label}</span>;
    return isExternalHref(segment.href) ? (
      <a key={id} href={segment.href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    ) : (
      <a key={id} href={segment.href}>
        {label}
      </a>
    );
  });
}

/**
 * **bold**, `code`, safe [label](href) and hover notes [label]{note} as React
 * elements; never HTML.
 * `links={false}` keeps link labels as text, e.g. inside a card that is itself a link.
 */
export function InlineMarkup({
  source,
  links = true,
  mark,
}: {
  source: string;
  links?: boolean;
  mark?: InlineMark;
}) {
  return <>{render(parseInline(source), links, "i", mark)}</>;
}
