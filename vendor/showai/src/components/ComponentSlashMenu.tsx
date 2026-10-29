import ExpandableSearch from "./ExpandableSearch";
import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PanelTop } from "../ui/icons";
import {
  useComponentCatalog,
  RegisterComponentContext,
} from "./useComponentCatalog";
import { componentCategory } from "../core/component-categories";
import {
  componentCategoryLabel,
  componentDisplayDescription,
  componentDisplayName,
} from "./component-display";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalog";
import "../editor/editor.css";

export function ComponentSlashMenu({
  left,
  top,
  onInsert,
  onClose,
}: {
  left: number;
  top: number;
  onInsert: (kind: string, data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const catalog = useComponentCatalog(true),
    register = useContext(RegisterComponentContext);
  const [query, setQuery] = useState(""),
    [selected, select] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null),
    active = useRef(true),
    restore = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      restore.current?.focus();
    };
  }, []);
  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const items = catalog.items
    .filter((item) => "kind" in item || item.role !== "page-outline")
    .filter((item) =>
      `${item.name} ${item.description} ${componentDisplayName(item)} ${componentDisplayDescription(item)} ${"kind" in item ? item.kind : item.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const insert = async (index: number) => {
    const item = items[index];
    if (!item || busy) return;
    setBusy(true);
    setError("");
    try {
      const value = await catalog.resolve(item);
      if (!active.current) return;
      if (value.component) register(value.component);
      onInsert(value.kind, value.data);
      onClose();
    } catch (reason) {
      if (active.current) {
        setBusy(false);
        setError((reason as Error).message);
      }
    }
  };
  return createPortal(
    <>
      <div className="slash-dismiss" onClick={onClose} />
      <div
        ref={root}
        className="slash-menu is-minimal"
        role="dialog"
        aria-label={t("insertContent")}
        style={{
          left: Math.max(12, Math.min(left, window.innerWidth - 320)),
          top: Math.max(12, Math.min(top, window.innerHeight - 410)),
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Enter") {
            event.preventDefault();
            void insert(selected);
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            select((index) =>
              items.length
                ? (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length
                : 0,
            );
          }
        }}
      >
        <div className="slash-search">
          <ExpandableSearch
            label={t("searchBlocks")}
            placeholder={t("searchComponentsPlaceholder")}
            defaultExpanded
            value={query}
            onChange={(value) => {
              setQuery(value);
              select(0);
            }}
          />
          <kbd>esc</kbd>
        </div>
        {(error || catalog.error) && (
          <p role="alert" className="slash-empty">
            {error || catalog.error}
          </p>
        )}
        <div
          className="slash-items"
          role="listbox"
          aria-label={t("blockTypes")}
          aria-busy={busy || catalog.loading}
        >
          {!items.length && (
            <p className="slash-empty">
              {catalog.loading
                ? t("loadingComponents")
                : t("noComponentsFound")}
            </p>
          )}
          {items.map((item, index) => (
            <button
              key={
                "kind" in item
                  ? item.kind
                  : `${item.id}@${item.version}#${item.integrity}`
              }
              role="option"
              className={`slash-item${selected === index ? " is-selected" : ""}`}
              aria-selected={selected === index}
              disabled={busy}
              onMouseEnter={() => select(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void insert(index)}
            >
              <span className="slash-item-icon">
                <PanelTop size={20} />
              </span>
              <span>
                <strong>{componentDisplayName(item)}</strong>
                <small>{componentCategoryLabel(componentCategory(item))}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
