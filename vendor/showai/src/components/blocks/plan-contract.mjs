// Shared contract for the roadmap and waterfall built-ins.
// Validation runs in the workbench, the CLI and the portable reader, so it stays dependency-free.
// Errors name the exact field path, e.g. items[3].depends[0].

const fail = (message) => {
  throw new Error(message);
};
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function text(value, path, maxLength = 400) {
  if (typeof value !== "string" || !value.trim())
    fail(`${path} must be non-empty text.`);
  if (value.length > maxLength)
    fail(`${path} must be at most ${maxLength} characters.`);
}
function optionalText(value, path, maxLength) {
  if (value !== undefined) text(value, path, maxLength);
}
function finite(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(`${path} must be a finite number.`);
}
function list(value, path, maximum, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    fail(`${path} must be an array of ${minimum} to ${maximum} items.`);
  value.forEach((item, index) => {
    if (!isObject(item)) fail(`${path}[${index}] must be an object.`);
  });
  return value;
}
function ids(value, path) {
  const seen = new Set();
  value.forEach((item, index) => {
    text(item.id, `${path}[${index}].id`, 60);
    if (seen.has(item.id)) fail(`${path} contains duplicate id ${item.id}.`);
    seen.add(item.id);
  });
  return seen;
}
function color(value, path) {
  if (value !== undefined && !/^#[0-9a-fA-F]{6}$/.test(value))
    fail(`${path} must be a six-digit hex color.`);
}
function oneOf(value, options, path) {
  if (!options.includes(value))
    fail(`${path} must be one of ${options.join(", ")}.`);
}

// ---------------------------------------------------------------- dates

const DAY = 86400000;
/** Whole days since 1970-01-01 for a YYYY-MM-DD date; NaN when the text is not a real calendar date. */
export function dayNumber(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return Number.NaN;
  const [year, month, day] = match.slice(1).map(Number);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? time / DAY
    : Number.NaN;
}
/** YYYY-MM-DD for a day number. */
export function dayText(day) {
  return new Date(day * DAY).toISOString().slice(0, 10);
}
function date(value, path) {
  if (Number.isNaN(dayNumber(value)))
    fail(`${path} must be a calendar date written YYYY-MM-DD.`);
  return dayNumber(value);
}

// ---------------------------------------------------------------- roadmap

export const ROADMAP_TONES = ["done", "active", "todo", "blocked"];
/** Default statuses used by a roadmap that does not define its own. */
export const DEFAULT_ROADMAP_STATUSES = [
  { id: "done", label: "已完成", tone: "done" }, // i18n-exempt: default status data, translated at display by id
  { id: "active", label: "进行中", tone: "active" }, // i18n-exempt: default status data, translated at display by id
  { id: "todo", label: "未开始", tone: "todo" }, // i18n-exempt: default status data, translated at display by id
  { id: "blocked", label: "受阻", tone: "blocked" }, // i18n-exempt: default status data, translated at display by id
];
const MAX_ROADMAP_DAYS = 400;

/** Inclusive length of an item in days. */
export function itemDays(item) {
  return dayNumber(item.end) - dayNumber(item.start) + 1;
}

/** The visible date window: explicit start/end, or the span of every dated entry. */
export function roadmapWindow(data) {
  if (data.start && data.end)
    return { start: dayNumber(data.start), end: dayNumber(data.end) };
  const days = [
    ...data.items.flatMap((item) => [
      dayNumber(item.start),
      dayNumber(item.end),
    ]),
    ...(data.milestones ?? []).map((milestone) => dayNumber(milestone.date)),
    ...(data.deadline ? [dayNumber(data.deadline.date)] : []),
  ];
  return {
    start: data.start ? dayNumber(data.start) : Math.min(...days),
    end: data.end ? dayNumber(data.end) : Math.max(...days),
  };
}

/**
 * Days per owner: everything scheduled, and what is still open
 * (unfinished items, reduced by their progress).
 */
export function ownerWorkload(data) {
  const tones = new Map(
    (data.statuses ?? DEFAULT_ROADMAP_STATUSES).map((status) => [
      status.id,
      status.tone,
    ]),
  );
  const load = {};
  for (const item of data.items) {
    const key = item.owner ?? "";
    const entry = (load[key] ??= { scheduled: 0, open: 0, items: 0 });
    const days = itemDays(item);
    entry.scheduled += days;
    entry.items += 1;
    if (tones.get(item.status) !== "done")
      entry.open += days * (1 - (item.progress ?? 0));
  }
  return load;
}

/** Items the given item waits for, and items waiting for it. */
export function itemLinks(data, id) {
  const item = data.items.find((entry) => entry.id === id);
  return {
    depends: item?.depends ?? [],
    unblocks: data.items
      .filter((entry) => (entry.depends ?? []).includes(id))
      .map((entry) => entry.id),
  };
}

function validateRoadmap(data) {
  optionalText(data.description, "description", 400);
  for (const key of ["start", "end", "today"])
    if (data[key] !== undefined) date(data[key], key);
  if (data.start !== undefined && data.end !== undefined) {
    if (dayNumber(data.end) < dayNumber(data.start))
      fail("end must be on or after start.");
  }
  if (data.groupBy !== undefined)
    oneOf(data.groupBy, ["lane", "owner"], "groupBy");

  const owners = new Set();
  if (data.owners !== undefined) {
    list(data.owners, "owners", 8, 1);
    for (const id of ids(data.owners, "owners")) owners.add(id);
    data.owners.forEach((owner, index) => {
      text(owner.label, `owners[${index}].label`, 40);
      color(owner.color, `owners[${index}].color`);
    });
  }
  const lanes = ids(list(data.lanes, "lanes", 12, 1), "lanes");
  data.lanes.forEach((lane, index) => {
    text(lane.label, `lanes[${index}].label`, 40);
    optionalText(lane.summary, `lanes[${index}].summary`, 120);
  });
  if (data.statuses !== undefined) {
    list(data.statuses, "statuses", 6, 1);
    ids(data.statuses, "statuses");
    data.statuses.forEach((status, index) => {
      text(status.label, `statuses[${index}].label`, 30);
      oneOf(status.tone, ROADMAP_TONES, `statuses[${index}].tone`);
    });
  }
  const statuses = new Set(
    (data.statuses ?? DEFAULT_ROADMAP_STATUSES).map((status) => status.id),
  );

  const items = ids(list(data.items, "items", 80, 1), "items");
  data.items.forEach((item, index) => {
    const path = `items[${index}]`;
    text(item.title, `${path}.title`, 80);
    if (!lanes.has(item.lane))
      fail(`${path}.lane ${item.lane} does not match a lane id.`);
    if (item.owner !== undefined && !owners.has(item.owner))
      fail(`${path}.owner ${item.owner} does not match an owner id.`);
    if (!statuses.has(item.status))
      fail(`${path}.status ${item.status} is not a defined status.`);
    const start = date(item.start, `${path}.start`);
    const end = date(item.end, `${path}.end`);
    if (end < start) fail(`${path}.end must be on or after ${path}.start.`);
    if (item.progress !== undefined) {
      finite(item.progress, `${path}.progress`);
      if (item.progress < 0 || item.progress > 1)
        fail(`${path}.progress must be between 0 and 1.`);
    }
    optionalText(item.detail, `${path}.detail`, 600);
    optionalText(item.doneWhen, `${path}.doneWhen`, 240);
    optionalText(item.basis, `${path}.basis`, 300);
    if (item.tags !== undefined) {
      if (!Array.isArray(item.tags) || item.tags.length > 12)
        fail(`${path}.tags must be an array of at most 12 labels.`);
      item.tags.forEach((tag, tagIndex) =>
        text(tag, `${path}.tags[${tagIndex}]`, 30),
      );
    }
    if (item.depends !== undefined) {
      if (!Array.isArray(item.depends) || item.depends.length > 12)
        fail(`${path}.depends must be an array of at most 12 item ids.`);
      item.depends.forEach((target, dependIndex) => {
        const dependPath = `${path}.depends[${dependIndex}]`;
        if (!items.has(target))
          fail(`${dependPath} ${target} does not match an item id.`);
        if (target === item.id)
          fail(`${dependPath} points to the item itself.`);
      });
      if (new Set(item.depends).size !== item.depends.length)
        fail(`${path}.depends lists the same item twice.`);
    }
  });
  dependencyCycle(data.items);

  if (data.milestones !== undefined) {
    list(data.milestones, "milestones", 12);
    data.milestones.forEach((milestone, index) => {
      date(milestone.date, `milestones[${index}].date`);
      text(milestone.label, `milestones[${index}].label`, 30);
    });
  }
  if (data.deadline !== undefined) {
    if (!isObject(data.deadline)) fail("deadline must be an object.");
    date(data.deadline.date, "deadline.date");
    optionalText(data.deadline.label, "deadline.label", 40);
  }
  if (data.initialItem !== undefined && !items.has(data.initialItem))
    fail(`initialItem ${data.initialItem} does not match an item id.`);

  // Everything dated must fall inside the visible window.
  const range = roadmapWindow(data);
  if (range.end - range.start + 1 > MAX_ROADMAP_DAYS)
    fail(`The roadmap spans more than ${MAX_ROADMAP_DAYS} days.`);
  const inside = (value, path) => {
    const day = dayNumber(value);
    if (day < range.start || day > range.end)
      fail(
        `${path} ${value} is outside the roadmap from ${dayText(range.start)} to ${dayText(range.end)}.`,
      );
  };
  data.items.forEach((item, index) => {
    inside(item.start, `items[${index}].start`);
    inside(item.end, `items[${index}].end`);
  });
  (data.milestones ?? []).forEach((milestone, index) =>
    inside(milestone.date, `milestones[${index}].date`),
  );
  if (data.deadline) inside(data.deadline.date, "deadline.date");
}

function dependencyCycle(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting")
      fail(
        `items.depends form a cycle: ${[...trail.slice(trail.indexOf(id)), id].join(" → ")}.`,
      );
    state.set(id, "visiting");
    for (const next of byId.get(id).depends ?? []) visit(next, [...trail, id]);
    state.set(id, "done");
  };
  for (const item of items) visit(item.id, []);
}

// ---------------------------------------------------------------- waterfall

export const WATERFALL_KINDS = ["total", "up", "down"];

/**
 * Running levels of a bridge. Each step gets its [bottom, top] span; totals after the
 * first are checked against the computed running level.
 */
export function waterfallBridge(steps) {
  let level = 0;
  const mismatches = [];
  const spans = steps.map((step, index) => {
    if (step.kind === "total") {
      if (index > 0 && step.value !== level)
        mismatches.push({ id: step.id, stated: step.value, computed: level });
      level = step.value;
      return [Math.min(0, level), Math.max(0, level)];
    }
    const from = level;
    level += step.kind === "up" ? step.value : -step.value;
    return [Math.min(from, level), Math.max(from, level)];
  });
  return { spans, end: level, mismatches };
}

/** Mismatches larger than half of the smallest displayed unit. */
export function waterfallMismatches(data) {
  const format = data.format ?? {};
  const tolerance =
    (0.5 * (format.divisor ?? 1)) / 10 ** (format.decimals ?? 0);
  return waterfallBridge(data.steps).mismatches.filter(
    (entry) => Math.abs(entry.stated - entry.computed) > tolerance,
  );
}

function validateWaterfall(data) {
  optionalText(data.eyebrow, "eyebrow", 160);
  optionalText(data.narrative, "narrative", 400);
  optionalText(data.axisNote, "axisNote", 200);
  if (data.upIsGood !== undefined && typeof data.upIsGood !== "boolean")
    fail("upIsGood must be true or false.");
  if (data.headlines !== undefined) {
    list(data.headlines, "headlines", 5);
    data.headlines.forEach((headline, index) => {
      text(headline.label, `headlines[${index}].label`, 40);
      text(headline.value, `headlines[${index}].value`, 24);
      optionalText(headline.detail, `headlines[${index}].detail`, 80);
      if (headline.tone !== undefined)
        oneOf(
          headline.tone,
          ["up", "down", "neutral"],
          `headlines[${index}].tone`,
        );
    });
  }
  if (data.format !== undefined) {
    const format = data.format;
    if (!isObject(format)) fail("format must be an object.");
    // Affixes may be empty or only a space, e.g. suffix " 万".
    for (const [key, maxLength] of [
      ["prefix", 6],
      ["suffix", 10],
    ])
      if (
        format[key] !== undefined &&
        (typeof format[key] !== "string" || format[key].length > maxLength)
      )
        fail(`format.${key} must be text of at most ${maxLength} characters.`);
    if (format.divisor !== undefined) {
      finite(format.divisor, "format.divisor");
      if (format.divisor <= 0) fail("format.divisor must be greater than 0.");
    }
    if (
      format.decimals !== undefined &&
      (!Number.isInteger(format.decimals) ||
        format.decimals < 0 ||
        format.decimals > 4)
    )
      fail("format.decimals must be an integer from 0 to 4.");
  }
  const steps = ids(list(data.steps, "steps", 16, 2), "steps");
  data.steps.forEach((step, index) => {
    const path = `steps[${index}]`;
    text(step.label, `${path}.label`, 24);
    oneOf(step.kind, WATERFALL_KINDS, `${path}.kind`);
    finite(step.value, `${path}.value`);
    if (step.kind !== "total" && step.value < 0)
      fail(
        `${path}.value must be a positive magnitude; use kind down for decreases.`,
      );
    if (step.breakdown !== undefined) {
      const breakdown = step.breakdown;
      if (!isObject(breakdown)) fail(`${path}.breakdown must be an object.`);
      optionalText(breakdown.title, `${path}.breakdown.title`, 80);
      optionalText(breakdown.note, `${path}.breakdown.note`, 300);
      list(breakdown.items, `${path}.breakdown.items`, 12);
      breakdown.items.forEach((item, itemIndex) => {
        text(item.label, `${path}.breakdown.items[${itemIndex}].label`, 60);
        finite(item.value, `${path}.breakdown.items[${itemIndex}].value`);
      });
    }
  });
  if (data.initialStep !== undefined && !steps.has(data.initialStep))
    fail(`initialStep ${data.initialStep} does not match a step id.`);
  if (data.axisFloor !== undefined) {
    finite(data.axisFloor, "axisFloor");
    // A floor may cut the base of totals, never a change bar: that would misstate its size.
    const { spans } = waterfallBridge(data.steps);
    data.steps.forEach((step, index) => {
      const [bottom, top] = spans[index];
      if (
        step.kind === "total" ? top <= data.axisFloor : bottom < data.axisFloor
      )
        fail(
          `axisFloor ${data.axisFloor} cuts steps[${index}] (${step.label}); lower it below ${step.kind === "total" ? top : bottom}.`,
        );
    });
  }
}

export function validatePlanData(kind, data) {
  if (!isObject(data)) fail("Component data must be an object.");
  optionalText(data.title, "title", 120);
  if (kind === "roadmap") validateRoadmap(data);
  else if (kind === "waterfall") validateWaterfall(data);
  else fail(`Unknown plan component ${kind}.`);
  return data;
}
