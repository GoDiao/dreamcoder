// Contract for the step-walkthrough built-in.
// Validation runs in the workbench, the CLI and the portable reader, so it stays dependency-free.
import { DIAGRAM_TONES } from "./doc-diagrams-contract.mjs";

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
function list(value, label, maximum, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    fail(`${label} must be an array of ${minimum} to ${maximum} items.`);
  value.forEach((item, index) => {
    if (!isObject(item)) fail(`${label}[${index}] must be an object.`);
  });
  return value;
}
function optionalList(value, label, maximum) {
  return value === undefined ? [] : list(value, label, maximum);
}
function unique(seen, id, label) {
  text(id, label);
  if (seen.has(id)) fail(`${label} duplicates id ${id}.`);
  seen.add(id);
}
function partRef(partIds, id, label) {
  if (!partIds.has(id)) fail(`${label} must name an existing part.`);
}

/** Change marks for a state entry, in reading order. */
export const ENTRY_STATUSES = ["new", "changed", "retired", "kept"];
/** Visual roles for the actions in a step. */
export const ACTION_KINDS = ["input", "action", "result", "note"];
export const WALKTHROUGH_LIMITS = {
  parts: 6,
  steps: 10,
  actions: 12,
  entries: 24,
  fields: 8,
  blocks: 8,
  callouts: 6,
  details: 10,
  sources: 8,
};

function validateStep(step, index, partIds, stepIds) {
  const at = `steps[${index}]`;
  unique(stepIds, step.id, `${at}.id`);
  text(step.label, `${at}.label`);
  text(step.takeaway, `${at}.takeaway`);
  optionalText(step.actionsHeading, `${at}.actionsHeading`);
  list(step.actions, `${at}.actions`, WALKTHROUGH_LIMITS.actions, 1).forEach(
    (action, k) => {
      const path = `${at}.actions[${k}]`;
      text(action.actor, `${path}.actor`);
      text(action.text, `${path}.text`);
      optionalText(action.code, `${path}.code`);
      if (action.kind !== undefined && !ACTION_KINDS.includes(action.kind))
        fail(`${path}.kind must be one of ${ACTION_KINDS.join(", ")}.`);
      if (
        action.illustrative !== undefined &&
        typeof action.illustrative !== "boolean"
      )
        fail(`${path}.illustrative must be true or false.`);
    },
  );
  const entryIds = new Set();
  optionalList(
    step.entries,
    `${at}.entries`,
    WALKTHROUGH_LIMITS.entries,
  ).forEach((entry, k) => {
    const path = `${at}.entries[${k}]`;
    unique(entryIds, entry.id, `${path}.id`);
    partRef(partIds, entry.partId, `${path}.partId`);
    text(entry.title, `${path}.title`);
    if (!ENTRY_STATUSES.includes(entry.status))
      fail(`${path}.status must be one of ${ENTRY_STATUSES.join(", ")}.`);
    optionalText(entry.statusLabel, `${path}.statusLabel`);
    optionalText(entry.note, `${path}.note`);
    list(entry.fields, `${path}.fields`, WALKTHROUGH_LIMITS.fields, 1).forEach(
      (field, f) => {
        text(field.label, `${path}.fields[${f}].label`);
        text(field.value, `${path}.fields[${f}].value`);
        if (field.mono !== undefined && typeof field.mono !== "boolean")
          fail(`${path}.fields[${f}].mono must be true or false.`);
      },
    );
  });
  const noted = new Set();
  optionalList(
    step.partNotes,
    `${at}.partNotes`,
    WALKTHROUGH_LIMITS.parts,
  ).forEach((note, k) => {
    partRef(partIds, note.partId, `${at}.partNotes[${k}].partId`);
    if (noted.has(note.partId))
      fail(`${at}.partNotes has more than one note for ${note.partId}.`);
    noted.add(note.partId);
    text(note.text, `${at}.partNotes[${k}].text`);
  });
  if (step.output !== undefined) {
    const output = step.output;
    if (!isObject(output)) fail(`${at}.output must be an object.`);
    text(output.heading, `${at}.output.heading`);
    const blockIds = new Set();
    const blocks = list(
      output.blocks,
      `${at}.output.blocks`,
      WALKTHROUGH_LIMITS.blocks,
      1,
    );
    blocks.forEach((block, k) => {
      const path = `${at}.output.blocks[${k}]`;
      unique(blockIds, block.id, `${path}.id`);
      if (block.partId !== undefined)
        partRef(partIds, block.partId, `${path}.partId`);
      text(block.label, `${path}.label`);
      text(block.text, `${path}.text`);
      if (block.callouts !== undefined) {
        if (
          !Array.isArray(block.callouts) ||
          block.callouts.length > WALKTHROUGH_LIMITS.callouts
        )
          fail(
            `${path}.callouts must be an array of at most ${WALKTHROUGH_LIMITS.callouts} items.`,
          );
        block.callouts.forEach((callout, c) =>
          text(callout, `${path}.callouts[${c}]`),
        );
      }
    });
    if (output.hidePartId !== undefined) {
      partRef(partIds, output.hidePartId, `${at}.output.hidePartId`);
      if (!blocks.some((block) => block.partId === output.hidePartId))
        fail(
          `${at}.output.hidePartId must match the part of at least one block.`,
        );
    }
    optionalText(output.hideLabel, `${at}.output.hideLabel`);
    optionalText(output.hideNote, `${at}.output.hideNote`);
  }
  if (step.details !== undefined) {
    if (
      !Array.isArray(step.details) ||
      step.details.length > WALKTHROUGH_LIMITS.details
    )
      fail(
        `${at}.details must be an array of at most ${WALKTHROUGH_LIMITS.details} items.`,
      );
    step.details.forEach((detail, k) => text(detail, `${at}.details[${k}]`));
  }
  optionalList(
    step.sources,
    `${at}.sources`,
    WALKTHROUGH_LIMITS.sources,
  ).forEach((source, k) => {
    text(source.label, `${at}.sources[${k}].label`);
    if (typeof source.url !== "string" || !/^https?:\/\//i.test(source.url))
      fail(`${at}.sources[${k}].url must be an http(s) URL.`);
  });
}

export function validateWalkthroughData(data) {
  if (!isObject(data)) fail("Step walkthrough data must be an object.");
  text(data.title, "title");
  optionalText(data.question, "question");
  optionalText(data.note, "note");
  optionalText(data.stateHeading, "stateHeading");
  const partIds = new Set();
  list(data.parts, "parts", WALKTHROUGH_LIMITS.parts, 1).forEach(
    (part, index) => {
      unique(partIds, part.id, `parts[${index}].id`);
      text(part.label, `parts[${index}].label`);
      optionalText(part.plain, `parts[${index}].plain`);
      optionalText(part.how, `parts[${index}].how`);
      if (part.tone !== undefined && !DIAGRAM_TONES.includes(part.tone))
        fail(
          `parts[${index}].tone must be one of ${DIAGRAM_TONES.join(", ")}.`,
        );
    },
  );
  const stepIds = new Set();
  list(data.steps, "steps", WALKTHROUGH_LIMITS.steps, 1).forEach(
    (step, index) => validateStep(step, index, partIds, stepIds),
  );
  if (data.initialStep !== undefined && !stepIds.has(data.initialStep))
    fail("initialStep must name an existing step.");
  return data;
}

/** Per step and part: how many entries carry each status. */
export function summarizeWalkthrough(data) {
  return data.steps.map((step) => ({
    id: step.id,
    parts: data.parts.map((part) => {
      const entries = (step.entries ?? []).filter(
        (entry) => entry.partId === part.id,
      );
      const count = (status) =>
        entries.filter((entry) => entry.status === status).length;
      return {
        id: part.id,
        total: entries.length,
        active: entries.length - count("retired"),
        new: count("new"),
        changed: count("changed"),
        retired: count("retired"),
      };
    }),
    outputBlocks: step.output
      ? step.output.blocks.map((block) => block.id)
      : [],
  }));
}
