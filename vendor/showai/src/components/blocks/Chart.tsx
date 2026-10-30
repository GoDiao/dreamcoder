import { BlockSettings } from "./action-host";
import { useId, useMemo, useState } from "react";
import {
  BarChart3,
  ChartNoAxesCombined,
  Check,
  Database,
  Download,
} from "../../ui/icons";
import {
  COLORS,
  downloadFile,
  finite,
  parseChartData,
  text,
  toCsv,
} from "./helpers";
import { BlockHeader, EmptyState, Field, blockLabel } from "./shared";
import type { BlockProps, ChartSeries } from "./types";
import { getLocale } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/chart";
import { NoteSvgText, NoteText, noteProps } from "./NoteText";
import { plainNotes, textNotes } from "./note-markup.mjs";
import { isIndexList, useReaderState } from "../../surface/reader-state";

/** Axis label: [label]{note} keeps its note; a shortened label shows the full text on hover. */
function AxisLabel({ label }: { label: string }) {
  const plain = plainNotes(label);
  if (plain.length <= 12) return <NoteSvgText text={label} />;
  const notes = textNotes(label).map((item) => item.note);
  return (
    <tspan {...noteProps([plain, ...notes].join("\n"), false)}>
      {plain.slice(0, 10) + "…"}
    </tspan>
  );
}

const WIDTH = 760,
  HEIGHT = 272,
  LEFT = 54,
  RIGHT = 24,
  TOP = 22,
  BOTTOM = 36;
const prettyNumber = (value: number) =>
  new Intl.NumberFormat(getLocale(), {
    notation: Math.abs(value) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);

export function ChartBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  const [editing, setEditing] = useState(false);
  const [hidden, setHidden] = useReaderState<number[]>("hiddenSeries", [], {
    accept: isIndexList,
  });
  const [hover, setHover] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftUnit, setDraftUnit] = useState("");
  const [error, setError] = useState("");
  const labels = Array.isArray(data.labels)
    ? data.labels.map((label) => text(label))
    : [];
  const series: ChartSeries[] = Array.isArray(data.series)
    ? data.series
        .filter(
          (item) =>
            item && typeof item === "object" && Array.isArray(item.values),
        )
        .map((item, index) => ({
          name: text(item.name, t("seriesName", { index: index + 1 })),
          values: item.values.map((value: unknown) => finite(value)),
          color: /^#[0-9a-f]{3,8}$/i.test(item.color)
            ? item.color
            : COLORS[index % COLORS.length],
        }))
    : [];
  const visible = series.filter((_, index) => !hidden.includes(index));
  const type = data.type === "bar" ? "bar" : "line";
  const values = visible.flatMap((item) => item.values.slice(0, labels.length));
  const minValue = Math.min(0, ...values),
    maxValue = Math.max(0, ...values);
  const padding = (maxValue - minValue) * 0.12 || 1;
  const domainMin = minValue < 0 ? minValue - padding : 0,
    domainMax = maxValue + padding;
  const chartWidth = WIDTH - LEFT - RIGHT,
    chartHeight = HEIGHT - TOP - BOTTOM;
  const band = chartWidth / Math.max(labels.length, 1);
  const x = (index: number) =>
    type === "bar"
      ? LEFT + band * (index + 0.5)
      : LEFT +
        (labels.length === 1
          ? chartWidth / 2
          : (index / (labels.length - 1)) * chartWidth);
  const y = (value: number) =>
    TOP + ((domainMax - value) / (domainMax - domainMin)) * chartHeight;
  const baseline = y(0);
  const uid = useId().replaceAll(":", "");
  const ticks = useMemo(
    () => Array.from({ length: 5 }, (_, index) => index / 4),
    [],
  );
  const editable = Boolean(onChange && !readOnly);
  const openEditor = () => {
    setDraft(
      JSON.stringify(
        {
          labels,
          series: series.map((item) => ({
            name: item.name,
            values: item.values,
            ...(item.color ? { color: item.color } : {}),
          })),
        },
        null,
        2,
      ),
    );
    setDraftTitle(text(data.title));
    setDraftUnit(text(data.unit));
    setError("");
    setEditing(!editing);
  };
  const save = () => {
    let result: ReturnType<typeof parseChartData>;
    try {
      result = parseChartData(draft);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("invalidData"));
      return;
    }
    onChange?.({ ...data, ...result, title: draftTitle, unit: draftUnit });
    setHidden([]);
    setEditing(false);
  };
  const exportCsv = () =>
    downloadFile(
      toCsv(
        [
          { id: "label", name: t("csvLabel"), type: "text" },
          ...series.map((item, index) => ({
            id: `s${index}`,
            name: plainNotes(item.name),
            type: "number" as const,
          })),
        ],
        labels.map((label, index) => ({
          id: String(index),
          label: plainNotes(label),
          ...Object.fromEntries(
            series.map((item, seriesIndex) => [
              `s${seriesIndex}`,
              item.values[index] ?? "",
            ]),
          ),
        })),
      ),
      `${plainNotes(text(data.title)) || t("fileName")}.csv`,
      "text/csv;charset=utf-8",
    );
  return (
    <section
      className="sb-block sb-chart"
      aria-label={blockLabel(data.title, t("dataChart"))}
    >
      <BlockHeader
        title={text(data.title)}
        defaultTitle={t("dataChart")}
        description={text(data.description)}
        icon={<ChartNoAxesCombined size={17} />}
        editable={editable}
        editing={editing}
        onEdit={openEditor}
      >
        {labels.length > 0 && (
          <button
            type="button"
            className="sb-icon-button"
            onClick={exportCsv}
            aria-label={t("exportData")}
            title={t("exportCsv")}
          >
            <Download size={15} />
          </button>
        )}
        {editable && (
          <div className="sb-segmented" aria-label={t("chartType")}>
            <button
              type="button"
              aria-label={t("line")}
              className={type === "line" ? "is-active" : ""}
              onClick={() => onChange?.({ ...data, type: "line" })}
            >
              <ChartNoAxesCombined size={15} />
            </button>
            <button
              type="button"
              aria-label={t("bar")}
              className={type === "bar" ? "is-active" : ""}
              onClick={() => onChange?.({ ...data, type: "bar" })}
            >
              <BarChart3 size={15} />
            </button>
          </div>
        )}
      </BlockHeader>
      {editing && (
        <BlockSettings>
          <div className="sb-editor-panel">
            <div className="sb-form-row">
              <Field label={t("title")}>
                <input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                />
              </Field>
              <Field label={t("unit")}>
                <input
                  placeholder={t("unitPlaceholder")}
                  value={draftUnit}
                  onChange={(event) => setDraftUnit(event.target.value)}
                />
              </Field>
            </div>
            <Field label={t("dataField")}>
              <textarea
                className="sb-code-input"
                rows={10}
                spellCheck={false}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </Field>
            {error && (
              <p role="alert" className="sb-error">
                {error}
              </p>
            )}
            <div className="sb-panel-footer">
              <button
                type="button"
                className="sb-button sb-primary"
                onClick={save}
              >
                <Check size={14} />
                {t("applyData")}
              </button>
            </div>
          </div>
        </BlockSettings>
      )}
      {!labels.length || !series.length ? (
        <EmptyState
          icon={<ChartNoAxesCombined size={30} strokeWidth={1.4} />}
          title={t("emptyTitle")}
          action={
            editable && !editing ? (
              <button type="button" className="sb-button" onClick={openEditor}>
                <Database size={14} />
                {t("addData")}
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="sb-chart-legend">
            {series.map((item, index) => (
              <button
                type="button"
                key={`${item.name}-${index}`}
                aria-pressed={!hidden.includes(index)}
                className={hidden.includes(index) ? "is-muted" : ""}
                onClick={() =>
                  setHidden((current) =>
                    current.includes(index)
                      ? current.filter((hiddenIndex) => hiddenIndex !== index)
                      : [...current, index],
                  )
                }
              >
                <span style={{ backgroundColor: item.color }} />
                <NoteText text={item.name} focusable={false} />
              </button>
            ))}
            {text(data.unit) && (
              <span className="sb-chart-unit">
                {t("unitValue", { unit: text(data.unit) })}
              </span>
            )}
          </div>
          <div className="sb-chart-canvas" onMouseLeave={() => setHover(null)}>
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label={t("summary", {
                title: plainNotes(text(data.title)) || t("chart"),
                points: labels.length,
                series: series.length,
              })}
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const relative =
                  ((event.clientX - rect.left) / rect.width) * WIDTH;
                const index =
                  type === "bar"
                    ? Math.floor((relative - LEFT) / band)
                    : Math.round(
                        ((relative - LEFT) / chartWidth) * (labels.length - 1),
                      );
                setHover(Math.min(labels.length - 1, Math.max(0, index)));
              }}
            >
              <defs>
                {visible.map((item, index) => (
                  <linearGradient
                    key={`${item.name}-${index}`}
                    id={`${uid}-fill-${index}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={item.color}
                      stopOpacity=".11"
                    />
                    <stop
                      offset="100%"
                      stopColor={item.color}
                      stopOpacity=".01"
                    />
                  </linearGradient>
                ))}
              </defs>
              {ticks.map((tick) => {
                const value = domainMax - tick * (domainMax - domainMin),
                  lineY = TOP + chartHeight * tick;
                return (
                  <g key={tick}>
                    <line
                      x1={LEFT}
                      x2={WIDTH - RIGHT}
                      y1={lineY}
                      y2={lineY}
                      className="sb-chart-grid"
                    />
                    <text
                      x={LEFT - 12}
                      y={lineY + 4}
                      textAnchor="end"
                      className="sb-chart-label"
                    >
                      {prettyNumber(value)}
                    </text>
                  </g>
                );
              })}
              {labels.map(
                (label, index) =>
                  (labels.length <= 10 ||
                    index % Math.ceil(labels.length / 8) === 0 ||
                    index === labels.length - 1) && (
                    <text
                      key={index}
                      x={x(index)}
                      y={HEIGHT - 12}
                      textAnchor="middle"
                      className="sb-chart-label"
                    >
                      <AxisLabel label={label} />
                    </text>
                  ),
              )}
              {visible.map((item, seriesIndex) => {
                const points = labels
                  .map(
                    (_, index) => `${x(index)},${y(item.values[index] ?? 0)}`,
                  )
                  .join(" ");
                if (type === "bar") {
                  const groupWidth = band * 0.66,
                    width = Math.max(
                      1,
                      groupWidth / Math.max(visible.length, 1) - 3,
                    );
                  return (
                    <g key={`${item.name}-${seriesIndex}`}>
                      {labels.map((label, index) => (
                        <rect
                          key={index}
                          x={
                            x(index) -
                            groupWidth / 2 +
                            seriesIndex * (width + 3)
                          }
                          y={Math.min(y(item.values[index] ?? 0), baseline)}
                          width={width}
                          height={Math.max(
                            1,
                            Math.abs(baseline - y(item.values[index] ?? 0)),
                          )}
                          rx={3}
                          fill={item.color}
                          opacity={
                            hover === null || hover === index ? ".9" : ".5"
                          }
                        >
                          <title>
                            {plainNotes(label)} · {plainNotes(item.name)}:{" "}
                            {item.values[index] ?? 0}
                            {text(data.unit)}
                          </title>
                        </rect>
                      ))}
                    </g>
                  );
                }
                return (
                  <g key={`${item.name}-${seriesIndex}`}>
                    <polygon
                      points={`${x(0)},${baseline} ${points} ${x(labels.length - 1)},${baseline}`}
                      fill={`url(#${uid}-fill-${seriesIndex})`}
                    />
                    <polyline
                      points={points}
                      fill="none"
                      stroke={item.color}
                      strokeWidth={2.3}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {(labels.length <= 20 || hover !== null) &&
                      labels.map(
                        (label, index) =>
                          (labels.length <= 20 || hover === index) && (
                            <circle
                              key={index}
                              cx={x(index)}
                              cy={y(item.values[index] ?? 0)}
                              r={hover === index ? 5 : 3}
                              fill={item.color}
                              stroke="var(--sb-surface)"
                              strokeWidth={2}
                            >
                              <title>
                                {plainNotes(label)} · {plainNotes(item.name)}:{" "}
                                {item.values[index] ?? 0}
                                {text(data.unit)}
                              </title>
                            </circle>
                          ),
                      )}
                  </g>
                );
              })}
              {hover !== null && (
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={TOP}
                  y2={HEIGHT - BOTTOM}
                  className="sb-chart-crosshair"
                />
              )}
            </svg>
            {hover !== null && (
              <div
                className="sb-chart-tooltip"
                style={{
                  left: `${Math.min(78, Math.max(8, (x(hover) / WIDTH) * 100))}%`,
                }}
              >
                <strong>{plainNotes(labels[hover])}</strong>
                {visible.map((item, index) => (
                  <div key={`${item.name}-${index}`}>
                    <span
                      className="sb-dot"
                      style={{ background: item.color }}
                    />
                    {plainNotes(item.name)}
                    <b>
                      {prettyNumber(item.values[hover] ?? 0)}
                      {text(data.unit)}
                    </b>
                  </div>
                ))}
              </div>
            )}
          </div>
          <details className="sb-data-details">
            <summary>
              {t("rawData")} <span>{t("rows", { count: labels.length })}</span>
            </summary>
            <div className="sb-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("label")}</th>
                    {series.map((item, index) => (
                      <th key={index}>
                        <NoteText text={item.name} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {labels.map((label, index) => (
                    <tr key={index}>
                      <td>
                        <NoteText text={label} />
                      </td>
                      {series.map((item, seriesIndex) => (
                        <td key={seriesIndex}>{item.values[index] ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
