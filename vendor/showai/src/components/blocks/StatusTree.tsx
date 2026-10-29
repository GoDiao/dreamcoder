import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { BlockProps } from "./types";
import { DEFAULT_TREE_STATUSES, statusCounts } from "./analysis-contract.mjs";
import "./analysis.css";
import { blockLabel } from "./shared";
import type { MessageKey } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/analysis";
import { NoteText } from "./NoteText";
import { useReaderState } from "../../surface/reader-state";

type Tone = "done" | "failed" | "active" | "todo" | "paused";
type Status = { id: string; label: string; tone: Tone; color?: string };
type Item = {
  id: string;
  label: string;
  status: string;
  source?: string;
  detail?: string;
  result?: string;
  links?: string[];
};
type Group = { id: string; label: string; summary?: string; items: Item[] };
type Tree = {
  title?: string;
  root?: string;
  description?: string;
  statuses?: Status[];
  groups: Group[];
};

const MARKS: Record<Tone, string> = {
  done: "✓",
  failed: "✕",
  active: "●",
  todo: "○",
  paused: "‖",
};
// Tone colors map onto the shared semantic tokens; a status may override its color.
const TONE_VARS: Record<Tone, [string, string]> = {
  done: ["var(--an-good)", "var(--an-good-soft)"],
  failed: ["var(--an-bad)", "var(--an-bad-soft)"],
  active: ["var(--an-info)", "var(--an-info-soft)"],
  todo: ["var(--an-idle)", "var(--an-idle-soft)"],
  paused: ["var(--an-warn)", "var(--an-warn-soft)"],
};
const toneStyle = (status: Status): CSSProperties =>
  ({
    "--tone": status.color ?? TONE_VARS[status.tone][0],
    "--tone-soft": status.color
      ? `color-mix(in srgb, ${status.color} 14%, transparent)`
      : TONE_VARS[status.tone][1],
  }) as CSSProperties;

// Statuses still carrying a contract default label are shown in the reader's language.
const DEFAULT_LABELS = new Map(
  (DEFAULT_TREE_STATUSES as Status[]).map((status) => [
    status.id,
    status.label,
  ]),
);
const DEFAULT_KEYS: Record<string, MessageKey<typeof messages>> = {
  done: "tree.status.done",
  active: "tree.status.active",
  failed: "tree.status.failed",
  todo: "tree.status.todo",
  paused: "tree.status.paused",
};
function localizeStatus(
  status: Status,
  t: (key: MessageKey<typeof messages>) => string,
): Status {
  const key = DEFAULT_KEYS[status.id];
  return key && DEFAULT_LABELS.get(status.id) === status.label
    ? { ...status, label: t(key) }
    : status;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
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

function StatusBar({
  items,
  statuses,
  height,
}: {
  items: Item[];
  statuses: Status[];
  height?: number;
}) {
  return (
    <div
      className="an-bar"
      style={height ? { height, borderRadius: height / 2 } : undefined}
    >
      {statuses.map((status) => {
        const count = items.filter((item) => item.status === status.id).length;
        return count ? (
          <div
            key={status.id}
            style={{
              ...toneStyle(status),
              width: `${(count / items.length) * 100}%`,
              background: "var(--tone)",
            }}
          />
        ) : null;
      })}
    </div>
  );
}

export function StatusTreeBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const model = data as unknown as Tree;
  const statuses = (model.statuses ?? (DEFAULT_TREE_STATUSES as Status[])).map(
    (status) => localizeStatus(status, t),
  );
  const statusOf = new Map(statuses.map((status) => [status.id, status]));
  const all = model.groups.flatMap((group) => group.items);
  const counts = statusCounts(model) as Record<string, number>;
  const [layoutRef, width] = useWidth();
  const [selected, setSelected] = useReaderState(
    "selected",
    () =>
      (
        all.find((item) => statusOf.get(item.status)?.tone === "active") ??
        all[0]
      )?.id ?? "",
    { accept: (value) => all.some((item) => item.id === value) },
  );
  const [focus, setFocus] = useReaderState<string | null>("focus", null, {
    accept: (value) => value === null || statusOf.has(value as string),
  });

  const narrow = width < 980;
  const treeWidth = narrow ? width : width - 316;
  const showRoot = Boolean(model.root) && treeWidth > 760;
  const rootW = showRoot ? 150 : 0;
  const groupW = 200;
  const gap = showRoot ? 46 : 36;
  const groupX = showRoot ? rootW + gap : 0;
  const itemX = groupX + groupW + gap;
  const itemW = Math.max(180, treeWidth - itemX);
  const rowH = 38;
  const groupGap = 16;

  // Each item takes one row; a group is centred on its rows.
  let y = 0;
  const rows: { item: Item; y: number; group: Group }[] = [];
  const groups: { group: Group; y: number; top: number; bottom: number }[] = [];
  for (const group of model.groups) {
    const top = y;
    for (const item of group.items) {
      rows.push({ item, y: y + rowH / 2, group });
      y += rowH;
    }
    groups.push({ group, y: (top + y) / 2, top, bottom: y });
    y += groupGap;
  }
  const height = Math.max(0, y - groupGap);
  const rootY = height / 2;
  const active = all.find((item) => item.id === selected);
  const activeGroup = model.groups.find((group) =>
    group.items.some((item) => item.id === selected),
  );
  const activeStatus = active ? statusOf.get(active.status) : undefined;
  const dim = (item: Item) => focus !== null && item.status !== focus;

  return (
    <section
      className="sb-block an-block"
      aria-label={blockLabel(model.title, t("tree.title"))}
    >
      <div className="an-head">
        {model.title && (
          <h3 className="an-title">
            <NoteText text={model.title} />
          </h3>
        )}
        {model.description && <p className="an-sub">{model.description}</p>}
        <div
          className="an-tools"
          role="group"
          aria-label={t("tree.highlightByStatus")}
        >
          {statuses.map((status) => (
            <button
              key={status.id}
              type="button"
              className="an-chip"
              style={{ ...toneStyle(status), color: "var(--tone)" }}
              aria-pressed={focus === status.id}
              onClick={() => setFocus(focus === status.id ? null : status.id)}
            >
              {`${MARKS[status.tone]} ${status.label} ${counts[status.id] ?? 0}`}
            </button>
          ))}
        </div>
      </div>
      <div className="an-tree-layout" ref={layoutRef}>
        <div className="an-tree" style={{ height, width: treeWidth }}>
          <svg width={treeWidth} height={height} aria-hidden="true">
            {showRoot &&
              groups.map(({ group, y: gy }) => {
                const mid = (rootW + groupX) / 2;
                return (
                  <path
                    key={group.id}
                    d={`M${rootW},${rootY} C${mid},${rootY} ${mid},${gy} ${groupX},${gy}`}
                    fill="none"
                    stroke="var(--an-line)"
                    strokeWidth={1.5}
                  />
                );
              })}
            {rows.map(({ item, y: iy, group }) => {
              const g = groups.find((entry) => entry.group.id === group.id)!;
              const status = statusOf.get(item.status)!;
              const x1 = groupX + groupW;
              const mid = (x1 + itemX) / 2;
              const quiet = status.tone === "todo" || status.tone === "paused";
              return (
                <path
                  key={item.id}
                  d={`M${x1},${g.y} C${mid},${g.y} ${mid},${iy} ${itemX},${iy}`}
                  fill="none"
                  style={toneStyle(status)}
                  stroke="var(--tone)"
                  strokeOpacity={dim(item) ? 0.12 : quiet ? 0.45 : 0.7}
                  strokeWidth={item.id === selected ? 2.5 : 1.6}
                  strokeDasharray={
                    status.tone === "failed" || status.tone === "todo"
                      ? "4 4"
                      : undefined
                  }
                />
              );
            })}
          </svg>
          {showRoot && (
            <div
              className="an-root"
              style={{ left: 0, top: rootY - 60, width: rootW, height: 120 }}
            >
              <small>{t("tree.question")}</small>
              {model.root}
            </div>
          )}
          {groups.map(({ group, y: gy, top, bottom }) => {
            const h = Math.max(56, Math.min(bottom - top - 6, 92));
            const done = group.items.filter(
              (item) => statusOf.get(item.status)?.tone === "done",
            ).length;
            return (
              <div
                key={group.id}
                className="an-group"
                style={{
                  left: groupX,
                  top: gy - h / 2,
                  width: groupW,
                  height: h,
                }}
              >
                <div className="an-group-top">
                  <b>{group.label}</b>
                  <span>
                    {done}/{group.items.length}
                  </span>
                </div>
                {group.summary && h > 70 && (
                  <div className="an-group-summary">{group.summary}</div>
                )}
                <StatusBar items={group.items} statuses={statuses} />
              </div>
            );
          })}
          {rows.map(({ item, y: iy }) => {
            const status = statusOf.get(item.status)!;
            return (
              <button
                key={item.id}
                type="button"
                className={`an-item an-st-${status.tone}${item.id === selected ? " is-selected" : ""}${dim(item) ? " is-dim" : ""}`}
                style={{
                  ...toneStyle(status),
                  left: itemX,
                  top: iy - 15,
                  width: itemW,
                  height: 30,
                }}
                aria-pressed={item.id === selected}
                onClick={() => setSelected(item.id)}
              >
                <span className="an-mark" aria-label={status.label}>
                  {MARKS[status.tone]}
                </span>
                <span className="an-item-label">{item.label}</span>
                {item.result && itemW > 420 && (
                  <span className="an-item-result">{item.result}</span>
                )}
                {item.source && (
                  <span className="an-item-source">{item.source}</span>
                )}
              </button>
            );
          })}
        </div>
        {active && activeStatus && (
          <aside className="an-detail" aria-live="polite">
            <div className="an-panel">
              {activeGroup && <div className="an-sub">{activeGroup.label}</div>}
              <h4>{active.label}</h4>
              <span className="an-pill" style={toneStyle(activeStatus)}>
                {MARKS[activeStatus.tone]} {activeStatus.label}
              </span>
              {active.source && (
                <span className="an-sub">
                  {" · "}
                  {t("tree.source", { source: active.source })}
                </span>
              )}
              {active.detail && (
                <div className="an-field">
                  <small>{t("tree.detail")}</small>
                  {active.detail}
                </div>
              )}
              {active.result && (
                <div className="an-result-box" style={toneStyle(activeStatus)}>
                  <small style={{ color: "var(--tone)", fontWeight: 600 }}>
                    {t("tree.result")}
                  </small>
                  <div>{active.result}</div>
                </div>
              )}
              {active.links && active.links.length > 0 && (
                <div className="an-field">
                  <small>{t("tree.links")}</small>
                  <div className="an-tags">
                    {active.links.map((link) => (
                      <span key={link} className="an-tag">
                        {link}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="an-panel">
              <p className="an-panel-title">{t("tree.overall")}</p>
              <StatusBar items={all} statuses={statuses} height={10} />
              <div className="an-legend">
                {statuses.map((status) => (
                  <span key={status.id} style={toneStyle(status)}>
                    <b>{MARKS[status.tone]}</b> {status.label}{" "}
                    {counts[status.id] ?? 0}
                  </span>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>
      <details className="an-static">
        <summary>{t("tree.readAll", { count: all.length })}</summary>
        {model.groups.map((group) => (
          <div key={group.id}>
            <h4>{group.label}</h4>
            <ul>
              {group.items.map((item) => (
                <li key={item.id}>
                  <b>{statusOf.get(item.status)?.label}</b> ·{" "}
                  {item.result
                    ? t("tree.itemResult", {
                        label: item.label,
                        result: item.result,
                      })
                    : item.label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
    </section>
  );
}
