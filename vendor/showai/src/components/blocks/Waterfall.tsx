import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BlockProps } from "./types";
import { waterfallBridge, waterfallMismatches } from "./plan-contract.mjs";
import "./waterfall.css";
import { blockLabel } from "./shared";
import { useLocale, useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/waterfall";
import { useReaderState } from "../../surface/reader-state";

type Kind = "total" | "up" | "down";
type Format = {
  prefix?: string;
  suffix?: string;
  divisor?: number;
  decimals?: number;
};
type Step = {
  id: string;
  label: string;
  kind: Kind;
  value: number;
  breakdown?: {
    title?: string;
    items: { label: string; value: number }[];
    note?: string;
  };
};
type Headline = {
  label: string;
  value: string;
  detail?: string;
  tone?: "up" | "down" | "neutral";
};
type Waterfall = {
  title?: string;
  eyebrow?: string;
  narrative?: string;
  headlines?: Headline[];
  steps: Step[];
  axisFloor?: number;
  axisNote?: string;
  format?: Format;
  upIsGood?: boolean;
  initialStep?: string;
};

const HEIGHT = 300;
const PAD = { left: 52, right: 8, top: 28, bottom: 12 };
const MIN_SLOT = 64;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round tick values covering [low, high] with about four intervals. */
function ticks(low: number, high: number) {
  const raw = (high - low) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((k) => k * power).find((k) => k >= raw) ?? raw;
  const values: number[] = [];
  for (
    let tick = Math.ceil(low / step) * step;
    tick <= high + step * 1e-6;
    tick += step
  )
    values.push(Number(tick.toPrecision(12)));
  return values;
}

export function WaterfallBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const locale = useLocale();
  const model = data as unknown as Waterfall;
  const steps = model.steps;
  const format = model.format ?? {};
  const upIsGood = model.upIsGood ?? true;
  const number = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: format.decimals ?? 0,
        maximumFractionDigits: format.decimals ?? 0,
      }),
    [locale, format.decimals],
  );
  // Axis ticks drop trailing zeros: 1 s rather than 1.00 s.
  const tickNumber = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: format.decimals ?? 0,
      }),
    [locale, format.decimals],
  );
  /** Stored value → display text; signed shows + for gains and − for losses. */
  const show = (value: number, signed = false, tick = false) => {
    const body = (tick ? tickNumber : number).format(
      Math.abs(value) / (format.divisor ?? 1),
    );
    const sign = value < 0 ? "−" : signed && value > 0 ? "+" : "";
    return `${sign}${format.prefix ?? ""}${body}${format.suffix ?? ""}`;
  };
  const delta = (step: Step) =>
    step.kind === "total"
      ? show(step.value)
      : show(step.kind === "down" ? -step.value : step.value, true);
  const tone = (kind: Kind | "neutral") =>
    kind === "total" || kind === "neutral"
      ? "total"
      : (kind === "up") === upIsGood
        ? "good"
        : "bad";

  const { spans } = waterfallBridge(steps);
  // Running total after each step, where the connector to the next bar starts.
  const levels = spans.map((span, index) =>
    steps[index].kind === "total"
      ? steps[index].value
      : steps[index].kind === "down"
        ? span[0]
        : span[1],
  );
  const mismatches = waterfallMismatches(model);
  const [selectedId, setSelected] = useReaderState(
    "selected",
    () => model.initialStep ?? steps[1]?.id ?? steps[0].id,
    { accept: (value) => steps.some((step) => step.id === value) },
  );
  const current = steps.find((step) => step.id === selectedId) ?? steps[0];
  const [chartRef, chartWidth] = useWidth();
  const barsRef = useRef<SVGGElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // Printing shows the full table, not only the selected step.
  useEffect(() => {
    const open = () => {
      if (detailsRef.current) detailsRef.current.open = true;
    };
    window.addEventListener("beforeprint", open);
    return () => window.removeEventListener("beforeprint", open);
  }, []);

  const width = Math.max(
    chartWidth,
    PAD.left + PAD.right + steps.length * MIN_SLOT,
  );
  const top = Math.max(...spans.map((span) => span[1]));
  const bottom = Math.min(...spans.map((span) => span[0]));
  const floor = model.axisFloor ?? Math.min(0, bottom);
  const yTicks = ticks(floor, top > floor ? top : floor + 1);
  const high = Math.max(top, yTicks[yTicks.length - 1] ?? top);
  const y = (value: number) =>
    PAD.top +
    (1 - (Math.max(value, floor) - floor) / (high - floor || 1)) *
      (HEIGHT - PAD.top - PAD.bottom);
  const slot = (width - PAD.left - PAD.right) / steps.length;
  const barWidth = Math.min(slot * 0.6, 72);
  const barX = (index: number) =>
    PAD.left + index * slot + (slot - barWidth) / 2;
  const broken = floor > 0;

  const select = (index: number) => {
    const step = steps[(index + steps.length) % steps.length];
    setSelected(step.id);
    barsRef.current
      ?.querySelector<SVGGElement>(`[data-step="${CSS.escape(step.id)}"]`)
      ?.focus();
  };
  const onBarKey = (event: KeyboardEvent, index: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected(steps[index].id);
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      select(index + (event.key === "ArrowRight" ? 1 : -1));
    }
  };

  const items = current.breakdown?.items ?? [];
  const itemSum = items.reduce((sum, item) => sum + item.value, 0);
  const largest = Math.max(1e-9, ...items.map((item) => Math.abs(item.value)));
  const tolerance =
    (0.5 * (format.divisor ?? 1)) / 10 ** (format.decimals ?? 0);
  const gap =
    items.length > 0 && Math.abs(itemSum - Math.abs(current.value)) > tolerance;
  const kindLabel = (kind: Kind) => t(`kind.${kind}`);

  return (
    <section
      className="sb-block wf-block"
      aria-label={blockLabel(model.title, t("title"))}
    >
      {model.eyebrow && <div className="wf-eyebrow">{model.eyebrow}</div>}
      {model.title && <h3 className="wf-title">{model.title}</h3>}
      {model.narrative && <p className="wf-story">{model.narrative}</p>}
      {model.headlines && model.headlines.length > 0 && (
        <dl className="wf-heads">
          {model.headlines.map((headline, index) => (
            <div key={index} className="wf-head">
              <dt>{headline.label}</dt>
              <dd>
                <b>{headline.value}</b>
                {headline.detail && (
                  <span
                    className={`wf-tone-${tone(headline.tone ?? "neutral")}`}
                  >
                    {headline.detail}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="wf-body">
        <figure className="wf-chart">
          <div className="wf-scroll" ref={chartRef}>
            <div className="wf-canvas" style={{ width, height: HEIGHT + 44 }}>
              <svg
                width={width}
                height={HEIGHT}
                role="group"
                aria-label={t("chart")}
              >
                {yTicks.map((tick) => (
                  <g key={tick} aria-hidden="true">
                    <line
                      className="wf-gridline"
                      x1={PAD.left}
                      x2={width - PAD.right}
                      y1={y(tick)}
                      y2={y(tick)}
                    />
                    <text
                      className="wf-tick"
                      x={PAD.left - 8}
                      y={y(tick) + 4}
                      textAnchor="end"
                    >
                      {show(tick, false, true)}
                    </text>
                  </g>
                ))}
                {floor < 0 && (
                  <line
                    className="wf-zero"
                    aria-hidden="true"
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={y(0)}
                    y2={y(0)}
                  />
                )}
                {broken && (
                  <g className="wf-break" aria-hidden="true">
                    <path
                      d={`M${PAD.left - 5} ${HEIGHT - PAD.bottom + 2} l5 -5 l5 5`}
                    />
                    <path
                      d={`M${PAD.left - 5} ${HEIGHT - PAD.bottom + 8} l5 -5 l5 5`}
                    />
                  </g>
                )}
                <g ref={barsRef}>
                  {steps.map((step, index) => {
                    const [low, upper] = spans[index];
                    const x = barX(index);
                    const barTop = y(upper);
                    const barHeight = Math.max(2, y(low) - barTop);
                    const active = step.id === current.id;
                    const next = index < steps.length - 1;
                    return (
                      <g
                        key={step.id}
                        className={`wf-bar wf-tone-${tone(step.kind)}${active ? " is-active" : ""}`}
                        data-step={step.id}
                        tabIndex={0}
                        role="button"
                        aria-pressed={active}
                        aria-label={t("step", {
                          label: step.label,
                          kind: kindLabel(step.kind),
                          value: delta(step),
                        })}
                        onClick={() => setSelected(step.id)}
                        onKeyDown={(event) => onBarKey(event, index)}
                      >
                        <rect
                          className="wf-slot"
                          x={PAD.left + index * slot + 2}
                          y={PAD.top - 24}
                          width={slot - 4}
                          height={HEIGHT - PAD.top + 22}
                          rx={8}
                        />
                        <rect
                          className="wf-fill"
                          x={x}
                          y={barTop}
                          width={barWidth}
                          height={barHeight}
                          rx={3}
                        />
                        {next && (
                          <line
                            className="wf-connector"
                            x1={x + barWidth}
                            x2={barX(index + 1)}
                            y1={y(levels[index])}
                            y2={y(levels[index])}
                          />
                        )}
                        <text
                          className="wf-value"
                          x={x + barWidth / 2}
                          y={barTop - 7}
                          textAnchor="middle"
                        >
                          {delta(step)}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
              <div
                className="wf-labels"
                style={{ top: HEIGHT }}
                aria-hidden="true"
              >
                {steps.map((step, index) => (
                  <span
                    key={step.id}
                    className={step.id === current.id ? "is-active" : undefined}
                    style={{ left: PAD.left + index * slot, width: slot }}
                    onClick={() => setSelected(step.id)}
                  >
                    {step.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <figcaption>
            {model.axisNote ??
              (broken ? t("axisFloor", { value: show(floor) }) : null)}
            {mismatches.map((entry) => (
              <span key={entry.id} className="wf-warn" role="status">
                {t("mismatch", {
                  label: steps.find((step) => step.id === entry.id)!.label,
                  stated: show(entry.stated),
                  computed: show(entry.computed),
                })}
              </span>
            ))}
          </figcaption>
        </figure>

        <aside
          className={`wf-side wf-tone-${tone(current.kind)}`}
          aria-live="polite"
        >
          <div className="wf-side-top">
            <span>{current.label}</span>
            <b>{delta(current)}</b>
          </div>
          {current.breakdown?.title && (
            <div className="wf-side-title">{current.breakdown.title}</div>
          )}
          {items.length > 0 ? (
            <ul>
              {items.map((item, index) => (
                <li key={index}>
                  <div className="wf-row">
                    <span>{item.label}</span>
                    <span className="wf-num">
                      {show(item.value)}
                      <em aria-label={t("share")}>
                        {itemSum
                          ? `${Math.round((item.value / itemSum) * 100)}%`
                          : "–"}
                      </em>
                    </span>
                  </div>
                  <div className="wf-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${(Math.abs(item.value) / largest) * 100}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wf-muted">{t("noBreakdown")}</p>
          )}
          {gap && (
            <p className="wf-muted">
              {t("breakdownGap", {
                sum: show(itemSum),
                value: show(Math.abs(current.value)),
                gap: show(Math.abs(itemSum - Math.abs(current.value))),
              })}
            </p>
          )}
          {current.breakdown?.note && (
            <p className="wf-note">{current.breakdown.note}</p>
          )}
          <p className="wf-hint">{t("hint")}</p>
        </aside>
      </div>

      <details className="wf-static" ref={detailsRef}>
        <summary>{t("readAll", { count: steps.length })}</summary>
        <table>
          <thead>
            <tr>
              <th>{t("column.step")}</th>
              <th>{t("column.kind")}</th>
              <th>{t("column.value")}</th>
              <th>{t("column.level")}</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step, index) => (
              <tr key={step.id}>
                <td>
                  {step.label}
                  {step.breakdown && step.breakdown.items.length > 0 && (
                    <div className="wf-muted">
                      {step.breakdown.items
                        .map((item) => `${item.label} ${show(item.value)}`)
                        .join(" · ")}
                    </div>
                  )}
                </td>
                <td>{kindLabel(step.kind)}</td>
                <td>{delta(step)}</td>
                <td>{show(levels[index])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
