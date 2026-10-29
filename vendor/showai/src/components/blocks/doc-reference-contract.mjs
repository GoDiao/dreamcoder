// Shared contract for the step-guide and command-reference built-ins.
// Validation runs in the workbench, the CLI and the portable reader, so it stays dependency-free.
import { plainInline } from "./inline-markup.mjs";

export { plainInline };

const fail = (message) => {
  throw new Error(message);
};
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function text(value, label, maximum) {
  if (typeof value !== "string" || !value.trim())
    fail(`${label} must be non-empty text.`);
  if (value.length > maximum)
    fail(`${label} must be at most ${maximum} characters.`);
}
function optionalText(value, label, maximum) {
  if (value !== undefined) text(value, label, maximum);
}
function code(value, label) {
  if (typeof value !== "string" || !value.trim())
    fail(`${label} must be non-empty code.`);
  if (value.length > 8000) fail(`${label} must be at most 8000 characters.`);
}
function number(value, label, minimum, maximum, exclusiveMinimum = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (exclusiveMinimum ? value <= minimum : value < minimum) ||
    value > maximum
  )
    fail(
      `${label} must be a number ${exclusiveMinimum ? "above" : "of at least"} ${minimum} and at most ${maximum}.`,
    );
}
function integer(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    fail(`${label} must be an integer from ${minimum} to ${maximum}.`);
}
function list(value, label, maximum, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    fail(`${label} must be an array of ${minimum} to ${maximum} items.`);
  value.forEach((item, index) => {
    if (!isObject(item)) fail(`${label}[${index}] must be an object.`);
  });
  return value;
}
function only(value, keys, label) {
  for (const key of Object.keys(value))
    if (!keys.includes(key)) fail(`${label}.${key} is not a known field.`);
}

export const STEP_LAYOUTS = ["list", "focus"];
export const SEGMENT_KINDS = ["active", "wait"];

const STEP_KEYS = [
  "id",
  "title",
  "short",
  "badge",
  "body",
  "code",
  "lang",
  "variants",
  "note",
  "result",
  "cue",
  "wait",
  "timer",
  "segments",
];

function validateSteps(data) {
  optionalText(data.description, "description", 600);
  if (data.layout !== undefined && !STEP_LAYOUTS.includes(data.layout))
    fail(`layout must be one of ${STEP_LAYOUTS.join(", ")}.`);
  if (data.start !== undefined) integer(data.start, "start", 0, 999);
  const steps = list(data.steps, "steps", 40, 1);
  if (data.initialStep !== undefined)
    integer(data.initialStep, "initialStep", 0, steps.length - 1);
  const ids = new Set();
  steps.forEach((step, index) => {
    const at = `steps[${index}]`;
    only(step, STEP_KEYS, at);
    if (step.id !== undefined) {
      text(step.id, `${at}.id`, 64);
      if (ids.has(step.id)) fail(`${at}.id duplicates ${step.id}.`);
      ids.add(step.id);
    }
    text(step.title, `${at}.title`, 160);
    optionalText(step.short, `${at}.short`, 24);
    optionalText(step.badge, `${at}.badge`, 24);
    optionalText(step.body, `${at}.body`, 3000);
    for (const key of ["note", "result", "cue", "wait"])
      optionalText(step[key], `${at}.${key}`, 600);
    optionalText(step.lang, `${at}.lang`, 24);
    if (step.code !== undefined) code(step.code, `${at}.code`);
    if (step.variants !== undefined) {
      if (step.code !== undefined)
        fail(`${at} uses either code or variants, not both.`);
      const labels = new Set();
      list(step.variants, `${at}.variants`, 6, 1).forEach((variant, v) => {
        const vat = `${at}.variants[${v}]`;
        only(variant, ["label", "code", "lang"], vat);
        text(variant.label, `${vat}.label`, 32);
        if (labels.has(variant.label))
          fail(`${vat}.label duplicates ${variant.label}.`);
        labels.add(variant.label);
        code(variant.code, `${vat}.code`);
        optionalText(variant.lang, `${vat}.lang`, 24);
      });
    }
    if (step.timer !== undefined) {
      if (!isObject(step.timer)) fail(`${at}.timer must be an object.`);
      only(step.timer, ["minutes", "label"], `${at}.timer`);
      number(step.timer.minutes, `${at}.timer.minutes`, 0, 1440, true);
      optionalText(step.timer.label, `${at}.timer.label`, 40);
    }
    if (step.segments !== undefined)
      list(step.segments, `${at}.segments`, 8, 1).forEach((segment, s) => {
        const sat = `${at}.segments[${s}]`;
        only(segment, ["start", "minutes", "kind"], sat);
        number(segment.start, `${sat}.start`, 0, 10000);
        number(segment.minutes, `${sat}.minutes`, 0, 10000, true);
        if (!SEGMENT_KINDS.includes(segment.kind))
          fail(`${sat}.kind must be one of ${SEGMENT_KINDS.join(", ")}.`);
      });
  });
}

function validateCommands(data) {
  optionalText(data.description, "description", 600);
  optionalText(data.placeholder, "placeholder", 60);
  optionalText(data.program, "program", 40);
  if (data.program !== undefined && /\s/.test(data.program))
    fail("program must be a single word.");
  const groups = new Set();
  list(data.groups, "groups", 16, 1).forEach((group, index) => {
    const at = `groups[${index}]`;
    only(group, ["id", "label"], at);
    text(group.id, `${at}.id`, 64);
    if (groups.has(group.id)) fail(`${at}.id duplicates ${group.id}.`);
    groups.add(group.id);
    text(group.label, `${at}.label`, 24);
  });
  const ids = new Set();
  list(data.commands, "commands", 300, 1).forEach((command, index) => {
    const at = `commands[${index}]`;
    only(
      command,
      ["id", "group", "command", "summary", "detail", "params", "examples"],
      at,
    );
    if (command.id !== undefined) {
      text(command.id, `${at}.id`, 64);
      if (ids.has(command.id)) fail(`${at}.id duplicates ${command.id}.`);
      ids.add(command.id);
    }
    text(command.group, `${at}.group`, 64);
    if (!groups.has(command.group))
      fail(`${at}.group ${command.group} does not match a group id.`);
    text(command.command, `${at}.command`, 240);
    text(command.summary, `${at}.summary`, 240);
    optionalText(command.detail, `${at}.detail`, 3000);
    if (command.params !== undefined) {
      const names = new Set();
      list(command.params, `${at}.params`, 40, 1).forEach((param, p) => {
        const pat = `${at}.params[${p}]`;
        only(param, ["name", "meaning"], pat);
        text(param.name, `${pat}.name`, 80);
        if (names.has(param.name))
          fail(`${pat}.name duplicates ${param.name}.`);
        names.add(param.name);
        text(param.meaning, `${pat}.meaning`, 400);
      });
    }
    if (command.examples !== undefined)
      list(command.examples, `${at}.examples`, 6, 1).forEach((example, e) => {
        const eat = `${at}.examples[${e}]`;
        only(example, ["label", "code"], eat);
        optionalText(example.label, `${eat}.label`, 40);
        code(example.code, `${eat}.code`);
      });
  });
}

export function validateDocReferenceData(kind, data) {
  if (!isObject(data)) fail("Component data must be an object.");
  optionalText(data.title, "title", 120);
  if (kind === "step-guide") validateSteps(data);
  else if (kind === "command-reference") validateCommands(data);
  else fail(`Unknown doc reference component ${kind}.`);
  return data;
}

// ---------------------------------------------------------------- step timeline

/** Active and waiting minutes plus the end of the last segment. */
export function stepTimeline(steps) {
  let active = 0;
  let wait = 0;
  let total = 0;
  for (const step of steps)
    for (const segment of step.segments ?? []) {
      if (segment.kind === "active") active += segment.minutes;
      else wait += segment.minutes;
      total = Math.max(total, segment.start + segment.minutes);
    }
  return { active, wait, total };
}

/** Axis ticks in minutes, spaced so a ribbon carries about four to eight labels. */
export function timelineTicks(total) {
  if (!(total > 0)) return [];
  const step =
    [5, 10, 15, 30, 60, 120, 240, 480].find((size) => total / size <= 8) ??
    Math.ceil(total / 8 / 60) * 60;
  const ticks = [];
  for (let minute = 0; minute <= total; minute += step) ticks.push(minute);
  return ticks;
}

// ---------------------------------------------------------------- command search

/** Lower-cased, de-duplicated search terms. */
export function searchTerms(query) {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
}

/** A command matches when every term appears in its command, summary or parameters. */
export function commandMatches(command, terms) {
  const haystack = [
    command.command,
    plainInline(command.summary),
    ...(command.params ?? []).map((param) => `${param.name} ${param.meaning}`),
  ].map((value) => value.toLowerCase());
  return terms.every((term) => haystack.some((value) => value.includes(term)));
}

/** Merged [start, end) ranges where any term occurs, case-insensitively. */
export function matchRanges(source, terms) {
  const lower = source.toLowerCase();
  const found = [];
  for (const term of terms)
    for (
      let index = lower.indexOf(term);
      index >= 0;
      index = lower.indexOf(term, index + term.length)
    )
      found.push([index, index + term.length]);
  found.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}
