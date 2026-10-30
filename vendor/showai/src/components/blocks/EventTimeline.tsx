import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { BlockProps } from "./types";
import {
  axisPointLabel,
  eventAt,
  initialPoint,
  phaseAt,
  pointCount,
  type EventTimelineData,
  type EventTimelineSeries,
  type EventTimelineTone,
} from "./event-timeline-contract.mjs";
import "./event-timeline.css";
import { blockLabel } from "./shared";
import { useLocale, useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/eventTimeline";
import {
  isIndex,
  useReaderState,
  useResetOnChange,
} from "../../surface/reader-state";

// Colors come from tone tokens so lines, bands and badges follow light and dark themes.
const tone = (value: EventTimelineTone = "neutral") => `var(--et-${value})`;
const soft = (value: EventTimelineTone = "neutral") =>
  `var(--et-${value}-soft)`;
const SERIES_TONES: EventTimelineTone[] = ["info", "bad", "good"];
const seriesColor = (series: EventTimelineSeries, index: number) =>
  series.color ?? tone(series.tone ?? SERIES_TONES[index]);

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

/** A 1/2/5 × 10ⁿ step that splits the range into about `parts` intervals. */
function niceStep(range: number, parts: number) {
  const raw = range / parts || 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/** One y scale per side, shared by the series drawn against it. */
function scaleFor(series: EventTimelineSeries[]) {
  if (!series.length) return null;
  const values = series.flatMap((item) =>
    item.values.filter((value): value is number => value !== null),
  );
  let lo = Math.min(0, ...values, ...series.map((item) => item.min ?? 0));
  let hi = Math.max(...values, ...series.map((item) => item.max ?? -Infinity));
  if (hi <= lo) hi = lo + 1;
  const step = niceStep(hi - lo, 4);
  lo = series.some((item) => item.min !== undefined)
    ? Math.min(...series.map((item) => item.min ?? lo))
    : Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let value = lo; value <= hi + step / 2; value += step)
    ticks.push(Number(value.toFixed(10)));
  return { lo, hi, ticks, unit: series.find((item) => item.unit)?.unit };
}

/** Axis label stride: the smallest round step that keeps labels apart. */
function labelStride(points: number, room: number, type: string) {
  const steps =
    type === "date"
      ? [1, 2, 7, 14, 28, 56, 91, 182, 364]
      : [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 720];
  return (
    steps.find((step) => (points - 1) / step <= room) ??
    Math.ceil((points - 1) / room)
  );
}

const formatValue = (value: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
  }).format(value);

export function EventTimelineBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const locale = useLocale();
  const model = data as unknown as EventTimelineData;
  const series = model.series ?? [];
  const phases = model.phases ?? [];
  const events = model.events;
  const kinds = new Map((model.kinds ?? []).map((kind) => [kind.id, kind]));
  const count = pointCount(model);
  const label = (point: number) => axisPointLabel(model.axis, point, locale);
  const kindColor = (id?: string) => {
    const kind = id ? kinds.get(id) : undefined;
    return kind?.color ?? tone(kind?.tone);
  };

  const start = initialPoint(model);
  const [point, setPoint] = useReaderState("point", start, { accept: isIndex });
  // Clicking one of several events on the same point pins it; scrubbing releases the pin.
  const [pinned, setPinned] = useReaderState<number | null>("pinned", null, {
    accept: (value) => value === null || isIndex(value),
  });
  useResetOnChange(`${start}:${count}`, () => {
    setPoint(start);
    setPinned(null);
  });
  const cursor = Math.min(point, count - 1);
  const active =
    pinned !== null && events[pinned]?.at === cursor
      ? pinned
      : eventAt(events, cursor);
  const phase = phaseAt(phases, cursor);

  const scrub = (next: number) => {
    setPinned(null);
    setPoint(Math.max(0, Math.min(count - 1, next)));
  };
  const select = (index: number) => {
    setPinned(index);
    setPoint(events[index].at);
  };
  const previous = active > 0 ? active - 1 : null;
  const next = active < events.length - 1 ? active + 1 : null;

  const [chartRef, width] = useWidth();
  const narrow = width < 520;
  const left = scaleFor(series.filter((item) => item.axis !== "right"));
  const right = scaleFor(series.filter((item) => item.axis === "right"));
  const pad = {
    l: left ? (narrow ? 34 : 42) : 14,
    r: right ? (narrow ? 34 : 42) : 14,
    t: phases.length ? 24 : 12,
    b: 26,
  };
  const W = Math.max(240, width);
  const H = series.length ? (narrow ? 190 : 240) : 96;
  const plotW = W - pad.l - pad.r;
  const base = H - pad.b;
  const x = (i: number) => pad.l + (i / (count - 1)) * plotW;
  const yOf = (scale: NonNullable<typeof left>) => (value: number) =>
    base - ((value - scale.lo) / (scale.hi - scale.lo)) * (base - pad.t);
  const scaleOf = (item: EventTimelineSeries) =>
    item.axis === "right" ? right! : left!;

  const paths = series.map((item) => {
    const y = yOf(scaleOf(item));
    const zero = y(Math.max(scaleOf(item).lo, 0));
    // Null values break the line, so gaps in the data stay visible.
    const runs: [number, number][][] = [[]];
    item.values.forEach((value, i) => {
      if (value === null) runs.push([]);
      else runs[runs.length - 1].push([x(i), y(value)]);
    });
    const live = runs.filter((run) => run.length > 0);
    const line = live
      .map((run) =>
        run
          .map(
            ([px, py], i) =>
              `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`,
          )
          .join(""),
      )
      .join("");
    const area = item.area
      ? live
          .map(
            (run) =>
              `M${run[0][0].toFixed(1)},${zero.toFixed(1)}` +
              run
                .map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`)
                .join("") +
              `L${run[run.length - 1][0].toFixed(1)},${zero.toFixed(1)}Z`,
          )
          .join("")
      : "";
    return { item, line, area, y };
  });

  const stride = labelStride(
    count,
    Math.max(2, Math.floor(plotW / (narrow ? 58 : 72))),
    model.axis.type,
  );
  const xTicks: number[] = [];
  for (let i = 0; i < count; i += stride) xTicks.push(i);

  const pointFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio =
      (event.clientX - box.left - (pad.l * box.width) / W) /
      ((plotW * box.width) / W);
    scrub(Math.round(ratio * (count - 1)));
  };

  // Keep the expanded event in view inside the list without scrolling the page.
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const item = list?.children[Math.max(active, 0)] as HTMLElement | undefined;
    if (!list || !item || list.scrollHeight <= list.clientHeight) return;
    const top = item.offsetTop - list.offsetTop;
    if (
      top < list.scrollTop ||
      top + item.offsetHeight > list.scrollTop + list.clientHeight
    ) {
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      list.scrollTo({
        top: Math.max(0, top - 32),
        behavior: reduce ? "auto" : "smooth",
      });
    }
  }, [active]);

  const moveFocus = (event: KeyboardEvent<HTMLOListElement>) => {
    const keys: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: events.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(events.length - 1, keys[event.key]));
    select(target);
    listRef.current?.querySelectorAll("button")[target]?.focus();
  };

  const axisName = model.axis.label ?? t("position");
  const chartLabel = series.length
    ? t("chart", {
        series: series.map((item) => item.label).join(" / "),
        axis: axisName,
        count: events.length,
      })
    : t("chartNoSeries", { axis: axisName, count: events.length });
  const current = active >= 0 ? events[active] : undefined;

  return (
    <section
      className="sb-block et-block"
      aria-label={blockLabel(model.title, t("title"))}
    >
      {(model.title || model.description) && (
        <div className="et-head">
          {model.title && <h3 className="et-title">{model.title}</h3>}
          {model.description && <p className="et-sub">{model.description}</p>}
        </div>
      )}
      {model.summary && model.summary.length > 0 && (
        <dl className="et-summary" aria-label={t("summary")}>
          {model.summary.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd style={stat.tone ? { color: tone(stat.tone) } : undefined}>
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className={`et-body${events.length ? "" : " is-single"}`}>
        <div className="et-main">
          <div className="et-readout" aria-live="polite">
            <span className="et-now">
              <small>{axisName}</small>
              <b>{label(cursor)}</b>
            </span>
            {phase >= 0 && (
              <span
                className="et-phase-pill"
                style={{ background: soft(phases[phase].tone) }}
              >
                {phases[phase].label}
              </span>
            )}
            {series.map((item, i) => {
              const value = item.values[cursor];
              return (
                <span key={item.id} className="et-value">
                  <i style={{ background: seriesColor(item, i) }} />
                  {item.label}{" "}
                  <b>
                    {value === null
                      ? t("noValue")
                      : `${formatValue(value, locale)}${item.unit ?? ""}`}
                  </b>
                </span>
              );
            })}
          </div>
          <div className="et-chart" ref={chartRef}>
            <svg
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={chartLabel}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                pointFromPointer(event);
              }}
              onPointerMove={(event) => {
                if (event.buttons & 1) pointFromPointer(event);
              }}
            >
              {phases.map((item, i) => (
                <rect
                  key={`band-${item.from}`}
                  x={x(item.from)}
                  y={pad.t - 20}
                  width={x(item.to) - x(item.from)}
                  height={base - pad.t + 20}
                  fill={soft(item.tone)}
                  opacity={i === phase ? 1 : 0.55}
                />
              ))}
              {phases.map((item) => {
                const room = x(item.to) - x(item.from) - 8;
                // Wide characters take about one em, narrow ones about half.
                const need = [...item.label].reduce(
                  (sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? 11 : 6.2),
                  0,
                );
                return room >= need ? (
                  <text
                    key={`phase-${item.from}`}
                    x={x(item.from) + 4}
                    y={pad.t - 7}
                    className="et-phase-label"
                  >
                    {item.label}
                  </text>
                ) : null;
              })}
              {left?.ticks.map((value) => (
                <g key={`l${value}`}>
                  <line
                    x1={pad.l}
                    x2={W - pad.r}
                    y1={yOf(left)(value)}
                    y2={yOf(left)(value)}
                    className="et-grid"
                  />
                  <text
                    x={pad.l - 6}
                    y={yOf(left)(value)}
                    className="et-tick"
                    textAnchor="end"
                    dominantBaseline="middle"
                  >
                    {formatValue(value, locale)}
                  </text>
                </g>
              ))}
              {right?.ticks.map((value) => (
                <g key={`r${value}`}>
                  {!left && (
                    <line
                      x1={pad.l}
                      x2={W - pad.r}
                      y1={yOf(right)(value)}
                      y2={yOf(right)(value)}
                      className="et-grid"
                    />
                  )}
                  <text
                    x={W - pad.r + 6}
                    y={yOf(right)(value)}
                    className="et-tick"
                    dominantBaseline="middle"
                  >
                    {formatValue(value, locale)}
                  </text>
                </g>
              ))}
              {left?.unit && (
                <text
                  x={pad.l - 6}
                  y={pad.t - 7}
                  className="et-tick"
                  textAnchor="end"
                >
                  {left.unit}
                </text>
              )}
              {right?.unit && (
                <text x={W - pad.r + 6} y={pad.t - 7} className="et-tick">
                  {right.unit}
                </text>
              )}
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={base}
                y2={base}
                className="et-baseline"
              />
              {xTicks.map((i) => (
                <text
                  key={`x${i}`}
                  x={x(i)}
                  y={H - 8}
                  className="et-tick"
                  textAnchor={i === 0 && pad.l < 30 ? "start" : "middle"}
                >
                  {label(i)}
                </text>
              ))}
              {paths.map(({ item, line, area }, i) => (
                <g key={item.id} style={{ color: seriesColor(item, i) }}>
                  {area && <path d={area} className="et-area" />}
                  <path
                    d={line}
                    className={`et-line${item.dashed ? " is-dashed" : ""}`}
                  />
                </g>
              ))}
              <line
                x1={x(cursor)}
                x2={x(cursor)}
                y1={phases.length ? pad.t - 20 : pad.t}
                y2={base}
                className="et-cursor"
              />
              {paths.map(({ item, y }, i) => {
                const value = item.values[cursor];
                return value === null ? null : (
                  <circle
                    key={`c-${item.id}`}
                    cx={x(cursor)}
                    cy={y(value)}
                    r={4}
                    className="et-cursor-dot"
                    style={{ fill: seriesColor(item, i) }}
                  />
                );
              })}
              {events.map((event, i) => (
                <circle
                  key={`e${i}`}
                  cx={x(event.at)}
                  cy={base}
                  r={i === active ? 6 : 4}
                  className={`et-marker${event.at > cursor ? " is-future" : ""}`}
                  style={{ fill: kindColor(event.kind) }}
                  onPointerDown={(pointer) => {
                    pointer.stopPropagation();
                    select(i);
                  }}
                >
                  <title>{`${label(event.at)} ${event.title}`}</title>
                </circle>
              ))}
            </svg>
          </div>
          <div className="et-controls">
            <button
              type="button"
              className="et-step"
              aria-label={t("previous")}
              title={t("previous")}
              disabled={previous === null}
              onClick={() => previous !== null && select(previous)}
            >
              ‹
            </button>
            <input
              type="range"
              min={0}
              max={count - 1}
              step={1}
              value={cursor}
              aria-label={t("scrub")}
              aria-valuetext={t("scrubValue", {
                point: label(cursor),
                event: current?.title ?? t("noEvent"),
              })}
              onChange={(event) => scrub(Number(event.target.value))}
            />
            <button
              type="button"
              className="et-step"
              aria-label={t("next")}
              title={t("next")}
              disabled={next === null}
              onClick={() => next !== null && select(next)}
            >
              ›
            </button>
          </div>
          {(series.length > 0 || phases.length > 0) && (
            <div className="et-legend">
              {series.map((item, i) => (
                <span key={item.id}>
                  <i
                    className={item.dashed ? "is-dashed" : undefined}
                    style={{ color: seriesColor(item, i) }}
                  />
                  {item.unit
                    ? t("seriesWithUnit", {
                        label: item.label,
                        unit: item.unit,
                      })
                    : item.label}
                </span>
              ))}
              {phases.length > 0 && (
                <span
                  className="et-phases"
                  role="group"
                  aria-label={t("phases")}
                >
                  {phases.map((item, i) => (
                    <button
                      key={`chip-${item.from}`}
                      type="button"
                      className="et-phase-chip"
                      style={{ background: soft(item.tone) }}
                      aria-pressed={i === phase}
                      aria-label={t("jumpToPhase", {
                        label: item.label,
                        from: label(item.from),
                        to: label(item.to),
                      })}
                      onClick={() => scrub(item.from)}
                    >
                      {item.label}
                      <small>
                        {label(item.from)}–{label(item.to)}
                      </small>
                    </button>
                  ))}
                </span>
              )}
            </div>
          )}
          {model.note && <p className="et-note">{model.note}</p>}
        </div>
        {events.length > 0 && (
          <ol
            className="et-events"
            ref={listRef}
            aria-label={t("events", { count: events.length })}
            onKeyDown={moveFocus}
          >
            {events.map((event, i) => {
              const kind = event.kind ? kinds.get(event.kind) : undefined;
              const open = i === active;
              return (
                <li
                  key={`${event.at}-${i}`}
                  className={`${open ? "is-open" : ""}${event.at > cursor ? " is-future" : ""}`}
                  style={{ "--kind": kindColor(event.kind) } as CSSProperties}
                >
                  <div className="et-card">
                    <button
                      type="button"
                      aria-current={open ? "step" : undefined}
                      aria-expanded={event.detail ? open : undefined}
                      tabIndex={open || (active === -1 && i === 0) ? 0 : -1}
                      onClick={() => select(i)}
                    >
                      <time>{label(event.at)}</time>
                      {kind && <span className="et-kind">{kind.label}</span>}
                      {event.at > cursor && (
                        <span className="et-sr">{t("future")}</span>
                      )}
                      <strong>{event.title}</strong>
                    </button>
                    {event.detail && (
                      <p className="et-detail">{event.detail}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
