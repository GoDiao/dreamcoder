import "./stepper.css";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useRef,
} from "react";
import { translator } from "../../i18n";
import { useReaderState } from "../../surface/reader-state";
import messages from "../../i18n/messages/richText";

const t = translator(messages);

/** Most steps a stepper holds; stepper.css hides inactive steps up to this count. */
export { MAX_STEPS } from "../blocks/primitive-contract.mjs";

export const stepTitle = (title: unknown, index: number) =>
  typeof title === "string" && title.trim()
    ? title
    : t("stepper.step", { n: index + 1 });

/**
 * Numbered step bar with previous/next. The editor and the reader share it;
 * which step is open is view state owned by the caller.
 */
export function StepperBar({
  titles,
  active,
  onSelect,
}: {
  titles: string[];
  active: number;
  onSelect: (index: number) => void;
}) {
  const tabs = useRef(new Map<number, HTMLButtonElement>());
  const go = (index: number, focus = false) => {
    const target = Math.max(0, Math.min(titles.length - 1, index));
    onSelect(target);
    if (focus) tabs.current.get(target)?.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    go(active + delta, true);
  };
  return (
    <div className="stepper-bar" contentEditable={false}>
      <div
        className="stepper-tabs"
        role="tablist"
        aria-label={t("stepper.steps")}
        onKeyDown={onKey}
      >
        {titles.map((title, index) => (
          <button
            key={index}
            ref={(element) => {
              if (element) tabs.current.set(index, element);
              else tabs.current.delete(index);
            }}
            type="button"
            role="tab"
            className="stepper-tab"
            aria-selected={index === active}
            tabIndex={index === active ? 0 : -1}
            data-done={index < active ? "" : undefined}
            onClick={() => go(index)}
          >
            <span className="stepper-number">{index + 1}</span>
            <span className="stepper-title">{title}</span>
          </button>
        ))}
      </div>
      <div className="stepper-arrows">
        <button
          type="button"
          className="stepper-arrow"
          aria-label={t("stepper.previous")}
          title={t("stepper.previous")}
          disabled={active === 0}
          onClick={() => go(active - 1)}
        >
          ←
        </button>
        <button
          type="button"
          className="stepper-arrow"
          aria-label={t("stepper.next")}
          title={t("stepper.next")}
          disabled={active === titles.length - 1}
          onClick={() => go(active + 1)}
        >
          →
        </button>
      </div>
    </div>
  );
}

/**
 * Reader for saved pages. Every step stays in the document so printing and
 * static reading show them all; the screen shows the open one.
 */
export function StepperReader({
  id,
  style,
  titles,
  steps,
}: {
  id?: string;
  style?: CSSProperties;
  titles: string[];
  steps: ReactNode[];
}) {
  const [active, setActive] = useReaderState("step", 0, {
    block: id ?? null,
    accept: Number.isInteger,
  });
  const current = Math.min(active, steps.length - 1);
  return (
    <section
      id={id}
      data-block-id={id}
      style={style}
      className="document-stepper portable-stepper"
    >
      <StepperBar titles={titles} active={current} onSelect={setActive} />
      {steps.map((step, index) => (
        <section
          key={index}
          className="stepper-step"
          role="tabpanel"
          aria-label={titles[index]}
          data-active={index === current ? "" : undefined}
        >
          <h4 className="stepper-print-title">
            {index + 1}. {titles[index]}
          </h4>
          {step}
        </section>
      ))}
    </section>
  );
}
