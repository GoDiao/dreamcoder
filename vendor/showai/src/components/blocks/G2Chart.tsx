import { BlockActions, BlockSettings } from "./action-host";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Download } from "../../ui/icons";
import { BlockHeader, Field } from "./shared";
import { GestureBoundary } from "./GestureBoundary";
import { useViewportLock, ViewportLockButton } from "./ViewportLock";
import { downloadFile, text } from "./helpers";
import { createG2Context } from "./g2/engine.js";
import { validateG2Data } from "./g2/contract.mjs";
import licenses from "./g2/licenses.json";
import type { BlockProps } from "./types";
import type { MessageKey } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/g2";
import "./g2-chart.css";
import {
  isText,
  useReaderState,
  useResetOnChange,
} from "../../surface/reader-state";

const interactions: [string, MessageKey<typeof messages>][] = [
  ["tooltip", "interaction.tooltip"],
  ["elementHighlight", "interaction.elementHighlight"],
  ["elementSelect", "interaction.elementSelect"],
  ["brushHighlight", "interaction.brushHighlight"],
  ["brushFilter", "interaction.brushFilter"],
  ["legendFilter", "interaction.legendFilter"],
];
const licenseAttribute = JSON.stringify(licenses);

export function G2ChartBlock({
  chartType,
  data,
  onChange,
  readOnly,
}: BlockProps & { chartType: string }) {
  const t = useTranslator(messages);
  const plot = useRef<HTMLDivElement>(null);
  const lock = useViewportLock("g2");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [hasViewportInteraction, setHasViewportInteraction] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const baseline = useRef("");
  const [exploreTheme, setExploreTheme] = useReaderState<string | null>(
    "theme",
    null,
    { accept: (value) => value === null || isText(value) },
  );
  const editable = Boolean(onChange && !readOnly);
  const theme = exploreTheme ?? String(data.theme ?? "indigo");
  const draftValue = (() => {
    if (!editing) return null;
    try {
      const value = JSON.parse(draft);
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, any>)
        : null;
    } catch {
      return null;
    }
  })();
  const draftPalette = Array.isArray(draftValue?.appearance?.palette)
    ? draftValue.appearance.palette
        .slice(0, 20)
        .map((value: unknown) =>
          typeof value === "string" && /^#[a-f\d]{6}$/i.test(value)
            ? value
            : "#888888",
        )
    : ["#120A8F", "#6653CF", "#9A89ED", "#EA8A3B", "#53A7A1"];
  const updateDraft = (next: Record<string, unknown>) => {
    if (!draftValue) {
      setDraftError(t("fixJsonFirst"));
      return;
    }
    setDraft(JSON.stringify({ ...draftValue, ...next }, null, 2));
    setDraftError("");
  };
  useResetOnChange(String(data.theme ?? ""), () => setExploreTheme(null));
  useEffect(() => {
    const target = plot.current;
    if (!target) return;
    let current: ReturnType<typeof createG2Context> | undefined;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let lastWidth = 0;
    const render = () => {
      if (stopped || target.clientWidth <= 0) return;
      const run = ++generation;
      lastWidth = target.clientWidth;
      current?.destroy();
      target.replaceChildren();
      setReady(false);
      setHasViewportInteraction(false);
      setError("");
      current = createG2Context(
        target,
        chartType,
        { ...data, theme },
        lock.locked,
      );
      current
        .render()
        .then(() => {
          if (!stopped && generation === run) {
            setHasViewportInteraction(current!.hasViewportInteraction);
            setReady(true);
          }
        })
        .catch((caught) => {
          if (!stopped && generation === run) {
            setError(caught instanceof Error ? caught.message : String(caught));
            setReady(false);
          }
        });
    };
    const observer = new ResizeObserver(() => {
      if (Math.abs(target.clientWidth - lastWidth) < 1) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        lastWidth = target.clientWidth;
        if (current)
          void current.resize().catch((caught) => {
            if (!stopped)
              setError(
                caught instanceof Error ? caught.message : String(caught),
              );
          });
        else render();
      }, 80);
    });
    observer.observe(target);
    render();
    return () => {
      stopped = true;
      generation++;
      clearTimeout(timer);
      observer.disconnect();
      current?.destroy();
    };
  }, [chartType, data, theme, lock.locked]);
  // Editor commits re-render every block; serialize the raw view only on data changes.
  const rawData = useMemo(
    () => JSON.stringify(data.datasets, null, 2),
    [data.datasets],
  );
  const open = () => {
    baseline.current = JSON.stringify(data);
    setDraft(JSON.stringify(data, null, 2));
    setDraftError("");
    setEditing(!editing);
  };
  const save = () => {
    if (JSON.stringify(data) !== baseline.current) {
      setDraftError(t("changedElsewhere"));
      return;
    }
    let next: Record<string, unknown>;
    try {
      next = JSON.parse(draft);
      validateG2Data(next);
    } catch (caught) {
      setDraftError(
        caught instanceof Error ? caught.message : t("invalidData"),
      );
      return;
    }
    onChange?.(next);
    setEditing(false);
    setDraftError("");
  };
  const changeTheme = (next: string) => {
    if (editable) onChange?.({ ...data, theme: next });
    else setExploreTheme(next);
  };
  const exportSvg = () => {
    const svg = plot.current?.querySelector("svg");
    if (!svg) return;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    downloadFile(
      new XMLSerializer().serializeToString(copy),
      `${chartType}.svg`,
      "image/svg+xml",
    );
  };
  return (
    <section
      ref={lock.ref}
      data-viewport-lock-scope="g2"
      data-viewport-locked={hasViewportInteraction && lock.locked}
      className={"sb-block sb-g2-chart" + (theme === "dark" ? " is-dark" : "")}
      aria-label={text(data.title, t("chart"))}
      data-g2-type={chartType}
      data-third-party-licenses={licenseAttribute}
    >
      <BlockHeader
        title={text(data.title)}
        description={text(data.description)}
        icon={<BarChart3 size={18} />}
        editable={editable}
        editing={editing}
        onEdit={open}
      >
        <button
          type="button"
          className="sb-icon-button"
          aria-label={t("downloadSvg")}
          title={t("downloadSvg")}
          disabled={!ready}
          onClick={exportSvg}
        >
          <Download size={16} />
        </button>
      </BlockHeader>
      {hasViewportInteraction && (
        <ViewportLockButton
          {...lock}
          label={t("chart")}
          unlockDescription={t("unlockDescription")}
        />
      )}
      <BlockActions>
        <div className="sb-g2-toolbar">
          <label>
            {t("theme")}{" "}
            <select
              aria-label={t("chartTheme")}
              value={theme}
              disabled={editing}
              onChange={(e) => changeTheme(e.target.value)}
            >
              <option value="indigo">{t("theme.indigo")}</option>
              <option value="classic">{t("theme.classic")}</option>
              <option value="dark">{t("theme.dark")}</option>
            </select>
          </label>
          {editable && <span>{t("editInSettings")}</span>}
        </div>
      </BlockActions>
      {editing && (
        <BlockSettings>
          <div className="sb-g2-editor">
            {draftValue && (
              <>
                <div className="sb-g2-settings">
                  <Field label={t("title")}>
                    <input
                      aria-label={t("chartTitle")}
                      value={draftValue.title ?? ""}
                      onChange={(e) => updateDraft({ title: e.target.value })}
                    />
                  </Field>
                  <Field label={t("height")}>
                    <input
                      aria-label={t("chartHeight")}
                      type="number"
                      min={200}
                      max={900}
                      value={draftValue.height ?? 320}
                      onChange={(e) =>
                        updateDraft({ height: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label={t("fontSize")}>
                    <input
                      aria-label={t("chartFontSize")}
                      type="number"
                      min={8}
                      max={32}
                      value={draftValue.appearance?.fontSize ?? 12}
                      onChange={(e) =>
                        updateDraft({
                          appearance: {
                            ...draftValue.appearance,
                            fontSize: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label={t("lineWidth")}>
                    <input
                      aria-label={t("chartLineWidth")}
                      type="number"
                      min={0}
                      max={12}
                      step={0.5}
                      value={draftValue.appearance?.lineWidth ?? 2}
                      onChange={(e) =>
                        updateDraft({
                          appearance: {
                            ...draftValue.appearance,
                            lineWidth: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="sb-g2-palette">
                  <span>{t("palette")}</span>
                  {draftPalette.map((color: string, index: number) => (
                    <input
                      key={index}
                      type="color"
                      aria-label={t("chartColor", { index: index + 1 })}
                      value={color}
                      onChange={(e) => {
                        const palette = [...draftPalette];
                        palette[index] = e.target.value;
                        updateDraft({
                          appearance: { ...draftValue.appearance, palette },
                        });
                      }}
                    />
                  ))}
                </div>
                <div className="sb-g2-toggles">
                  <label>
                    <input
                      type="checkbox"
                      checked={draftValue.legend !== false}
                      onChange={(e) =>
                        updateDraft({ legend: e.target.checked })
                      }
                    />
                    {t("showLegend")}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(draftValue.animation)}
                      onChange={(e) =>
                        updateDraft({ animation: e.target.checked })
                      }
                    />
                    {t("animation")}
                  </label>
                  {interactions.map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={
                          draftValue.interaction?.[key] ??
                          ["tooltip", "legendFilter"].includes(key)
                        }
                        onChange={(e) =>
                          updateDraft({
                            interaction: {
                              ...draftValue.interaction,
                              [key]: e.target.checked,
                            },
                          })
                        }
                      />
                      {t(label)}
                    </label>
                  ))}
                </div>
              </>
            )}
            <details className="sb-data-details" open>
              <summary>{t("dataAndAdvanced")}</summary>
              <Field label={t("dataFieldsStyle")}>
                <textarea
                  aria-label={t("parametersJson")}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                />
              </Field>
            </details>
            {draftError && (
              <p role="alert" className="sb-error">
                {draftError}
              </p>
            )}
            <button type="button" className="sb-button" onClick={save}>
              {t("saveSettings")}
            </button>
          </div>
        </BlockSettings>
      )}
      {error && (
        <p role="alert" className="sb-error">
          {t("renderFailed", { error })}
        </p>
      )}
      <GestureBoundary
        axes={hasViewportInteraction && !lock.locked ? ["x", "y", "zoom"] : []}
      >
        <div
          ref={plot}
          className="sb-g2-plot"
          style={{ height: Number(data.height ?? 320) }}
          aria-label={t("plotArea")}
          aria-busy={!ready && !error}
        />
      </GestureBoundary>
      <details className="sb-data-details">
        <summary>{t("viewRawData")}</summary>
        <pre>{rawData}</pre>
      </details>
    </section>
  );
}
