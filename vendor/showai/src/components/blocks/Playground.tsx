import { BlockSettings } from "./action-host";
import {
  type CSSProperties,
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  FlaskConical,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
} from "../../ui/icons";
import { finite, text, uid } from "./helpers";
import { BlockHeader, Field } from "./shared";
import type { BlockProps } from "./types";
import {
  breakdownParts,
  clampInput,
  compilePlayground,
  evaluatePlayground,
  formatNumber,
  inputDefault,
  inputType,
  isLegacyPlayground,
  rankItems,
  validatePlaygroundData,
  type NumberFormat,
  type PlaygroundBreakdown,
  type PlaygroundFormula,
  type PlaygroundOutput,
  type PlaygroundPreset,
  type PlaygroundRanking,
} from "./playground-contract.mjs";
import "./playground.css";
import { getLocale, type MessageKey, type Translator } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/playground";
import common from "../../i18n/messages/common";
import { isNumberRecord, useReaderState } from "../../surface/reader-state";

interface Parameter {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  type?: "slider" | "stepper" | "toggle" | "choice";
  hint?: string;
  options?: { label: string; value: number; note?: string }[];
}
type Translate = Translator<(typeof messages.catalogs)["zh-CN"]>;
const OPERATIONS: { value: string; label: MessageKey<typeof messages> }[] = [
  { value: "sum", label: "operation.sum" },
  { value: "product", label: "operation.product" },
  { value: "average", label: "operation.average" },
];
const LIMITS: {
  key: "min" | "max" | "step" | "value";
  label: MessageKey<typeof messages>;
}[] = [
  { key: "min", label: "min" },
  { key: "max", label: "max" },
  { key: "step", label: "step" },
  { key: "value", label: "initial" },
];
// Slider and stepper carry a numeric range; toggle and choice do not.
const ranged = (input: Parameter) =>
  ["slider", "stepper"].includes(inputType(input));
const swatch = (color: string | undefined, index: number) =>
  color ?? `var(--pg-c${(index % 8) + 1})`;
// Steps such as 0.1 accumulate binary error; trim to a stable display value.
const tidy = (value: number) => Number(value.toFixed(10));

export function calculate(inputs: number[], operation: string): number {
  if (!inputs.length) return 0;
  if (operation === "product")
    return inputs.reduce((result, value) => result * value, 1);
  const total = inputs.reduce((result, value) => result + value, 0);
  return operation === "average" ? total / inputs.length : total;
}
export function PlaygroundBlock({ data, onChange, readOnly }: BlockProps) {
  const controlId = useId();
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const inputs: Parameter[] = Array.isArray(data.inputs) ? data.inputs : [];
  const [values, setValues] = useReaderState<Record<string, number>>(
    "values",
    {},
    { accept: isNumberRecord },
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    resultLabel: "",
    unit: "",
    operation: "sum",
  });
  const [draftInputs, setDraftInputs] = useState<Parameter[]>([]);
  const [error, setError] = useState("");
  const editable = Boolean(onChange && !readOnly);
  const legacy = isLegacyPlayground(data);
  const locale = getLocale();
  // Formulas compile once per data change; data reaching here was validated by the host.
  const compiled = useMemo(() => {
    try {
      return { formulas: compilePlayground(data), problem: "" };
    } catch (problem) {
      return { formulas: [], problem: (problem as Error).message };
    }
  }, [data]);
  const scope = compiled.problem
    ? {}
    : evaluatePlayground(data, values, compiled.formulas);
  const currentValue = (input: Parameter) =>
    clampInput(input, values[input.id] ?? inputDefault(input));
  const setValue = (input: Parameter, value: number) =>
    setValues((current) => ({
      ...current,
      [input.id]: clampInput(input, value),
    }));
  const result = calculate(
    inputs.map(currentValue),
    text(data.operation, "sum"),
  );
  const formattedResult = Number.isFinite(result)
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(result)
    : t("outOfRange");
  const formulas = Array.isArray(data.formulas)
    ? (data.formulas as PlaygroundFormula[])
    : [];
  const outputs: PlaygroundOutput[] = Array.isArray(data.outputs)
    ? (data.outputs as PlaygroundOutput[])
    : !legacy && formulas.length
      ? [{ formula: formulas[formulas.length - 1].id }]
      : [];
  const breakdown = data.breakdown as PlaygroundBreakdown | undefined;
  const presets = Array.isArray(data.presets)
    ? (data.presets as PlaygroundPreset[])
    : [];
  const ranking = data.ranking as PlaygroundRanking | undefined;
  const hasResultPanel = legacy || outputs.length > 0 || Boolean(breakdown);
  const openEditor = () => {
    setDraft({
      title: text(data.title, t("defaultTitle")),
      resultLabel: text(data.resultLabel, t("defaultResult")),
      unit: text(data.unit),
      operation: text(data.operation, "sum"),
    });
    setDraftInputs(inputs.map((input) => ({ ...input })));
    setError("");
    setEditing(!editing);
  };
  const save = () => {
    if (
      draftInputs.some(
        (input) =>
          !input.label.trim() ||
          (ranged(input) &&
            (![input.min, input.max, input.value].every(Number.isFinite) ||
              input.min >= input.max ||
              // A stepper may omit its step and count by 1.
              (input.step !== undefined || inputType(input) === "slider"
                ? !Number.isFinite(input.step) || input.step <= 0
                : false))),
      )
    ) {
      setError(t("invalidInputs"));
      return;
    }
    const nextInputs = draftInputs.map((input) =>
      ranged(input)
        ? {
            ...input,
            value: Math.min(input.max, Math.max(input.min, input.value)),
          }
        : input,
    );
    // The editor covers the legacy fields; formulas, outputs and the rest are carried over untouched.
    const next = legacy
      ? { ...data, ...draft, inputs: nextInputs }
      : { ...data, title: draft.title, inputs: nextInputs };
    try {
      validatePlaygroundData(next);
    } catch (problem) {
      setError(t("invalidData", { message: (problem as Error).message }));
      return;
    }
    onChange?.(next);
    setValues({});
    setEditing(false);
  };
  const updateDraftInput = (index: number, changes: Partial<Parameter>) =>
    setDraftInputs((current) =>
      current.map((input, currentIndex) =>
        currentIndex === index ? { ...input, ...changes } : input,
      ),
    );
  const formulaById = new Map(formulas.map((formula) => [formula.id, formula]));
  const inputById = new Map(inputs.map((input) => [input.id, input]));
  const nameOf = (id: string) =>
    formulaById.get(id)?.label ?? inputById.get(id)?.label ?? id;
  const formatOf = (id: string, format?: NumberFormat) =>
    format ?? formulaById.get(id)?.format;
  const unitOf = (id: string, unit?: string) =>
    unit ?? formulaById.get(id)?.unit ?? inputById.get(id)?.unit ?? "";
  const show = (value: number, format?: NumberFormat) =>
    Number.isFinite(value)
      ? formatNumber(value, format, locale)
      : t("outOfRange");
  const isActivePreset = (preset: PlaygroundPreset) =>
    Object.entries(preset.values).every(([id, value]) => {
      const input = inputById.get(id);
      return input !== undefined && currentValue(input) === value;
    });
  return (
    <section
      className="sb-block sb-playground"
      aria-label={text(data.title) || t("defaultTitle")}
    >
      <BlockHeader
        title={text(data.title)}
        defaultTitle={t("defaultTitle")}
        description={text(data.description)}
        icon={<FlaskConical size={17} />}
        editable={editable}
        editing={editing}
        onEdit={openEditor}
      >
        <button
          type="button"
          className="sb-icon-button"
          aria-label={t("reset")}
          title={t("reset")}
          onClick={() => setValues({})}
        >
          <RotateCcw size={15} />
        </button>
      </BlockHeader>
      {editing && (
        <BlockSettings>
          <div className="sb-editor-panel">
            <div className="sb-form-row">
              <Field label={t("title")}>
                <input
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </Field>
              {legacy && (
                <Field label={t("operation")}>
                  <select
                    value={draft.operation}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        operation: event.target.value,
                      }))
                    }
                  >
                    {OPERATIONS.map((operation) => (
                      <option key={operation.value} value={operation.value}>
                        {t(operation.label)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            {legacy ? (
              <div className="sb-form-row">
                <Field label={t("resultLabel")}>
                  <input
                    value={draft.resultLabel}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        resultLabel: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label={t("resultUnit")}>
                  <input
                    value={draft.unit}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        unit: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
            ) : (
              <p className="pg-editor-note">{t("advancedNote")}</p>
            )}
            {draftInputs.map((input, index) => (
              <div className="sb-parameter-editor" key={input.id}>
                <div className="sb-form-row">
                  <Field label={t("parameterName")}>
                    <input
                      value={input.label}
                      onChange={(event) =>
                        updateDraftInput(index, { label: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={t("unit")}>
                    <input
                      value={input.unit ?? ""}
                      onChange={(event) =>
                        updateDraftInput(index, { unit: event.target.value })
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    className="sb-icon-button sb-danger"
                    aria-label={t("deleteParameter", { label: input.label })}
                    onClick={() =>
                      setDraftInputs((current) =>
                        current.filter(
                          (_, currentIndex) => currentIndex !== index,
                        ),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {ranged(input) && (
                  <div className="sb-form-row">
                    {LIMITS.map(({ key, label }) => (
                      <Field key={key} label={t(label)}>
                        <input
                          type="number"
                          value={input[key] ?? ""}
                          onChange={(event) =>
                            updateDraftInput(index, {
                              [key]:
                                event.target.value === ""
                                  ? 0
                                  : Number(event.target.value),
                            })
                          }
                        />
                      </Field>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {error && (
              <p className="sb-error" role="alert">
                {error}
              </p>
            )}
            <div className="sb-panel-footer">
              <button
                type="button"
                className="sb-button"
                onClick={() =>
                  setDraftInputs((current) => [
                    ...current,
                    {
                      id: uid(),
                      label: t("newParameter"),
                      min: 0,
                      max: 100,
                      step: 1,
                      value: 0,
                    },
                  ])
                }
              >
                <Plus size={14} />
                {t("addParameter")}
              </button>
              <button
                type="button"
                className="sb-button sb-primary"
                onClick={save}
              >
                <Check size={14} />
                {tc("save")}
              </button>
            </div>
          </div>
        </BlockSettings>
      )}
      {compiled.problem && (
        <p className="sb-error" role="alert">
          {t("invalidData", { message: compiled.problem })}
        </p>
      )}
      <div
        className={`sb-playground-body${!hasResultPanel && ranking ? " pg-ranking-body" : ""}`}
      >
        <div className="sb-parameters">
          {presets.length > 0 && (
            <div className="pg-presets" role="group" aria-label={t("presets")}>
              {presets.map((preset, index) => (
                <button
                  key={index}
                  type="button"
                  className="pg-chip"
                  aria-pressed={isActivePreset(preset)}
                  onClick={() =>
                    setValues((current) => ({ ...current, ...preset.values }))
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
          {inputs.length ? (
            inputs.map((input) => {
              const type = inputType(input);
              const value = currentValue(input);
              const id = `${controlId}-param-${input.id}`;
              if (type === "stepper")
                return (
                  <StepperInput
                    key={input.id}
                    id={id}
                    input={input}
                    value={value}
                    locale={locale}
                    t={t}
                    onChange={(next) => setValue(input, next)}
                  />
                );
              if (type === "toggle")
                return (
                  <div className="sb-parameter pg-toggle-row" key={input.id}>
                    <div className="pg-toggle-copy">
                      <label htmlFor={id}>{input.label}</label>
                      {input.hint && <p className="pg-hint">{input.hint}</p>}
                    </div>
                    <button
                      id={id}
                      type="button"
                      role="switch"
                      aria-checked={value === 1}
                      className="pg-switch"
                      onClick={() => setValue(input, value ? 0 : 1)}
                    >
                      <span aria-hidden="true" />
                    </button>
                  </div>
                );
              if (type === "choice")
                return (
                  <ChoiceInput
                    key={input.id}
                    id={id}
                    input={input}
                    value={value}
                    onChange={(next) => setValue(input, next)}
                  />
                );
              return (
                <div className="sb-parameter" key={input.id}>
                  <div className="sb-parameter-label">
                    <label htmlFor={id}>{input.label}</label>
                    <div>
                      <input
                        aria-label={t("parameterValue", { label: input.label })}
                        type="number"
                        min={input.min}
                        max={input.max}
                        step={input.step}
                        value={value}
                        onChange={(event) => {
                          if (event.target.value === "") return;
                          setValue(input, Number(event.target.value));
                        }}
                      />
                      <span>{input.unit}</span>
                    </div>
                  </div>
                  <input
                    id={id}
                    aria-label={input.label}
                    type="range"
                    min={input.min}
                    max={input.max}
                    step={input.step}
                    value={value}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [input.id]: Number(event.target.value),
                      }))
                    }
                    style={
                      {
                        "--range-progress": `${((value - input.min) / (input.max - input.min)) * 100}%`,
                      } as CSSProperties
                    }
                  />
                  <div className="sb-range-labels">
                    <span>
                      {input.min}
                      {input.unit}
                    </span>
                    <span>
                      {input.max}
                      {input.unit}
                    </span>
                  </div>
                  {input.hint && <p className="pg-hint">{input.hint}</p>}
                </div>
              );
            })
          ) : (
            <div className="sb-empty">
              <FlaskConical size={26} />
              <strong>{t("emptyTitle")}</strong>
              {editable && !editing && (
                <button
                  type="button"
                  className="sb-button"
                  onClick={openEditor}
                >
                  {t("setUp")}
                </button>
              )}
            </div>
          )}
        </div>
        {legacy ? (
          <div className="sb-calculation-result">
            <span>{text(data.resultLabel, t("defaultResult"))}</span>
            <strong aria-live="polite">
              {formattedResult}
              <small>{text(data.unit)}</small>
            </strong>
            <span className="sb-formula">
              {inputs.length
                ? inputs
                    .map((input) => input.label)
                    .join(data.operation === "product" ? " × " : " + ") +
                  (data.operation === "average"
                    ? t("averageSuffix", { count: inputs.length })
                    : "")
                : t("waiting")}
            </span>
          </div>
        ) : hasResultPanel ? (
          <div className="sb-calculation-result pg-results">
            {outputs.map((output, index) => {
              const value = scope[output.formula] ?? Number.NaN;
              const format = formatOf(output.formula, output.format);
              const content = (
                <>
                  {show(value, format)}
                  {unitOf(output.formula, output.unit) && (
                    <small>{unitOf(output.formula, output.unit)}</small>
                  )}
                </>
              );
              return (
                <div
                  key={`${output.formula}-${index}`}
                  className={index ? "pg-figure" : "pg-headline"}
                >
                  <span>{output.label ?? nameOf(output.formula)}</span>
                  {index ? (
                    <b>{content}</b>
                  ) : (
                    <strong aria-live="polite">{content}</strong>
                  )}
                  {output.hint && <p className="pg-hint">{output.hint}</p>}
                  {output.target && (
                    <TargetMeter
                      value={value}
                      target={
                        typeof output.target.value === "string"
                          ? (scope[output.target.value] ?? Number.NaN)
                          : output.target.value
                      }
                      label={output.target.label ?? t("target")}
                      above={output.target.above ?? t("above")}
                      below={output.target.below ?? t("below")}
                      show={(amount) => show(amount, format)}
                      t={t}
                    />
                  )}
                </div>
              );
            })}
            {breakdown && (
              <Breakdown
                breakdown={breakdown}
                parts={breakdownParts(data, scope).map((part) => ({
                  ...part,
                  label: part.label ?? nameOf(part.formula),
                  text: show(
                    part.value,
                    breakdown.format ?? formatOf(part.formula),
                  ),
                }))}
                locale={locale}
                t={t}
              />
            )}
            {text(data.note) && <p className="pg-note">{text(data.note)}</p>}
          </div>
        ) : null}
        {ranking && !hasResultPanel && (
          <Ranking ranking={ranking} scope={scope} locale={locale} t={t} />
        )}
      </div>
      {ranking && hasResultPanel && (
        <div className="pg-ranking-wide">
          <Ranking ranking={ranking} scope={scope} locale={locale} t={t} />
        </div>
      )}
      {ranking && !hasResultPanel && text(data.note) && (
        <p className="pg-note pg-note-wide">{text(data.note)}</p>
      )}
    </section>
  );
}

function StepperInput({
  id,
  input,
  value,
  locale,
  t,
  onChange,
}: {
  id: string;
  input: Parameter;
  value: number;
  locale: string;
  t: Translate;
  onChange: (value: number) => void;
}) {
  const step = finite(input.step, 1) || 1;
  return (
    <div className="sb-parameter pg-stepper-row">
      <div className="pg-toggle-copy">
        <span id={`${id}-label`}>{input.label}</span>
        {input.hint && <p className="pg-hint">{input.hint}</p>}
      </div>
      <div className="pg-stepper" role="group" aria-labelledby={`${id}-label`}>
        <button
          type="button"
          aria-label={t("decrease", { label: input.label })}
          disabled={value <= input.min}
          onClick={() => onChange(tidy(value - step))}
        >
          <Minus size={14} />
        </button>
        <output aria-live="polite">
          {new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(
            value,
          )}
          {input.unit && <small>{input.unit}</small>}
        </output>
        <button
          type="button"
          aria-label={t("increase", { label: input.label })}
          disabled={value >= input.max}
          onClick={() => onChange(tidy(value + step))}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function ChoiceInput({
  id,
  input,
  value,
  onChange,
}: {
  id: string;
  input: Parameter;
  value: number;
  onChange: (value: number) => void;
}) {
  const options = input.options ?? [];
  const group = useRef<HTMLDivElement>(null);
  // Radio-group keyboard model: arrows move and select, only the checked option is tabbable.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
      event.key
    ];
    if (!delta) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    group.current
      ?.querySelectorAll<HTMLButtonElement>("[role=radio]")
      [next]?.focus();
  };
  return (
    <div className="sb-parameter">
      <div className="sb-parameter-label">
        <span id={`${id}-label`}>{input.label}</span>
      </div>
      <div
        ref={group}
        className="pg-choices"
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        onKeyDown={onKeyDown}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            tabIndex={option.value === value ? 0 : -1}
            className="pg-choice"
            onClick={() => onChange(option.value)}
          >
            <b>{option.label}</b>
            {option.note && <span>{option.note}</span>}
          </button>
        ))}
      </div>
      {input.hint && <p className="pg-hint">{input.hint}</p>}
    </div>
  );
}

function TargetMeter({
  value,
  target,
  label,
  above,
  below,
  show,
  t,
}: {
  value: number;
  target: number;
  label: string;
  above: string;
  below: string;
  show: (value: number) => string;
  t: Translate;
}) {
  if (!Number.isFinite(value) || !Number.isFinite(target)) return null;
  const low = Math.min(0, value, target);
  const high = Math.max(0, value, target);
  const end = high + (high - low || 1) * 0.08;
  const at = (amount: number) => `${((amount - low) / (end - low)) * 100}%`;
  const gap = value - target;
  const hit = gap >= 0;
  return (
    <div className={`pg-target ${hit ? "is-hit" : "is-miss"}`}>
      <div className="pg-target-track" aria-hidden="true">
        <span className="pg-target-fill" style={{ width: at(value) }} />
        <span className="pg-target-mark" style={{ left: at(target) }} />
      </div>
      <div className="pg-target-copy">
        <span>
          {label} {show(target)}
        </span>
        <b>
          {gap === 0
            ? t("onTarget")
            : `${hit ? "▲" : "▼"} ${show(Math.abs(gap))} ${hit ? above : below}`}
        </b>
      </div>
    </div>
  );
}

function Breakdown({
  breakdown,
  parts,
  locale,
  t,
}: {
  breakdown: PlaygroundBreakdown;
  parts: {
    formula: string;
    label: string;
    color?: string;
    value: number;
    share: number;
    text: string;
  }[];
  locale: string;
  t: Translate;
}) {
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const title = breakdown.title ?? t("breakdown");
  return (
    <div className="pg-breakdown" role="group" aria-label={title}>
      <span className="pg-section-title">{title}</span>
      <div className="pg-bar" aria-hidden="true">
        {parts.map((part, index) => (
          <span
            key={part.formula}
            className={part.value < 0 ? "is-negative" : undefined}
            style={{
              width: `${part.share * 100}%`,
              background: swatch(part.color, index),
            }}
          />
        ))}
      </div>
      <table className="pg-table">
        <thead>
          <tr>
            <th scope="col">{t("item")}</th>
            <th scope="col">{t("value")}</th>
            <th scope="col">{t("share")}</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((part, index) => (
            <tr key={part.formula}>
              <th scope="row">
                <i
                  className={part.value < 0 ? "is-negative" : undefined}
                  style={{ background: swatch(part.color, index) }}
                />
                {part.label}
              </th>
              <td>{part.text}</td>
              <td>{percent.format(part.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ranking({
  ranking,
  scope,
  locale,
  t,
}: {
  ranking: PlaygroundRanking;
  scope: Record<string, number>;
  locale: string;
  t: Translate;
}) {
  const ranked = rankItems(ranking, scope);
  const list = useRef<HTMLOListElement>(null);
  const positions = useRef(new Map<string, number>());
  const order = ranked.map((entry) => entry.item.id).join("\u0000");
  // FLIP: rows slide from their previous position when the order changes.
  useLayoutEffect(() => {
    const rows = [
      ...(list.current?.querySelectorAll<HTMLElement>("[data-rank-id]") ?? []),
    ];
    const still =
      typeof window === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    for (const row of rows) {
      const id = row.dataset.rankId!;
      const top = row.offsetTop;
      const before = positions.current.get(id);
      positions.current.set(id, top);
      if (still || before === undefined || before === top) continue;
      row.animate?.(
        [
          { transform: `translateY(${before - top}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: 280, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
    }
  }, [order]);
  const weights = ranking.criteria.map((criterion) => {
    const weight =
      typeof criterion.weight === "string"
        ? scope[criterion.weight]
        : (criterion.weight ?? 1);
    return Number.isFinite(weight) ? Math.max(0, weight) : 0;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: ranking.decimals ?? 0,
    maximumFractionDigits: ranking.decimals ?? 0,
  });
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const title = ranking.title ?? t("ranking");
  return (
    <div className="pg-ranking" role="group" aria-label={title}>
      <div className="pg-ranking-head">
        <span className="pg-section-title">{title}</span>
        <ul className="pg-legend" aria-label={t("weights")}>
          {ranking.criteria.map((criterion, index) => (
            <li
              key={criterion.id}
              className={weights[index] ? undefined : "is-off"}
              title={criterion.hint}
            >
              <i style={{ background: swatch(criterion.color, index) }} />
              {criterion.label}
              <b>{percent.format(total ? weights[index] / total : 0)}</b>
            </li>
          ))}
        </ul>
      </div>
      <ol className="pg-rank-list" ref={list}>
        {ranked.map((entry, position) => (
          <li
            key={entry.item.id}
            data-rank-id={entry.item.id}
            className={position === 0 && total ? "is-first" : undefined}
          >
            <span className="pg-rank-number" aria-hidden="true">
              {position + 1}
            </span>
            <div className="pg-rank-copy">
              <b>{entry.item.label}</b>
              {entry.item.note && <span>{entry.item.note}</span>}
            </div>
            <div className="pg-rank-bar">
              {entry.parts.map((part, index) =>
                part.value > 0 ? (
                  <span
                    key={part.id}
                    title={t("contribution", {
                      label: ranking.criteria[index].label,
                      value: part.value.toFixed(1),
                    })}
                    style={{
                      width: `${part.value}%`,
                      background: swatch(ranking.criteria[index].color, index),
                    }}
                  />
                ) : null,
              )}
            </div>
            <strong className="pg-rank-score">
              <span className="pg-visually-hidden">{t("score")} </span>
              {number.format(entry.score)}
            </strong>
          </li>
        ))}
      </ol>
    </div>
  );
}
