import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import type { BlockProps } from "./types";
import { DIAGRAM_TONES, LAYER_TONE_ORDER } from "./doc-diagrams-contract.mjs";
import type {
  EntryStatus,
  WalkthroughData,
  WalkthroughPart,
  WalkthroughStep,
} from "./walkthrough-contract.mjs";
import { InlineMarkup } from "./InlineMarkup";
import "./step-walkthrough.css";
import { blockLabel } from "./shared";
import type { MessageKey, MessageParams } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/stepWalkthrough";
import { isFlag, isIndex, useReaderState } from "../../surface/reader-state";

type Part = WalkthroughPart & { tone: NonNullable<WalkthroughPart["tone"]> };
type Translate = (
  key: MessageKey<typeof messages>,
  params?: MessageParams,
) => string;

const statusKey = (status: EntryStatus) => `status.${status}` as const;

/** Code lines starting with + or - read as an added or removed diff line. */
function CodeLines({ code }: { code: string }) {
  return (
    <pre className="wk-code">
      {code.split("\n").map((line, index) => (
        <span
          key={index}
          data-diff={
            line.startsWith("+")
              ? "add"
              : line.startsWith("-")
                ? "del"
                : undefined
          }
        >
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function StepView({
  step,
  index,
  parts,
  stateHeading,
  hidden,
  onHide,
  t,
}: {
  step: WalkthroughStep;
  index: number;
  parts: Part[];
  stateHeading?: string;
  hidden: boolean;
  onHide?: (value: boolean) => void;
  t: Translate;
}) {
  const partOf = (id?: string) => parts.find((part) => part.id === id);
  const output = step.output;
  const hiddenPart = output && hidden ? partOf(output.hidePartId) : undefined;
  const togglePart = output?.hidePartId ? partOf(output.hidePartId) : undefined;
  return (
    <div className="wk-step-view">
      <div className="wk-takeaway">
        <span>{t("takeaway", { n: index + 1 })}</span>
        <p>
          <InlineMarkup source={step.takeaway} />
        </p>
      </div>
      <div className="wk-body">
        <div className="wk-col">
          <h4 className="wk-col-title">
            {step.actionsHeading ?? t("actions")}
          </h4>
          <ol className="wk-actions">
            {step.actions.map((action, k) => (
              <li
                key={k}
                className="wk-action"
                data-kind={action.kind ?? "action"}
              >
                <span className="wk-actor">
                  {action.actor}
                  {action.illustrative && (
                    <em className="wk-illustrative">{t("illustrative")}</em>
                  )}
                </span>
                <span className="wk-action-text">
                  <InlineMarkup source={action.text} />
                </span>
                {action.code && <CodeLines code={action.code} />}
              </li>
            ))}
          </ol>
        </div>
        <div className="wk-col">
          {output ? (
            <>
              <div className="wk-col-head">
                <h4 className="wk-col-title">{output.heading}</h4>
                {togglePart && onHide && (
                  <label className="wk-switch">
                    <input
                      type="checkbox"
                      checked={hidden}
                      onChange={(event) => onHide(event.target.checked)}
                    />
                    {output.hideLabel ?? t("hide", { part: togglePart.label })}
                  </label>
                )}
              </div>
              <div className="wk-blocks">
                {output.blocks.map((block) => {
                  const part = partOf(block.partId);
                  const isHidden = hiddenPart && block.partId === hiddenPart.id;
                  return (
                    <div
                      key={block.id}
                      className="wk-block"
                      data-tone={part?.tone ?? "slate"}
                      data-hidden={isHidden ? "" : undefined}
                    >
                      <div className="wk-block-head">
                        {part && <span className="wk-chip">{part.label}</span>}
                        <span className="wk-block-label">{block.label}</span>
                      </div>
                      {isHidden ? (
                        <p className="wk-hidden-note">
                          <InlineMarkup
                            source={output.hideNote ?? t("hidden")}
                          />
                        </p>
                      ) : (
                        <>
                          <pre className="wk-block-text">{block.text}</pre>
                          {!!block.callouts?.length && (
                            <ul className="wk-callouts">
                              {block.callouts.map((callout, c) => (
                                <li key={c}>
                                  <InlineMarkup source={callout} />
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {hiddenPart && (
                <p className="wk-sr" aria-live="polite">
                  {t("hiddenLive", { part: hiddenPart.label })}
                </p>
              )}
            </>
          ) : (
            <>
              <h4 className="wk-col-title">{stateHeading ?? t("state")}</h4>
              <div className="wk-parts">
                {parts.map((part) => {
                  const entries = (step.entries ?? []).filter(
                    (entry) => entry.partId === part.id,
                  );
                  const note = step.partNotes?.find(
                    (item) => item.partId === part.id,
                  )?.text;
                  return (
                    <section
                      key={part.id}
                      className="wk-part"
                      data-tone={part.tone}
                      aria-label={part.label}
                    >
                      <div className="wk-part-head">
                        <b>{part.label}</b>
                        {part.plain && <span>{part.plain}</span>}
                        {part.how && <small>{part.how}</small>}
                      </div>
                      {note && (
                        <p className="wk-part-note">
                          <InlineMarkup source={note} />
                        </p>
                      )}
                      {!entries.length && !note && (
                        <p className="wk-part-empty">{t("empty")}</p>
                      )}
                      {entries.map((entry) => (
                        <article
                          key={entry.id}
                          className="wk-entry"
                          data-status={entry.status}
                        >
                          <div className="wk-entry-head">
                            <b>{entry.title}</b>
                            <span
                              className="wk-badge"
                              data-status={entry.status}
                            >
                              {entry.statusLabel ?? t(statusKey(entry.status))}
                            </span>
                          </div>
                          <dl className="wk-fields">
                            {entry.fields.map((field, f) => (
                              <div key={f}>
                                <dt>{field.label}</dt>
                                <dd data-mono={field.mono ? "" : undefined}>
                                  {field.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                          {entry.note && (
                            <p className="wk-entry-note">
                              <InlineMarkup source={entry.note} />
                            </p>
                          )}
                        </article>
                      ))}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StepNotes({ step, t }: { step: WalkthroughStep; t: Translate }) {
  return (
    <div className="wk-details">
      {!!step.details?.length && (
        <ul>
          {step.details.map((detail, k) => (
            <li key={k}>
              <InlineMarkup source={detail} />
            </li>
          ))}
        </ul>
      )}
      {!!step.sources?.length && (
        <p className="wk-sources">
          {t("sources")}
          {step.sources.map((source, k) => (
            <span key={k}>
              {k > 0 && " · "}
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.label}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

export function StepWalkthroughBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const model = data as unknown as WalkthroughData;
  const parts = useMemo<Part[]>(
    () =>
      (Array.isArray(model.parts) ? model.parts : []).map((part, index) => ({
        ...part,
        tone: DIAGRAM_TONES.includes(part.tone as Part["tone"])
          ? (part.tone as Part["tone"])
          : LAYER_TONE_ORDER[index % LAYER_TONE_ORDER.length],
      })),
    [model.parts],
  );
  const steps = Array.isArray(model.steps) ? model.steps : [];
  const initial = Math.max(
    0,
    steps.findIndex((step) => step.id === model.initialStep),
  );
  const [current, setCurrent] = useReaderState("step", initial, {
    accept: isIndex,
  });
  // A changed initial step in the data resets the reader's position.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (seenInitial !== initial) {
    setSeenInitial(initial);
    setCurrent(initial);
  }
  const [hidden, setHidden] = useState(false);
  const [showDetails, setShowDetails] = useReaderState("details", false, {
    accept: isFlag,
  });
  const tabs = useRef(new Map<number, HTMLButtonElement>());
  const label = blockLabel(model.title, t("title"));

  if (!steps.length)
    return (
      <section className="sb-block wk-block-root" aria-label={label}>
        <p className="wk-part-empty">{t("noSteps")}</p>
      </section>
    );

  const index = Math.min(current, steps.length - 1);
  const step = steps[index];
  const go = (next: number, focus = false) => {
    const target = Math.max(0, Math.min(steps.length - 1, next));
    setCurrent(target);
    setHidden(false);
    if (focus) tabs.current.get(target)?.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    go(index + delta, true);
  };
  const hasNotes = !!step.details?.length || !!step.sources?.length;

  return (
    <section className="sb-block wk-block-root" aria-label={label}>
      <header className="wk-head">
        <h3 className="wk-title">{model.title}</h3>
        {model.question && (
          <p className="wk-question">
            <span>{t("question")}</span>
            <InlineMarkup source={model.question} />
          </p>
        )}
        <ul className="wk-legend" aria-label={t("parts")}>
          {parts.map((part) => (
            <li key={part.id} data-tone={part.tone}>
              <b>{part.label}</b>
              {part.plain && <span>{part.plain}</span>}
            </li>
          ))}
        </ul>
      </header>

      <div className="wk-live">
        <div
          className="wk-tabs"
          role="tablist"
          aria-label={t("steps")}
          onKeyDown={onKey}
        >
          {steps.map((item, k) => (
            <button
              key={item.id}
              ref={(element) => {
                if (element) tabs.current.set(k, element);
                else tabs.current.delete(k);
              }}
              type="button"
              role="tab"
              aria-selected={k === index}
              tabIndex={k === index ? 0 : -1}
              data-done={k < index ? "" : undefined}
              className="wk-tab"
              onClick={() => go(k)}
            >
              <span className="wk-tab-n">{k + 1}</span>
              <span className="wk-tab-label">{item.label}</span>
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={step.label}>
          <StepView
            step={step}
            index={index}
            parts={parts}
            stateHeading={model.stateHeading}
            hidden={hidden}
            onHide={setHidden}
            t={t}
          />
        </div>
        <footer className="wk-foot">
          <div className="wk-nav">
            <button
              type="button"
              className="wk-btn"
              disabled={index === 0}
              onClick={() => go(index - 1)}
            >
              ← {t("previous")}
            </button>
            <span className="wk-count">
              {t("count", { current: index + 1, total: steps.length })}
            </span>
            <button
              type="button"
              className="wk-btn"
              data-primary=""
              disabled={index === steps.length - 1}
              onClick={() => go(index + 1)}
            >
              {t("next")} →
            </button>
          </div>
          {hasNotes && (
            <div>
              <button
                type="button"
                className="wk-toggle"
                aria-expanded={showDetails}
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? t("hideDetails") : t("details")}
              </button>
              {showDetails && <StepNotes step={step} t={t} />}
            </div>
          )}
        </footer>
      </div>

      {/* Printed pages cannot switch steps, so every step is laid out in order. */}
      <div className="wk-print">
        {steps.map((item, k) => (
          <section key={item.id} className="wk-print-step">
            <h4 className="wk-print-title">
              {k + 1}. {item.label}
            </h4>
            <StepView
              step={item}
              index={k}
              parts={parts}
              stateHeading={model.stateHeading}
              hidden={false}
              t={t}
            />
            {(!!item.details?.length || !!item.sources?.length) && (
              <StepNotes step={item} t={t} />
            )}
          </section>
        ))}
      </div>

      {model.note && (
        <p className="wk-note">
          <InlineMarkup source={model.note} />
        </p>
      )}
    </section>
  );
}
