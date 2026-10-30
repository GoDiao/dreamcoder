// Shared contract for the database built-in: validation plus the date math the
// calendar and heatmap views share. It runs in the workbench, the CLI and the
// portable reader, so it stays dependency-free.

const fail = (message) => {
  throw new Error(message);
};
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const reservedIds = new Set(["id", "__proto__", "prototype", "constructor"]);

export const DATABASE_COLUMN_TYPES = [
  "text",
  "number",
  "select",
  "checkbox",
  "url",
  "date",
];
export const DATABASE_VIEWS = ["table", "board", "calendar"];
export const CALENDAR_MODES = ["month", "week", "heatmap"];
export const MAX_HEATMAP_WEEKS = 53;
// A record spanning longer than this is drawn on its first day only.
export const MAX_SPAN_DAYS = 366;

const DAY_MS = 86400000;

/** ISO calendar day (YYYY-MM-DD) to a whole day number, or null when invalid. */
export function parseDay(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return Math.round(time / DAY_MS);
}

export function formatDay(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** The reader's local calendar day as a day number. */
export function localDay(date = new Date()) {
  return Math.round(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS,
  );
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day) {
  return new Date(day * DAY_MS).getUTCDay();
}

export function startOfWeek(day, weekStartsOn = 1) {
  return day - ((weekdayOf(day) - weekStartsOn + 7) % 7);
}

/** Loose date text (2026/10/14, 2026-10-14T09:00) to ISO, or "" when unreadable. */
export function normalizeDate(value) {
  if (typeof value !== "string") return "";
  const match = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value);
  if (!match) return "";
  const iso = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return parseDay(iso) === null ? "" : iso;
}

/** "H:MM" or "HH:MM" (up to 24:00) to minutes after midnight, or null. */
export function parseTime(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minutes <= 1440 ? minutes : null;
}

function validateCalendar(calendar, columns) {
  if (!isObject(calendar)) fail("calendar must be an object.");
  const column = (key, types) => {
    const id = calendar[key];
    if (id === undefined) return;
    if (typeof id !== "string")
      fail(`calendar.${key} must be a column id string.`);
    const target = columns.find((item) => item.id === id);
    if (!target) fail(`calendar.${key} refers to missing column ${id}.`);
    if (!types.includes(target.type))
      fail(`calendar.${key} must refer to a ${types.join(" or ")} column.`);
  };
  column("dateColumn", ["date"]);
  column("endDateColumn", ["date"]);
  column("startTimeColumn", ["text"]);
  column("endTimeColumn", ["text"]);
  column("colorColumn", ["select"]);
  column("doneColumn", ["checkbox"]);
  if (
    calendar.endDateColumn !== undefined &&
    calendar.endDateColumn === calendar.dateColumn
  )
    fail("calendar.endDateColumn must differ from calendar.dateColumn.");
  if (calendar.endTimeColumn !== undefined && !calendar.startTimeColumn)
    fail("calendar.endTimeColumn requires calendar.startTimeColumn.");
  if (calendar.mode !== undefined && !CALENDAR_MODES.includes(calendar.mode))
    fail(`calendar.mode must be one of ${CALENDAR_MODES.join(", ")}.`);
  if (
    calendar.initialDate !== undefined &&
    parseDay(calendar.initialDate) === null
  )
    fail("calendar.initialDate must be a YYYY-MM-DD date.");
  if (
    calendar.weekStartsOn !== undefined &&
    ![0, 1].includes(calendar.weekStartsOn)
  )
    fail("calendar.weekStartsOn must be 0 (Sunday) or 1 (Monday).");
  if (
    calendar.weeks !== undefined &&
    (!Number.isInteger(calendar.weeks) ||
      calendar.weeks < 1 ||
      calendar.weeks > MAX_HEATMAP_WEEKS)
  )
    fail(`calendar.weeks must be an integer from 1 to ${MAX_HEATMAP_WEEKS}.`);
  for (const key of Object.keys(calendar))
    if (
      ![
        "dateColumn",
        "endDateColumn",
        "startTimeColumn",
        "endTimeColumn",
        "colorColumn",
        "doneColumn",
        "mode",
        "initialDate",
        "weekStartsOn",
        "weeks",
      ].includes(key)
    )
      fail(`calendar.${key} is not a supported setting.`);
}

/** Validate database data; old data without date columns or calendar settings stays valid. */
export function validateDatabaseData(data) {
  if (!isObject(data)) fail("Component data must be an object.");
  for (const key of ["title", "description", "groupBy"])
    if (
      data[key] !== undefined &&
      (typeof data[key] !== "string" || data[key].length > 10000)
    )
      fail(`${key} must be text, at most 10000 characters.`);
  const list = (key, limit) => {
    if (data[key] === undefined) return [];
    if (!Array.isArray(data[key]) || data[key].length > limit)
      fail(`${key} must be an array of at most ${limit} items.`);
    const seen = new Set();
    for (const [index, item] of data[key].entries()) {
      if (!isObject(item)) fail(`${key}[${index}] must be an object.`);
      if (typeof item.id !== "string" || !item.id || item.id.length > 200)
        fail(`${key}[${index}].id must be non-empty text.`);
      if (seen.has(item.id)) fail(`${key} contains duplicate id ${item.id}.`);
      if (reservedIds.has(item.id) && (key === "columns" || item.id !== "id"))
        fail(`${key}[${index}].id cannot use the reserved name ${item.id}.`);
      seen.add(item.id);
    }
    return data[key];
  };
  const columns = list("columns", 50);
  for (const [index, column] of columns.entries()) {
    const path = `columns[${index}]`;
    if (typeof column.name !== "string" || column.name.length > 1000)
      fail(`${path}.name must be text, at most 1000 characters.`);
    if (!DATABASE_COLUMN_TYPES.includes(column.type))
      fail(`${path}.type must be one of ${DATABASE_COLUMN_TYPES.join(", ")}.`);
    if (
      column.options !== undefined &&
      (!Array.isArray(column.options) ||
        column.options.length > 200 ||
        !column.options.every((value) => typeof value === "string"))
    )
      fail(`${path}.options must be an array of at most 200 texts.`);
  }
  const dateColumns = columns.filter((column) => column.type === "date");
  for (const [index, row] of list("rows", 5000).entries()) {
    for (const [key, value] of Object.entries(row))
      if (!["string", "number", "boolean"].includes(typeof value))
        fail(`rows[${index}].${key} must be text, a number or a boolean.`);
    for (const column of dateColumns) {
      const value = row[column.id];
      if (value !== undefined && value !== "" && parseDay(value) === null)
        fail(`rows[${index}].${column.id} must be a YYYY-MM-DD date or empty.`);
    }
  }
  if (data.view !== undefined && !DATABASE_VIEWS.includes(data.view))
    fail(`view must be one of ${DATABASE_VIEWS.join(", ")}.`);
  if (data.calendar !== undefined) validateCalendar(data.calendar, columns);
  if (data.view === "calendar" && !dateColumns.length)
    fail("view calendar requires a date column.");
  return data;
}

/**
 * Turn rows into dated entries. Rows without a valid start date are skipped; an
 * end date before the start, or a span past MAX_SPAN_DAYS, collapses to one day.
 */
export function calendarEntries(rows, settings) {
  const entries = [];
  for (const row of rows) {
    const start = parseDay(row[settings.dateColumn]);
    if (start === null) continue;
    let end = settings.endDateColumn
      ? parseDay(row[settings.endDateColumn])
      : null;
    if (end === null || end < start || end - start >= MAX_SPAN_DAYS)
      end = start;
    const startMinute = settings.startTimeColumn
      ? parseTime(row[settings.startTimeColumn])
      : null;
    let endMinute =
      startMinute !== null && settings.endTimeColumn
        ? parseTime(row[settings.endTimeColumn])
        : null;
    if (endMinute !== null && endMinute <= startMinute) endMinute = null;
    entries.push({
      row,
      start,
      end,
      startMinute,
      endMinute,
      done: settings.doneColumn ? row[settings.doneColumn] === true : false,
    });
  }
  return entries.sort(
    (a, b) =>
      a.start - b.start ||
      (a.startMinute ?? -1) - (b.startMinute ?? -1) ||
      b.end - a.end,
  );
}

/** Entries overlapping each day of [from, to], keyed by day number. */
export function entriesByDay(entries, from, to) {
  const days = new Map();
  for (let day = from; day <= to; day += 1) days.set(day, []);
  for (const entry of entries)
    for (
      let day = Math.max(from, entry.start);
      day <= Math.min(to, entry.end);
      day += 1
    )
      days.get(day).push(entry);
  return days;
}

/** Assign side-by-side lanes to timed entries of one day so overlaps stay readable. */
export function timeLanes(entries) {
  const lanes = [];
  const placed = entries
    .filter((entry) => entry.startMinute !== null)
    .map((entry) => {
      const end = entry.endMinute ?? Math.min(1440, entry.startMinute + 60);
      let lane = lanes.findIndex((laneEnd) => laneEnd <= entry.startMinute);
      if (lane < 0) lane = lanes.push(end) - 1;
      else lanes[lane] = end;
      return { entry, lane, end };
    });
  return { placed, laneCount: Math.max(1, lanes.length) };
}

/**
 * Heatmap of N whole weeks ending with the week of `endDay`. With a done column
 * only checked records count. Streaks count consecutive active days ending at
 * `today` — the reference day, normally the reader's date — or the day before
 * while that day is still open, within the window.
 */
export function heatmapSummary(entries, options) {
  const weekStartsOn = options.weekStartsOn ?? 1;
  const weeks = options.weeks ?? 12;
  const from = startOfWeek(options.endDay, weekStartsOn) - (weeks - 1) * 7;
  const to = from + weeks * 7 - 1;
  const counted = options.countDone
    ? entries.filter((entry) => entry.done)
    : entries;
  const byDay = entriesByDay(counted, from, to);
  const cells = [];
  let max = 0;
  for (let day = from; day <= to; day += 1) {
    const count = byDay.get(day).length;
    max = Math.max(max, count);
    cells.push({ day, count });
  }
  for (const cell of cells)
    cell.level = cell.count
      ? Math.max(1, Math.ceil((cell.count / max) * 4))
      : 0;
  const last = Math.min(to, options.today);
  let longest = 0,
    run = 0,
    activeDays = 0;
  for (let day = from; day <= last; day += 1) {
    const active = byDay.get(day).length > 0;
    if (active) activeDays += 1;
    run = active ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  let day = last;
  if (day >= from && day === options.today && !byDay.get(day).length) day -= 1;
  for (; day >= from && byDay.get(day).length; day -= 1) current += 1;
  return {
    from,
    to,
    cells,
    max,
    current,
    longest,
    activeDays,
    elapsedDays: Math.max(0, last - from + 1),
  };
}
