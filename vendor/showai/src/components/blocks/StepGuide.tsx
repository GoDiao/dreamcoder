import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { BlockProps } from "./types";
import {
  plainInline,
  stepTimeline,
  timelineTicks,
} from "./doc-reference-contract.mjs";
import { InlineMarkup as Inline } from "./InlineMarkup";
import "./step-guide.css";
import { blockLabel } from "./shared";
import type { Translator } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/stepGuide";
import { NoteText } from "./NoteText";
import { isIndex, useReaderSet, useReaderState } from "../../surface/reader-state";

type Variant = { label: string; code: string; lang?: string };
type Segment = { start: number; minutes: number; kind: "active" | "wait" };
type Step = {
  id?: string;
  title: string;
  short?: string;
  badge?: string;
  body?: string;
  code?: string;
  lang?: string;
  variants?: Variant[];
  note?: string;
  result?: string;
  cue?: string;
  wait?: string;
  timer?: { minutes: number; label?: string };
  segments?: Segment[];
};
type Guide = {
  title?: string;
  description?: string;
  layout?: "list" | "focus";
  start?: number;
  initialStep?: number;
  steps: Step[];
};
/** A countdown is paused (`endAt` null) with `left` ms remaining, or running until `endAt`. */
type Timer = { left: number; endAt: number | null; done: boolean };
type T = Translator<(typeof messages)["catalogs"]["zh-CN"]>;

function Paragraphs({
  source,
  className,
}: {
  source: string;
  className: string;
}) {
  return (
    <>
      {source
        .split(/\n+/)
        .filter((line) => line.trim())
        .map((line, index) => (
          <p key={index} className={className}>
            <Inline source={line} />
          </p>
        ))}
    </>
  );
}

// ---------------------------------------------------------------- copyable code panel (shared with command-reference)

/** Copy through a temporary textarea (the Clipboard API is denied in sandboxed readers); select the code when that fails. */
function copyText(text: string, fallback: HTMLElement | null): boolean {
  const active = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  active?.focus?.({ preventScroll: true });
  if (!copied && fallback) {
    const range = document.createRange();
    range.selectNodeContents(fallback);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  return copied;
}

const isComment = (line: string, lang?: string) => {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//")) return true;
  return (
    trimmed.startsWith("#") &&
    !trimmed.startsWith("#!") &&
    !/^(md|markdown)$/i.test(lang ?? "")
  );
};

/**
 * Code with an optional row of variant tabs (one per platform or host) and a copy button.
 * `name` is the accessible name of the code, e.g. "code for step 3".
 */
export function CodePanel({
  variants,
  name,
  fallbackLang,
}: {
  variants: Variant[];
  name: string;
  fallbackLang?: string;
}) {
  const t = useTranslator(messages);
  const baseId = useId();
  const [tab, setTab] = useState(0);
  const [status, setStatus] = useState<"idle" | "copied" | "selected">("idle");
  const codeRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const tabs = variants.length > 1;
  const active = variants[Math.min(tab, variants.length - 1)];
  const code = active.code.replace(/\n+$/, "");
  const lang = active.lang ?? fallbackLang;

  const copy = () => {
    const copied = copyText(code, codeRef.current);
    setStatus(copied ? "copied" : "selected");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => setStatus("idle"),
      copied ? 1500 : 4000,
    );
  };
  const select = (index: number) => {
    setTab(index);
    setStatus("idle");
  };
  const onTabKey = (event: KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowRight: tab + 1,
      ArrowLeft: tab - 1,
      Home: 0,
      End: variants.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = (keys[event.key] + variants.length) % variants.length;
    select(next);
    (tabsRef.current?.children[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <div className="sg-code">
      <div className="sg-codebar">
        {tabs ? (
          <div
            className="sg-tabs"
            role="tablist"
            aria-label={t("code.variants")}
            ref={tabsRef}
            onKeyDown={onTabKey}
          >
            {variants.map((variant, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                id={`${baseId}-tab${index}`}
                aria-selected={index === tab}
                aria-controls={`${baseId}-panel${index}`}
                tabIndex={index === tab ? 0 : -1}
                onClick={() => select(index)}
              >
                {variant.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="sg-lang">
            {active.label || lang || t("code.label")}
          </span>
        )}
        <span className="sg-copy-hint" aria-live="polite">
          {status === "selected" ? t("code.selected") : ""}
        </span>
        <button
          type="button"
          className={`sg-copy${status === "copied" ? " is-ok" : ""}`}
          onClick={copy}
          aria-label={
            status === "copied"
              ? t("code.copied")
              : t("code.copyLabel", { label: name })
          }
        >
          {status === "copied" ? (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
            </svg>
          )}
          <span>{status === "copied" ? t("code.copied") : t("code.copy")}</span>
        </button>
      </div>
      {/* Every variant stays in the document so print and static reading show them all. */}
      {variants.map((variant, index) => (
        <pre
          key={index}
          className="sg-pre"
          id={`${baseId}-panel${index}`}
          role={tabs ? "tabpanel" : undefined}
          aria-labelledby={tabs ? `${baseId}-tab${index}` : undefined}
          aria-label={tabs ? undefined : name}
          data-label={tabs ? variant.label : undefined}
          hidden={index !== tab}
          tabIndex={0}
        >
          <code ref={index === tab ? codeRef : undefined}>
            {variant.code
              .replace(/\n+$/, "")
              .split("\n")
              .map((line, row) => (
                <span
                  key={row}
                  className={
                    isComment(line, variant.lang ?? fallbackLang)
                      ? "sg-comment"
                      : undefined
                  }
                >
                  {line}
                  {"\n"}
                </span>
              ))}
          </code>
        </pre>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- time

function duration(minutes: number, t: T) {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (!hours) return t("duration.minutes", { minutes: rest });
  return rest
    ? t("duration.hoursMinutes", { hours, minutes: rest })
    : t("duration.hours", { hours });
}

function clock(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

const axisLabel = (minute: number) =>
  minute === 0
    ? "0"
    : `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function TimerControl({
  step,
  number,
  timer,
  left,
  large,
  onToggle,
  onReset,
  t,
}: {
  step: Step;
  number: number;
  timer: Timer | undefined;
  left: number;
  large: boolean;
  onToggle: () => void;
  onReset: () => void;
  t: T;
}) {
  const full = step.timer!.minutes * 60000;
  const fraction = full ? left / full : 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const label = step.timer!.label;
  const state = timer?.done ? " is-done" : timer?.endAt ? " is-run" : "";
  return (
    <div
      className={`sg-timer${large ? " is-large" : ""}${state}`}
      role="group"
      aria-label={label ? `${t("timer.label")} · ${label}` : t("timer.label")}
    >
      {large && (
        <svg viewBox="0 0 132 132" className="sg-ring" aria-hidden="true">
          <circle cx="66" cy="66" r={radius} className="sg-ring-bg" />
          <circle
            cx="66"
            cy="66"
            r={radius}
            className="sg-ring-fg"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            transform="rotate(-90 66 66)"
          />
        </svg>
      )}
      <div className="sg-clock">
        <b role="timer">{timer?.done ? t("timer.timeUp") : clock(left)}</b>
        {label && <span>{label}</span>}
      </div>
      {!large && (
        <span className="sg-meter" aria-hidden="true">
          <i style={{ width: `${(1 - fraction) * 100}%` }} />
        </span>
      )}
      <div className="sg-timer-buttons">
        {!timer?.done && (
          <button
            type="button"
            className="sg-go"
            onClick={onToggle}
            aria-label={`${timer?.endAt ? t("timer.pause") : timer ? t("timer.resume") : t("timer.start")} · ${number}`}
          >
            <span aria-hidden="true">{timer?.endAt ? "❚❚" : "▶"}</span>
            {timer?.endAt
              ? t("timer.pause")
              : timer
                ? t("timer.resume")
                : t("timer.start")}
          </button>
        )}
        {timer && (
          <button type="button" className="sg-reset" onClick={onReset}>
            <span aria-hidden="true">↺</span>
            {t("timer.reset")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- step content

function StepDetails({
  step,
  number,
  t,
  timer,
}: {
  step: Step;
  number: number;
  t: T;
  timer?: ReactNode;
}) {
  const variants = step.variants?.length
    ? step.variants
    : step.code
      ? [{ label: "", code: step.code, lang: step.lang }]
      : null;
  return (
    <>
      {step.body && <Paragraphs source={step.body} className="sg-body" />}
      {variants && (
        <CodePanel
          variants={variants}
          name={t("code.stepLabel", { number })}
          fallbackLang={step.lang}
        />
      )}
      {step.cue && (
        <p className="sg-hint is-cue">
          <b>{t("cue")}</b>
          <span>
            <Inline source={step.cue} />
          </span>
        </p>
      )}
      {step.wait && (
        <p className="sg-hint is-wait">
          <b>{t("wait")}</b>
          <span>
            <Inline source={step.wait} />
          </span>
        </p>
      )}
      {step.note && (
        <p className="sg-note">
          <svg viewBox="0 0 16 16" role="img" aria-label={t("note")}>
            <circle cx="8" cy="8" r="6.2" />
            <path d="M8 7.2v3.6M8 5.1v.1" />
          </svg>
          <span>
            <Inline source={step.note} />
          </span>
        </p>
      )}
      {step.result && (
        <p className="sg-result">
          <svg viewBox="0 0 16 16" role="img" aria-label={t("result")}>
            <circle cx="8" cy="8" r="7" />
            <path d="M4.9 8.2l2.1 2.1 4.1-4.5" />
          </svg>
          <span>
            <Inline source={step.result} />
          </span>
        </p>
      )}
      {timer}
    </>
  );
}

/** Timer text for print and static reading, where the countdown cannot run. */
function StaticTimer({ step, t }: { step: Step; t: T }) {
  if (!step.timer) return null;
  const minutes = duration(step.timer.minutes, t);
  return (
    <p className="sg-timer-static">
      <span aria-hidden="true">⏱ </span>
      {step.timer.label
        ? t("timer.of", { label: step.timer.label, minutes })
        : minutes}
    </p>
  );
}

const CheckMark = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.8 8.4l2.8 2.8 5.6-6.4" />
  </svg>
);

// ---------------------------------------------------------------- block

export function StepGuideBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const guide = data as unknown as Guide;
  const steps = guide.steps;
  const focus = guide.layout === "focus";
  const start = guide.start ?? 1;
  const keyOf = (step: Step, index: number) => step.id ?? `#${index}`;
  const shortOf = (step: Step) => step.short ?? plainInline(step.title);
  const baseId = useId();
  const stepId = (index: number) => `${baseId}-step${index}`;

  const [current, setCurrent] = useReaderState(
    "step",
    () => Math.min(Math.max(guide.initialStep ?? 0, 0), steps.length - 1),
    { accept: isIndex },
  );
  const index = Math.min(current, steps.length - 1);
  const [done, setDone] = useReaderSet("done");
  const [timers, setTimers] = useState<Record<string, Timer>>({});
  const [now, setNow] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState("");
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!Object.values(timers).some((timer) => timer.endAt)) return;
    const interval = window.setInterval(() => {
      const moment = Date.now();
      setNow(moment);
      const finished = Object.entries(timers).filter(
        ([, timer]) => timer.endAt !== null && timer.endAt <= moment,
      );
      if (!finished.length) return;
      setTimers((previous) => {
        const next = { ...previous };
        for (const [key] of finished)
          next[key] = { left: 0, endAt: null, done: true };
        return next;
      });
      const number = steps.findIndex(
        (step, i) => keyOf(step, i) === finished[0][0],
      );
      setAnnouncement(t("timer.timeUpStep", { number: start + number }));
    }, 250);
    return () => window.clearInterval(interval);
  }, [timers, steps, start, t]);

  const doneCount = steps.filter((step, i) => done.has(keyOf(step, i))).length;
  const toggleDone = (key: string) =>
    setDone((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const leftOf = (step: Step, i: number) => {
    const timer = timers[keyOf(step, i)];
    if (!timer) return (step.timer?.minutes ?? 0) * 60000;
    return timer.endAt ? Math.max(0, timer.endAt - now) : timer.left;
  };
  const toggleTimer = (step: Step, i: number) => {
    const key = keyOf(step, i);
    const timer = timers[key];
    if (timer?.done) return;
    const left = leftOf(step, i);
    const moment = Date.now();
    setNow(moment);
    setTimers({
      ...timers,
      [key]: timer?.endAt
        ? { left, endAt: null, done: false }
        : { left, endAt: moment + left, done: false },
    });
  };
  const resetTimer = (step: Step, i: number) => {
    const next = { ...timers };
    delete next[keyOf(step, i)];
    setTimers(next);
  };

  /** Focus mode switches the card; list mode scrolls the step into view. */
  const go = (target: number) => {
    const next = Math.min(steps.length - 1, Math.max(0, target));
    setCurrent(next);
    if (focus) return;
    const element = rootRef.current?.querySelector<HTMLElement>(
      `[id="${stepId(next)}"]`,
    );
    element?.scrollIntoView({
      block: "nearest",
      behavior: reducedMotion() ? "auto" : "smooth",
    });
    element?.querySelector<HTMLElement>(".sg-num")?.focus({
      preventScroll: true,
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!focus || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("[role=tablist], pre, input, textarea")) return;
    if (event.key === "ArrowRight") go(index + 1);
    else if (event.key === "ArrowLeft") go(index - 1);
    else return;
    event.preventDefault();
  };

  const timerFor = (step: Step, i: number, large: boolean) =>
    step.timer ? (
      <TimerControl
        step={step}
        number={start + i}
        timer={timers[keyOf(step, i)]}
        left={leftOf(step, i)}
        large={large}
        onToggle={() => toggleTimer(step, i)}
        onReset={() => resetTimer(step, i)}
        t={t}
      />
    ) : null;

  const numberButton = (step: Step, i: number, className = "sg-num") => {
    const number = start + i;
    const isDone = done.has(keyOf(step, i));
    return (
      <button
        type="button"
        className={className}
        aria-pressed={isDone}
        aria-label={
          isDone ? t("markUndone", { number }) : t("markDone", { number })
        }
        onClick={() => toggleDone(keyOf(step, i))}
      >
        {isDone ? <CheckMark /> : number}
      </button>
    );
  };

  // Timers that keep running (or have finished) away from what the reader is looking at.
  const tray = steps
    .map((step, i) => ({ step, i, timer: timers[keyOf(step, i)] }))
    .filter(
      ({ i, timer }) =>
        timer && (timer.endAt || timer.done) && !(focus && i === index),
    );

  const timeline = stepTimeline(steps);
  const ticks = timelineTicks(timeline.total);
  const percent = (minute: number) => `${(minute / timeline.total) * 100}%`;
  const step = steps[index];

  return (
    <section
      ref={rootRef}
      className={`sb-block sg-block ${focus ? "is-focus" : "is-list"}`}
      aria-label={blockLabel(guide.title, t("title"))}
      onKeyDown={onKeyDown}
    >
      {(guide.title || guide.description) && (
        <div className="sg-head">
          {guide.title && (
            <h3 className="sg-heading">
              <NoteText text={guide.title} />
            </h3>
          )}
          {guide.description && (
            <p className="sg-sub">
              <Inline source={guide.description} />
            </p>
          )}
        </div>
      )}

      {steps.length > 1 && (
        <div className="sg-progress">
          <span className="sg-count" aria-live="polite">
            {doneCount === steps.length
              ? t("allDone")
              : t("progress", { done: doneCount, total: steps.length })}
          </span>
          <span className="sg-bar" aria-hidden="true">
            <i style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </span>
          {doneCount > 0 ? (
            <button
              type="button"
              className="sg-clear"
              aria-label={t("resetProgressLabel")}
              onClick={() => setDone(new Set())}
            >
              {t("resetProgress")}
            </button>
          ) : (
            !focus && <span className="sg-tip">{t("tickHint")}</span>
          )}
        </div>
      )}

      {timeline.total > 0 && (
        <div className="sg-ribbon" role="group" aria-label={t("ribbon.label")}>
          <div className="sg-ribbon-sum">
            <span className="sg-ribbon-total">
              <b>{duration(timeline.total, t)}</b> {t("ribbon.total")}
            </span>
            <span className="sg-key is-active">
              <i aria-hidden="true" /> {t("ribbon.active")}{" "}
              <b>{duration(timeline.active, t)}</b>
            </span>
            <span className="sg-key is-wait">
              <i aria-hidden="true" /> {t("ribbon.wait")}{" "}
              <b>{duration(timeline.wait, t)}</b>
            </span>
            <span className="sg-ribbon-hint">{t("ribbon.hint")}</span>
          </div>
          <div className="sg-ribbon-rows">
            {steps.map((item, i) =>
              item.segments?.length ? (
                <button
                  key={keyOf(item, i)}
                  type="button"
                  className={`sg-row${focus && i === index ? " is-current" : ""}${done.has(keyOf(item, i)) ? " is-done" : ""}`}
                  aria-current={focus && i === index ? "step" : undefined}
                  aria-label={t("ribbon.row", {
                    number: start + i,
                    label: shortOf(item),
                  })}
                  onClick={() => go(i)}
                >
                  <span className="sg-row-label" aria-hidden="true">
                    <em>{start + i}</em>
                    {shortOf(item)}
                  </span>
                  <span className="sg-track" aria-hidden="true">
                    {ticks.map((minute) => (
                      <span
                        key={minute}
                        className="sg-grid"
                        style={{ left: percent(minute) }}
                      />
                    ))}
                    {item.segments.map((segment, s) => (
                      <span
                        key={s}
                        className={`sg-seg is-${segment.kind}`}
                        style={{
                          left: percent(segment.start),
                          width: percent(segment.minutes),
                        }}
                      >
                        {timers[keyOf(item, i)]?.endAt &&
                          s === item.segments!.length - 1 && (
                            <span className="sg-live" />
                          )}
                      </span>
                    ))}
                  </span>
                </button>
              ) : null,
            )}
            <div className="sg-axis" aria-hidden="true">
              <span />
              <span className="sg-track">
                {ticks.map((minute) => (
                  <span key={minute} style={{ left: percent(minute) }}>
                    {axisLabel(minute)}
                  </span>
                ))}
              </span>
            </div>
          </div>
        </div>
      )}

      {tray.length > 0 && (
        <div className="sg-tray" role="group" aria-label={t("timer.tray")}>
          {tray.map(({ step: item, i, timer }) => {
            const time = timer.done
              ? t("timer.timeUp")
              : clock(leftOf(item, i));
            return (
              <button
                key={keyOf(item, i)}
                type="button"
                className={timer.done ? "is-done" : undefined}
                aria-label={t("timer.trayItem", {
                  number: start + i,
                  label: shortOf(item),
                  time,
                })}
                onClick={() => go(i)}
              >
                <span aria-hidden="true">{timer.done ? "⏰" : "⏱"}</span>
                <span className="sg-tray-label">{shortOf(item)}</span>
                <b>{time}</b>
              </button>
            );
          })}
        </div>
      )}

      {focus ? (
        <>
          <div className="sg-card" key={keyOf(step, index)}>
            <div className="sg-card-main">
              <div
                className={`sg-card-head${done.has(keyOf(step, index)) ? " is-done" : ""}`}
              >
                {numberButton(step, index, "sg-num is-large")}
                <div className="sg-card-titles">
                  <small>
                    {t("focus.position", {
                      number: index + 1,
                      total: steps.length,
                    })}
                  </small>
                  <h4 className="sg-title" aria-live="polite">
                    <Inline source={step.title} />
                  </h4>
                </div>
                {step.badge && <span className="sg-badge">{step.badge}</span>}
              </div>
              <StepDetails step={step} number={start + index} t={t} />
            </div>
            {step.timer && (
              <div className="sg-card-side">{timerFor(step, index, true)}</div>
            )}
          </div>
          <nav className="sg-foot" aria-label={t("focus.nav")}>
            <button
              type="button"
              className="sg-nav"
              onClick={() => go(index - 1)}
              disabled={index === 0}
            >
              <span aria-hidden="true">← </span>
              {t("focus.prev")}
            </button>
            <div className="sg-dots">
              {steps.map((item, i) => (
                <button
                  key={keyOf(item, i)}
                  type="button"
                  aria-label={t("focus.goTo", {
                    number: start + i,
                    title: plainInline(item.title),
                  })}
                  aria-current={i === index ? "step" : undefined}
                  className={`${i === index ? "is-current" : ""}${done.has(keyOf(item, i)) ? " is-done" : ""}`}
                  onClick={() => go(i)}
                />
              ))}
            </div>
            <button
              type="button"
              className="sg-nav is-next"
              onClick={() => go(index + 1)}
              disabled={index === steps.length - 1}
            >
              {t("focus.next")}
              <span aria-hidden="true"> →</span>
            </button>
          </nav>
          {/* Print and static reading show every step; the countdown becomes text. */}
          <ol className="sg-print" start={start}>
            {steps.map((item, i) => (
              <li key={keyOf(item, i)}>
                <h4 className="sg-title">
                  <Inline source={item.title} />
                  {item.badge && <span className="sg-badge">{item.badge}</span>}
                </h4>
                <StepDetails
                  step={item}
                  number={start + i}
                  t={t}
                  timer={<StaticTimer step={item} t={t} />}
                />
              </li>
            ))}
          </ol>
        </>
      ) : (
        <ol className="sg-list">
          {steps.map((item, i) => {
            const isDone = done.has(keyOf(item, i));
            return (
              <li
                key={keyOf(item, i)}
                id={stepId(i)}
                className={`sg-step${isDone ? " is-done" : ""}`}
              >
                <div className="sg-rail">
                  {numberButton(item, i)}
                  {i < steps.length - 1 && (
                    <span className="sg-line" aria-hidden="true" />
                  )}
                </div>
                <div className="sg-content">
                  <h4 className="sg-title">
                    <Inline source={item.title} />
                    {item.badge && (
                      <span className="sg-badge">{item.badge}</span>
                    )}
                  </h4>
                  <StepDetails
                    step={item}
                    number={start + i}
                    t={t}
                    timer={
                      item.timer && (
                        <>
                          <div className="sg-screen">
                            {timerFor(item, i, false)}
                          </div>
                          <div className="sg-print-only">
                            <StaticTimer step={item} t={t} />
                          </div>
                        </>
                      )
                    }
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="sg-announce" aria-live="assertive">
        {announcement}
      </p>
    </section>
  );
}
