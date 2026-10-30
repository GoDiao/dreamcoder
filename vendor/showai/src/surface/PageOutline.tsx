import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { JSONContent } from "@tiptap/core";
import { ChevronRight, ListTree, Pin, PinOff, X, Settings2 } from "../ui/icons";
import { useAvailableComponents } from "../components/custom/CustomBlock";
import { useAppearanceTheme } from "../design/useAppearanceTheme";
import { useLocale, useTranslator } from "../i18n/react";
import messages from "../i18n/messages/pageOutline";
import { OutlineRenderer } from "./OutlineRenderer";
import {
  buildPageOutline,
  flattenOutline,
  outlinePlacement,
  type NativePageOutline,
  type OutlinePlacement,
  type OutlineViewState,
  type PageOutlineComponentProps,
  type PageOutlineItem,
} from "./page-outline.mjs";
import "./page-outline.css";

export function ReadingIndex({
  outline,
  navigate,
  setBranchExpanded,
}: PageOutlineComponentProps) {
  const t = useTranslator(messages);
  const expanded = new Set(outline.expandedItemIds);
  const render = (items: PageOutlineItem[]) => (
    <ol>
      {items.map((item) => (
        <li key={item.id}>
          <div className="page-outline-row">
            {item.children.length > 0 && (
              <button
                type="button"
                className="page-outline-branch"
                aria-expanded={expanded.has(item.id)}
                aria-label={`${expanded.has(item.id) ? t("collapse") : t("expand")} ${item.title}`}
                onClick={() =>
                  setBranchExpanded(item.id, !expanded.has(item.id))
                }
              >
                <ChevronRight size={12} />
              </button>
            )}
            {item.navigable ? (
              <button
                type="button"
                className="page-outline-item"
                aria-current={
                  outline.activeItemId === item.id ? "location" : undefined
                }
                onClick={() => navigate(item.id)}
              >
                {item.title}
              </button>
            ) : (
              <span className="page-outline-item">{item.title}</span>
            )}
          </div>
          {item.children.length > 0 &&
            expanded.has(item.id) &&
            render(item.children)}
        </li>
      ))}
    </ol>
  );
  return outline.items.length ? (
    <nav aria-label={t("title")}>{render(outline.items)}</nav>
  ) : (
    <p className="page-outline-empty">{t("empty")}</p>
  );
}
export interface PageOutlineHostProps {
  page: JSONContent;
  documentId: string;
  scroll: RefObject<HTMLDivElement | null>;
  shell: RefObject<HTMLDivElement | null>;
  view: OutlineViewState;
  /** Called after the reader opens, pins or folds part of the outline. */
  onViewChange?: (view: OutlineViewState) => void;
  onSettings?: () => void;
}
export function PageOutline(props: PageOutlineHostProps) {
  const config = props.page.attrs?.outline as NativePageOutline | undefined;
  return config?.enabled ? (
    <ActivePageOutline key={props.page.attrs!.id} {...props} config={config} />
  ) : null;
}
function ActivePageOutline({
  page,
  documentId,
  scroll,
  shell,
  view,
  onViewChange,
  onSettings,
  config,
}: PageOutlineHostProps & { config: NativePageOutline }) {
  const t = useTranslator(messages),
    theme = useAppearanceTheme(),
    locale = useLocale();
  const available = useAvailableComponents();
  const generated = useMemo(
    () => buildPageOutline(page, config),
    [page, config],
  );
  const flat = useMemo(() => flattenOutline(generated.items), [generated]);
  const [, refresh] = useState(0);
  const [placement, setPlacement] = useState<OutlinePlacement>("floating");
  const [size, setSize] = useState({ width: config.width, height: 400 });
  const [active, setActive] = useState<string | null>(null);
  const rendererKey = JSON.stringify(config.renderer ?? null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const error = failure?.key === rendererKey ? failure.message : "";
  const rendererError = useCallback(
    (message: string) => setFailure({ key: rendererKey, message }),
    [rendererKey],
  );
  const rail = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLElement>(null);
  const initial =
    config.initialState === "auto"
      ? undefined
      : config.initialState === "expanded";
  const pinned = view.pinned ?? config.placement === "docked";
  const expanded =
    view.expanded ??
    initial ??
    (placement === "margin" || placement === "docked");
  const latest = useRef({ placement, expanded });
  latest.current = { placement, expanded };
  const viewChanged = useRef(onViewChange);
  viewChanged.current = onViewChange;
  const update = useCallback(() => {
    refresh((v) => v + 1);
    viewChanged.current?.(view);
  }, [view]);
  const collapse = useCallback(() => {
    view.expanded = false;
    update();
    requestAnimationFrame(() => rail.current?.focus());
  }, [view, update]);
  useEffect(() => {
    const host = shell.current,
      scroller = scroll.current;
    if (!host || !scroller) return;
    const column = scroller.querySelector<HTMLElement>(
      ":scope > .container-page-column",
    );
    const measure = () => {
      const bounds = host.getBoundingClientRect();
      if (!bounds.width) return;
      const content = column?.getBoundingClientRect();
      const width = Math.min(config.width, Math.max(180, bounds.width - 24));
      const next = outlinePlacement({
        width: bounds.width,
        gutter: content ? bounds.right - content.right : 0,
        panelWidth: width,
        widthMode: page.attrs?.widthMode ?? "standard",
        preferred:
          view.pinned === false && config.placement === "docked"
            ? "auto"
            : config.placement,
        pinned: view.pinned,
        previous: latest.current.placement,
      });
      if (
        latest.current.placement !== next &&
        latest.current.expanded &&
        view.expanded === undefined
      )
        view.expanded = true;
      const height = Math.max(
        100,
        bounds.height -
          (Number.parseFloat(
            getComputedStyle(host).getPropertyValue("--page-outline-top"),
          ) || 16) -
          16,
      );
      setPlacement(next);
      setSize((old) =>
        old.width === width && old.height === height ? old : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(scroller);
    if (column) observer.observe(column);
    return () => observer.disconnect();
  }, [
    config.width,
    config.placement,
    page.attrs?.widthMode,
    view.pinned,
    shell,
    scroll,
  ]);
  useEffect(() => {
    const host = shell.current;
    if (!host) return;
    host.dataset.outlineDocked = String(expanded && placement === "docked");
    host.style.setProperty("--page-outline-width", `${size.width}px`);
    const scroller = scroll.current;
    if (scroller) scroller.inert = expanded && placement === "drawer";
    return () => {
      delete host.dataset.outlineDocked;
      host.style.removeProperty("--page-outline-width");
      if (scroller) scroller.inert = false;
    };
  }, [expanded, placement, size.width, shell, scroll]);
  const element = useCallback(
    (nodeId: string) => {
      const scroller = scroll.current;
      return [
        ...(scroller?.querySelectorAll<HTMLElement>(
          `[data-block-id="${CSS.escape(nodeId)}"],[data-surface-id="${CSS.escape(nodeId)}"]`,
        ) ?? []),
      ].find((el) => el.closest(".container-page") === scroller);
    },
    [scroll],
  );
  const navigate = useCallback(
    (itemId: string) => {
      const nodeId = generated.targets.get(itemId);
      if (!nodeId) return;
      const target = element(nodeId),
        scroller = scroll.current;
      if (!target || !scroller) return;
      for (
        let parent = target.parentElement;
        parent && parent !== scroller;
        parent = parent.parentElement
      )
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      scroller.scrollTo({
        top:
          scroller.scrollTop +
          target.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          24,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      setActive(itemId);
      if (placement === "drawer") collapse();
    },
    [generated, element, scroll, placement, collapse],
  );
  useEffect(() => {
    const scroller = scroll.current;
    if (!scroller) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = scroller.getBoundingClientRect().top + 72;
        let selected: string | null = null;
        for (const item of flat) {
          const id = generated.targets.get(item.id);
          const target = id ? element(id) : undefined;
          if (
            target &&
            target.getClientRects().length &&
            target.getBoundingClientRect().top <= top
          )
            selected = item.id;
        }
        setActive(selected);
      });
    };
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(scroller);
    const column = scroller.firstElementChild;
    if (column) resize.observe(column);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", measure);
      resize.disconnect();
    };
  }, [generated, flat, element, scroll]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        collapse();
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        placement === "floating" &&
        event.target instanceof Node &&
        shell.current?.contains(event.target) &&
        !panel.current?.contains(event.target) &&
        !rail.current?.contains(event.target)
      )
        collapse();
    };
    const keepFocus = (event: FocusEvent) => {
      if (
        placement === "drawer" &&
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !(
          event.target instanceof Element &&
          event.target.closest(".studio-modal-shade")
        )
      )
        panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    shell.current?.addEventListener("keydown", close);
    window.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", keepFocus);
    return () => {
      shell.current?.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", keepFocus);
    };
  }, [expanded, placement, collapse, shell]);
  const component = config.renderer
    ? available.find(
        (c) =>
          c.id === config.renderer!.componentId &&
          c.version === config.renderer!.version &&
          c.integrity === config.renderer!.integrity &&
          c.role === "page-outline" &&
          c.pageOutlineProtocol === 1,
      )
    : undefined;
  const contract: PageOutlineComponentProps = {
    props: config.renderer?.props ?? {},
    outline: {
      protocol: 1,
      pageId: page.attrs!.id,
      items: generated.items,
      activeItemId: active,
      expandedItemIds:
        view.branches ?? flat.filter((i) => i.children.length).map((i) => i.id),
      container: {
        placement,
        width: size.width,
        height: Math.max(80, size.height - 52),
      },
      theme,
      locale,
    },
    navigate,
    setBranchExpanded: (id, open) => {
      if (!flat.some((i) => i.id === id && i.children.length)) return;
      const set = new Set(
        view.branches ?? flat.filter((i) => i.children.length).map((i) => i.id),
      );
      open ? set.add(id) : set.delete(id);
      view.branches = [...set];
      update();
    },
    collapse,
  };
  const open = () => {
    view.expanded = true;
    update();
    requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLButtonElement>("button")?.focus(),
    );
  };
  return (
    <>
      {expanded && placement === "drawer" && (
        <button
          type="button"
          className="page-outline-backdrop"
          aria-label={t("collapse")}
          onClick={collapse}
        />
      )}
      <button
        ref={rail}
        type="button"
        className="page-outline-rail"
        data-surface-ui
        aria-label={t(expanded ? "collapse" : "expand")}
        aria-expanded={expanded}
        onClick={expanded ? collapse : open}
        hidden={expanded}
      >
        <ListTree size={16} />
        <span>{t("title")}</span>
      </button>
      <aside
        ref={panel}
        className="page-outline-panel"
        data-placement={placement}
        data-outline-page={page.attrs!.id}
        data-resource-id={documentId}
        hidden={!expanded}
        data-surface-ui
        role={placement === "drawer" ? "dialog" : undefined}
        aria-modal={placement === "drawer" ? true : undefined}
        aria-label={t("title")}
        style={{ width: size.width }}
      >
        <header>
          <strong>{t("title")}</strong>
          {onSettings && (
            <button
              type="button"
              aria-label={t("settings")}
              onClick={onSettings}
            >
              <Settings2 size={14} />
            </button>
          )}
          {placement !== "drawer" && (
            <button
              type="button"
              aria-label={t(pinned ? "unpin" : "pin")}
              aria-pressed={pinned}
              onClick={() => {
                view.pinned = !pinned;
                view.expanded = true;
                update();
              }}
            >
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
          )}
          <button type="button" aria-label={t("collapse")} onClick={collapse}>
            <X size={14} />
          </button>
        </header>
        <div
          className="page-outline-content"
          data-custom={component && !error ? true : undefined}
        >
          {config.renderer && (!component || error) && (
            // The original error is for diagnosis; readers see the fallback.
            <p
              className="page-outline-error"
              role="status"
              title={error || undefined}
            >
              {t("unavailable")}
            </p>
          )}
          {component && !error ? (
            <OutlineRenderer
              key={component.integrity}
              component={component}
              contract={contract}
              onError={rendererError}
            />
          ) : (
            <ReadingIndex {...contract} />
          )}
        </div>
      </aside>
    </>
  );
}

/** Printing uses the same semantic tree, independent of a renderer's screen layout. */
export function PageOutlinePrint({ page }: { page: JSONContent }) {
  const t = useTranslator(messages);
  if (!page.attrs?.outline?.enabled || page.attrs.kind !== "page") return null;
  const tree = buildPageOutline(page);
  const render = (items: PageOutlineItem[]) => (
    <ol>
      {items.map((item) => (
        <li key={item.id}>
          {tree.targets.has(item.id) ? (
            <a href={`#${tree.targets.get(item.id)}`}>{item.title}</a>
          ) : (
            item.title
          )}
          {item.children.length > 0 && render(item.children)}
        </li>
      ))}
    </ol>
  );
  return (
    <nav className="page-outline-print" aria-label={t("title")}>
      <h2>{t("title")}</h2>
      {render(tree.items)}
    </nav>
  );
}
