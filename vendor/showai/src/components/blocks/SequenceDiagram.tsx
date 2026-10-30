import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BlockProps } from "./types";
import {
  DIAGRAM_TONES,
  detailParagraphs,
  type DiagramTone,
} from "./doc-diagrams-contract.mjs";
import { InlineMarkup } from "./InlineMarkup";
import "./sequence-diagram.css";
import { blockLabel } from "./shared";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/sequenceDiagram";
import { NoteText } from "./NoteText";
import { isIndex, useReaderState } from "../../surface/reader-state";

type Kind = "call" | "reply" | "note";
type Actor = {
  id: string;
  label: string;
  sub?: string;
  icon?: string;
  tone?: DiagramTone;
};
type Step = {
  from: string;
  to: string;
  label: string;
  detail?: string;
  kind?: Kind;
};
type Sequence = {
  title?: string;
  description?: string;
  actors: Actor[];
  steps: Step[];
};
type Cast = (Actor & { tone: DiagramTone })[];
// a and b are actor column indexes.
type Placed = Step & { kind: Kind; a: number; b: number };

const PLAY_MS = 1600;
const ROW = 46;
const SELF_ROW = 56;
const FALLBACK_FONT = "system-ui, -apple-system, sans-serif";

/** Paragraphs of detail text with **bold**, `code` and safe links. */
export function DetailText({ source }: { source?: string }) {
  return (
    <>
      {detailParagraphs(source).map((line, index) => (
        <p key={index}>
          <InlineMarkup source={line} />
        </p>
      ))}
    </>
  );
}

// SVG text cannot wrap, so labels are measured and shortened to fit their lane.
let canvas: CanvasRenderingContext2D | null | undefined;
function measurer(font: string) {
  if (canvas === undefined)
    canvas =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
  return (value: string, size: number, weight = 400) => {
    if (canvas) {
      canvas.font = `${weight} ${size}px ${font}`;
      return canvas.measureText(value).width;
    }
    let width = 0;
    for (const char of value)
      width += /[\u2e80-\uffff]/.test(char) ? size : size * 0.58;
    return width;
  };
}
type Measure = ReturnType<typeof measurer>;
function fit(
  measure: Measure,
  value: string,
  max: number,
  size: number,
  weight = 400,
) {
  if (measure(value, size, weight) <= max) return value;
  const chars = Array.from(value);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (measure(`${chars.slice(0, mid).join("")}…`, size, weight) <= max)
      low = mid;
    else high = mid - 1;
  }
  return `${chars.slice(0, low).join("").trimEnd()}…`;
}

/** Steps whose ends are not actors are left out so a partial edit still renders. */
function arrange(model: Sequence) {
  const actors: Cast = (Array.isArray(model.actors) ? model.actors : []).map(
    (actor) => ({
      ...actor,
      tone: DIAGRAM_TONES.includes(actor.tone as DiagramTone)
        ? (actor.tone as DiagramTone)
        : "accent",
    }),
  );
  const index = new Map(actors.map((actor, i) => [actor.id, i]));
  const steps: Placed[] = [];
  for (const step of Array.isArray(model.steps) ? model.steps : []) {
    const a = index.get(step.from);
    const b = index.get(step.to);
    if (a === undefined || b === undefined) continue;
    steps.push({
      ...step,
      a,
      b,
      kind: step.kind === "reply" || step.kind === "note" ? step.kind : "call",
    });
  }
  return { actors, steps };
}

const ICONS = {
  prev: <path d="M10 3.5 5.5 8l4.5 4.5" />,
  next: <path d="M6 3.5 10.5 8 6 12.5" />,
  play: <path className="sq-fill" d="M5 3.2v9.6L12.6 8z" />,
  pause: (
    <path className="sq-fill" d="M4.5 3.5h2.4v9H4.5zM9.1 3.5h2.4v9H9.1z" />
  ),
  restart: (
    <>
      <path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3" />
      <path d="M4.6 2.2v2.7h2.7" />
    </>
  ),
};
const Icon = ({ name }: { name: keyof typeof ICONS }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    {ICONS[name]}
  </svg>
);

function ActorChip({ actor }: { actor: Cast[number] }) {
  return (
    <span className="sq-chip" data-tone={actor.tone}>
      {actor.icon && <span aria-hidden="true">{actor.icon}</span>}
      {actor.label}
    </span>
  );
}

function Route({
  step,
  actors,
  t,
}: {
  step: Placed;
  actors: Cast;
  t: (key: "reply" | "note") => string;
}) {
  return (
    <>
      <ActorChip actor={actors[step.a]} />
      {step.a !== step.b && (
        <>
          <span className="sq-arrow" aria-hidden="true">
            {step.kind === "note" ? "·" : "→"}
          </span>
          <ActorChip actor={actors[step.b]} />
        </>
      )}
      {step.kind !== "call" && <em>{t(step.kind)}</em>}
    </>
  );
}

function stepKeys(
  event: KeyboardEvent,
  current: number,
  total: number,
): number | null {
  if (event.key === "Home") return 0;
  if (event.key === "End") return total - 1;
  if (event.key === "ArrowRight" || event.key === "ArrowDown")
    return Math.min(total - 1, current + 1);
  if (event.key === "ArrowLeft" || event.key === "ArrowUp")
    return Math.max(0, current - 1);
  return null;
}

function Wide({
  actors,
  steps,
  width,
  current,
  measure,
  go,
  label,
  stepTitle,
}: {
  actors: Cast;
  steps: Placed[];
  width: number;
  current: number;
  measure: Measure;
  go: (index: number) => void;
  label: string;
  stepTitle: (step: Placed, index: number) => string;
}) {
  const margin = 4;
  const colW = (width - 2 * margin) / actors.length;
  const X = (i: number) => margin + colW * (i + 0.5);
  const headH = actors.some((actor) => actor.sub) ? 58 : 42;
  const boxW = Math.min(colW - 12, 176);
  const rows: { top: number; h: number; y: number }[] = [];
  let y = headH + 16;
  for (const step of steps) {
    const h = step.kind !== "note" && step.a === step.b ? SELF_ROW : ROW;
    rows.push({ top: y, h, y: y + 30 });
    y += h;
  }
  const height = y + 14;
  const active = steps[current];
  const involved = new Set(active ? [active.a, active.b] : []);
  const badge = (x: number, cy: number, i: number) => (
    <g className="sq-num">
      <circle cx={x} cy={cy} r={10} />
      <text x={x} y={cy + 4} textAnchor="middle">
        {i + 1}
      </text>
    </g>
  );

  return (
    <svg
      className="sq-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      tabIndex={0}
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        const next = stepKeys(event, current, steps.length);
        if (next === null) return;
        event.preventDefault();
        go(next);
      }}
    >
      {actors.map((actor, i) => (
        <line
          key={actor.id}
          className="sq-life"
          data-tone={actor.tone}
          data-on={involved.has(i) ? "" : undefined}
          x1={X(i)}
          x2={X(i)}
          y1={headH}
          y2={height - 4}
        />
      ))}
      {active && (
        <rect
          className="sq-band"
          x={2}
          y={rows[current].top + 3}
          width={width - 4}
          height={rows[current].h - 6}
          rx={8}
        />
      )}
      {actors.map((actor, i) => {
        const x = X(i);
        const iconW = actor.icon ? 26 : 0;
        const name = fit(measure, actor.label, boxW - 20 - iconW, 14, 600);
        const nameX = x - (measure(name, 14, 600) + iconW) / 2;
        const sub = actor.sub ? fit(measure, actor.sub, boxW - 16, 12) : "";
        const nameY = actor.sub ? 24 : headH / 2 + 5;
        return (
          <g
            key={actor.id}
            className="sq-actor"
            data-tone={actor.tone}
            data-on={involved.has(i) ? "" : undefined}
          >
            <rect
              x={x - boxW / 2}
              y={1}
              width={boxW}
              height={headH - 2}
              rx={10}
            />
            {actor.icon && (
              <text
                className="sq-icon"
                x={nameX + 9}
                y={nameY}
                textAnchor="middle"
              >
                {actor.icon}
              </text>
            )}
            <text className="sq-alabel" x={nameX + iconW} y={nameY}>
              {name}
            </text>
            {sub && (
              <text
                className="sq-asub"
                x={x}
                y={nameY + 19}
                textAnchor="middle"
              >
                {sub}
              </text>
            )}
            <title>
              {actor.sub ? `${actor.label} · ${actor.sub}` : actor.label}
            </title>
          </g>
        );
      })}
      {steps.map((step, i) => {
        const row = rows[i];
        const state = i < current ? "done" : i === current ? "cur" : "todo";
        const xa = X(step.a);
        const xb = X(step.b);
        const size = 13;
        const weight = state === "cur" ? 600 : 500;
        let body: ReactNode;
        let hit: { x: number; w: number };
        if (step.kind === "note") {
          const low = Math.min(xa, xb);
          const high = Math.max(xa, xb);
          const want = measure(step.label, size, weight) + 52;
          let x0: number;
          let x1: number;
          if (step.a === step.b) {
            // A note on one actor stays inside that actor's column.
            const w = Math.min(want, colW - 8);
            x0 = low - w / 2;
            x1 = low + w / 2;
          } else {
            // A note across actors spans their lifelines, wider when the label needs it.
            x0 = low - colW * 0.36;
            x1 = high + colW * 0.36;
            if (x1 - x0 < want) {
              const mid = (low + high) / 2;
              x0 = mid - want / 2;
              x1 = mid + want / 2;
            }
          }
          x0 = Math.max(4, x0);
          x1 = Math.min(width - 4, x1);
          const text = fit(measure, step.label, x1 - x0 - 52, size, weight);
          const groupW = 27 + measure(text, size, weight);
          const gx = (x0 + x1) / 2 - groupW / 2;
          body = (
            <>
              <rect
                className="sq-note"
                x={x0}
                y={row.top + 8}
                width={x1 - x0}
                height={30}
                rx={6}
              />
              {badge(gx + 10, row.top + 23, i)}
              <text className="sq-label" x={gx + 27} y={row.top + 27.5}>
                {text}
              </text>
            </>
          );
          hit = { x: x0, w: x1 - x0 };
        } else if (step.a === step.b) {
          const right =
            xa + 74 + measure(step.label, size, weight) < width - 4 ||
            xa < width / 2;
          const d = right ? 1 : -1;
          const y1 = row.top + 16;
          const y2 = row.top + 40;
          const loopX = xa + d * 30;
          const text = fit(
            measure,
            step.label,
            right ? width - 4 - (xa + 70) : xa - 74,
            size,
            weight,
          );
          const groupW = 27 + measure(text, size, weight);
          const gx = right ? xa + 44 : xa - 44 - groupW;
          body = (
            <>
              <path
                className="sq-line"
                data-reply={step.kind === "reply" ? "" : undefined}
                d={`M${xa},${y1}H${loopX - d * 6}Q${loopX},${y1} ${loopX},${y1 + 6}V${y2 - 6}Q${loopX},${y2} ${loopX - d * 6},${y2}H${xa + d * 8}`}
              />
              <path
                className="sq-head"
                d={`M${xa + d},${y2}l${d * 8},-4.5v9z`}
              />
              {badge(gx + 10, (y1 + y2) / 2, i)}
              <text className="sq-label" x={gx + 27} y={(y1 + y2) / 2 + 4.5}>
                {text}
              </text>
            </>
          );
          const left = right ? xa - 8 : gx - 4;
          hit = { x: left, w: (right ? gx + groupW + 8 : xa + 8) - left };
        } else {
          const d = xb > xa ? 1 : -1;
          const x1 = xa + d * 2;
          const x2 = xb - d * 2;
          const text = fit(
            measure,
            step.label,
            Math.max(84, Math.abs(xb - xa) + colW * 0.4 - 36),
            size,
            weight,
          );
          const groupW = 27 + measure(text, size, weight);
          const gx = Math.max(
            4,
            Math.min(width - 4 - groupW, (xa + xb) / 2 - groupW / 2),
          );
          const reply = step.kind === "reply";
          body = (
            <>
              <path
                className="sq-line"
                data-reply={reply ? "" : undefined}
                d={`M${x1},${row.y}H${x2 - d * (reply ? 1 : 7)}`}
              />
              {reply ? (
                <path
                  className="sq-open"
                  d={`M${x2 - d * 8},${row.y - 5}L${x2},${row.y}L${x2 - d * 8},${row.y + 5}`}
                />
              ) : (
                <path
                  className="sq-head"
                  d={`M${x2},${row.y}l${-d * 8},-4.5v9z`}
                />
              )}
              {badge(gx + 10, row.y - 15, i)}
              <text className="sq-label" x={gx + 27} y={row.y - 10.5}>
                {text}
              </text>
            </>
          );
          const left = Math.min(xa, xb, gx) - 6;
          hit = { x: left, w: Math.max(xa, xb, gx + groupW) + 6 - left };
        }
        return (
          <g
            key={i}
            className="sq-step"
            data-state={state}
            data-kind={step.kind}
            onClick={() => go(i)}
          >
            <rect
              className="sq-hit"
              x={hit.x}
              y={row.top + 2}
              width={hit.w}
              height={row.h - 4}
            />
            {body}
            <title>{stepTitle(step, i)}</title>
          </g>
        );
      })}
    </svg>
  );
}

export function SequenceDiagramBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const model = data as unknown as Sequence;
  const { actors, steps } = useMemo(() => arrange(model), [model]);
  const rootRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  // Server rendering and export start wide; the observer corrects it on mount.
  const [width, setWidth] = useState(800);
  const [font, setFont] = useState(FALLBACK_FONT);
  const [current, setCurrent] = useReaderState("step", 0, { accept: isIndex });
  const [playing, setPlaying] = useState(false);
  const total = steps.length;
  const at = Math.min(current, Math.max(0, total - 1));

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    setFont(getComputedStyle(element).fontFamily || FALLBACK_FONT);
    const read = () => setWidth(Math.floor(element.clientWidth));
    read();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setCurrent((value) => Math.min(value + 1, total - 1)),
      PLAY_MS,
    );
    return () => clearInterval(timer);
  }, [playing, total]);
  useEffect(() => {
    if (playing && at >= total - 1) setPlaying(false);
  }, [at, playing, total]);

  const measure = useMemo(() => measurer(font), [font]);
  const go = (index: number) => {
    setPlaying(false);
    setCurrent(Math.max(0, Math.min(total - 1, index)));
  };
  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (at >= total - 1) setCurrent(0);
    setPlaying(true);
  };
  const stepTitle = (step: Placed, index: number) =>
    t("stepTitle", {
      number: index + 1,
      from: actors[step.a].label,
      to: actors[step.b].label,
      label: step.label,
    });

  const label = blockLabel(model.title, t("title"));
  const narrow = width < 640 || (width - 8) / Math.max(1, actors.length) < 96;
  const step = steps[at];
  const state = (i: number) => (i < at ? "done" : i === at ? "cur" : "todo");
  const controls = (
    <div className="sq-bar">
      <div className="sq-buttons" role="group" aria-label={t("controls")}>
        <button type="button" onClick={() => go(at - 1)} disabled={at === 0}>
          <Icon name="prev" />
          <span>{t("prev")}</span>
        </button>
        <button
          type="button"
          onClick={() => go(at + 1)}
          disabled={at >= total - 1}
        >
          <Icon name="next" />
          <span>{t("next")}</span>
        </button>
        <button
          type="button"
          className="sq-play"
          aria-pressed={playing}
          onClick={togglePlay}
          disabled={total < 2}
        >
          <Icon name={playing ? "pause" : "play"} />
          <span>{playing ? t("pause") : t("play")}</span>
        </button>
        <button
          type="button"
          onClick={() => go(0)}
          disabled={at === 0 && !playing}
        >
          <Icon name="restart" />
          <span>{t("restart")}</span>
        </button>
      </div>
      <span className="sq-count" aria-live="polite">
        {t("count", { current: at + 1, total })}
      </span>
    </div>
  );
  const progress = (
    <div className="sq-progress" aria-hidden="true">
      <i style={{ width: `${((at + 1) / Math.max(1, total)) * 100}%` }} />
    </div>
  );

  return (
    <section
      className="sb-block sq-block"
      aria-label={label}
      ref={rootRef}
      data-narrow={narrow ? "" : undefined}
    >
      {(model.title || model.description || !narrow) && (
        <div className="sq-top">
          <div>
            {model.title && (
              <h3 className="sq-title">
                <NoteText text={model.title} />
              </h3>
            )}
            {model.description && (
              <p className="sq-description">{model.description}</p>
            )}
          </div>
          {!narrow && total > 0 && <span className="sq-hint">{t("hint")}</span>}
        </div>
      )}
      {step &&
        (narrow ? (
          <>
            <div className="sq-cast" aria-label={t("actors")}>
              {actors.map((actor) => (
                <ActorChip key={actor.id} actor={actor} />
              ))}
            </div>
            <div className="sq-panel sq-panel-bar">
              {controls}
              {progress}
            </div>
            <ol
              className="sq-list"
              ref={listRef}
              onKeyDown={(event) => {
                const next = stepKeys(event, at, total);
                if (next === null) return;
                event.preventDefault();
                go(next);
                listRef.current
                  ?.querySelectorAll<HTMLButtonElement>("button")
                  [next]?.focus();
              }}
            >
              {steps.map((item, i) => (
                <li key={i} data-state={state(i)} data-kind={item.kind}>
                  <button
                    type="button"
                    aria-current={i === at ? "step" : undefined}
                    onClick={() => go(i)}
                  >
                    <span className="sq-lnum">{i + 1}</span>
                    <span className="sq-lbody">
                      <span className="sq-route">
                        <Route step={item} actors={actors} t={t} />
                      </span>
                      <span className="sq-ltitle">{item.label}</span>
                    </span>
                  </button>
                  {i === at && item.detail && (
                    <div className="sq-ldetail sq-md">
                      <DetailText source={item.detail} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <Wide
              actors={actors}
              steps={steps}
              width={width}
              current={at}
              measure={measure}
              go={go}
              label={t("diagram", { count: total })}
              stepTitle={stepTitle}
            />
            <div className="sq-panel">
              {controls}
              {progress}
              <div className="sq-detail" aria-live="polite">
                <div className="sq-meta">
                  <span className="sq-lnum">{at + 1}</span>
                  <Route step={step} actors={actors} t={t} />
                </div>
                <h4>{step.label}</h4>
                {step.detail && (
                  <div className="sq-md">
                    <DetailText source={step.detail} />
                  </div>
                )}
              </div>
            </div>
          </>
        ))}
      {/* Printed pages cannot step through, so every step and its detail is listed. */}
      <div className="sq-static">
        <p className="sq-static-title">{t("allSteps")}</p>
        <ol>
          {steps.map((item, i) => (
            <li key={i}>
              <div className="sq-route">
                <Route step={item} actors={actors} t={t} />
              </div>
              <b>{item.label}</b>
              {item.detail && (
                <div className="sq-md">
                  <DetailText source={item.detail} />
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
