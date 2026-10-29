import {
  Fragment,
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BlockProps } from "./types";
import {
  normalizePath,
  pathSegment,
  plainInline,
  structureOutline,
  type StructureItem,
  type StructureKind,
  type StructureNode,
} from "./doc-browse-contract.mjs";
import { InlineMarkup as InlineText } from "./InlineMarkup";
import "./structure-browser.css";
import { blockLabel } from "./shared";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/structureBrowser";
import { NoteText } from "./NoteText";
import {
  isRecord,
  isStringList,
  useReaderState,
  useResetOnChange,
} from "../../surface/reader-state";

type Structure = {
  title?: string;
  nodes: StructureNode[];
  initial?: string;
  caption?: string;
};
type Outline = ReturnType<typeof structureOutline>;

/** Blank lines separate paragraphs; a paragraph whose lines all start with "- " is a list. */
function Paragraphs({ source }: { source: string }) {
  return source
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph, index) => {
      const lines = paragraph.split("\n");
      if (lines.every((line) => /^\s*[-•]\s+/.test(line)))
        return (
          <ul key={index} className="stb-para">
            {lines.map((line, row) => (
              <li key={row}>
                <InlineText source={line.replace(/^\s*[-•]\s+/, "")} />
              </li>
            ))}
          </ul>
        );
      return (
        <p key={index} className="stb-para">
          {lines.map((line, row) => (
            <Fragment key={row}>
              {row > 0 && <br />}
              <InlineText source={line} />
            </Fragment>
          ))}
        </p>
      );
    });
}

function KindIcon({ kind, open }: { kind: StructureKind; open?: boolean }) {
  if (kind === "dir")
    return (
      <svg
        className={`stb-icon is-dir${open ? " is-open" : ""}`}
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <path d="M1.75 4.25c0-.69.56-1.25 1.25-1.25h2.6l1.4 1.5h6c.69 0 1.25.56 1.25 1.25v6c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25z" />
      </svg>
    );
  if (kind === "file")
    return (
      <svg className="stb-icon is-file" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 1.75h5.2L12.75 5.3v8.2c0 .41-.34.75-.75.75H4a.75.75 0 0 1-.75-.75V2.5c0-.41.34-.75.75-.75z" />
        <path d="M9 1.9v3.6h3.6" />
      </svg>
    );
  if (kind === "object")
    return (
      <span className="stb-icon is-glyph is-object" aria-hidden="true">
        {"{}"}
      </span>
    );
  if (kind === "array")
    return (
      <span className="stb-icon is-glyph is-array" aria-hidden="true">
        [ ]
      </span>
    );
  return (
    <svg className="stb-icon is-field" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="5"
        y="5"
        width="6"
        height="6"
        rx="1.5"
        transform="rotate(45 8 8)"
      />
    </svg>
  );
}

function CodePanel({
  code,
  lang,
  name,
}: {
  code: string;
  lang?: string;
  name: string;
}) {
  const t = useTranslator(messages);
  const ref = useRef<HTMLElement>(null);
  const timer = useRef<number>(undefined);
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const settle = (next: "copied" | "selected") => {
    setState(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => setState("idle"),
      next === "copied" ? 1500 : 4000,
    );
  };
  // Where the clipboard is unavailable (sandboxed reader), select the code for a manual copy.
  const selectCode = () => {
    const selection = window.getSelection();
    if (ref.current && selection) {
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    settle("selected");
  };
  const copy = () => {
    if (!navigator.clipboard) return selectCode();
    navigator.clipboard
      .writeText(code)
      .then(() => settle("copied"), selectCode);
  };
  return (
    <div className="stb-code">
      <div className="stb-codebar">
        <span className="stb-lang">{lang || t("example")}</span>
        <span className="stb-copystate" aria-live="polite">
          {state === "selected" ? t("selectedToCopy") : ""}
        </span>
        <button
          type="button"
          className={`stb-copy${state === "copied" ? " is-done" : ""}`}
          aria-label={t("copyLabel", { name })}
          onClick={copy}
        >
          {state === "copied" ? (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 8.5l3 3 6-6.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" />
              <path d="M10.5 3.5v-.4A1.6 1.6 0 0 0 8.9 1.5H4.1A1.6 1.6 0 0 0 2.5 3.1v4.8a1.6 1.6 0 0 0 1.6 1.6h.4" />
            </svg>
          )}
          {state === "copied" ? t("copied") : t("copy")}
        </button>
      </div>
      <pre className="stb-pre">
        <code ref={ref}>{code}</code>
      </pre>
    </div>
  );
}

/** Selection and open set at load: the initial path and its ancestors open, else nodes marked open. */
function initialView({ items, roots }: Outline, initial?: string) {
  const open = new Set<string>();
  for (const item of items.values())
    if (item.node.open && item.children.length) open.add(item.path);
  const target = initial ? normalizePath(initial) : "";
  const resolved = items.has(target) ? target : null;
  const selected = resolved ?? roots[0] ?? null;
  if (resolved) {
    for (
      let path: string | null = resolved;
      path;
      path = items.get(path)!.parent
    )
      if (items.get(path)!.children.length) open.add(path);
  } else if (!open.size && selected && items.get(selected)!.children.length)
    open.add(selected);
  return { selected, open };
}

/** Every node expanded with its summary, for print and static reading. */
function PrintOutline({
  paths,
  outline,
}: {
  paths: string[];
  outline: Outline;
}) {
  return (
    <ul>
      {paths.map((path) => {
        const item = outline.items.get(path)!;
        return (
          <li key={path}>
            <span className="stb-print-name">{item.node.name}</span>
            {item.node.type && (
              <span className="stb-type">{item.node.type}</span>
            )}
            {item.node.badge && (
              <span className="stb-badge">{item.node.badge}</span>
            )}
            {item.node.summary && (
              <span className="stb-print-summary">
                {" — "}
                <InlineText source={item.node.summary} links={false} />
              </span>
            )}
            {item.children.length > 0 && (
              <PrintOutline paths={item.children} outline={outline} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function StructureBrowserBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const model = data as unknown as Structure;
  const outline = useMemo(
    () => structureOutline(model.nodes ?? []),
    [model.nodes],
  );
  const { items, roots } = outline;
  const [saved, setSaved] = useReaderState<{
    selected: string | null;
    open: string[];
  }>(
    "view",
    () => {
      const view = initialView(outline, model.initial);
      return { selected: view.selected, open: [...view.open] };
    },
    {
      accept: (value) =>
        isRecord(value) &&
        (value.selected === null || items.has(value.selected as string)) &&
        isStringList(value.open),
    },
  );
  const view = useMemo(
    () => ({ selected: saved.selected as string, open: new Set(saved.open) }),
    [saved],
  );
  const setView = (
    action: (current: ReturnType<typeof initialView>) => ReturnType<
      typeof initialView
    >,
  ) =>
    setSaved((current) => {
      // initialView types its selection as present; an empty outline has none.
      const next = action({
        selected: current.selected as string,
        open: new Set(current.open),
      });
      return { selected: next.selected, open: [...next.open] };
    });
  // Reading state restarts when the instance's structure or initial path changes.
  useResetOnChange(
    JSON.stringify([[...items.keys()], model.initial ?? null]),
    () => setView(() => initialView(outline, model.initial)),
  );
  const { selected, open } = view;

  const select = (path: string, toggle?: "open" | "close" | "flip") =>
    setView((current) => {
      const next = new Set(current.open);
      if (toggle === "open" || (toggle === "flip" && !next.has(path)))
        next.add(path);
      else if (toggle === "close" || toggle === "flip") next.delete(path);
      return { selected: path, open: next };
    });
  const reveal = (path: string) =>
    setView((current) => {
      const next = new Set(current.open);
      for (let p = items.get(path)?.parent ?? null; p; p = items.get(p)!.parent)
        next.add(p);
      return { selected: path, open: next };
    });

  const visible = useMemo(() => {
    const out: StructureItem[] = [];
    const walk = (paths: string[]) => {
      for (const path of paths) {
        const item = items.get(path)!;
        out.push(item);
        if (item.children.length && open.has(path)) walk(item.children);
      }
    };
    walk(roots);
    return out;
  }, [items, roots, open]);

  // Keyboard moves keep focus on the selected row (roving tabindex).
  const rows = useRef(new Map<string, HTMLDivElement>());
  const fromKeyboard = useRef(false);
  useLayoutEffect(() => {
    if (fromKeyboard.current && selected) rows.current.get(selected)?.focus();
    fromKeyboard.current = false;
  }, [selected, visible]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!selected) return;
    const item = items.get(selected)!;
    const index = visible.findIndex((entry) => entry.path === selected);
    const go = (path?: string | null, toggle?: "open" | "close" | "flip") => {
      event.preventDefault();
      if (!path) return;
      fromKeyboard.current = true;
      select(path, toggle);
    };
    switch (event.key) {
      case "ArrowDown":
        return go(visible[index + 1]?.path);
      case "ArrowUp":
        return go(visible[index - 1]?.path);
      case "Home":
        return go(visible[0]?.path);
      case "End":
        return go(visible[visible.length - 1]?.path);
      case "ArrowRight":
        if (!item.children.length) return event.preventDefault();
        return open.has(selected) ? go(item.children[0]) : go(selected, "open");
      case "ArrowLeft":
        return item.children.length && open.has(selected)
          ? go(selected, "close")
          : go(item.parent);
      case "Enter":
      case " ":
        return item.children.length
          ? go(selected, "flip")
          : event.preventDefault();
    }
  };

  const current = selected ? items.get(selected) : undefined;
  const crumbs: StructureItem[] = [];
  for (let path: string | null = selected; path; path = items.get(path)!.parent)
    crumbs.unshift(items.get(path)!);
  const siblingsOf = (item: StructureItem) =>
    item.parent ? items.get(item.parent)!.children : roots;

  return (
    <section
      className="sb-block stb-block"
      aria-label={blockLabel(model.title, t("title"))}
    >
      {model.title && (
        <h3 className="stb-heading">
          <NoteText text={model.title} />
        </h3>
      )}
      <div className="stb-frame">
        <div className="stb-nav">
          <div
            className="stb-tree"
            role="tree"
            aria-label={t("tree")}
            onKeyDown={onKeyDown}
          >
            {visible.map((item) => {
              const isOpen = open.has(item.path);
              const isSelected = item.path === selected;
              const siblings = siblingsOf(item);
              return (
                <div
                  key={item.path}
                  ref={(element) => {
                    if (element) rows.current.set(item.path, element);
                    else rows.current.delete(item.path);
                  }}
                  role="treeitem"
                  aria-level={item.depth + 1}
                  aria-setsize={siblings.length}
                  aria-posinset={siblings.indexOf(item.path) + 1}
                  aria-selected={isSelected}
                  aria-expanded={item.children.length ? isOpen : undefined}
                  tabIndex={isSelected ? 0 : -1}
                  className={`stb-row${isSelected ? " is-selected" : ""}`}
                  style={{ "--depth": item.depth } as CSSProperties}
                  onClick={() =>
                    select(
                      item.path,
                      item.children.length && (!isOpen || isSelected)
                        ? "flip"
                        : undefined,
                    )
                  }
                >
                  {Array.from({ length: item.depth }, (_, level) => (
                    <i
                      key={level}
                      className="stb-guide"
                      style={{ "--level": level } as CSSProperties}
                      aria-hidden="true"
                    />
                  ))}
                  <span
                    className={`stb-chevron${item.children.length ? "" : " is-none"}${isOpen ? " is-open" : ""}`}
                    aria-hidden="true"
                    title={
                      item.children.length
                        ? t("toggle", { name: item.node.name })
                        : undefined
                    }
                    onClick={(event) => {
                      if (!item.children.length) return;
                      // The chevron only expands or collapses; selection stays.
                      event.stopPropagation();
                      setView((state) => {
                        const next = new Set(state.open);
                        if (next.has(item.path)) next.delete(item.path);
                        else next.add(item.path);
                        return { ...state, open: next };
                      });
                    }}
                  >
                    {item.children.length > 0 && (
                      <svg viewBox="0 0 12 12">
                        <path d="M4.5 2.75L7.75 6 4.5 9.25" />
                      </svg>
                    )}
                  </span>
                  <KindIcon kind={item.kind} open={isOpen} />
                  <span className="stb-name">{item.node.name}</span>
                  {item.node.type && (
                    <span className="stb-type">{item.node.type}</span>
                  )}
                  {item.node.badge && (
                    <span className="stb-badge">{item.node.badge}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="stb-detail" aria-live="polite">
          {current ? (
            <>
              <nav className="stb-crumbs" aria-label={t("path")}>
                {crumbs.map((crumb, index) => (
                  <Fragment key={crumb.path}>
                    {index > 0 && (
                      <span className="stb-sep" aria-hidden="true">
                        /
                      </span>
                    )}
                    {index < crumbs.length - 1 ? (
                      <button type="button" onClick={() => select(crumb.path)}>
                        {pathSegment(crumb.node.name)}
                      </button>
                    ) : (
                      <span aria-current="location">
                        {pathSegment(crumb.node.name)}
                      </span>
                    )}
                  </Fragment>
                ))}
              </nav>
              <div className="stb-title">
                <KindIcon kind={current.kind} />
                <h4>{current.node.name}</h4>
                {current.node.type && (
                  <span className="stb-dtype">{current.node.type}</span>
                )}
                {current.node.badge && (
                  <span className="stb-badge">{current.node.badge}</span>
                )}
              </div>
              <div className="stb-meta">
                {t(`kind.${current.kind}`)}
                {current.children.length > 0 &&
                  ` · ${t("childCount", { count: current.children.length })}`}
              </div>
              {current.node.summary && (
                <p className="stb-summary">
                  <InlineText source={current.node.summary} />
                </p>
              )}
              {current.node.detail && (
                <div className="stb-body">
                  <Paragraphs source={current.node.detail} />
                </div>
              )}
              {current.node.example && (
                <CodePanel
                  key={current.path}
                  code={current.node.example}
                  lang={current.node.exampleLang}
                  name={current.node.name}
                />
              )}
              {current.children.length > 0 && (
                <div className="stb-kids">
                  <div className="stb-kidshead">{t("contains")}</div>
                  {current.children.map((path) => {
                    const child = items.get(path)!;
                    return (
                      <button
                        type="button"
                        key={path}
                        className="stb-kid"
                        onClick={() => reveal(path)}
                      >
                        <KindIcon kind={child.kind} />
                        <span className="stb-kidname">{child.node.name}</span>
                        {child.node.summary && (
                          <span className="stb-kidsum">
                            {plainInline(child.node.summary)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {!current.node.summary &&
                !current.node.detail &&
                !current.node.example &&
                !current.children.length && (
                  <p className="stb-empty">{t("noDetail")}</p>
                )}
            </>
          ) : (
            <p className="stb-empty">{t("empty")}</p>
          )}
        </div>
      </div>
      <div className="stb-print">
        <PrintOutline paths={roots} outline={outline} />
      </div>
      {model.caption && (
        <p className="stb-caption">
          <InlineText source={model.caption} />
        </p>
      )}
    </section>
  );
}
