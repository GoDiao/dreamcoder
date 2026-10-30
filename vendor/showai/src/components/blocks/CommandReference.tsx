import {
  type KeyboardEvent,
  type ReactNode,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BlockProps } from "./types";
import {
  commandMatches,
  matchRanges,
  searchTerms,
} from "./doc-reference-contract.mjs";
import { CodePanel } from "./StepGuide";
import { InlineMarkup as Inline } from "./InlineMarkup";
import "./command-reference.css";
import { blockLabel } from "./shared";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/commandReference";
import { NoteText } from "./NoteText";
import { useReaderSet, useReaderState } from "../../surface/reader-state";

type Param = { name: string; meaning: string };
type Command = {
  id?: string;
  group: string;
  command: string;
  summary: string;
  detail?: string;
  params?: Param[];
  examples?: { label?: string; code: string }[];
};
type Group = { id: string; label: string };
type Reference = {
  title?: string;
  description?: string;
  placeholder?: string;
  program?: string;
  groups: Group[];
  commands: Command[];
};
type Range = [number, number];

const ALL = "\u0000all";
/** Long groups show this many commands in the unfiltered overview. */
const LIMIT = 6;

/** text[from, to) with <mark> over the matched ranges. */
function marked(
  text: string,
  ranges: Range[],
  from = 0,
  to = text.length,
  key = "h",
): ReactNode[] {
  const out: ReactNode[] = [];
  let position = from;
  let n = 0;
  for (const [a, b] of ranges) {
    if (b <= position || a >= to) continue;
    const start = Math.max(a, position);
    const end = Math.min(b, to);
    if (start > position) out.push(text.slice(position, start));
    out.push(<mark key={`${key}${n++}`}>{text.slice(start, end)}</mark>);
    position = end;
  }
  if (position < to) out.push(text.slice(position, to));
  return out;
}
const highlighter = (terms: string[]) =>
  terms.length
    ? (text: string, key: string) => (
        <span key={key}>
          {marked(text, matchRanges(text, terms), 0, text.length, key)}
        </span>
      )
    : undefined;

/**
 * Command line: the program prefix muted, leading sub-command words bold,
 * flags and placeholders styled; search matches are highlighted across tokens.
 */
function CommandLine({
  text,
  terms,
  program,
}: {
  text: string;
  terms: string[];
  program?: string;
}) {
  const ranges = matchRanges(text, terms);
  const out: ReactNode[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  let position = 0;
  let first = true;
  let named = false;
  let verbs = true;
  let index = 0;
  while ((match = pattern.exec(text))) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;
    if (start > position) out.push(text.slice(position, start));
    let kind: string;
    if (first && program && token === program) kind = "prog";
    else if (
      !named &&
      /^[A-Za-z_][\w.-]*$/.test(token) &&
      !/^[A-Z][A-Z0-9_]*$/.test(token)
    ) {
      // A tool-style name (with _ or .) is the whole name; plain words may continue it ("pages read").
      kind = "verb";
      named = true;
      if (/[_.]/.test(token)) verbs = false;
    } else if (verbs && /^[a-z][a-z0-9-]*$/.test(token)) kind = "verb";
    else {
      verbs = false;
      kind = /^\[?-{1,2}[A-Za-z]/.test(token)
        ? "flag"
        : /^[[<(]?[A-Z][A-Z0-9_]*(?:[|,.][A-Z0-9_]+)*[\]>)]?\]?$|^[[<].*[\]>]$/.test(
              token,
            )
          ? "ph"
          : "arg";
    }
    first = false;
    out.push(
      <span
        key={index}
        className={`cr-${kind}${token.length > 32 ? " is-long" : ""}`}
      >
        {marked(text, ranges, start, end, `t${index}.`)}
      </span>,
    );
    index++;
    position = end;
  }
  if (position < text.length) out.push(text.slice(position));
  return <code className="cr-cmd">{out}</code>;
}

/** Paragraphs separated by blank lines; a paragraph whose lines all start with "- " becomes a list. */
function DetailText({ source }: { source: string }) {
  return (
    <>
      {source
        .trim()
        .split(/\n\s*\n/)
        .map((paragraph, index) => {
          const lines = paragraph.split("\n");
          if (lines.every((line) => /^\s*[-•]\s+/.test(line)))
            return (
              <ul key={index} className="cr-para">
                {lines.map((line, j) => (
                  <li key={j}>
                    <Inline source={line.replace(/^\s*[-•]\s+/, "")} />
                  </li>
                ))}
              </ul>
            );
          return (
            <p key={index} className="cr-para">
              {lines.map((line, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  <Inline source={line} />
                </span>
              ))}
            </p>
          );
        })}
    </>
  );
}

export function CommandReferenceBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const reference = data as unknown as Reference;
  const baseId = useId();
  const list = useMemo(
    () =>
      reference.commands.map((command, index) => ({
        ...command,
        key: command.id ?? `#${index}`,
      })),
    [reference.commands],
  );
  const [query, setQuery] = useState("");
  const [group, setGroup] = useReaderState("group", ALL, {
    accept: (value) =>
      value === ALL || reference.groups.some((entry) => entry.id === value),
  });
  const [open, setOpen] = useReaderSet("open");
  const [more, setMore] = useReaderSet("more");
  const deferred = useDeferredValue(query);
  const terms = useMemo(() => searchTerms(deferred), [deferred]);
  const mark = highlighter(terms);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const hits = useMemo(
    () =>
      terms.length
        ? list.filter((command) => commandMatches(command, terms))
        : list,
    [list, terms],
  );
  const sections = reference.groups.map((entry) => ({
    ...entry,
    total: list.filter((command) => command.group === entry.id).length,
    items: hits.filter((command) => command.group === entry.id),
  }));
  const shown = sections.filter(
    (section) =>
      (group === ALL || section.id === group) && section.items.length,
  );
  const shownCount = shown.reduce((n, section) => n + section.items.length, 0);
  const activeLabel = sections.find((section) => section.id === group)?.label;
  const multi = shown.length > 1 || group === ALL;
  const capped = (id: string, count: number) =>
    group === ALL && !terms.length && !more.has(id) && count > LIMIT + 2;

  const toggle = (key: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const clear = () => {
    setQuery("");
    input.current?.focus();
  };
  const rows = () => [
    ...(listRef.current?.querySelectorAll<HTMLButtonElement>(
      ".cr-row:not([hidden] *)",
    ) ?? []),
  ];
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
    }
    if (event.key === "ArrowDown") {
      const first = rows()[0];
      if (!first) return;
      event.preventDefault();
      first.focus();
    }
  };
  const onListKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const all = rows();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    if (event.key === "ArrowUp" && at === 0) input.current?.focus();
    else
      all[
        Math.max(
          0,
          Math.min(all.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)),
        )
      ]?.focus();
  };

  return (
    <section
      className="sb-block cr-block"
      aria-label={blockLabel(reference.title, t("title"))}
    >
      {(reference.title || reference.description) && (
        <div className="cr-head">
          {reference.title && (
            <h3 className="cr-heading">
              <NoteText text={reference.title} />
            </h3>
          )}
          {reference.description && (
            <p className="cr-sub">
              <Inline source={reference.description} />
            </p>
          )}
        </div>
      )}
      <div className="cr-search">
        <svg className="cr-glass" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.6" />
          <path d="M10.4 10.4l3.3 3.3" />
        </svg>
        <input
          ref={input}
          type="search"
          value={query}
          placeholder={reference.placeholder ?? t("placeholder")}
          aria-label={t("search")}
          aria-controls={`${baseId}-list`}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={onSearchKey}
        />
        {query ? (
          <button
            type="button"
            className="cr-clear"
            onClick={clear}
            aria-label={t("clear")}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5 5l6 6M11 5l-6 6" />
            </svg>
          </button>
        ) : (
          <span className="cr-total">{t("total", { count: list.length })}</span>
        )}
      </div>
      <p className="cr-status" role="status">
        {terms.length ? t("found", { count: hits.length }) : ""}
      </p>

      <div className="cr-chips" role="group" aria-label={t("filter")}>
        <button
          type="button"
          aria-pressed={group === ALL}
          onClick={() => setGroup(ALL)}
        >
          {t("all")}
          <span>{hits.length}</span>
        </button>
        {sections.map((section) => (
          <button
            type="button"
            key={section.id}
            aria-pressed={group === section.id}
            className={section.items.length ? undefined : "is-zero"}
            onClick={() =>
              setGroup((current) => (current === section.id ? ALL : section.id))
            }
          >
            {section.label}
            <span>{section.items.length}</span>
          </button>
        ))}
      </div>

      {shownCount ? (
        <div
          className="cr-list"
          id={`${baseId}-list`}
          ref={listRef}
          onKeyDown={onListKey}
        >
          {shown.map((section) => {
            const cut = capped(section.id, section.items.length);
            return (
              <section
                key={section.id}
                className="cr-section"
                aria-label={section.label}
              >
                {multi && (
                  <div className="cr-grouphead">
                    <span>{section.label}</span>
                    <span className="cr-groupcount">
                      {terms.length
                        ? t("groupCount", {
                            shown: section.items.length,
                            total: section.total,
                          })
                        : section.total}
                    </span>
                  </div>
                )}
                <ul>
                  {section.items.map((command, index) => {
                    const isOpen = open.has(command.key);
                    const detailId = `${baseId}-d${command.key}`;
                    const expandable = Boolean(
                      command.detail ||
                      command.params?.length ||
                      command.examples?.length,
                    );
                    // Parameters that matched when the command line and summary did not.
                    const paramHits = terms.length
                      ? (command.params ?? []).filter((param) =>
                          terms.some(
                            (term) =>
                              !command.command.toLowerCase().includes(term) &&
                              !command.summary.toLowerCase().includes(term) &&
                              `${param.name} ${param.meaning}`
                                .toLowerCase()
                                .includes(term),
                          ),
                        )
                      : [];
                    return (
                      <li
                        key={command.key}
                        className={`cr-item${isOpen ? " is-open" : ""}`}
                        // Capped commands stay in the document for print and static reading.
                        hidden={cut && index >= LIMIT}
                      >
                        <button
                          type="button"
                          className="cr-row"
                          aria-expanded={expandable ? isOpen : undefined}
                          aria-controls={expandable ? detailId : undefined}
                          data-static={expandable ? undefined : ""}
                          onClick={() => expandable && toggle(command.key)}
                        >
                          <span className="cr-main">
                            <CommandLine
                              text={command.command}
                              terms={terms}
                              program={reference.program}
                            />
                            <span className="cr-summary">
                              <Inline
                                source={command.summary}
                                mark={mark}
                                links={false}
                              />
                            </span>
                            {paramHits.length > 0 && (
                              <span className="cr-paramhits">
                                {t("params")}
                                {paramHits.slice(0, 4).map((param) => (
                                  <code key={param.name}>
                                    {mark
                                      ? mark(param.name, param.name)
                                      : param.name}
                                  </code>
                                ))}
                              </span>
                            )}
                          </span>
                          {expandable && (
                            <svg
                              className="cr-chev"
                              viewBox="0 0 12 12"
                              aria-hidden="true"
                            >
                              <path d="M3 4.75L6 7.75 9 4.75" />
                            </svg>
                          )}
                        </button>
                        {expandable && (
                          <div
                            className="cr-detail"
                            id={detailId}
                            hidden={!isOpen}
                          >
                            {command.detail && (
                              <div className="cr-body">
                                <DetailText source={command.detail} />
                              </div>
                            )}
                            {command.params && command.params.length > 0 && (
                              <table className="cr-params">
                                <thead>
                                  <tr>
                                    <th scope="col">{t("paramName")}</th>
                                    <th scope="col">{t("paramMeaning")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {command.params.map((param) => (
                                    <tr key={param.name}>
                                      <th scope="row">
                                        <code>
                                          {mark
                                            ? mark(param.name, param.name)
                                            : param.name}
                                        </code>
                                      </th>
                                      <td>
                                        <Inline source={param.meaning} />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {command.examples &&
                              command.examples.length > 0 && (
                                <CodePanel
                                  variants={command.examples.map(
                                    (example, e) => ({
                                      label:
                                        example.label ??
                                        (command.examples!.length > 1
                                          ? `${t("example")} ${e + 1}`
                                          : t("example")),
                                      code: example.code,
                                    }),
                                  )}
                                  name={t("exampleName", {
                                    command: command.command,
                                  })}
                                />
                              )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {cut && (
                  <button
                    type="button"
                    className="cr-more"
                    onClick={() =>
                      setMore((previous) => new Set(previous).add(section.id))
                    }
                  >
                    {t("showMore", {
                      count: section.items.length - LIMIT,
                      group: section.label,
                    })}
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M3 4.75L6 7.75 9 4.75" />
                    </svg>
                  </button>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="cr-empty">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="18" cy="18" r="10" />
            <path d="M25.5 25.5l7 7" />
            <path d="M14 18h8" />
          </svg>
          <p className="cr-emptytitle">
            {query.trim()
              ? group !== ALL && activeLabel
                ? t("noMatchIn", { query: query.trim(), group: activeLabel })
                : t("noMatch", { query: query.trim() })
              : t("emptyGroup", { group: activeLabel ?? "" })}
          </p>
          <p className="cr-emptyhint">{t("emptyHint")}</p>
          <div className="cr-emptyactions">
            {group !== ALL && hits.length > 0 && (
              <button type="button" onClick={() => setGroup(ALL)}>
                {t("viewAll", { count: hits.length })}
              </button>
            )}
            {query && (
              <button type="button" onClick={clear}>
                {t("clear")}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
