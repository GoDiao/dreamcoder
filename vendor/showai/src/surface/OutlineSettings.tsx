import { readCustomBlockData } from "../components/custom/contract";
import { ManualOutlineEditor } from "./ManualOutlineEditor";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import Dialog from "../studio/Dialog";
import {
  useComponentCatalog,
  RegisterComponentContext,
} from "../components/useComponentCatalog";
import { useAvailableComponents } from "../components/custom/CustomBlock";
import { validateInFrame } from "../components/custom/validate-in-frame";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/pageOutline";
import {
  buildPageOutline,
  defaultPageOutline,
  validatePageOutline,
  type NativePageOutline,
  type ManualOutlineEntry,
  type PageOutlineItem,
} from "./page-outline.mjs";

export function OutlineSettings({
  page,
  onClose,
  onSave,
}: {
  page: JSONContent;
  onClose: () => void;
  onSave: (config: NativePageOutline | undefined, baseline: string) => void;
}) {
  const t = useTranslator(messages),
    catalog = useComponentCatalog(true),
    register = useContext(RegisterComponentContext),
    available = useAvailableComponents();
  const baseline = useRef(JSON.stringify(page.attrs?.outline));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [draft, setDraft] = useState<NativePageOutline>(() =>
    structuredClone(page.attrs?.outline ?? defaultPageOutline()),
  );
  const [propsText, setPropsText] = useState(() =>
    JSON.stringify(draft.renderer?.props ?? {}, null, 2),
  );
  const [structure, setStructure] = useState(() =>
    JSON.stringify(
      draft.source.mode === "manual"
        ? draft.source.entries
        : (draft.source.overrides ?? {}),
      null,
      2,
    ),
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const components = useMemo(
    () =>
      catalog.items.filter(
        (item) =>
          !("kind" in item) &&
          item.role === "page-outline" &&
          item.pageOutlineProtocol === 1,
      ),
    [catalog.items],
  );
  const key = (item: { id: string; version: string; integrity: string }) =>
    `${item.id}@${item.version}#${item.integrity}`;
  const selected = draft.renderer
    ? `${draft.renderer.componentId}@${draft.renderer.version}#${draft.renderer.integrity}`
    : "";
  const choose = async (value: string) => {
    setError("");
    if (!value) {
      setDraft((old) => {
        const next = { ...old };
        delete next.renderer;
        return next;
      });
      return;
    }
    const item = components.find(
      (item) => !("kind" in item) && key(item) === value,
    );
    if (!item) return;
    setBusy(true);
    try {
      const result = await catalog.resolve(item);
      if (!result.component) throw new Error(t("unavailable"));
      register(result.component);
      const c = result.component;
      setDraft((old) => ({
        ...old,
        renderer: {
          componentId: c.id,
          version: c.version,
          integrity: c.integrity,
          props: structuredClone(c.defaultData),
        },
      }));
      setPropsText(JSON.stringify(c.defaultData, null, 2));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mode = (value: string) => {
    if (value === draft.source.mode) return;
    const tree = buildPageOutline(page, draft);
    const convert = (items: PageOutlineItem[]): ManualOutlineEntry[] =>
      items.map((item) => {
        const nodeId = tree.targets.get(item.id);
        const overridden =
          draft.source.mode === "headings" &&
          nodeId &&
          draft.source.overrides?.[nodeId]?.title !== undefined;
        return {
          id: item.id,
          ...(!nodeId || overridden ? { title: item.title } : {}),
          ...(nodeId ? { nodeId } : {}),
          ...(item.children.length ? { children: convert(item.children) } : {}),
        };
      });
    setStructure(
      JSON.stringify(value === "manual" ? convert(tree.items) : {}, null, 2),
    );
    setDraft((old) => ({
      ...old,
      source:
        value === "manual"
          ? { mode: "manual", entries: convert(tree.items) }
          : { mode: "headings", maxLevel: 3 },
    }));
  };
  const apply = async () => {
    setError("");
    setBusy(true);
    try {
      const value = structuredClone(draft),
        parsed = JSON.parse(structure);
      if (value.source.mode === "manual") value.source.entries = parsed;
      else value.source.overrides = parsed;
      if (value.renderer) {
        value.renderer.props = JSON.parse(propsText);
        readCustomBlockData(value.renderer);
        const c = available.find((c) => key(c) === selected);
        if (value.enabled) {
          if (!c) throw new Error(t("unavailable"));
          await validateInFrame(c, value.renderer.props);
        }
      }
      validatePageOutline(value, page);
      if (!alive.current) return;
      onSave(value, baseline.current);
      onClose();
    } catch (reason) {
      if (alive.current) setError((reason as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const missing = buildPageOutline(page, page.attrs?.outline).missing.length;
  return (
    <Dialog
      title={t("settings")}
      onClose={onClose}
      className="page-outline-settings"
    >
      <div className="page-outline-settings-body">
        <label className="page-outline-enable">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              setDraft({ ...draft, enabled: event.target.checked })
            }
          />
          {t("enable")}
        </label>
        <label>
          {t("renderer")}
          <select
            aria-label={t("renderer")}
            value={selected}
            disabled={busy}
            onChange={(event) => void choose(event.target.value)}
          >
            <option value="">{t("builtin")}</option>
            {selected &&
              !components.some(
                (c) => !("kind" in c) && key(c) === selected,
              ) && (
                <option value={selected}>
                  {draft.renderer!.componentId} · {draft.renderer!.version}
                </option>
              )}
            {components.map((c) =>
              "kind" in c ? null : (
                <option key={key(c)} value={key(c)}>
                  {c.name} · {c.version}
                </option>
              ),
            )}
          </select>
        </label>
        <p className="page-outline-hint">{t("sourceCode")}</p>
        {draft.renderer && (
          <label>
            {t("props")}
            <textarea
              aria-label={t("props")}
              rows={5}
              spellCheck={false}
              value={propsText}
              onChange={(event) => setPropsText(event.target.value)}
            />
          </label>
        )}
        <div className="page-outline-fields">
          <label>
            {t("source")}
            <select
              aria-label={t("source")}
              value={draft.source.mode}
              onChange={(event) => mode(event.target.value)}
            >
              <option value="headings">{t("headings")}</option>
              <option value="manual">{t("manual")}</option>
            </select>
          </label>
          {draft.source.mode === "headings" && (
            <label>
              {t("depth")}
              <select
                aria-label={t("depth")}
                value={draft.source.maxLevel}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    source: {
                      ...draft.source,
                      mode: "headings",
                      maxLevel: Number(event.target.value),
                    },
                  })
                }
              >
                {[1, 2, 3, 4, 5, 6].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {draft.source.mode === "manual" && (
          <ManualOutlineEditor
            page={page}
            entries={draft.source.entries}
            onChange={(entries) => {
              setDraft({ ...draft, source: { mode: "manual", entries } });
              setStructure(JSON.stringify(entries, null, 2));
            }}
          />
        )}
        <details>
          <summary>{t("config")}</summary>
          <p className="page-outline-hint">
            {t(
              draft.source.mode === "headings" ? "headingsHint" : "manualHint",
            )}
          </p>
          <textarea
            aria-label={t("config")}
            rows={8}
            spellCheck={false}
            value={structure}
            onChange={(event) => setStructure(event.target.value)}
          />
        </details>
        {missing > 0 && <p role="status">{t("missing", { count: missing })}</p>}
        <div className="page-outline-fields">
          <label>
            {t("initial")}
            <select
              value={draft.initialState}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  initialState: event.target
                    .value as NativePageOutline["initialState"],
                })
              }
            >
              {(["auto", "expanded", "collapsed"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("placement")}
            <select
              value={draft.placement}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  placement: event.target
                    .value as NativePageOutline["placement"],
                })
              }
            >
              {(["auto", "floating", "docked"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          {t("width")}
          <input
            type="number"
            min={180}
            max={480}
            value={draft.width}
            onChange={(event) =>
              setDraft({ ...draft, width: event.target.valueAsNumber })
            }
          />
        </label>
        {(error || catalog.error) && (
          <p className="page-outline-error" role="alert">
            {error || catalog.error}
          </p>
        )}
        <footer>
          {page.attrs?.outline && (
            <button
              type="button"
              onClick={() => {
                try {
                  onSave(undefined, baseline.current);
                  onClose();
                } catch (reason) {
                  setError((reason as Error).message);
                }
              }}
            >
              {t("remove")}
            </button>
          )}
          <button
            type="button"
            className="page-outline-apply"
            disabled={busy}
            onClick={apply}
          >
            {busy ? t("loading") : t("apply")}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
