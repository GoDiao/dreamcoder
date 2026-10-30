import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "../../ui/icons";
import {
  type CalendarEntry,
  calendarEntries,
  entriesByDay,
  formatDay,
  heatmapSummary,
  localDay,
  MAX_HEATMAP_WEEKS,
  parseDay,
  startOfWeek,
  timeLanes,
} from "./database-contract.mjs";
import { text } from "./helpers";
import { BlockItemSources } from "./action-host";
import { EmptyState } from "./shared";
import { useLocale, useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/database";
import type {
  DatabaseCalendarConfig,
  DatabaseColumn,
  DatabaseRow,
} from "./types";
import "./database-calendar.css";
import { isIndex, useReaderState } from "../../surface/reader-state";

type Mode = "month" | "week" | "heatmap";
type Entry = CalendarEntry<DatabaseRow>;
const MODES: Mode[] = ["month", "week", "heatmap"];
const DAY_MS = 86400000;
const MONTH_VISIBLE = 3;

/** Calendar settings with every column id checked against the current columns. */
export interface CalendarView {
  dateColumn?: DatabaseColumn;
  endDateColumn?: DatabaseColumn;
  startTimeColumn?: DatabaseColumn;
  endTimeColumn?: DatabaseColumn;
  colorColumn?: DatabaseColumn;
  doneColumn?: DatabaseColumn;
  mode: Mode;
  initialDay: number | null;
  weekStartsOn: 0 | 1;
  weeks: number;
}

const pick = (
  columns: DatabaseColumn[],
  id: string | undefined,
  type: DatabaseColumn["type"],
) => columns.find((column) => column.id === id && column.type === type);

/** Resolve saved calendar settings; the date and color columns fall back to the first fitting column. */
export function resolveCalendar(
  columns: DatabaseColumn[],
  config: DatabaseCalendarConfig = {},
): CalendarView {
  const dateColumn =
    pick(columns, config.dateColumn, "date") ??
    columns.find((column) => column.type === "date");
  const endDateColumn = pick(columns, config.endDateColumn, "date");
  const startTimeColumn = pick(columns, config.startTimeColumn, "text");
  return {
    dateColumn,
    endDateColumn:
      endDateColumn && endDateColumn !== dateColumn ? endDateColumn : undefined,
    startTimeColumn,
    endTimeColumn: startTimeColumn
      ? pick(columns, config.endTimeColumn, "text")
      : undefined,
    colorColumn:
      config.colorColumn === ""
        ? undefined
        : (pick(columns, config.colorColumn, "select") ??
          columns.find((column) => column.type === "select")),
    doneColumn: pick(columns, config.doneColumn, "checkbox"),
    mode: MODES.includes(config.mode as Mode) ? (config.mode as Mode) : "month",
    initialDay: parseDay(config.initialDate),
    weekStartsOn: config.weekStartsOn === 0 ? 0 : 1,
    weeks:
      Number.isInteger(config.weeks) &&
      config.weeks! >= 1 &&
      config.weeks! <= MAX_HEATMAP_WEEKS
        ? config.weeks!
        : 12,
  };
}

/** Drop calendar references that no longer fit the columns, so edited properties keep the data valid. */
export function pruneCalendarConfig(
  config: DatabaseCalendarConfig | undefined,
  columns: DatabaseColumn[],
): DatabaseCalendarConfig | undefined {
  if (!config) return undefined;
  const next: DatabaseCalendarConfig = { ...config };
  const keep = (
    key:
      | "dateColumn"
      | "endDateColumn"
      | "startTimeColumn"
      | "endTimeColumn"
      | "colorColumn"
      | "doneColumn",
    type: DatabaseColumn["type"],
  ) => {
    if (next[key] !== undefined && !pick(columns, next[key], type))
      delete next[key];
  };
  keep("dateColumn", "date");
  keep("endDateColumn", "date");
  keep("startTimeColumn", "text");
  keep("endTimeColumn", "text");
  keep("colorColumn", "select");
  keep("doneColumn", "checkbox");
  if (next.endDateColumn && next.endDateColumn === next.dateColumn)
    delete next.endDateColumn;
  if (!next.startTimeColumn) delete next.endTimeColumn;
  return next;
}

const dateOf = (day: number) => new Date(day * DAY_MS);
const monthStart = (day: number) => {
  const date = dateOf(day);
  return Math.round(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / DAY_MS,
  );
};
const addMonths = (day: number, count: number) => {
  const date = dateOf(day);
  return Math.round(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1) / DAY_MS,
  );
};
const clock = (minute: number) =>
  `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

function useFormatters(locale: string) {
  return useMemo(() => {
    const make = (options: Intl.DateTimeFormatOptions) => {
      const format = new Intl.DateTimeFormat(locale, {
        ...options,
        timeZone: "UTC",
      });
      return (day: number) => format.format(dateOf(day));
    };
    return {
      month: make({ year: "numeric", month: "long" }),
      monthShort: make({ month: "short" }),
      day: make({ month: "short", day: "numeric" }),
      full: make({
        year: "numeric",
        month: "short",
        day: "numeric",
        weekday: "short",
      }),
      weekday: make({ weekday: "short" }),
    };
  }, [locale]);
}

export function DatabaseCalendar({
  columns,
  rows,
  settings,
  editable,
  renderCell,
  onMove,
  onAdd,
  onRemove,
}: {
  columns: DatabaseColumn[];
  /** Rows after search and filters; the calendar never filters on its own. */
  rows: DatabaseRow[];
  settings: CalendarView;
  editable: boolean;
  renderCell: (row: DatabaseRow, column: DatabaseColumn) => ReactNode;
  onMove?: (id: string, start: string, end?: string) => void;
  onAdd?: (date: string) => string | undefined;
  onRemove?: (id: string) => void;
}) {
  const t = useTranslator(messages);
  const locale = useLocale();
  const format = useFormatters(locale);
  // Rows mapped from shared data move only when their date is writable here.
  const sources = useContext(BlockItemSources);
  const movable = (id: string) =>
    !sources?.get(id)?.readOnly.includes(settings.dateColumn?.id ?? "");
  const today = localDay();
  const [mode, setMode] = useReaderState<Mode>("calendarMode", settings.mode, {
    accept: (value) => ["month", "week", "heatmap"].includes(value as string),
  });
  const [anchor, setAnchor] = useReaderState(
    "calendarDay",
    settings.initialDay ?? today,
    { accept: isIndex },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const [dragging, setDragging] = useState<Entry | null>(null);
  const heatRef = useRef<HTMLDivElement>(null);
  const {
    dateColumn,
    endDateColumn,
    startTimeColumn,
    endTimeColumn,
    colorColumn,
    doneColumn,
    weekStartsOn,
  } = settings;
  const primary =
    columns.find((column) => column.type === "text") ?? columns[0];
  const entries = useMemo(
    () =>
      dateColumn
        ? calendarEntries(rows, {
            dateColumn: dateColumn.id,
            endDateColumn: endDateColumn?.id,
            startTimeColumn: startTimeColumn?.id,
            endTimeColumn: endTimeColumn?.id,
            doneColumn: doneColumn?.id,
          })
        : [],
    [
      rows,
      dateColumn,
      endDateColumn,
      startTimeColumn,
      endTimeColumn,
      doneColumn,
    ],
  );
  const categories = colorColumn
    ? Array.from(
        new Set([
          ...(colorColumn.options ?? []),
          ...entries.map((entry) => text(entry.row[colorColumn.id])),
        ]),
      ).filter(Boolean)
    : [];
  const toneOf = (row: DatabaseRow) => {
    const index = colorColumn
      ? categories.indexOf(text(row[colorColumn.id]))
      : -1;
    return index < 0 ? "n" : String(index % 5);
  };
  const toneStyle = (tone: string) =>
    ({
      "--dbc-c": `var(--dbc-${tone})`,
      "--dbc-c-soft": `var(--dbc-${tone}-soft)`,
    }) as CSSProperties;
  const inFocus = (entry: Entry) =>
    !focus || (colorColumn && text(entry.row[colorColumn.id]) === focus);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    if (!selectedId) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  if (!dateColumn)
    return (
      <EmptyState
        icon={<span className="sb-dbc-empty-glyph">31</span>}
        title={t("calendar.noDateColumn")}
        description={t("calendar.noDateColumnHint")}
      />
    );

  // Visible window per mode.
  let from: number, to: number, label: string;
  if (mode === "month") {
    const first = monthStart(anchor);
    const last = addMonths(anchor, 1) - 1;
    from = startOfWeek(first, weekStartsOn);
    to = startOfWeek(last, weekStartsOn) + 6;
    label = format.month(first);
  } else if (mode === "week") {
    from = startOfWeek(anchor, weekStartsOn);
    to = from + 6;
    label = `${format.day(from)} – ${format.day(to)}`;
  } else {
    to = startOfWeek(anchor, weekStartsOn) + 6;
    from = to - settings.weeks * 7 + 1;
    label = `${format.month(from)} – ${format.month(to)}`;
  }
  const byDay = entriesByDay(entries, from, to);
  const visible = new Set<Entry>();
  for (const list of byDay.values())
    for (const entry of list) visible.add(entry);
  const undated = rows.length - entries.length;
  const step = (direction: 1 | -1) => {
    setExpandedDay(null);
    setAnchor((current) =>
      mode === "month"
        ? addMonths(current, direction)
        : current + direction * 7 * (mode === "week" ? 1 : settings.weeks),
    );
  };
  const navLabels = {
    month: [t("calendar.previousMonth"), t("calendar.nextMonth")],
    week: [t("calendar.previousWeek"), t("calendar.nextWeek")],
    heatmap: [t("calendar.previousRange"), t("calendar.nextRange")],
  }[mode];
  const weekdays = range(0, 6).map((offset) =>
    format.weekday(startOfWeek(today, weekStartsOn) + offset),
  );
  const selected = entries.find((entry) => entry.row.id === selectedId);
  const timeText = (entry: Entry) =>
    entry.startMinute === null
      ? ""
      : entry.endMinute === null
        ? clock(entry.startMinute)
        : `${clock(entry.startMinute)}–${clock(entry.endMinute)}`;
  const add = (day: number) => {
    const id = onAdd?.(formatDay(day));
    if (id) setSelectedId(id);
  };
  const drop = (day: number) => {
    if (!dragging || !onMove) return;
    const delta = day - dragging.start;
    if (delta)
      onMove(
        dragging.row.id,
        formatDay(dragging.start + delta),
        endDateColumn && parseDay(dragging.row[endDateColumn.id]) !== null
          ? formatDay(dragging.end + delta)
          : undefined,
      );
    setDragging(null);
  };
  const dropTarget = (day: number) =>
    onMove && editable
      ? {
          onDragOver: (event: DragEvent) => {
            if (dragging) event.preventDefault();
          },
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            drop(day);
          },
        }
      : {};

  const chip = (entry: Entry, day: number, compact = false) => {
    const tone = toneOf(entry.row);
    const title = text(entry.row[primary?.id]) || t("untitled");
    const time = timeText(entry);
    return (
      <button
        type="button"
        key={entry.row.id}
        className={[
          "sb-dbc-chip",
          entry.row.id === selectedId && "is-selected",
          inFocus(entry) ? "" : "is-faded",
          entry.done && "is-done",
          entry.start < day && "continues-before",
          entry.end > day && "continues-after",
        ]
          .filter(Boolean)
          .join(" ")}
        style={toneStyle(tone)}
        aria-pressed={entry.row.id === selectedId}
        title={[time, title].filter(Boolean).join(" ")}
        draggable={Boolean(editable && onMove && movable(entry.row.id))}
        onDragStart={() => setDragging(entry)}
        onDragEnd={() => setDragging(null)}
        onClick={() =>
          setSelectedId(entry.row.id === selectedId ? null : entry.row.id)
        }
      >
        {doneColumn && (
          <span className="sb-dbc-check" aria-hidden="true">
            {entry.done ? "✓" : ""}
          </span>
        )}
        {time && !compact && <span className="sb-dbc-time">{time}</span>}
        <span className="sb-dbc-chip-title">{title}</span>
      </button>
    );
  };

  const agenda = (days: number[]) => {
    const filled = days.filter((day) => byDay.get(day)!.length);
    return (
      <ol className="sb-dbc-agenda" aria-label={t("calendar.agenda")}>
        {filled.map((day) => (
          <li
            key={day}
            className={day === today ? "is-today" : ""}
            {...dropTarget(day)}
          >
            <span className="sb-dbc-agenda-day">
              {format.full(day)}
              {day === today && <b>{t("calendar.today")}</b>}
            </span>
            <div className="sb-dbc-agenda-items">
              {byDay.get(day)!.map((entry) => chip(entry, day))}
            </div>
          </li>
        ))}
        {!filled.length && (
          <li className="sb-dbc-agenda-empty">
            {t("calendar.noRecordsInRange")}
          </li>
        )}
      </ol>
    );
  };

  const addButton = (day: number) =>
    editable && onAdd ? (
      <button
        type="button"
        className="sb-icon-button sb-dbc-add"
        aria-label={t("calendar.addOnDay", { date: format.full(day) })}
        onClick={() => add(day)}
      >
        <Plus size={12} />
      </button>
    ) : null;

  const month = () => {
    const activeMonth = dateOf(monthStart(anchor)).getUTCMonth();
    const days = range(from, to);
    return (
      <>
        <div className="sb-dbc-month" role="grid" aria-label={label}>
          <div className="sb-dbc-weekdays" role="row">
            {weekdays.map((name) => (
              <span key={name} role="columnheader">
                {name}
              </span>
            ))}
          </div>
          {range(0, days.length / 7 - 1).map((week) => (
            <div className="sb-dbc-week-row" role="row" key={week}>
              {days.slice(week * 7, week * 7 + 7).map((day) => {
                const list = byDay.get(day)!;
                const expanded = expandedDay === day;
                const shown = expanded ? list : list.slice(0, MONTH_VISIBLE);
                return (
                  <div
                    role="gridcell"
                    key={day}
                    aria-label={format.full(day)}
                    className={[
                      "sb-dbc-day",
                      dateOf(day).getUTCMonth() !== activeMonth && "is-outside",
                      day === today && "is-today",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    {...dropTarget(day)}
                  >
                    <div className="sb-dbc-day-head">
                      <span className="sb-dbc-day-number">
                        {dateOf(day).getUTCDate()}
                      </span>
                      {addButton(day)}
                    </div>
                    {shown.map((entry) => chip(entry, day))}
                    {list.length > MONTH_VISIBLE && (
                      <button
                        type="button"
                        className="sb-dbc-more"
                        aria-expanded={expanded}
                        onClick={() => setExpandedDay(expanded ? null : day)}
                      >
                        {expanded
                          ? t("calendar.showLess")
                          : t("calendar.moreRecords", {
                              count: list.length - MONTH_VISIBLE,
                            })}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {agenda(range(monthStart(anchor), addMonths(anchor, 1) - 1))}
      </>
    );
  };

  const week = () => {
    const days = range(from, to);
    const timed = entries.some(
      (entry) => entry.startMinute !== null && visible.has(entry),
    );
    let startHour = 8,
      endHour = 18;
    for (const entry of visible)
      if (entry.startMinute !== null) {
        startHour = Math.min(startHour, Math.floor(entry.startMinute / 60));
        endHour = Math.max(
          endHour,
          Math.ceil((entry.endMinute ?? entry.startMinute + 60) / 60),
        );
      }
    endHour = Math.min(24, endHour);
    const span = (endHour - startHour) * 60;
    const now = new Date();
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    return (
      <>
        <div
          className={`sb-dbc-weekgrid ${timed ? "is-timed" : ""}`}
          style={{ "--dbc-hours": endHour - startHour } as CSSProperties}
        >
          {timed && (
            <div className="sb-dbc-axis" aria-hidden="true">
              <span className="sb-dbc-axis-head" />
              <span className="sb-dbc-axis-allday">{t("calendar.allDay")}</span>
              <div className="sb-dbc-axis-hours">
                {range(startHour, endHour - 1).map((hour) => (
                  <span
                    key={hour}
                    style={{ top: `${((hour - startHour) * 6000) / span}%` }}
                  >
                    {hour}:00
                  </span>
                ))}
              </div>
            </div>
          )}
          {days.map((day) => {
            const list = byDay.get(day)!;
            const untimed = timed
              ? list.filter(
                  (entry) => entry.startMinute === null || entry.start !== day,
                )
              : list;
            const lanes = timeLanes(
              list.filter((entry) => entry.start === day),
            );
            return (
              <div
                key={day}
                className={`sb-dbc-weekday ${day === today ? "is-today" : ""}`}
                {...dropTarget(day)}
              >
                <div className="sb-dbc-weekday-head">
                  <span>{format.weekday(day)}</span>
                  <strong>{format.day(day)}</strong>
                  {addButton(day)}
                </div>
                <div className="sb-dbc-weekday-list">
                  {untimed.map((entry) => chip(entry, day))}
                </div>
                {timed && (
                  <div className="sb-dbc-hours">
                    {lanes.placed.map(({ entry, lane, end }) => (
                      <div
                        key={entry.row.id}
                        className="sb-dbc-slot"
                        style={{
                          top: `${((entry.startMinute! - startHour * 60) * 100) / span}%`,
                          height: `${((end - entry.startMinute!) * 100) / span}%`,
                          left: `${(lane * 100) / lanes.laneCount}%`,
                          width: `${100 / lanes.laneCount}%`,
                        }}
                      >
                        {chip(entry, day)}
                      </div>
                    ))}
                    {day === today &&
                      nowMinute >= startHour * 60 &&
                      nowMinute <= endHour * 60 && (
                        <span
                          className="sb-dbc-now"
                          style={{
                            top: `${((nowMinute - startHour * 60) * 100) / span}%`,
                          }}
                        >
                          <b>{t("calendar.now")}</b>
                        </span>
                      )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {agenda(days)}
      </>
    );
  };

  const heatmap = () => {
    const counted = entries.filter(inFocus);
    // Streaks are counted as of the shown date, so a log viewed at its saved
    // initial date keeps its streak after that day has passed.
    const asOf = Math.min(today, anchor);
    const summary = heatmapSummary(counted, {
      endDay: to,
      today: asOf,
      weeks: settings.weeks,
      weekStartsOn,
      countDone: Boolean(doneColumn),
    });
    const focusTone =
      focus && colorColumn ? String(categories.indexOf(focus) % 5) : null;
    const active = pickedDay ?? Math.min(to, Math.max(from, asOf));
    const moveFocus = (event: KeyboardEvent) => {
      const delta = {
        ArrowUp: -1,
        ArrowDown: 1,
        ArrowLeft: -7,
        ArrowRight: 7,
        Home: from - active,
        End: summary.to - active,
      }[event.key];
      if (delta === undefined) return;
      event.preventDefault();
      const next = Math.min(summary.to, Math.max(summary.from, active + delta));
      setPickedDay(next);
      heatRef.current
        ?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)
        ?.focus();
    };
    const rate = summary.elapsedDays
      ? Math.round((summary.activeDays * 100) / summary.elapsedDays)
      : 0;
    const dayList = byDay.get(active)!.filter(inFocus);
    const countLabel = (count: number) =>
      doneColumn
        ? t("calendar.doneCount", { count })
        : t("recordCount", { count });
    return (
      <div className="sb-dbc-heat" style={toneStyle(focusTone ?? "a")}>
        <dl className="sb-dbc-stats">
          <div>
            <dt>{t("calendar.currentStreak")}</dt>
            <dd>{t("calendar.days", { count: summary.current })}</dd>
          </div>
          <div>
            <dt>{t("calendar.longestStreak")}</dt>
            <dd>{t("calendar.days", { count: summary.longest })}</dd>
          </div>
          <div>
            <dt>{t("calendar.activeDays")}</dt>
            <dd>
              {summary.activeDays} / {summary.elapsedDays}
              <small>{rate}%</small>
            </dd>
          </div>
        </dl>
        <div className="sb-dbc-heat-scroll">
          <div
            ref={heatRef}
            className="sb-dbc-heat-grid"
            role="group"
            aria-label={t("calendar.heatmapLabel", { range: label })}
            style={{ "--dbc-weeks": settings.weeks } as CSSProperties}
            onKeyDown={moveFocus}
          >
            <span className="sb-dbc-heat-corner" />
            {range(0, settings.weeks - 1).map((column) => {
              const first = summary.from + column * 7;
              const monthBegins = range(first, first + 6).find(
                (day) => dateOf(day).getUTCDate() === 1,
              );
              return (
                <span
                  key={column}
                  className="sb-dbc-heat-month"
                  style={{ gridColumn: column + 2 }}
                  aria-hidden="true"
                >
                  {monthBegins !== undefined || column === 0
                    ? format.monthShort(monthBegins ?? first)
                    : ""}
                </span>
              );
            })}
            {weekdays.map((name, row) => (
              <span
                key={name}
                className="sb-dbc-heat-weekday"
                style={{ gridRow: row + 2 }}
                aria-hidden="true"
              >
                {row % 2 === 0 ? name : ""}
              </span>
            ))}
            {summary.cells.map((cell, index) => (
              <button
                type="button"
                key={cell.day}
                data-day={cell.day}
                tabIndex={cell.day === active ? 0 : -1}
                className={[
                  "sb-dbc-heat-cell",
                  `level-${cell.level}`,
                  cell.day > today && "is-future",
                  cell.day === today && "is-today",
                  cell.day === pickedDay && "is-picked",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  gridColumn: Math.floor(index / 7) + 2,
                  gridRow: (index % 7) + 2,
                }}
                aria-label={`${format.full(cell.day)}: ${countLabel(cell.count)}`}
                aria-pressed={cell.day === pickedDay}
                title={`${format.full(cell.day)} · ${countLabel(cell.count)}`}
                onClick={() =>
                  setPickedDay(cell.day === pickedDay ? null : cell.day)
                }
              />
            ))}
          </div>
        </div>
        <div className="sb-dbc-heat-legend" aria-hidden="true">
          <span>{t("calendar.less")}</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className={`sb-dbc-heat-cell level-${level}`} />
          ))}
          <span>{t("calendar.more")}</span>
        </div>
        <div className="sb-dbc-heat-day">
          <strong>{format.full(active)}</strong>
          {addButton(active)}
          <div className="sb-dbc-agenda-items">
            {dayList.length ? (
              dayList.map((entry) => chip(entry, active))
            ) : (
              <span className="sb-dbc-muted">
                {t("calendar.noRecordsOnDay")}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`sb-dbc sb-dbc-${mode}`}>
      <div className="sb-dbc-bar">
        <div
          className="sb-dbc-modes"
          role="group"
          aria-label={t("calendar.mode")}
        >
          {MODES.map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={mode === item}
              className={mode === item ? "is-active" : ""}
              onClick={() => setMode(item)}
            >
              {t(`calendar.mode.${item}`)}
            </button>
          ))}
        </div>
        <div className="sb-dbc-nav">
          <button
            type="button"
            className="sb-icon-button"
            aria-label={navLabels[0]}
            onClick={() => step(-1)}
          >
            <ChevronLeft size={14} />
          </button>
          <strong aria-live="polite">{label}</strong>
          <button
            type="button"
            className="sb-icon-button"
            aria-label={navLabels[1]}
            onClick={() => step(1)}
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            className="sb-dbc-today"
            onClick={() => {
              setAnchor(today);
              setPickedDay(null);
            }}
          >
            {t("calendar.today")}
          </button>
        </div>
      </div>
      {colorColumn && categories.length > 0 && (
        <div
          className="sb-dbc-legend"
          role="group"
          aria-label={t("calendar.colorLegend", { name: colorColumn.name })}
        >
          <button
            type="button"
            aria-pressed={!focus}
            className={!focus ? "is-active" : ""}
            onClick={() => setFocus(null)}
          >
            {t("allRecords")}
          </button>
          {categories.map((name, index) => {
            const inRange = [...visible].filter(
              (entry) => text(entry.row[colorColumn.id]) === name,
            );
            const minutes = inRange.reduce(
              (sum, entry) =>
                sum +
                (entry.startMinute !== null && entry.endMinute !== null
                  ? entry.endMinute - entry.startMinute
                  : 0),
              0,
            );
            return (
              <button
                type="button"
                key={name}
                aria-pressed={focus === name}
                className={focus === name ? "is-active" : ""}
                style={toneStyle(String(index % 5))}
                onClick={() => setFocus(focus === name ? null : name)}
              >
                <i aria-hidden="true" />
                {name}
                <b>
                  {mode === "week" && minutes
                    ? t("calendar.hours", {
                        hours: Math.round(minutes / 6) / 10,
                      })
                    : inRange.length}
                </b>
              </button>
            );
          })}
        </div>
      )}
      {mode === "month" ? month() : mode === "week" ? week() : heatmap()}
      {selected && (
        <div
          className="sb-dbc-detail"
          role="region"
          aria-label={text(selected.row[primary?.id]) || t("untitled")}
          style={toneStyle(toneOf(selected.row))}
        >
          <div className="sb-dbc-detail-head">
            <strong>{text(selected.row[primary?.id]) || t("untitled")}</strong>
            <span className="sb-dbc-muted">
              {format.full(selected.start)}
              {selected.end > selected.start &&
                ` – ${format.full(selected.end)}`}
              {timeText(selected) && ` · ${timeText(selected)}`}
            </span>
            {editable &&
              onRemove &&
              sources?.get(selected.row.id)?.removable !== false && (
                <button
                  type="button"
                  className="sb-icon-button sb-danger"
                  aria-label={t("deleteRecord")}
                  onClick={() => {
                    onRemove(selected.row.id);
                    setSelectedId(null);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            <button
              type="button"
              className="sb-icon-button"
              aria-label={t("calendar.closeDetail")}
              onClick={() => setSelectedId(null)}
            >
              <X size={13} />
            </button>
          </div>
          <dl className="sb-dbc-fields">
            {columns
              .filter((column) => editable || column.id !== primary?.id)
              .map((column) => (
                <div key={column.id}>
                  <dt>{column.name}</dt>
                  <dd>{renderCell(selected.row, column)}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}
      {undated > 0 && (
        <p className="sb-dbc-muted sb-dbc-undated">
          {t("calendar.undated", { count: undated, name: dateColumn.name })}
        </p>
      )}
    </div>
  );
}
