// Shared contract for the comparison-matrix, status-tree and experiment-tracker built-ins.
// Validation runs in the workbench, the CLI and the portable reader, so it stays dependency-free.

const fail = (message) => {
  throw new Error(message);
};
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function text(value, label) {
  if (typeof value !== "string" || !value.trim())
    fail(`${label} must be non-empty text.`);
}
function optionalText(value, label) {
  if (value !== undefined) text(value, label);
}
function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(`${label} must be a finite number.`);
}
function list(value, label, maximum, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    fail(`${label} must be an array of ${minimum} to ${maximum} items.`);
  for (const item of value)
    if (!isObject(item)) fail(`${label} contains an invalid item.`);
  return value;
}
function ids(value, label) {
  const seen = new Set();
  for (const item of value) {
    text(item.id, `${label}.id`);
    if (seen.has(item.id)) fail(`${label} contains duplicate id ${item.id}.`);
    seen.add(item.id);
  }
  return seen;
}
function color(value, label) {
  if (value !== undefined && !/^#[0-9a-fA-F]{6}$/.test(value))
    fail(`${label} must be a six-digit hex color.`);
}
function url(value, label) {
  if (value !== undefined && !/^https?:\/\//i.test(value))
    fail(`${label} must be an http(s) URL.`);
}

export const MATRIX_TONES = ["yes", "no", "partial", "neutral", "na"];
export const TREE_TONES = ["done", "failed", "active", "todo", "paused"];
export const EXPERIMENT_STATUSES = [
  "kept",
  "discarded",
  "failed",
  "running",
  "stopped",
];

/** Default statuses used by a status tree that does not define its own. */
export const DEFAULT_TREE_STATUSES = [
  { id: "done", label: "走通", tone: "done" }, // i18n-exempt: default status data, translated at display by id
  { id: "active", label: "进行中", tone: "active" }, // i18n-exempt: default status data, translated at display by id
  { id: "failed", label: "没走通", tone: "failed" }, // i18n-exempt: default status data, translated at display by id
  { id: "todo", label: "待探索", tone: "todo" }, // i18n-exempt: default status data, translated at display by id
  { id: "paused", label: "搁置", tone: "paused" }, // i18n-exempt: default status data, translated at display by id
];

function validateMatrix(data) {
  optionalText(data.description, "description");
  const rows = ids(list(data.rows, "rows", 60, 1), "rows");
  for (const row of data.rows) {
    text(row.label, "row.label");
    optionalText(row.hint, "row.hint");
    optionalText(row.group, "row.group");
  }
  const columns = ids(list(data.columns, "columns", 12, 1), "columns");
  for (const column of data.columns) {
    text(column.label, "column.label");
    optionalText(column.note, "column.note");
    url(column.url, "column.url");
    if (column.highlight !== undefined && typeof column.highlight !== "boolean")
      fail("column.highlight must be true or false.");
  }
  if (data.columns.filter((column) => column.highlight).length > 1)
    fail("At most one column can be highlighted.");
  const cells = new Set();
  for (const cell of list(data.cells, "cells", 720)) {
    if (!rows.has(cell.row))
      fail(`cell.row ${cell.row} does not match a row id.`);
    if (!columns.has(cell.column))
      fail(`cell.column ${cell.column} does not match a column id.`);
    const key = `${cell.row}\u0000${cell.column}`;
    if (cells.has(key))
      fail(`Duplicate cell for row ${cell.row} and column ${cell.column}.`);
    cells.add(key);
    if (!MATRIX_TONES.includes(cell.tone))
      fail(`cell.tone must be one of ${MATRIX_TONES.join(", ")}.`);
    optionalText(cell.text, "cell.text");
    optionalText(cell.note, "cell.note");
  }
  if (data.legend !== undefined) {
    if (!isObject(data.legend)) fail("legend must be an object.");
    for (const [tone, label] of Object.entries(data.legend)) {
      if (!MATRIX_TONES.includes(tone))
        fail(`legend key ${tone} is not a tone.`);
      text(label, `legend.${tone}`);
    }
  }
}

function validateTree(data) {
  optionalText(data.root, "root");
  optionalText(data.description, "description");
  const statuses = data.statuses ?? DEFAULT_TREE_STATUSES;
  if (data.statuses !== undefined) {
    list(data.statuses, "statuses", 8, 1);
    ids(data.statuses, "statuses");
    for (const status of data.statuses) {
      text(status.label, "status.label");
      if (!TREE_TONES.includes(status.tone))
        fail(`status.tone must be one of ${TREE_TONES.join(", ")}.`);
      color(status.color, "status.color");
    }
  }
  const statusIds = new Set(statuses.map((status) => status.id));
  ids(list(data.groups, "groups", 16, 1), "groups");
  const itemIds = new Set();
  for (const group of data.groups) {
    text(group.label, "group.label");
    optionalText(group.summary, "group.summary");
    for (const item of list(group.items, "group.items", 30, 1)) {
      text(item.id, "item.id");
      if (itemIds.has(item.id)) fail(`items contain duplicate id ${item.id}.`);
      itemIds.add(item.id);
      text(item.label, "item.label");
      if (!statusIds.has(item.status))
        fail(`item.status ${item.status} is not a defined status.`);
      for (const key of ["source", "detail", "result"])
        optionalText(item[key], `item.${key}`);
      if (item.links !== undefined) {
        if (!Array.isArray(item.links) || item.links.length > 20)
          fail("item.links must be an array of at most 20 labels.");
        for (const link of item.links) text(link, "item.link");
      }
    }
  }
}

function validateTracker(data) {
  optionalText(data.subtitle, "subtitle");
  if (data.updatedAt !== undefined && Number.isNaN(Date.parse(data.updatedAt)))
    fail("updatedAt must be a date-time.");
  if (!isObject(data.metric)) fail("metric must be an object.");
  text(data.metric.label, "metric.label");
  optionalText(data.metric.unit, "metric.unit");
  if (!["higher", "lower"].includes(data.metric.direction))
    fail("metric.direction must be higher or lower.");
  if (data.metric.baseline !== undefined)
    finite(data.metric.baseline, "metric.baseline");
  const groups = data.groups ?? [];
  if (data.groups !== undefined) {
    list(data.groups, "groups", 6, 1);
    ids(data.groups, "groups");
    for (const group of data.groups) {
      text(group.label, "group.label");
      if (group.frontier !== undefined && typeof group.frontier !== "boolean")
        fail("group.frontier must be true or false.");
      if (
        group.shape !== undefined &&
        !["dot", "diamond"].includes(group.shape)
      )
        fail("group.shape must be dot or diamond.");
    }
  }
  const groupIds = new Set(groups.map((group) => group.id));
  const runs = list(data.runs ?? [], "runs", 20);
  ids(runs, "runs");
  ids(list(data.experiments, "experiments", 2000, 1), "experiments");
  for (const experiment of data.experiments) {
    text(experiment.name, "experiment.name");
    if (experiment.group !== undefined && !groupIds.has(experiment.group))
      fail(`experiment.group ${experiment.group} is not a defined group.`);
    optionalText(experiment.category, "experiment.category");
    if (!EXPERIMENT_STATUSES.includes(experiment.status))
      fail(
        `experiment.status must be one of ${EXPERIMENT_STATUSES.join(", ")}.`,
      );
    if (Number.isNaN(Date.parse(experiment.start)))
      fail(`experiment ${experiment.id} needs a valid start date-time.`);
    if (experiment.minutes !== undefined)
      finite(experiment.minutes, "experiment.minutes");
    if (experiment.resources !== undefined)
      finite(experiment.resources, "experiment.resources");
    if (experiment.score !== null) finite(experiment.score, "experiment.score");
    optionalText(experiment.note, "experiment.note");
  }
  for (const run of runs) {
    text(run.name, "run.name");
    color(run.color, "run.color");
    if (!Array.isArray(run.steps) || run.steps.length > 2000)
      fail("run.steps must be an array of at most 2000 numbers.");
    for (const step of run.steps) finite(step, "run.step");
    if (!isObject(run.series)) fail("run.series must be an object.");
    for (const [key, values] of Object.entries(run.series)) {
      if (!Array.isArray(values) || values.length !== run.steps.length)
        fail(`run ${run.id} series ${key} must match its steps.`);
      for (const value of values) finite(value, `run.series.${key}`);
    }
  }
  for (const chart of list(data.charts ?? [], "charts", 4)) {
    text(chart.key, "chart.key");
    text(chart.label, "chart.label");
    optionalText(chart.unit, "chart.unit");
  }
  if (data.resource !== undefined) {
    if (!isObject(data.resource)) fail("resource must be an object.");
    text(data.resource.unit, "resource.unit");
    if (data.resource.costPerHour !== undefined)
      finite(data.resource.costPerHour, "resource.costPerHour");
    optionalText(data.resource.currency, "resource.currency");
    if (data.resource.budget !== undefined)
      finite(data.resource.budget, "resource.budget");
  }
}

export function validateAnalysisData(kind, data) {
  if (!isObject(data)) fail("Component data must be an object.");
  optionalText(data.title, "title");
  if (kind === "comparison-matrix") validateMatrix(data);
  else if (kind === "status-tree") validateTree(data);
  else if (kind === "experiment-tracker") validateTracker(data);
  else fail(`Unknown analysis component ${kind}.`);
  return data;
}

/** Rows whose non-empty cells disagree across columns (by tone or text). */
export function differingRows(data) {
  return data.rows
    .filter((row) => {
      const values = data.columns.map((column) => {
        const cell = data.cells.find(
          (c) => c.row === row.id && c.column === column.id,
        );
        return cell ? `${cell.tone}\u0000${cell.text ?? ""}` : "na";
      });
      return new Set(values).size > 1;
    })
    .map((row) => row.id);
}

/** Count items per status id across all groups. */
export function statusCounts(data) {
  const counts = {};
  for (const group of data.groups)
    for (const item of group.items)
      counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

/**
 * Running best over time for experiments with a score.
 * Only groups marked frontier (or every experiment when no groups exist) take part,
 * so runs with different budgets are not mixed on one frontier.
 */
export function experimentFrontier(data) {
  const higher = data.metric.direction === "higher";
  const eligible = new Set(
    (data.groups ?? [])
      .filter((group) => group.frontier !== false)
      .map((group) => group.id),
  );
  const usesGroups = (data.groups ?? []).length > 0;
  const points = data.experiments
    .filter(
      (e) =>
        e.score !== null &&
        e.status !== "failed" &&
        (!usesGroups || eligible.has(e.group)),
    )
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const frontier = [];
  for (const point of points) {
    const last = frontier[frontier.length - 1];
    if (!last || (higher ? point.score > last.score : point.score < last.score))
      frontier.push(point);
  }
  return frontier.map((point) => point.id);
}
