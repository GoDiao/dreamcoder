import { BlockSettings } from "./action-host";
import { useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Gauge,
  Plus,
  Trash2,
} from "../../ui/icons";
import { finite, text } from "./helpers";
import { BlockHeader, EmptyState, Field, blockLabel } from "./shared";
import type { BlockProps } from "./types";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/metrics";
import common from "../../i18n/messages/common";

// A leading/trailing label around one number, e.g. "$1,234.5M" or "98%".
const countable = /^(\D*?)(-?\d{1,3}(?:,\d{3})+|-?\d+)(\.\d+)?(\D*)$/;

/** Counts a figure up the first time it is seen. Reduced motion and rendered
 * exports keep the final value; `aria-busy` lets thumbnail capture and screen
 * readers wait for it. Pattern after Magic UI's NumberTicker (MIT). */
function CountUp({ value }: { value: string }) {
  const element = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const target = element.current;
    const match = countable.exec(value);
    if (
      !target ||
      !match ||
      typeof IntersectionObserver === "undefined" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      // Catalog thumbnails capture a still frame, as their stage already
      // turns off CSS motion.
      target.closest(".component-capture-stage")
    )
      return;
    const [, prefix, integer, fraction = "", suffix] = match;
    const end = Number(integer.replaceAll(",", "") + fraction);
    // Years read as labels, not quantities to count towards.
    const year = !fraction && /^(19|20)\d\d$/.test(integer);
    if (!end || year) return;
    const digits = Math.max(0, fraction.length - 1);
    const format = (current: number) =>
      prefix +
      current.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        useGrouping: integer.includes(","),
      }) +
      suffix;
    let frame = 0;
    const count = () => {
      observer.disconnect();
      target.setAttribute("aria-busy", "true");
      target.textContent = format(0);
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / 1000);
        target.textContent =
          progress < 1 ? format(end * (1 - (1 - progress) ** 4)) : value;
        if (progress < 1) frame = requestAnimationFrame(step);
        else target.removeAttribute("aria-busy");
      };
      frame = requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) count();
    });
    const box = target.getBoundingClientRect();
    // Start before the first paint when already on screen, so the final value
    // never flashes; otherwise wait until the figure scrolls into view.
    if (
      document.visibilityState === "visible" &&
      box.bottom > 0 &&
      box.top < innerHeight
    )
      count();
    else observer.observe(target);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      target.removeAttribute("aria-busy");
      target.textContent = value;
    };
  }, [value]);
  return (
    <span ref={element} className="sb-metric-figure">
      {value}
    </span>
  );
}

interface Metric {
  label: string;
  value: string | number;
  unit?: string;
  detail?: string;
  trend?: number;
}
export function MetricsBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftItems, setDraftItems] = useState<Metric[]>([]);
  const items: Metric[] = Array.isArray(data.items) ? data.items : [];
  const editable = Boolean(onChange && !readOnly);
  const openEditor = () => {
    setDraftTitle(text(data.title));
    setDraftItems(items.map((item) => ({ ...item })));
    setEditing(!editing);
  };
  const updateItem = (index: number, updates: Partial<Metric>) =>
    setDraftItems((current) =>
      current.map((item, currentIndex) =>
        currentIndex === index ? { ...item, ...updates } : item,
      ),
    );
  return (
    <section
      className="sb-block sb-metrics"
      aria-label={blockLabel(data.title, t("metrics"))}
    >
      <BlockHeader
        title={text(data.title)}
        defaultTitle={t("metrics")}
        icon={<Gauge size={17} />}
        editable={editable}
        editing={editing}
        onEdit={openEditor}
      />
      {editing && (
        <BlockSettings>
          <div className="sb-editor-panel">
            <Field label={t("title")}>
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
              />
            </Field>
            <div className="sb-metric-editors">
              {draftItems.map((item, index) => (
                <div className="sb-metric-editor" key={index}>
                  <div className="sb-form-row">
                    <Field label={t("name")}>
                      <input
                        value={item.label}
                        onChange={(event) =>
                          updateItem(index, { label: event.target.value })
                        }
                      />
                    </Field>
                    <Field label={t("value")}>
                      <input
                        value={item.value}
                        onChange={(event) =>
                          updateItem(index, { value: event.target.value })
                        }
                      />
                    </Field>
                    <Field label={t("unit")}>
                      <input
                        value={item.unit ?? ""}
                        onChange={(event) =>
                          updateItem(index, { unit: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <div className="sb-form-row">
                    <Field label={t("detail")}>
                      <input
                        value={item.detail ?? ""}
                        onChange={(event) =>
                          updateItem(index, { detail: event.target.value })
                        }
                      />
                    </Field>
                    <Field label={t("trend")}>
                      <input
                        type="number"
                        value={item.trend ?? ""}
                        onChange={(event) =>
                          updateItem(index, {
                            trend:
                              event.target.value === ""
                                ? undefined
                                : Number(event.target.value),
                          })
                        }
                      />
                    </Field>
                    <button
                      type="button"
                      className="sb-icon-button sb-danger"
                      aria-label={t("deleteMetric", { label: item.label })}
                      onClick={() =>
                        setDraftItems((current) =>
                          current.filter(
                            (_, currentIndex) => currentIndex !== index,
                          ),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="sb-panel-footer">
              <button
                type="button"
                className="sb-button"
                onClick={() =>
                  setDraftItems((current) => [
                    ...current,
                    { label: t("newMetric"), value: "" },
                  ])
                }
              >
                <Plus size={14} />
                {t("addMetric")}
              </button>
              <button
                type="button"
                className="sb-button sb-primary"
                onClick={() => {
                  onChange?.({
                    ...data,
                    title: draftTitle,
                    items: draftItems.map(({ trend, ...item }) => ({
                      ...item,
                      ...(typeof trend === "number" && Number.isFinite(trend)
                        ? { trend }
                        : {}),
                    })),
                  });
                  setEditing(false);
                }}
              >
                <Check size={14} />
                {tc("save")}
              </button>
            </div>
          </div>
        </BlockSettings>
      )}
      {items.length ? (
        <div className="sb-metric-grid">
          {items.map((item, index) => (
            <div className="sb-metric" key={index}>
              <span className="sb-metric-label">{text(item.label)}</span>
              <div className="sb-metric-value">
                <CountUp value={text(item.value, "—")} />
                <span>{text(item.unit)}</span>
              </div>
              <div className="sb-metric-foot">
                {typeof item.trend === "number" && (
                  <span
                    className={`sb-trend ${item.trend < 0 ? "is-negative" : ""}`}
                  >
                    {item.trend < 0 ? (
                      <ArrowDownRight size={13} />
                    ) : (
                      <ArrowUpRight size={13} />
                    )}
                    {Math.abs(finite(item.trend))}%
                  </span>
                )}
                {item.detail && <span>{text(item.detail)}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Gauge size={28} strokeWidth={1.4} />}
          title={t("emptyTitle")}
          action={
            editable && !editing ? (
              <button type="button" className="sb-button" onClick={openEditor}>
                <Plus size={14} />
                {t("addMetric")}
              </button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
