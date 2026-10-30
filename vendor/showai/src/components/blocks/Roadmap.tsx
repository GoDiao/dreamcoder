import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BlockProps } from "./types";
import {
  DEFAULT_ROADMAP_STATUSES,
  dayNumber,
  itemDays,
  ownerWorkload,
  roadmapWindow,
} from "./plan-contract.mjs";
import "./roadmap.css";
import { blockLabel } from "./shared";
import type { MessageKey } from "../../i18n";
import { useLocale, useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/roadmap";
import { useReaderState } from "../../surface/reader-state";

type Tone = "done" | "active" | "todo" | "blocked";
type Status = { id: string; label: string; tone: Tone };
type Owner = { id: string; label: string; color?: string };
type Lane = { id: string; label: string; summary?: string };
type Item = {
  id: string;
  lane: string;
  owner?: string;
  title: string;
  start: string;
  end: string;
  status: string;
  progress?: number;
  detail?: string;
  doneWhen?: string;
  basis?: string;
  depends?: string[];
  tags?: string[];
};
type Milestone = { date: string; label: string };
type Roadmap = {
  title?: string;
  description?: string;
  start?: string;
  end?: string;
  today?: string;
  deadline?: { date: string; label?: string };
  groupBy?: "lane" | "owner";
  owners?: Owner[];
  lanes: Lane[];
  statuses?: Status[];
  items: Item[];
  milestones?: Milestone[];
  initialItem?: string;
};

const DAY = 86400000;
// Owners without a color take these in order; all read on light and dark paper.
const PALETTE = [
  "#3b74b8",
  "#2f8f6b",
  "#b7792f",
  "#7c5cc4",
  "#c0504a",
  "#2a9aa6",
  "#8a6d3b",
  "#5b6f8a",
];
const GUTTER = 132;
const MIN_TRACK = 520;

// Statuses still carrying a contract default label are shown in the reader's language.
const DEFAULT_LABELS = new Map(
  (DEFAULT_ROADMAP_STATUSES as Status[]).map((status) => [
    status.id,
    status.label,
  ]),
);
const DEFAULT_KEYS: Record<string, MessageKey<typeof messages>> = {
  done: "status.done",
  active: "status.active",
  todo: "status.todo",
  blocked: "status.blocked",
};

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

/** Rough label width so short bars put their title beside the bar instead of clipping it. */
const textWidth = (value: string) =>
  [...value].reduce(
    (sum, char) => sum + (/[\u2e80-\uffff]/.test(char) ? 12 : 6.8),
    0,
  ) + 16;

/** Tick days: every day for short plans, Mondays for a few months, month starts beyond. */
function axisTicks(start: number, end: number) {
  const total = end - start + 1;
  const ticks: number[] = [];
  if (total <= 21) {
    for (let day = start; day <= end; day += 1) ticks.push(day);
    return { ticks, unit: "day" as const };
  }
  if (total <= 120) {
    // Day 4 since the epoch (1970-01-05) is a Monday.
    for (let day = start + ((((4 - start) % 7) + 7) % 7); day <= end; day += 7)
      ticks.push(day);
    return { ticks, unit: "week" as const };
  }
  const first = new Date(start * DAY);
  for (
    let month = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1),
    );
    month.getTime() / DAY <= end;
    month = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1),
    )
  )
    ticks.push(month.getTime() / DAY);
  return { ticks, unit: "month" as const };
}

const round = (value: number) => Math.round(value * 10) / 10;

export function RoadmapBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const locale = useLocale();
  const model = data as unknown as Roadmap;
  const statuses = (
    model.statuses ?? (DEFAULT_ROADMAP_STATUSES as Status[])
  ).map((status) => {
    const key = DEFAULT_KEYS[status.id];
    return key && DEFAULT_LABELS.get(status.id) === status.label
      ? { ...status, label: t(key) }
      : status;
  });
  const statusOf = new Map(statuses.map((status) => [status.id, status]));
  const owners = (model.owners ?? []).map((owner, index) => ({
    ...owner,
    color: owner.color ?? PALETTE[index % PALETTE.length],
  }));
  const ownerOf = new Map(owners.map((owner) => [owner.id, owner]));
  const laneOf = new Map(model.lanes.map((lane) => [lane.id, lane]));
  const itemOf = new Map(model.items.map((item) => [item.id, item]));
  const workload = ownerWorkload(model);
  const hasUnassigned = model.items.some((item) => !item.owner);

  const [layoutRef, width] = useWidth();
  const [groupBy, setGroupBy] = useReaderState<"lane" | "owner">(
    "groupBy",
    owners.length ? (model.groupBy ?? "lane") : "lane",
    {
      accept: (value) =>
        value === "lane" || (value === "owner" && owners.length > 0),
    },
  );
  const [ownerFocus, setOwnerFocus] = useReaderState<string | null>(
    "ownerFocus",
    null,
    { accept: (value) => value === null || ownerOf.has(value as string) },
  );
  const [selectedId, setSelected] = useReaderState<string | null>(
    "selected",
    () =>
      model.initialItem ??
      model.items.find((item) => statusOf.get(item.status)?.tone === "active")
        ?.id ??
      null,
    { accept: (value) => value === null || itemOf.has(value as string) },
  );
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // Printing shows every task, not only the one selected on screen.
  useEffect(() => {
    const open = () => {
      if (detailsRef.current) detailsRef.current.open = true;
    };
    window.addEventListener("beforeprint", open);
    return () => window.removeEventListener("beforeprint", open);
  }, []);

  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
    [locale],
  );
  const weekdayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }),
    [locale],
  );
  const monthFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
    [locale],
  );
  const formatDay = (day: number) => dateFormat.format(new Date(day * DAY));
  const range = (item: Item) =>
    t("range", {
      start: formatDay(dayNumber(item.start)),
      end: formatDay(dayNumber(item.end)),
    });

  const { start: d0, end: d1 } = roadmapWindow(model);
  const total = d1 - d0 + 1;
  const pct = (day: number) => ((day - d0) / total) * 100;
  const narrow = width < 640;
  const gutter = narrow ? 0 : GUTTER;
  const trackPx = Math.max(width, MIN_TRACK) - gutter;
  const { ticks, unit } = axisTicks(d0, d1);
  // Thin out labels so neighbouring ticks never collide.
  const tickPx =
    ticks.length > 1 ? ((ticks[1] - ticks[0]) / total) * trackPx : trackPx;
  const labelEvery = Math.max(
    1,
    Math.ceil((unit === "day" ? 40 : 52) / tickPx),
  );
  const at = (percent: number) =>
    `calc(var(--rm-gutter) + (100% - var(--rm-gutter)) * ${percent / 100})`;
  const today = model.today ? dayNumber(model.today) : Number.NaN;
  const showToday = today >= d0 && today <= d1;
  const deadline = model.deadline ? dayNumber(model.deadline.date) : Number.NaN;

  const selected = selectedId ? itemOf.get(selectedId) : undefined;
  const dependents = selected
    ? model.items.filter((item) => (item.depends ?? []).includes(selected.id))
    : [];
  const related = new Set([
    ...(selected?.depends ?? []),
    ...dependents.map((item) => item.id),
  ]);

  const groups =
    groupBy === "owner"
      ? [
          ...owners.map((owner) => ({
            id: owner.id,
            label: owner.label,
            color: owner.color as string | undefined,
            items: model.items.filter((item) => item.owner === owner.id),
          })),
          ...(hasUnassigned
            ? [
                {
                  id: "",
                  label: t("unassigned"),
                  color: undefined,
                  items: model.items.filter((item) => !item.owner),
                },
              ]
            : []),
        ]
      : model.lanes.map((lane) => ({
          id: lane.id,
          label: lane.label,
          color: undefined as string | undefined,
          items: model.items.filter((item) => item.lane === lane.id),
        }));
  const counts = new Map<string, number>();
  for (const item of model.items)
    counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  const scheduledTotal =
    owners.reduce(
      (sum, owner) => sum + (workload[owner.id]?.scheduled ?? 0),
      0,
    ) || 1;

  const toggle = (id: string) => setSelected(selectedId === id ? null : id);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && selectedId) {
      event.stopPropagation();
      setSelected(null);
    }
  };
  const ownerColor = (item: Item) =>
    (item.owner && ownerOf.get(item.owner)?.color) || "var(--rm-idle)";

  return (
    <section
      className="sb-block rm-block"
      aria-label={blockLabel(model.title, t("title"))}
      onKeyDown={onKeyDown}
    >
      <div className="rm-head">
        <div className="rm-intro">
          {model.title && <h3 className="rm-title">{model.title}</h3>}
          {model.description && <p className="rm-sub">{model.description}</p>}
        </div>
        {owners.length > 0 && (
          <div className="rm-load" role="group" aria-label={t("workload")}>
            <span className="rm-label">{t("workload")}</span>
            <div className="rm-load-bar" aria-hidden="true">
              {owners.map((owner) => (
                <span
                  key={owner.id}
                  style={{
                    width: `${((workload[owner.id]?.scheduled ?? 0) / scheduledTotal) * 100}%`,
                    background: owner.color,
                  }}
                />
              ))}
            </div>
            <ul className="rm-load-list">
              {owners.map((owner) => (
                <li
                  key={owner.id}
                  aria-label={t("workloadEntry", {
                    owner: owner.label,
                    scheduled: round(workload[owner.id]?.scheduled ?? 0),
                    open: round(workload[owner.id]?.open ?? 0),
                  })}
                >
                  <i style={{ background: owner.color }} />
                  <b>{owner.label}</b>
                  <span>
                    {t("scheduledDays", {
                      count: round(workload[owner.id]?.scheduled ?? 0),
                    })}
                    {" · "}
                    {t("openDays", {
                      count: round(workload[owner.id]?.open ?? 0),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="rm-tools">
        {owners.length > 0 && (
          <div className="rm-seg" role="group" aria-label={t("groupBy")}>
            <span>{t("groupBy")}</span>
            {(["lane", "owner"] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={groupBy === key}
                onClick={() => setGroupBy(key)}
              >
                {t(key === "lane" ? "byLane" : "byOwner")}
              </button>
            ))}
          </div>
        )}
        {owners.length > 1 && (
          <div className="rm-chips" role="group" aria-label={t("ownerFilter")}>
            <button
              type="button"
              aria-pressed={ownerFocus === null}
              onClick={() => setOwnerFocus(null)}
            >
              {t("everyone")}
            </button>
            {owners.map((owner) => (
              <button
                key={owner.id}
                type="button"
                aria-pressed={ownerFocus === owner.id}
                style={{ "--rm-c": owner.color } as CSSProperties}
                onClick={() =>
                  setOwnerFocus(ownerFocus === owner.id ? null : owner.id)
                }
              >
                <i />
                {owner.label}
              </button>
            ))}
          </div>
        )}
        <ul className="rm-legend" aria-label={t("statusLegend")}>
          {statuses.map((status) => (
            <li key={status.id}>
              <i className={`rm-swatch rm-tone-${status.tone}`} />
              {status.label} <b>{counts.get(status.id) ?? 0}</b>
            </li>
          ))}
        </ul>
      </div>

      <div className={`rm-scroll${narrow ? " is-narrow" : ""}`} ref={layoutRef}>
        <div
          className="rm-chart"
          role="group"
          aria-label={t("chart")}
          style={
            {
              "--rm-gutter": `${gutter}px`,
              minWidth: narrow ? MIN_TRACK : undefined,
            } as CSSProperties
          }
        >
          <div className="rm-axis">
            {ticks.map((day, index) => (
              <span
                key={day}
                className="rm-tick"
                style={{ left: at(pct(day)) }}
              >
                {index % labelEvery === 0 &&
                  (unit === "month"
                    ? monthFormat.format(new Date(day * DAY))
                    : formatDay(day))}
                {unit === "day" && index % labelEvery === 0 && (
                  <small>{weekdayFormat.format(new Date(day * DAY))}</small>
                )}
              </span>
            ))}
            {(model.milestones ?? []).map((milestone) => (
              <span
                key={`${milestone.date}-${milestone.label}`}
                className="rm-milestone"
                style={{ left: at(pct(dayNumber(milestone.date) + 0.5)) }}
              >
                <i aria-hidden="true" />
                <em>{milestone.label}</em>
              </span>
            ))}
          </div>
          <div className="rm-rows">
            <div className="rm-overlay" aria-hidden="true">
              {ticks.map((day) => (
                <i
                  key={day}
                  className="rm-grid"
                  style={{ left: at(pct(day)) }}
                />
              ))}
              {showToday && (
                <>
                  <span
                    className="rm-past"
                    style={{
                      left: "var(--rm-gutter)",
                      width: `calc((100% - var(--rm-gutter)) * ${pct(today) / 100})`,
                    }}
                  />
                  <span
                    className="rm-today"
                    style={{ left: at(pct(today + 0.5)) }}
                  >
                    <em>{t("today")}</em>
                  </span>
                </>
              )}
              {(model.milestones ?? []).map((milestone) => (
                <i
                  key={`${milestone.date}-${milestone.label}`}
                  className="rm-milestone-line"
                  style={{ left: at(pct(dayNumber(milestone.date) + 0.5)) }}
                />
              ))}
              {model.deadline && (
                <span
                  className="rm-deadline"
                  style={{ left: at(pct(deadline + 1)) }}
                >
                  <em>{model.deadline.label ?? t("deadline")}</em>
                </span>
              )}
            </div>
            {groups.map((group) =>
              group.items.length ? (
                <Fragment key={group.id}>
                  <div className="rm-group">
                    {group.color && <i style={{ background: group.color }} />}
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    const status = statusOf.get(item.status)!;
                    const owner = item.owner
                      ? ownerOf.get(item.owner)
                      : undefined;
                    const left = pct(dayNumber(item.start));
                    const span = (itemDays(item) / total) * 100;
                    const dim =
                      ownerFocus !== null && item.owner !== ownerFocus;
                    const inside =
                      (span / 100) * trackPx >= textWidth(item.title);
                    const flip = !inside && left + span > 72;
                    const isSelected = item.id === selectedId;
                    const state = `${isSelected ? " is-selected" : ""}${related.has(item.id) ? " is-related" : ""}${dim ? " is-dim" : ""}`;
                    return (
                      <div
                        key={item.id}
                        className="rm-row"
                        style={{ "--rm-c": ownerColor(item) } as CSSProperties}
                      >
                        <div className={`rm-gutter${dim ? " is-dim" : ""}`}>
                          {groupBy === "lane" ? (
                            owner && (
                              <span className="rm-owner-tag">
                                {owner.label}
                              </span>
                            )
                          ) : (
                            <span className="rm-lane-tag">
                              {laneOf.get(item.lane)?.label}
                            </span>
                          )}
                        </div>
                        <div className="rm-track">
                          <button
                            type="button"
                            className={`rm-bar rm-tone-${status.tone}${state}`}
                            style={{ left: `${left}%`, width: `${span}%` }}
                            aria-pressed={isSelected}
                            aria-label={t("bar", {
                              title: item.title,
                              owner: owner?.label ?? t("unassigned"),
                              status: status.label,
                              range: range(item),
                            })}
                            onClick={() => toggle(item.id)}
                          >
                            {status.tone === "active" &&
                              item.progress !== undefined && (
                                <span
                                  className="rm-progress"
                                  style={{ width: `${item.progress * 100}%` }}
                                />
                              )}
                            {inside && (
                              <span className="rm-bar-text">{item.title}</span>
                            )}
                          </button>
                          {!inside && (
                            <span
                              className={`rm-outside${state}`}
                              aria-hidden="true"
                              style={
                                flip
                                  ? { right: `calc(${100 - left}% + 6px)` }
                                  : { left: `calc(${left + span}% + 6px)` }
                              }
                              onClick={() => toggle(item.id)}
                            >
                              {item.title}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </Fragment>
              ) : null,
            )}
          </div>
        </div>
      </div>

      <div className="rm-detail" aria-live="polite">
        {selected ? (
          <SelectedItem
            item={selected}
            status={statusOf.get(selected.status)!}
            owner={selected.owner ? ownerOf.get(selected.owner) : undefined}
            lane={laneOf.get(selected.lane)}
            range={range(selected)}
            depends={(selected.depends ?? []).map((id) => itemOf.get(id)!)}
            dependents={dependents}
            onSelect={setSelected}
            onClear={() => setSelected(null)}
          />
        ) : (
          <p className="rm-hint">{t("hint")}</p>
        )}
      </div>

      <details className="rm-static" ref={detailsRef}>
        <summary>{t("readAll", { count: model.items.length })}</summary>
        {model.lanes.map((lane) => {
          const items = model.items.filter((item) => item.lane === lane.id);
          return items.length ? (
            <div key={lane.id}>
              <h4>{lane.label}</h4>
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <b>{item.title}</b>
                    {item.owner && ` · ${ownerOf.get(item.owner)?.label}`}
                    {" · "}
                    {t("staticItem", {
                      range: range(item),
                      status: statusOf.get(item.status)!.label,
                    })}
                    {item.detail && <div>{item.detail}</div>}
                    {item.doneWhen && (
                      <div>{t("staticDoneWhen", { text: item.doneWhen })}</div>
                    )}
                    {item.depends && item.depends.length > 0 && (
                      <div>
                        {t("staticDepends", {
                          items: item.depends
                            .map((id) => itemOf.get(id)?.title)
                            .join(t("listSeparator")),
                        })}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null;
        })}
      </details>
    </section>
  );
}

function SelectedItem({
  item,
  status,
  owner,
  lane,
  range,
  depends,
  dependents,
  onSelect,
  onClear,
}: {
  item: Item;
  status: Status;
  owner?: Owner;
  lane?: Lane;
  range: string;
  depends: Item[];
  dependents: Item[];
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  const t = useTranslator(messages);
  return (
    <>
      <div className="rm-detail-main">
        <div className="rm-meta">
          {owner && (
            <span className="rm-pill" style={{ background: owner.color }}>
              {owner.label}
            </span>
          )}
          <span className="rm-status">
            <i className={`rm-swatch rm-tone-${status.tone}`} />
            {status.label}
            {status.tone === "active" && item.progress !== undefined && (
              <>
                {" "}
                · {t("progress", { percent: Math.round(item.progress * 100) })}
              </>
            )}
          </span>
          <span>
            {range} · {t("days", { count: itemDays(item) })}
          </span>
          {lane && <span>{lane.label}</span>}
          <button
            type="button"
            className="rm-close"
            aria-label={t("clearSelection")}
            onClick={onClear}
          >
            ×
          </button>
        </div>
        <h4>{item.title}</h4>
        {item.detail && <p>{item.detail}</p>}
        {item.basis && (
          <p className="rm-basis">
            <b>{t("basis")}</b> {item.basis}
          </p>
        )}
      </div>
      <div className="rm-detail-side">
        {item.doneWhen && (
          <div>
            <small>{t("doneWhen")}</small>
            <p>{item.doneWhen}</p>
          </div>
        )}
        {depends.length > 0 && (
          <div>
            <small>{t("depends")}</small>
            <div className="rm-links">
              {depends.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSelect(entry.id)}
                >
                  {entry.title}
                </button>
              ))}
            </div>
          </div>
        )}
        {dependents.length > 0 && (
          <div>
            <small>{t("unblocks")}</small>
            <div className="rm-links">
              {dependents.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSelect(entry.id)}
                >
                  {entry.title}
                </button>
              ))}
            </div>
          </div>
        )}
        {item.tags && item.tags.length > 0 && (
          <div>
            <small>{t("tags")}</small>
            <div className="rm-tags">
              {item.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
