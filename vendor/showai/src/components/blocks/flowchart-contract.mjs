const kinds = new Set([
  "request",
  "skill",
  "decision",
  "reference",
  "query",
  "result",
]);
const reserved = new Set(["__proto__", "prototype", "constructor"]);
export const STAGE_STATES = ["ok", "warn", "bad", "idle", "active"];
const states = new Set(STAGE_STATES);
function label(value, name, required = false, max = 10000) {
  if (value === undefined && !required) return;
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error(`${name} must be ${required ? "non-empty " : ""}text.`);
}
function unique(items, name, limit) {
  if (!Array.isArray(items) || items.length > limit)
    throw new Error(`${name} must contain at most ${limit} items.`);
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error(`${name} requires objects.`);
    label(item.id, `${name}.id`, true, 200);
    if (reserved.has(item.id) || ids.has(item.id))
      throw new Error(`${name} requires unique, non-reserved IDs.`);
    ids.add(item.id);
  }
  return ids;
}
export function validateFlowchartData(data) {
  label(data.title, "flowchart.title");
  label(data.description, "flowchart.description");
  if (
    data.height !== undefined &&
    (!Number.isFinite(data.height) || data.height < 360 || data.height > 1200)
  )
    throw new Error("Flowchart height must be between 360 and 1200.");
  unique(data.flows, "flowchart.flows", 20);
  for (const flow of data.flows) {
    label(flow.label, "flow.label", true, 200);
    label(flow.description, "flow.description");
    if (flow.direction !== undefined && !["TB", "LR"].includes(flow.direction))
      throw new Error("Flow direction must be TB or LR.");
    const ids = unique(flow.nodes, "flow.nodes", 200);
    unique(flow.edges, "flow.edges", 400);
    for (const node of flow.nodes) {
      label(node.label, "node.label", true, 200);
      label(node.subtitle, "node.subtitle", false, 300);
      label(node.detail, "node.detail");
      for (const side of ["sourceSide", "targetSide"]) {
        if (
          node[side] !== undefined &&
          !["top", "bottom", "left", "right"].includes(node[side])
        )
          throw new Error(`${side} must be a valid connection side.`);
      }
      if (node.kind !== undefined && !kinds.has(node.kind))
        throw new Error("Unsupported flow node kind.");
      for (const key of ["commands", "references"]) {
        if (node[key] === undefined) continue;
        if (!Array.isArray(node[key]) || node[key].length > 30)
          throw new Error(`${key} must have at most 30 entries.`);
        node[key].forEach((item) => label(item, key, true, 3000));
      }
      if (
        node.position &&
        (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))
      )
        throw new Error("Node positions must be finite.");
    }
    for (const edge of flow.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target))
        throw new Error(`Flow edge ${edge.id} references a missing node.`);
      label(edge.label, "edge.label", false, 300);
    }
    validatePlayback(flow, `flowchart.flows[${data.flows.indexOf(flow)}]`);
  }
  return data;
}
function record(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object.`);
}
// Journeys walk a route step by step; stages recolour the same graph over
// time. Both only reference nodes and edges of their own flow.
function validatePlayback(flow, path) {
  const nodes = new Set(flow.nodes.map((node) => node.id));
  const edges = new Map(flow.edges.map((edge) => [edge.id, edge]));
  if (flow.journeys !== undefined) {
    const journeyIds = unique(flow.journeys, `${path}.journeys`, 12);
    flow.journeys.forEach((journey, j) => {
      const at = `${path}.journeys[${j}]`;
      label(journey.label, `${at}.label`, true, 200);
      label(journey.summary, `${at}.summary`, false, 1000);
      if (
        !Array.isArray(journey.steps) ||
        !journey.steps.length ||
        journey.steps.length > 60
      )
        throw new Error(`${at}.steps must contain 1 to 60 steps.`);
      journey.steps.forEach((step, s) => {
        const stepAt = `${at}.steps[${s}]`;
        record(step, stepAt);
        if (!nodes.has(step.node))
          throw new Error(`${stepAt}.node references a missing node.`);
        label(step.title, `${stepAt}.title`, true, 200);
        label(step.text, `${stepAt}.text`, true, 3000);
        if (step.edge === undefined) return;
        const edge = edges.get(step.edge);
        if (!edge) throw new Error(`${stepAt}.edge references a missing edge.`);
        if (edge.source !== step.node && edge.target !== step.node)
          throw new Error(`${stepAt}.edge must connect to node ${step.node}.`);
      });
    });
    if (
      flow.initialJourney !== undefined &&
      !journeyIds.has(flow.initialJourney)
    )
      throw new Error(`${path}.initialJourney references a missing journey.`);
  } else if (flow.initialJourney !== undefined)
    throw new Error(`${path}.initialJourney requires journeys.`);
  if (flow.stages !== undefined) {
    const stageIds = unique(flow.stages, `${path}.stages`, 30);
    flow.stages.forEach((stage, i) => {
      const at = `${path}.stages[${i}]`;
      label(stage.label, `${at}.label`, true, 200);
      label(stage.summary, `${at}.summary`, false, 3000);
      for (const [key, ids, extra] of [
        ["nodes", nodes, "note"],
        ["edges", edges, "label"],
      ]) {
        if (stage[key] === undefined) continue;
        record(stage[key], `${at}.${key}`);
        const entries = Object.entries(stage[key]);
        if (entries.length > (key === "nodes" ? 200 : 400))
          throw new Error(`${at}.${key} has too many entries.`);
        for (const [id, view] of entries) {
          const entryAt = `${at}.${key}.${id}`;
          if (!ids.has(id))
            throw new Error(
              `${entryAt} references a missing ${key === "nodes" ? "node" : "edge"}.`,
            );
          record(view, entryAt);
          if (!states.has(view.state))
            throw new Error(
              `${entryAt}.state must be one of ${STAGE_STATES.join(", ")}.`,
            );
          label(view[extra], `${entryAt}.${extra}`, false, 300);
        }
      }
    });
    if (flow.initialStage !== undefined && !stageIds.has(flow.initialStage))
      throw new Error(`${path}.initialStage references a missing stage.`);
  } else if (flow.initialStage !== undefined)
    throw new Error(`${path}.initialStage requires stages.`);
}
/**
 * The edge walked to reach each journey step: the explicit `edge`, otherwise
 * an edge joining the previous step's node to this one (either direction).
 */
export function journeyStepEdges(flow, journey) {
  return journey.steps.map((step, index) => {
    if (step.edge !== undefined) return step.edge;
    const previous = journey.steps[index - 1]?.node;
    if (previous === undefined || previous === step.node) return undefined;
    const forward = flow.edges.find(
      (edge) => edge.source === previous && edge.target === step.node,
    );
    return (
      forward ??
      flow.edges.find(
        (edge) => edge.source === step.node && edge.target === previous,
      )
    )?.id;
  });
}
