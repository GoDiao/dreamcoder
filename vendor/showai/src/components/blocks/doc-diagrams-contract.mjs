// Shared contract for the sequence-diagram and layer-diagram built-ins.
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
function list(value, label, maximum, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    fail(`${label} must be an array of ${minimum} to ${maximum} items.`);
  value.forEach((item, index) => {
    if (!isObject(item)) fail(`${label}[${index}] must be an object.`);
  });
  return value;
}
function unique(seen, id, label) {
  text(id, label);
  if (seen.has(id)) fail(`${label} duplicates id ${id}.`);
  seen.add(id);
}
function tone(value, label) {
  if (value !== undefined && !DIAGRAM_TONES.includes(value))
    fail(`${label} must be one of ${DIAGRAM_TONES.join(", ")}.`);
}

/** Color families shared by both diagrams; each maps to a light and a dark hue in CSS. */
export const DIAGRAM_TONES = [
  "accent",
  "teal",
  "orange",
  "violet",
  "rose",
  "slate",
];
/** Layers without a tone take these in order. */
export const LAYER_TONE_ORDER = [
  "accent",
  "teal",
  "violet",
  "orange",
  "rose",
  "slate",
];
export const STEP_KINDS = ["call", "reply", "note"];
export const SEQUENCE_LIMITS = { actors: 8, steps: 40 };
export const LAYER_LIMITS = { layers: 8, modules: 12 };

function validateSequence(data) {
  optionalText(data.description, "description");
  const actors = new Set();
  list(data.actors, "actors", SEQUENCE_LIMITS.actors, 1).forEach(
    (actor, index) => {
      const at = `actors[${index}]`;
      unique(actors, actor.id, `${at}.id`);
      text(actor.label, `${at}.label`);
      optionalText(actor.sub, `${at}.sub`);
      optionalText(actor.icon, `${at}.icon`);
      if (actor.icon !== undefined && Array.from(actor.icon).length > 8)
        fail(`${at}.icon must be a single emoji or short symbol.`);
      tone(actor.tone, `${at}.tone`);
    },
  );
  list(data.steps, "steps", SEQUENCE_LIMITS.steps, 1).forEach((step, index) => {
    const at = `steps[${index}]`;
    for (const end of ["from", "to"]) {
      text(step[end], `${at}.${end}`);
      if (!actors.has(step[end]))
        fail(`${at}.${end} ${step[end]} does not match an actor id.`);
    }
    text(step.label, `${at}.label`);
    optionalText(step.detail, `${at}.detail`);
    if (step.kind !== undefined && !STEP_KINDS.includes(step.kind))
      fail(`${at}.kind must be one of ${STEP_KINDS.join(", ")}.`);
  });
}

function validateLayers(data) {
  optionalText(data.caption, "caption");
  const layers = new Set();
  const modules = new Set();
  list(data.layers, "layers", LAYER_LIMITS.layers, 1).forEach(
    (layer, index) => {
      const at = `layers[${index}]`;
      unique(layers, layer.id, `${at}.id`);
      text(layer.name, `${at}.name`);
      optionalText(layer.sub, `${at}.sub`);
      tone(layer.tone, `${at}.tone`);
      list(layer.modules, `${at}.modules`, LAYER_LIMITS.modules).forEach(
        (module, moduleIndex) => {
          const path = `${at}.modules[${moduleIndex}]`;
          unique(modules, module.id, `${path}.id`);
          text(module.name, `${path}.name`);
          optionalText(module.path, `${path}.path`);
          optionalText(module.detail, `${path}.detail`);
        },
      );
    },
  );
  if (data.initial !== undefined) {
    text(data.initial, "initial");
    if (!modules.has(data.initial))
      fail(`initial ${data.initial} does not match a module id.`);
  }
}

export function validateDocDiagramData(kind, data) {
  if (!isObject(data)) fail("Component data must be an object.");
  optionalText(data.title, "title");
  if (kind === "sequence-diagram") validateSequence(data);
  else if (kind === "layer-diagram") validateLayers(data);
  else fail(`Unknown diagram component ${kind}.`);
  return data;
}

/** Detail text split into non-empty paragraphs; each renders through InlineMarkup. */
export function detailParagraphs(source) {
  if (typeof source !== "string") return [];
  return source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}
