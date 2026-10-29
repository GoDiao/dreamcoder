import { useEffect, useMemo, useRef, useState } from "react";
import type { BlockProps } from "./types";
import { experimentFrontier } from "./analysis-contract.mjs";
import "./analysis.css";
import { blockLabel } from "./shared";
import { getLocale, type MessageKey } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/analysis";
import { useReaderSet, useReaderState } from "../../surface/reader-state";

type Status = "kept" | "discarded" | "failed" | "running" | "stopped";
type Experiment = {
  id: string;
  name: string;
  group?: string;
  category?: string;
  status: Status;
  start: string;
  minutes?: number;
  resources?: number;
  score: number | null;
  note?: string;
};
type Group = {
  id: string;
  label: string;
  frontier?: boolean;
  shape?: "dot" | "diamond";
};
type Run = {
  id: string;
  name: string;
  color?: string;
  steps: number[];
  series: Record<string, number[]>;
};
type Chart = { key: string; label: string; unit?: string };
type Tracker = {
  title?: string;
  subtitle?: string;
  updatedAt?: string;
  metric: {
    label: string;
    unit?: string;
    direction: "higher" | "lower";
    baseline?: number;
  };
  groups?: Group[];
  experiments: Experiment[];
  runs?: Run[];
  charts?: Chart[];
  resource?: {
    unit: string;
    costPerHour?: number;
    currency?: string;
    budget?: number;
  };
};

const STATUS_LABEL: Record<Status, MessageKey<typeof messages>> = {
  kept: "tracker.status.kept",
  discarded: "tracker.status.discarded",
  failed: "tracker.status.failed",
  running: "tracker.status.running",
  stopped: "tracker.status.stopped",
};
const FILTERS: ("all" | Status)[] = [
  "all",
  "kept",
  "running",
  "discarded",
  "failed",
  "stopped",
];
const PALETTE = [
  "#2f6b4f",
  "#3b74b8",
  "#b0473f",
  "#a86b34",
  "#7061b0",
  "#8a918c",
];

const time = (value: string) => Date.parse(value);
const pad = (value: number) => String(value).padStart(2, "0");
const stamp = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
// Small metrics such as a loss need more decimals than counts and hours.
const number = (value: number) =>
  value.toLocaleString(getLocale(), {
    maximumFractionDigits: Math.abs(value) < 10 ? 3 : 1,
  });

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
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

function Scatter({
  model,
  frontier,
  selected,
  onSelect,
}: {
  model: Tracker;
  frontier: string[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslator(messages);
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<Experiment | null>(null);
  const height = 360;
  const m = { l: 44, r: 16, t: 18, b: 52 };
  const lane = 28;
  const plotH = height - m.t - m.b - lane;
  const higher = model.metric.direction === "higher";
  const scored = model.experiments.filter((e) => e.score !== null);
  const starts = model.experiments.map((e) => time(e.start));
  const t0 = Math.min(...starts);
  const ends = model.experiments.map(
    (e) => time(e.start) + (e.minutes ?? 0) * 60000,
  );
  const t1 = Math.max(
    model.updatedAt ? time(model.updatedAt) : 0,
    ...ends,
    t0 + 3600000,
  );
  const values = [
    ...scored.map((e) => e.score as number),
    ...(model.metric.baseline === undefined ? [] : [model.metric.baseline]),
  ];
  // Padding scales with the data so small metrics (a loss of 2.1) keep a readable range.
  const span = values.length ? Math.max(...values) - Math.min(...values) : 0;
  const pad = span * 0.1 || Math.abs(values[0] ?? 0) * 0.05 || 1;
  const lo = values.length ? Math.min(...values) - pad : 0;
  const hi = values.length ? Math.max(...values) + pad : 1;
  const x = (ms: number) => m.l + ((ms - t0) / (t1 - t0)) * (width - m.l - m.r);
  // Better scores are always drawn higher, so "lower is better" flips the axis.
  const y = (v: number) =>
    m.t + (higher ? 1 - (v - lo) / (hi - lo) : (v - lo) / (hi - lo)) * plotH;
  const laneY = m.t + plotH + lane / 2 + 6;
  const byId = new Map(model.experiments.map((e) => [e.id, e]));
  const groupOf = new Map((model.groups ?? []).map((g) => [g.id, g]));
  const runColor = new Map(
    (model.runs ?? []).map((r, i) => [
      r.id,
      r.color ?? PALETTE[i % PALETTE.length],
    ]),
  );
  const points = frontier.map((id) => byId.get(id)!);
  let path = "";
  points.forEach((e, i) => {
    path +=
      i === 0
        ? `M${x(time(e.start))},${y(e.score as number)}`
        : `H${x(time(e.start))}V${y(e.score as number)}`;
  });
  if (points.length) path += `H${x(t1)}`;
  const labelled = new Set<string>();
  let lastX = -Infinity;
  for (const e of points) {
    const px = x(time(e.start));
    if (px - lastX > 120) {
      labelled.add(e.id);
      lastX = px;
    }
  }
  const ticks: number[] = [];
  // A "nice" step of 1, 2 or 5 × 10^n giving about five gridlines.
  const raw = (hi - lo) / 5 || 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const tickStep =
    [1, 2, 5, 10].map((f) => f * magnitude).find((s) => s >= raw) ??
    10 * magnitude;
  for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi; v += tickStep)
    ticks.push(+v.toFixed(6));
  const days: number[] = [];
  const first = new Date(t0);
  first.setHours(0, 0, 0, 0);
  for (let d = first.getTime() + 86400000; d < t1; d += 86400000) days.push(d);
  const unit = model.metric.unit ?? "";

  return (
    <div className="an-plot" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={t("tracker.overTime", { metric: model.metric.label })}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              className="an-grid-line"
              x1={m.l}
              x2={width - m.r}
              y1={y(v)}
              y2={y(v)}
            />
            <text x={m.l - 8} y={y(v) + 4} textAnchor="end">
              {number(v)}
            </text>
          </g>
        ))}
        {days.map((d) => (
          <g key={d}>
            <line
              x1={x(d)}
              x2={x(d)}
              y1={m.t}
              y2={m.t + plotH + lane}
              stroke="var(--an-line)"
            />
            <text x={x(d) + 4} y={height - 18}>
              {stamp(d).slice(0, 5)}
            </text>
          </g>
        ))}
        <rect
          className="an-lane"
          x={m.l}
          y={m.t + plotH + 6}
          width={Math.max(0, width - m.l - m.r)}
          height={lane}
          rx={6}
        />
        <text x={m.l + 8} y={laneY + 4}>
          {t("tracker.noScore")}
        </text>
        {model.metric.baseline !== undefined && (
          <g>
            <line
              className="an-baseline"
              x1={m.l}
              x2={width - m.r}
              y1={y(model.metric.baseline)}
              y2={y(model.metric.baseline)}
            />
            <text
              className="an-baseline-label"
              x={width - m.r - 4}
              y={y(model.metric.baseline) - 5}
              textAnchor="end"
            >
              {t("tracker.baseline", { value: model.metric.baseline })}
            </text>
          </g>
        )}
        {path && <path className="an-frontier" d={path} />}
        {model.experiments.map((e) => {
          const cx = x(time(e.start));
          const events = {
            onMouseEnter: () => setHover(e),
            onClick: () => onSelect(e.id),
            className: "an-point",
          };
          if (e.score === null)
            return e.status === "failed" ? (
              <g key={e.id} {...events}>
                <path
                  d={`M${cx - 5},${laneY - 5}L${cx + 5},${laneY + 5}M${cx + 5},${laneY - 5}L${cx - 5},${laneY + 5}`}
                  stroke="var(--an-bad)"
                  strokeWidth={2.2}
                />
                <circle cx={cx} cy={laneY} r={9} fill="transparent" />
              </g>
            ) : (
              <g key={e.id} {...events}>
                <circle
                  className={e.status === "running" ? "an-ring" : undefined}
                  cx={cx}
                  cy={laneY}
                  r={6}
                  fill="none"
                  stroke="var(--an-info)"
                  strokeWidth={2}
                />
                <circle cx={cx} cy={laneY} r={3} fill="var(--an-info)" />
              </g>
            );
          const cy = y(e.score);
          const diamond = groupOf.get(e.group ?? "")?.shape === "diamond";
          const color =
            runColor.get(e.id) ??
            (e.status === "kept"
              ? "var(--an-good)"
              : e.status === "stopped"
                ? "var(--an-warn)"
                : "var(--an-idle)");
          return (
            <g key={e.id} {...events}>
              {selected === e.id && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={13}
                  fill="none"
                  stroke="var(--an-text)"
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                />
              )}
              {diamond ? (
                <>
                  <rect
                    x={cx - 7}
                    y={cy - 7}
                    width={14}
                    height={14}
                    rx={3}
                    transform={`rotate(45 ${cx} ${cy})`}
                    fill="var(--an-paper)"
                    stroke={color}
                    strokeWidth={3}
                  />
                  {e.status === "running" && (
                    <circle
                      className="an-ring"
                      cx={cx}
                      cy={cy}
                      r={11}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.5}
                    />
                  )}
                </>
              ) : e.status === "kept" ? (
                <circle className="an-point-kept" cx={cx} cy={cy} r={5.5} />
              ) : (
                <circle className="an-point-other" cx={cx} cy={cy} r={4} />
              )}
              {(labelled.has(e.id) || diamond) && (
                <text
                  className={`an-point-label${labelled.has(e.id) ? " is-frontier" : ""}`}
                  x={cx + 10}
                  y={cy - 8}
                  style={diamond ? { fill: color } : undefined}
                >
                  {diamond
                    ? `${e.id} · ${number(e.score)}`
                    : e.name.length > 8
                      ? `${e.name.slice(0, 8)}…`
                      : e.name}
                </text>
              )}
            </g>
          );
        })}
        <text x={m.l} y={height - 2}>
          {t("tracker.startTime")}
        </text>
      </svg>
      {hover && (
        <div
          className="an-tip"
          style={{
            left: Math.min(x(time(hover.start)) + 14, width - 230),
            top:
              hover.score === null
                ? laneY - 120
                : Math.max(0, y(hover.score) - 20),
          }}
        >
          <b>
            {hover.id} · {hover.name}
          </b>
          <span>
            {stamp(time(hover.start))}
            {hover.minutes !== undefined &&
              ` · ${t("tracker.minutes", { count: hover.minutes })}`}
            {hover.resources !== undefined &&
              ` · ${hover.resources} ${model.resource?.unit ?? ""}`}
          </span>
          {t("tracker.metricValue", {
            metric: model.metric.label,
            value: hover.score === null ? "—" : `${number(hover.score)}${unit}`,
          })}{" "}
          · {t(STATUS_LABEL[hover.status])}
          {hover.note && <span>{hover.note}</span>}
        </div>
      )}
    </div>
  );
}

function MiniChart({
  chart,
  runs,
  colors,
  hoverStep,
  onHover,
}: {
  chart: Chart;
  runs: Run[];
  colors: Map<string, string>;
  hoverStep: number | null;
  onHover: (step: number | null) => void;
}) {
  const [ref, width] = useWidth();
  const height = 140;
  const m = { l: 40, r: 10, t: 8, b: 20 };
  const visible = runs.filter((run) => run.series[chart.key]?.length);
  const all = visible.flatMap((run) => run.series[chart.key]);
  const maxStep = Math.max(1, ...visible.flatMap((run) => run.steps));
  if (!all.length) return null;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const x = (s: number) => m.l + (s / maxStep) * (width - m.l - m.r);
  const y = (v: number) =>
    m.t + (1 - (v - lo) / (hi - lo)) * (height - m.t - m.b);
  const fmt = (v: number) =>
    Math.abs(hi) < 5 ? v.toFixed(2) : number(Math.round(v));
  const at = (run: Run) => {
    if (hoverStep === null) return undefined;
    const index = run.steps.findIndex((s) => s >= hoverStep);
    return index < 0
      ? undefined
      : { step: run.steps[index], value: run.series[chart.key][index] };
  };
  return (
    <div className="an-panel an-mini" ref={ref}>
      <p className="an-panel-title">
        {chart.label}
        {chart.unit && <span className="an-sub"> · {chart.unit}</span>}
      </p>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={chart.label}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onHover(
            Math.max(
              0,
              Math.min(
                maxStep,
                ((event.clientX - box.left - m.l) / (width - m.l - m.r)) *
                  maxStep,
              ),
            ),
          );
        }}
        onMouseLeave={() => onHover(null)}
      >
        {[lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1].map(
          (v) => (
            <g key={v}>
              <line
                className="an-grid-line"
                x1={m.l}
                x2={width - m.r}
                y1={y(v)}
                y2={y(v)}
              />
              <text x={m.l - 6} y={y(v) + 3} textAnchor="end">
                {fmt(v)}
              </text>
            </g>
          ),
        )}
        {[0, maxStep / 2, maxStep].map((s, i) => (
          <text
            key={s}
            x={x(s)}
            y={height - 5}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
          >
            {number(s)}
          </text>
        ))}
        {visible.map((run) => (
          <path
            key={run.id}
            d={run.series[chart.key]
              .map((v, i) => `${i ? "L" : "M"}${x(run.steps[i])},${y(v)}`)
              .join("")}
            fill="none"
            stroke={colors.get(run.id)}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {hoverStep !== null && (
          <g>
            <line
              x1={x(hoverStep)}
              x2={x(hoverStep)}
              y1={m.t}
              y2={height - m.b}
              stroke="var(--an-text)"
              strokeOpacity={0.35}
            />
            {visible.map((run) => {
              const point = at(run);
              return point ? (
                <circle
                  key={run.id}
                  cx={x(point.step)}
                  cy={y(point.value)}
                  r={3.5}
                  fill={colors.get(run.id)}
                  stroke="var(--an-paper)"
                  strokeWidth={1.5}
                />
              ) : null;
            })}
          </g>
        )}
      </svg>
      <div className="an-mini-values">
        {hoverStep !== null &&
          visible.map((run) => {
            const point = at(run);
            return (
              <span key={run.id}>
                <b style={{ color: colors.get(run.id) }}>{run.id}</b>{" "}
                {point ? fmt(point.value) : "—"}
              </span>
            );
          })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  detail,
  wide,
  meter,
}: {
  label: string;
  value: string;
  unit?: string;
  detail?: string;
  wide?: boolean;
  meter?: number;
}) {
  return (
    <div className={`an-stat${wide ? " is-wide" : ""}`}>
      <small>{label}</small>
      <div className="an-stat-value">
        {value}
        {unit && <span className="an-stat-unit">{unit}</span>}
      </div>
      {detail && <p>{detail}</p>}
      {meter !== undefined && (
        <div className="an-meter">
          <i style={{ width: `${Math.min(100, meter * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export function ExperimentTrackerBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const model = data as unknown as Tracker;
  const [filter, setFilter] = useReaderState<"all" | Status>("filter", "all", {
    accept: (value) =>
      ["all", "kept", "discarded", "failed", "running", "stopped"].includes(
        value as string,
      ),
  });
  const [selected, setSelected] = useReaderState<string | null>(
    "selected",
    null,
    { accept: (value) => value === null || typeof value === "string" },
  );
  const [hidden, setHidden] = useReaderSet("hiddenRuns");
  const [hoverStep, setHoverStep] = useState<number | null>(null);
  const frontier = useMemo(
    () => experimentFrontier(model) as string[],
    [model],
  );
  const runs = model.runs ?? [];
  const charts = model.charts ?? [];
  const colors = new Map(
    runs.map((run, i) => [run.id, run.color ?? PALETTE[i % PALETTE.length]]),
  );
  const higher = model.metric.direction === "higher";
  const better = (a: number, b: number) => (higher ? a > b : a < b);
  const counts: Record<string, number> = { all: model.experiments.length };
  for (const e of model.experiments)
    counts[e.status] = (counts[e.status] ?? 0) + 1;
  const listed = model.experiments
    .filter((e) => filter === "all" || e.status === filter)
    .sort((a, b) => time(b.start) - time(a.start));
  const scored = model.experiments.filter(
    (e) => e.score !== null && e.status !== "failed",
  );
  const groups = model.groups?.length
    ? model.groups
    : [{ id: "", label: t("tracker.best") }];
  const bestByGroup = groups.map((group) => {
    const pool = scored.filter(
      (e) => !model.groups?.length || e.group === group.id,
    );
    return {
      group,
      best: pool.reduce<Experiment | null>(
        (b, e) => (!b || better(e.score as number, b.score as number) ? e : b),
        null,
      ),
    };
  });
  const frontierBest = frontier.length
    ? model.experiments.find((e) => e.id === frontier[frontier.length - 1])
    : undefined;
  // Positive gain always means better, whichever direction the metric runs.
  const gain =
    frontierBest && model.metric.baseline !== undefined
      ? ((frontierBest.score as number) - model.metric.baseline) *
        (higher ? 1 : -1)
      : 0;
  const hours = model.experiments.reduce(
    (sum, e) => sum + ((e.minutes ?? 0) / 60) * (e.resources ?? 0),
    0,
  );
  const unit = model.metric.unit ?? "";
  const categories = useMemo(() => {
    const map = new Map<string, { total: number; kept: number }>();
    for (const e of model.experiments) {
      if (!e.category) continue;
      const entry = map.get(e.category) ?? { total: 0, kept: 0 };
      entry.total += 1;
      if (e.status === "kept") entry.kept += 1;
      map.set(e.category, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [model.experiments]);
  const maxCategory = Math.max(1, ...categories.map(([, c]) => c.total));
  const active = model.experiments.find((e) => e.id === selected);
  const visibleRuns = runs.filter((run) => !hidden.has(run.id));
  const toggleRun = (id: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section
      className="sb-block an-block"
      aria-label={blockLabel(model.title, t("tracker.title"))}
    >
      <div className="an-tracker">
        <div className="an-head">
          {model.title && <h3 className="an-title">{model.title}</h3>}
          {model.subtitle && <p className="an-sub">{model.subtitle}</p>}
          {model.updatedAt && (
            <p className="an-sub an-tools">
              {t("tracker.updatedAt", { time: stamp(time(model.updatedAt)) })}
            </p>
          )}
        </div>
        <div className="an-tracker-grid">
          <div className="an-panel an-runs">
            <div className="an-runs-head">
              <p className="an-panel-title">
                {t("tracker.runs", { count: model.experiments.length })}
              </p>
              <div
                className="an-tools"
                style={{ marginLeft: 0 }}
                role="group"
                aria-label={t("tracker.filterByStatus")}
              >
                {FILTERS.filter((key) => key === "all" || counts[key]).map(
                  (key) => (
                    <button
                      key={key}
                      type="button"
                      className="an-chip"
                      aria-pressed={filter === key}
                      onClick={() => setFilter(key)}
                    >
                      {key === "all" ? t("tracker.all") : t(STATUS_LABEL[key])}{" "}
                      {counts[key] ?? 0}
                    </button>
                  ),
                )}
              </div>
            </div>
            <div className="an-runs-list">
              {listed.map((e) => {
                const run = runs.find((r) => r.id === e.id);
                return (
                  <div
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    className={`an-row an-ex-${e.status}${selected === e.id ? " is-selected" : ""}`}
                    onClick={() => setSelected(selected === e.id ? null : e.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelected(selected === e.id ? null : e.id);
                      }
                    }}
                  >
                    {run ? (
                      <input
                        type="checkbox"
                        aria-label={t("tracker.showRun", { id: run.id })}
                        checked={!hidden.has(run.id)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleRun(run.id)}
                        style={{ margin: 0, accentColor: colors.get(run.id) }}
                      />
                    ) : (
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          background: "var(--tone)",
                          justifySelf: "center",
                        }}
                      />
                    )}
                    <b style={run ? { color: colors.get(run.id) } : undefined}>
                      {e.id}
                    </b>
                    <span className="an-row-name">
                      {e.name}
                      <small>
                        {stamp(time(e.start))} ·{" "}
                        <span className="an-status">
                          {t(STATUS_LABEL[e.status])}
                        </span>
                      </small>
                    </span>
                    <span className="an-score">
                      {e.score === null ? "—" : number(e.score)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="an-main">
            <div className="an-panel">
              <div className="an-plot-legend">
                <b>
                  {t("tracker.allExperiments", { metric: model.metric.label })}
                  {unit ? ` (${unit})` : ""} ·{" "}
                  {higher
                    ? t("tracker.higherIsBetter")
                    : t("tracker.lowerIsBetter")}
                </b>
                {frontier.length > 0 && <span>{t("tracker.frontier")}</span>}
                <span>{t("tracker.legendKept")}</span>
                <span>{t("tracker.legendOther")}</span>
                {model.groups?.some((g) => g.shape === "diamond") && (
                  <span>
                    ◇{" "}
                    {model.groups
                      .filter((g) => g.shape === "diamond")
                      .map((g) => g.label)
                      .join(t("tracker.listSeparator"))}
                  </span>
                )}
              </div>
              <Scatter
                model={model}
                frontier={frontier}
                selected={selected}
                onSelect={(id) => setSelected(selected === id ? null : id)}
              />
            </div>
            {charts.length > 0 && runs.length > 0 && (
              <>
                <div className="an-small-multiples">
                  {charts.map((chart) => (
                    <MiniChart
                      key={chart.key}
                      chart={chart}
                      runs={visibleRuns}
                      colors={colors}
                      hoverStep={hoverStep}
                      onHover={setHoverStep}
                    />
                  ))}
                </div>
                <div className="an-legend">
                  {runs.map((run) => (
                    <span
                      key={run.id}
                      style={{ opacity: hidden.has(run.id) ? 0.35 : 1 }}
                    >
                      <b style={{ color: colors.get(run.id) }}>━</b> {run.id} ·{" "}
                      {run.name}
                    </span>
                  ))}
                  <span>{t("tracker.runsHint")}</span>
                </div>
              </>
            )}
          </div>

          <div className="an-stats">
            <div className="an-stat-grid">
              <Stat
                label={t("tracker.total")}
                value={String(model.experiments.length)}
                detail={
                  groups.length > 1
                    ? groups
                        .map(
                          (g) =>
                            `${g.label} ${model.experiments.filter((e) => e.group === g.id).length}`,
                        )
                        .join(" · ")
                    : t("tracker.runningCount", { count: counts.running ?? 0 })
                }
              />
              {bestByGroup.map(({ group, best }) =>
                best ? (
                  <Stat
                    key={group.id}
                    label={
                      groups.length > 1
                        ? t("tracker.groupBest", { group: group.label })
                        : t("tracker.currentBest")
                    }
                    value={number(best.score as number)}
                    unit={unit}
                    detail={`${best.id} · ${best.name}`}
                  />
                ) : null,
              )}
              {model.metric.baseline !== undefined && frontierBest && (
                <Stat
                  label={t("tracker.gain")}
                  value={`${gain >= 0 ? "+" : "−"}${number(Math.abs(gain))}`}
                  unit={unit === "%" ? "pt" : unit}
                  detail={t("tracker.gainDetail", {
                    best: number(frontierBest.score as number),
                    baseline: model.metric.baseline,
                  })}
                />
              )}
              <Stat
                label={t("tracker.keepRate")}
                value={String(
                  Math.round(
                    ((counts.kept ?? 0) / model.experiments.length) * 100,
                  ),
                )}
                unit="%"
                detail={t("tracker.keepRateDetail", {
                  kept: counts.kept ?? 0,
                  running: counts.running ?? 0,
                })}
              />
              {model.resource && (
                <Stat
                  label={t("tracker.resourceHours", {
                    unit: model.resource.unit,
                  })}
                  value={number(Math.round(hours))}
                  detail={
                    model.resource.budget
                      ? t("tracker.budget", {
                          value: number(model.resource.budget),
                        })
                      : undefined
                  }
                  meter={
                    model.resource.budget
                      ? hours / model.resource.budget
                      : undefined
                  }
                />
              )}
              {model.resource?.costPerHour !== undefined && (
                <Stat
                  wide
                  label={t("tracker.cost")}
                  value={`${model.resource.currency ?? "¥"}${number(Math.round(hours * model.resource.costPerHour))}`}
                  detail={t("tracker.costRate", {
                    rate: `${model.resource.currency ?? "¥"}${model.resource.costPerHour}`,
                    unit: model.resource.unit,
                  })}
                />
              )}
            </div>
            {categories.length > 0 && (
              <div className="an-panel">
                <p className="an-panel-title">{t("tracker.byCategory")}</p>
                {categories.map(([name, c]) => (
                  <div key={name} style={{ fontSize: 11.5, marginBottom: 5 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>{name}</span>
                      <span className="an-sub">
                        {c.kept} / {c.total}
                      </span>
                    </div>
                    <div className="an-meter">
                      <i
                        className="is-total"
                        style={{ width: `${(c.total / maxCategory) * 100}%` }}
                      />
                      <i
                        style={{ width: `${(c.kept / maxCategory) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {active && (
              <div className="an-detail-card" aria-live="polite">
                <b>
                  {active.id} · {active.name}
                </b>
                <span>
                  {[
                    active.category,
                    model.groups?.find((g) => g.id === active.group)?.label,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span>
                  {stamp(time(active.start))}
                  {active.minutes !== undefined &&
                    ` · ${t("tracker.minutes", { count: active.minutes })}`}
                  {active.resources !== undefined &&
                    ` · ${active.resources} ${model.resource?.unit ?? ""}`}
                </span>
                {t("tracker.metricValue", {
                  metric: model.metric.label,
                  value: active.score === null ? "—" : number(active.score),
                })}{" "}
                · {t(STATUS_LABEL[active.status])}
                {active.note && <span>{active.note}</span>}
              </div>
            )}
          </div>
        </div>
        <details className="an-static">
          <summary>
            {t("tracker.readTable", { count: model.experiments.length })}
          </summary>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>{t("tracker.column.name")}</th>
                <th>{t("tracker.column.start")}</th>
                <th>{t("tracker.column.status")}</th>
                <th>{model.metric.label}</th>
                <th>{t("tracker.column.note")}</th>
              </tr>
            </thead>
            <tbody>
              {[...model.experiments]
                .sort((a, b) => time(a.start) - time(b.start))
                .map((e) => (
                  <tr key={e.id}>
                    <td>{e.id}</td>
                    <td>{e.name}</td>
                    <td>{stamp(time(e.start))}</td>
                    <td>{t(STATUS_LABEL[e.status])}</td>
                    <td>{e.score === null ? "—" : number(e.score)}</td>
                    <td>{e.note ?? ""}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}
