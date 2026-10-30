// Shared contract for the event-timeline built-in.
// Validation runs in the workbench, the CLI and the portable reader, so it stays dependency-free.
// Every position (events[].at, phases[].from/to, initialAt) is a 0-based point index on the axis.

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
  value.forEach((item, index) => {
    if (!isObject(item)) fail(`${label}[${index}] must be an object.`);
  });
  return value;
}
function color(value, label) {
  if (value !== undefined && !/^#[0-9a-fA-F]{6}$/.test(value))
    fail(`${label} must be a six-digit hex color.`);
}
function flag(value, label) {
  if (value !== undefined && typeof value !== "boolean")
    fail(`${label} must be true or false.`);
}
function tone(value, label) {
  if (value !== undefined && !EVENT_TIMELINE_TONES.includes(value))
    fail(`${label} must be one of ${EVENT_TIMELINE_TONES.join(", ")}.`);
}

export const EVENT_TIMELINE_TONES = [
  "neutral",
  "info",
  "good",
  "warn",
  "bad",
  "accent",
];
export const EVENT_TIMELINE_AXIS_TYPES = ["number", "clock", "date"];
export const EVENT_TIMELINE_LIMITS = {
  points: 500,
  series: 3,
  phases: 12,
  kinds: 8,
  events: 80,
  summary: 6,
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

function parseDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  const time = Date.UTC(y, m - 1, d);
  const date = new Date(time);
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? time
    : NaN;
}

function index(value, label, count) {
  if (!Number.isInteger(value) || value < 0 || value >= count)
    fail(`${label} must be a point index from 0 to ${count - 1}.`);
}

function validateAxis(axis) {
  if (!isObject(axis)) fail("axis must be an object.");
  if (!EVENT_TIMELINE_AXIS_TYPES.includes(axis.type))
    fail(`axis.type must be one of ${EVENT_TIMELINE_AXIS_TYPES.join(", ")}.`);
  optionalText(axis.label, "axis.label");
  if (axis.step !== undefined) {
    finite(axis.step, "axis.step");
    if (axis.step <= 0) fail("axis.step must be greater than 0.");
    if (axis.type !== "number" && !Number.isInteger(axis.step))
      fail(
        `axis.step must be a whole number of ${axis.type === "clock" ? "minutes" : "days"}.`,
      );
  }
  if (axis.type === "number") {
    if (axis.start !== undefined) finite(axis.start, "axis.start");
    for (const key of ["prefix", "unit"])
      if (
        axis[key] !== undefined &&
        (typeof axis[key] !== "string" || !axis[key].trim())
      )
        fail(`axis.${key} must be non-empty text.`);
  } else if (axis.type === "clock") {
    if (typeof axis.start !== "string" || !CLOCK.test(axis.start))
      fail("axis.start must be a 24-hour time like 13:50 for a clock axis.");
  } else if (
    typeof axis.start !== "string" ||
    !DATE.test(axis.start) ||
    Number.isNaN(parseDate(axis.start))
  )
    fail("axis.start must be a date like 2026-10-18 for a date axis.");
  if (axis.count !== undefined) {
    const { points } = EVENT_TIMELINE_LIMITS;
    if (!Number.isInteger(axis.count) || axis.count < 2 || axis.count > points)
      fail(`axis.count must be a whole number from 2 to ${points}.`);
  }
}

/** Number of points on the axis: axis.count, or the length of the series. */
export function pointCount(data) {
  return data.axis.count ?? data.series?.[0]?.values.length ?? 0;
}

export function validateEventTimelineData(data) {
  if (!isObject(data)) fail("Component data must be an object.");
  optionalText(data.title, "title");
  optionalText(data.description, "description");
  optionalText(data.note, "note");
  validateAxis(data.axis);
  const limits = EVENT_TIMELINE_LIMITS;

  const series = list(data.series ?? [], "series", limits.series);
  const seriesIds = new Set();
  series.forEach((item, i) => {
    const label = `series[${i}]`;
    text(item.id, `${label}.id`);
    if (seriesIds.has(item.id))
      fail(`series contains duplicate id ${item.id}.`);
    seriesIds.add(item.id);
    text(item.label, `${label}.label`);
    optionalText(item.unit, `${label}.unit`);
    tone(item.tone, `${label}.tone`);
    color(item.color, `${label}.color`);
    flag(item.area, `${label}.area`);
    flag(item.dashed, `${label}.dashed`);
    if (item.axis !== undefined && !["left", "right"].includes(item.axis))
      fail(`${label}.axis must be left or right.`);
    if (item.min !== undefined) finite(item.min, `${label}.min`);
    if (item.max !== undefined) finite(item.max, `${label}.max`);
    if (
      item.min !== undefined &&
      item.max !== undefined &&
      item.min >= item.max
    )
      fail(`${label}.min must be below ${label}.max.`);
    if (!Array.isArray(item.values))
      fail(`${label}.values must be an array of numbers.`);
    item.values.forEach((value, j) => {
      if (value !== null) finite(value, `${label}.values[${j}]`);
    });
    if (!item.values.some((value) => value !== null))
      fail(`${label}.values needs at least one number.`);
  });
  if (data.axis.count === undefined && series.length === 0)
    fail("axis.count is required when there are no series.");
  const count = pointCount(data);
  if (count < 2 || count > limits.points)
    fail(`The axis must have 2 to ${limits.points} points.`);
  series.forEach((item, i) => {
    if (item.values.length !== count)
      fail(
        `series[${i}].values must have ${count} values, one per axis point.`,
      );
  });

  list(data.phases ?? [], "phases", limits.phases).forEach((phase, i) => {
    const label = `phases[${i}]`;
    text(phase.label, `${label}.label`);
    tone(phase.tone, `${label}.tone`);
    index(phase.from, `${label}.from`, count);
    index(phase.to, `${label}.to`, count);
    if (phase.to <= phase.from)
      fail(`${label}.to must be after ${label}.from.`);
    const previous = data.phases[i - 1];
    if (previous && phase.from < previous.to)
      fail(`${label} overlaps the previous phase; phases must be in order.`);
  });

  const kinds = list(data.kinds ?? [], "kinds", limits.kinds);
  const kindIds = new Set();
  kinds.forEach((kind, i) => {
    text(kind.id, `kinds[${i}].id`);
    if (kindIds.has(kind.id)) fail(`kinds contains duplicate id ${kind.id}.`);
    kindIds.add(kind.id);
    text(kind.label, `kinds[${i}].label`);
    tone(kind.tone, `kinds[${i}].tone`);
    color(kind.color, `kinds[${i}].color`);
  });

  const events = list(data.events, "events", limits.events);
  events.forEach((event, i) => {
    const label = `events[${i}]`;
    index(event.at, `${label}.at`, count);
    if (i > 0 && event.at < events[i - 1].at)
      fail(
        `${label}.at is before the previous event; list events in time order.`,
      );
    text(event.title, `${label}.title`);
    optionalText(event.detail, `${label}.detail`);
    if (event.kind !== undefined && !kindIds.has(event.kind))
      fail(`${label}.kind ${event.kind} is not a defined kind.`);
  });

  list(data.summary ?? [], "summary", limits.summary).forEach((stat, i) => {
    text(stat.label, `summary[${i}].label`);
    text(stat.value, `summary[${i}].value`);
    tone(stat.tone, `summary[${i}].tone`);
  });

  if (data.initialAt !== undefined) index(data.initialAt, "initialAt", count);
  return data;
}

/** Index of the latest event at or before the point, or -1 before the first event. */
export function eventAt(events, point) {
  let found = -1;
  events.forEach((event, i) => {
    if (event.at <= point) found = i;
  });
  return found;
}

/** The phase covering the point; a shared boundary belongs to the later phase. */
export function phaseAt(phases, point) {
  let found = -1;
  (phases ?? []).forEach((phase, i) => {
    if (phase.from <= point && point <= phase.to) found = i;
  });
  return found;
}

/** Point the reader starts on: initialAt, else the first event, else the last point. */
export function initialPoint(data) {
  return data.initialAt ?? data.events[0]?.at ?? pointCount(data) - 1;
}

/** Label for a point index, following the axis type. */
export function axisPointLabel(axis, point, locale = "en") {
  const step = axis.step ?? 1;
  if (axis.type === "clock") {
    const [h, m] = axis.start.split(":").map(Number);
    const total = (((h * 60 + m + point * step) % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  if (axis.type === "date")
    return new Intl.DateTimeFormat(locale, {
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(parseDate(axis.start) + point * step * DAY));
  const value = (axis.start ?? 0) + point * step;
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 3,
  }).format(value);
  return `${axis.prefix ?? ""}${number}${axis.unit ?? ""}`;
}
