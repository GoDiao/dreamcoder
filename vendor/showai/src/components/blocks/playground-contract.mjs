// Shared contract for the playground (交互计算) built-in.
// Validation runs in the workbench, the CLI and the portable reader, so it stays dependency-free.
// Formulas use a small declarative expression language; nothing here calls eval or Function.

const fail = (message) => {
  throw new Error(message);
};
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isFinite = (value) => typeof value === "number" && Number.isFinite(value);

export const OPERATIONS = ["sum", "product", "average"];
export const INPUT_TYPES = ["slider", "stepper", "toggle", "choice"];
export const LIMITS = {
  inputs: 30,
  options: 8,
  formulas: 60,
  outputs: 6,
  breakdown: 12,
  presets: 8,
  criteria: 8,
  rankingItems: 30,
  expression: 500,
  depth: 48,
};
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/* ---------- Expression language ---------- */

// Function name → [minimum arguments, maximum arguments].
const FUNCTIONS = {
  min: [1, 16],
  max: [1, 16],
  round: [1, 2],
  floor: [1, 1],
  ceil: [1, 1],
  abs: [1, 1],
  sqrt: [1, 1],
  clamp: [3, 3],
  if: [3, 3],
};
export const EXPRESSION_FUNCTIONS = Object.keys(FUNCTIONS);
const COMPARISONS = ["<", "<=", ">", ">=", "==", "!="];

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const space = /^\s+/.exec(rest);
    if (space) {
      index += space[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      tokens.push({ type: "num", value: Number(number[0]), at: index });
      index += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (name) {
      tokens.push({ type: "id", value: name[0], at: index });
      index += name[0].length;
      continue;
    }
    const operator = /^(?:<=|>=|==|!=|[-+*/^(),<>])/.exec(rest);
    if (!operator)
      fail(`Unexpected character "${rest[0]}" at position ${index + 1}.`);
    tokens.push({ type: "op", value: operator[0], at: index });
    index += operator[0].length;
  }
  return tokens;
}

/**
 * Parses an expression into a plain AST:
 * num | ref | unary | binary | call. Throws with the failing position.
 */
export function parseExpression(source) {
  if (typeof source !== "string" || !source.trim())
    fail("Expression must be non-empty text.");
  if (source.length > LIMITS.expression)
    fail(`Expression must be at most ${LIMITS.expression} characters.`);
  const tokens = tokenize(source);
  let position = 0;
  let depth = 0;
  const peek = () => tokens[position];
  const where = () =>
    peek() ? `position ${peek().at + 1}` : "the end of the expression";
  const isOp = (value) => peek()?.type === "op" && peek().value === value;
  const expect = (value) => {
    if (!isOp(value)) fail(`Expected "${value}" at ${where()}.`);
    position += 1;
  };
  const nested = (parse) => {
    depth += 1;
    if (depth > LIMITS.depth) fail("Expression is nested too deeply.");
    const node = parse();
    depth -= 1;
    return node;
  };
  function comparison() {
    let left = additive();
    while (peek()?.type === "op" && COMPARISONS.includes(peek().value)) {
      const op = tokens[position++].value;
      left = { type: "binary", op, left, right: additive() };
    }
    return left;
  }
  function additive() {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = tokens[position++].value;
      left = { type: "binary", op, left, right: term() };
    }
    return left;
  }
  function term() {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = tokens[position++].value;
      left = { type: "binary", op, left, right: unary() };
    }
    return left;
  }
  function unary() {
    if (isOp("-") || isOp("+")) {
      const op = tokens[position++].value;
      return nested(() => ({ type: "unary", op, arg: unary() }));
    }
    return power();
  }
  function power() {
    const base = primary();
    if (!isOp("^")) return base;
    position += 1;
    // Right-associative, and binds tighter than a leading minus: -2^2 is -(2^2).
    return { type: "binary", op: "^", left: base, right: nested(unary) };
  }
  function primary() {
    const token = peek();
    if (!token) fail("Expression ended unexpectedly.");
    if (token.type === "num") {
      position += 1;
      return { type: "num", value: token.value };
    }
    if (token.type === "id") {
      position += 1;
      if (!isOp("(")) return { type: "ref", id: token.value };
      const arity = FUNCTIONS[token.value];
      if (!arity) fail(`Unknown function "${token.value}".`);
      position += 1;
      const args = [];
      if (!isOp(")")) {
        args.push(nested(comparison));
        while (isOp(",")) {
          position += 1;
          args.push(nested(comparison));
        }
      }
      expect(")");
      if (args.length < arity[0] || args.length > arity[1])
        fail(
          `${token.value}() takes ${arity[0] === arity[1] ? arity[0] : `${arity[0]} to ${arity[1]}`} argument(s).`,
        );
      return { type: "call", name: token.value, args };
    }
    if (token.value === "(") {
      position += 1;
      const node = nested(comparison);
      expect(")");
      return node;
    }
    fail(`Unexpected "${token.value}" at ${where()}.`);
  }
  const tree = comparison();
  if (position < tokens.length)
    fail(`Unexpected "${peek().value}" at ${where()}.`);
  return tree;
}

/** Ids an expression reads, in first-use order. */
export function expressionRefs(tree) {
  const refs = new Set();
  const visit = (node) => {
    if (node.type === "ref") refs.add(node.id);
    else if (node.type === "unary") visit(node.arg);
    else if (node.type === "binary") {
      visit(node.left);
      visit(node.right);
    } else if (node.type === "call") node.args.forEach(visit);
  };
  visit(tree);
  return [...refs];
}

/** Evaluates a parsed expression; comparisons yield 1 or 0. Non-finite results propagate. */
export function evaluateExpression(tree, scope) {
  const run = (node) => {
    switch (node.type) {
      case "num":
        return node.value;
      case "ref": {
        const value = scope[node.id];
        if (typeof value !== "number") fail(`Unknown id "${node.id}".`);
        return value;
      }
      case "unary":
        return node.op === "-" ? -run(node.arg) : run(node.arg);
      case "binary": {
        const a = run(node.left);
        const b = run(node.right);
        switch (node.op) {
          case "+":
            return a + b;
          case "-":
            return a - b;
          case "*":
            return a * b;
          case "/":
            return a / b;
          case "^":
            return a ** b;
          case "<":
            return a < b ? 1 : 0;
          case "<=":
            return a <= b ? 1 : 0;
          case ">":
            return a > b ? 1 : 0;
          case ">=":
            return a >= b ? 1 : 0;
          case "==":
            return a === b ? 1 : 0;
          default:
            return a !== b ? 1 : 0;
        }
      }
      default: {
        if (node.name === "if")
          return run(node.args[0]) ? run(node.args[1]) : run(node.args[2]);
        const args = node.args.map(run);
        switch (node.name) {
          case "min":
            return Math.min(...args);
          case "max":
            return Math.max(...args);
          case "round": {
            const scale =
              10 ** Math.max(0, Math.min(10, Math.round(args[1] ?? 0)));
            return Math.round(args[0] * scale) / scale;
          }
          case "floor":
            return Math.floor(args[0]);
          case "ceil":
            return Math.ceil(args[0]);
          case "abs":
            return Math.abs(args[0]);
          case "sqrt":
            return Math.sqrt(args[0]);
          default:
            return Math.min(Math.max(args[0], args[1]), args[2]);
        }
      }
    }
  };
  return run(tree);
}

/* ---------- Data helpers ---------- */

export const inputType = (input) => input.type ?? "slider";

/** Initial value of an input as authored; choice defaults to its first option, toggle to 0. */
export function inputDefault(input) {
  const type = inputType(input);
  if (type === "toggle") return input.value ? 1 : 0;
  if (type === "choice")
    return isFinite(input.value) ? input.value : input.options[0].value;
  return isFinite(input.value) ? input.value : 0;
}

/** Coerces a reading-time value into what the input accepts. */
export function clampInput(input, value) {
  const type = inputType(input);
  if (type === "toggle") return value ? 1 : 0;
  if (type === "choice")
    return input.options.some((option) => option.value === value)
      ? value
      : inputDefault(input);
  return Math.min(input.max, Math.max(input.min, value));
}

/** True when the playground shows the original sum/product/average result. */
export function isLegacyPlayground(data) {
  return (
    data.formulas === undefined &&
    data.outputs === undefined &&
    (data.operation !== undefined || data.ranking === undefined)
  );
}

function compileFormulas(formulas, inputIds) {
  const parsed = new Map();
  formulas.forEach((formula, index) => {
    try {
      parsed.set(formula.id, parseExpression(formula.expr));
    } catch (error) {
      fail(`formulas[${index}].expr: ${error.message}`);
    }
  });
  formulas.forEach((formula, index) => {
    for (const ref of expressionRefs(parsed.get(formula.id)))
      if (!inputIds.has(ref) && !parsed.has(ref))
        fail(`formulas[${index}].expr references unknown id "${ref}".`);
  });
  // Depth-first topological order; a grey node met again closes a cycle.
  const order = [];
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "active")
      fail(
        `formulas contain a cycle: ${[...trail.slice(trail.indexOf(id)), id].join(" -> ")}.`,
      );
    state.set(id, "active");
    for (const ref of expressionRefs(parsed.get(id)))
      if (parsed.has(ref)) visit(ref, [...trail, id]);
    state.set(id, "done");
    order.push({ id, tree: parsed.get(id) });
  };
  for (const formula of formulas) visit(formula.id, []);
  return order;
}

/** Parses and orders formulas once; reuse the result for every evaluation. */
export function compilePlayground(data) {
  const inputs = Array.isArray(data.inputs) ? data.inputs : [];
  return compileFormulas(
    Array.isArray(data.formulas) ? data.formulas : [],
    new Set(inputs.map((input) => input.id)),
  );
}

/**
 * Computes every input and formula value for the given reading-time overrides.
 * `compiled` comes from compilePlayground(data).
 */
export function evaluatePlayground(
  data,
  values = {},
  compiled = compilePlayground(data),
) {
  const scope = Object.create(null);
  for (const input of Array.isArray(data.inputs) ? data.inputs : [])
    scope[input.id] = clampInput(
      input,
      values[input.id] ?? inputDefault(input),
    );
  for (const { id, tree } of compiled)
    scope[id] = evaluateExpression(tree, scope);
  return scope;
}

/** Breakdown parts with each part's share of the summed magnitudes. */
export function breakdownParts(data, scope) {
  const items = data.breakdown?.items ?? [];
  const parts = items.map((item) => ({ ...item, value: scope[item.formula] }));
  const total = parts.reduce(
    (sum, part) =>
      sum + (Number.isFinite(part.value) ? Math.abs(part.value) : 0),
    0,
  );
  return parts.map((part) => ({
    ...part,
    share:
      total && Number.isFinite(part.value) ? Math.abs(part.value) / total : 0,
  }));
}

/**
 * Weighted ranking: each criterion contributes weight × score / Σweights,
 * rescaled so a perfect item scores 100. Ties keep the authored order.
 */
export function rankItems(ranking, scope) {
  const scale = ranking.scale ?? 10;
  const weights = ranking.criteria.map((criterion) => {
    const weight =
      typeof criterion.weight === "string"
        ? scope[criterion.weight]
        : (criterion.weight ?? 1);
    return Number.isFinite(weight) ? Math.max(0, weight) : 0;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return ranking.items
    .map((item, index) => {
      const parts = ranking.criteria.map((criterion, criterionIndex) => ({
        id: criterion.id,
        value: total
          ? (weights[criterionIndex] * (item.scores[criterion.id] ?? 0) * 100) /
            (total * scale)
          : 0,
      }));
      return {
        item,
        index,
        parts,
        score: parts.reduce((sum, part) => sum + part.value, 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Formats a number with an optional prefix, suffix, divisor and fixed decimals. */
export function formatNumber(value, format = {}, locale) {
  if (!Number.isFinite(value)) return "";
  const scaled = value / (format.divisor ?? 1);
  const digits =
    format.decimals === undefined
      ? { maximumFractionDigits: 2 }
      : {
          minimumFractionDigits: format.decimals,
          maximumFractionDigits: format.decimals,
        };
  const body = new Intl.NumberFormat(locale, digits).format(Math.abs(scaled));
  const zero = Number(body.replace(/[^\d.]/g, "")) === 0;
  const sign =
    scaled < 0 && !zero ? "−" : format.signed ? (zero ? "±" : "+") : "";
  return `${sign}${format.prefix ?? ""}${body}${format.suffix ?? ""}`;
}

/* ---------- Validation ---------- */

function text(value, label, maximum = 1000) {
  if (typeof value !== "string" || value.length > maximum)
    fail(`${label} must be text of at most ${maximum} characters.`);
}
function optionalText(value, label, maximum) {
  if (value !== undefined) text(value, label, maximum);
}
function label(value, path) {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    fail(`${path} must be non-empty text of at most 200 characters.`);
}
function finite(value, path) {
  if (!isFinite(value)) fail(`${path} must be a finite number.`);
}
function list(value, path, maximum, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    fail(`${path} must be an array of ${minimum} to ${maximum} items.`);
  value.forEach((item, index) => {
    if (!isObject(item)) fail(`${path}[${index}] must be an object.`);
  });
  return value;
}
function color(value, path) {
  if (value !== undefined && !/^#[0-9a-fA-F]{6}$/.test(value))
    fail(`${path} must be a six-digit hex color.`);
}
function format(value, path) {
  if (value === undefined) return;
  if (!isObject(value)) fail(`${path} must be an object.`);
  optionalText(value.prefix, `${path}.prefix`, 20);
  optionalText(value.suffix, `${path}.suffix`, 20);
  if (
    value.decimals !== undefined &&
    (!Number.isInteger(value.decimals) ||
      value.decimals < 0 ||
      value.decimals > 6)
  )
    fail(`${path}.decimals must be an integer from 0 to 6.`);
  if (
    value.divisor !== undefined &&
    (!isFinite(value.divisor) || value.divisor <= 0)
  )
    fail(`${path}.divisor must be a positive number.`);
  if (value.signed !== undefined && typeof value.signed !== "boolean")
    fail(`${path}.signed must be true or false.`);
}

function validateInput(input, path) {
  if (typeof input.id !== "string" || !input.id)
    fail(`${path}.id must be non-empty text.`);
  text(input.label, `${path}.label`);
  optionalText(input.unit, `${path}.unit`, 40);
  optionalText(input.hint, `${path}.hint`);
  const type = inputType(input);
  if (!INPUT_TYPES.includes(type))
    fail(`${path}.type must be one of ${INPUT_TYPES.join(", ")}.`);
  if (type === "slider" || type === "stepper") {
    finite(input.min, `${path}.min`);
    finite(input.max, `${path}.max`);
    finite(input.value, `${path}.value`);
    if (input.min >= input.max) fail(`${path}.max must be greater than min.`);
    if (type === "slider" || input.step !== undefined) {
      finite(input.step, `${path}.step`);
      if (input.step <= 0) fail(`${path}.step must be greater than 0.`);
    }
  }
  if (
    type === "toggle" &&
    input.value !== undefined &&
    input.value !== 0 &&
    input.value !== 1
  )
    fail(`${path}.value must be 0 or 1.`);
  if (type === "choice") {
    const options = list(input.options, `${path}.options`, LIMITS.options, 2);
    const seen = new Set();
    options.forEach((option, index) => {
      label(option.label, `${path}.options[${index}].label`);
      finite(option.value, `${path}.options[${index}].value`);
      optionalText(option.note, `${path}.options[${index}].note`, 200);
      if (seen.has(option.value))
        fail(`${path}.options contains duplicate value ${option.value}.`);
      seen.add(option.value);
    });
    if (input.value !== undefined && !seen.has(input.value))
      fail(`${path}.value must equal one of the option values.`);
  }
}

function presetValue(input, value, path) {
  finite(value, path);
  const type = inputType(input);
  if (type === "toggle" && value !== 0 && value !== 1)
    fail(`${path} must be 0 or 1.`);
  if (
    type === "choice" &&
    !input.options.some((option) => option.value === value)
  )
    fail(`${path} must equal one of the option values.`);
  if (
    (type === "slider" || type === "stepper") &&
    (value < input.min || value > input.max)
  )
    fail(`${path} must be within ${input.min} to ${input.max}.`);
}

function validateTarget(target, path, known) {
  if (!isObject(target)) fail(`${path} must be an object.`);
  if (typeof target.value === "string") {
    if (!known.has(target.value))
      fail(`${path}.value references unknown id "${target.value}".`);
  } else finite(target.value, `${path}.value`);
  optionalText(target.label, `${path}.label`, 200);
  optionalText(target.above, `${path}.above`, 200);
  optionalText(target.below, `${path}.below`, 200);
}

function validateRanking(ranking, known) {
  if (!isObject(ranking)) fail("ranking must be an object.");
  optionalText(ranking.title, "ranking.title", 200);
  if (
    ranking.scale !== undefined &&
    (!isFinite(ranking.scale) || ranking.scale <= 0)
  )
    fail("ranking.scale must be a positive number.");
  const scale = ranking.scale ?? 10;
  if (
    ranking.decimals !== undefined &&
    (!Number.isInteger(ranking.decimals) ||
      ranking.decimals < 0 ||
      ranking.decimals > 2)
  )
    fail("ranking.decimals must be an integer from 0 to 2.");
  const criteria = list(
    ranking.criteria,
    "ranking.criteria",
    LIMITS.criteria,
    1,
  );
  const criterionIds = new Set();
  criteria.forEach((criterion, index) => {
    const path = `ranking.criteria[${index}]`;
    if (typeof criterion.id !== "string" || !criterion.id)
      fail(`${path}.id must be non-empty text.`);
    if (criterionIds.has(criterion.id))
      fail(`ranking.criteria contains duplicate id ${criterion.id}.`);
    criterionIds.add(criterion.id);
    label(criterion.label, `${path}.label`);
    optionalText(criterion.hint, `${path}.hint`, 200);
    color(criterion.color, `${path}.color`);
    if (typeof criterion.weight === "string") {
      if (!known.has(criterion.weight))
        fail(`${path}.weight references unknown id "${criterion.weight}".`);
    } else if (criterion.weight !== undefined) {
      finite(criterion.weight, `${path}.weight`);
      if (criterion.weight < 0) fail(`${path}.weight must not be negative.`);
    }
  });
  const items = list(ranking.items, "ranking.items", LIMITS.rankingItems, 1);
  const itemIds = new Set();
  items.forEach((item, index) => {
    const path = `ranking.items[${index}]`;
    if (typeof item.id !== "string" || !item.id)
      fail(`${path}.id must be non-empty text.`);
    if (itemIds.has(item.id))
      fail(`ranking.items contains duplicate id ${item.id}.`);
    itemIds.add(item.id);
    label(item.label, `${path}.label`);
    optionalText(item.note, `${path}.note`, 300);
    if (!isObject(item.scores)) fail(`${path}.scores must be an object.`);
    for (const [criterion, score] of Object.entries(item.scores)) {
      if (!criterionIds.has(criterion))
        fail(`${path}.scores.${criterion} does not match a criterion id.`);
      finite(score, `${path}.scores.${criterion}`);
      if (score < 0 || score > scale)
        fail(`${path}.scores.${criterion} must be within 0 to ${scale}.`);
    }
  });
}

/** Validates playground data and returns it unchanged; throws with a field path. */
export function validatePlaygroundData(data) {
  if (!isObject(data)) fail("Playground data must be an object.");
  optionalText(data.title, "title", 200);
  optionalText(data.description, "description", 2000);
  optionalText(data.resultLabel, "resultLabel", 200);
  optionalText(data.unit, "unit", 40);
  optionalText(data.note, "note", 1000);
  if (data.operation !== undefined && !OPERATIONS.includes(data.operation))
    fail(`operation must be one of ${OPERATIONS.join(", ")}.`);

  const inputs = list(data.inputs, "inputs", LIMITS.inputs);
  const known = new Set();
  inputs.forEach((input, index) => {
    validateInput(input, `inputs[${index}]`);
    if (known.has(input.id)) fail(`inputs contains duplicate id ${input.id}.`);
    known.add(input.id);
  });

  if (data.formulas !== undefined) {
    const formulas = list(data.formulas, "formulas", LIMITS.formulas);
    formulas.forEach((formula, index) => {
      const path = `formulas[${index}]`;
      if (typeof formula.id !== "string" || !IDENTIFIER.test(formula.id))
        fail(
          `${path}.id must start with a letter or _ and use only letters, digits and _.`,
        );
      if (FUNCTIONS[formula.id])
        fail(`${path}.id "${formula.id}" is a reserved function name.`);
      if (known.has(formula.id))
        fail(`${path}.id ${formula.id} duplicates another id.`);
      known.add(formula.id);
      optionalText(formula.label, `${path}.label`, 200);
      optionalText(formula.unit, `${path}.unit`, 40);
      format(formula.format, `${path}.format`);
      if (typeof formula.expr !== "string") fail(`${path}.expr must be text.`);
    });
    compileFormulas(formulas, new Set(inputs.map((input) => input.id)));
  }

  if (data.outputs !== undefined) {
    const outputs = list(data.outputs, "outputs", LIMITS.outputs, 1);
    outputs.forEach((output, index) => {
      const path = `outputs[${index}]`;
      if (!known.has(output.formula))
        fail(`${path}.formula references unknown id "${output.formula}".`);
      optionalText(output.label, `${path}.label`, 200);
      optionalText(output.unit, `${path}.unit`, 40);
      optionalText(output.hint, `${path}.hint`, 300);
      format(output.format, `${path}.format`);
      if (output.target !== undefined)
        validateTarget(output.target, `${path}.target`, known);
    });
  }

  if (data.breakdown !== undefined) {
    if (!isObject(data.breakdown)) fail("breakdown must be an object.");
    optionalText(data.breakdown.title, "breakdown.title", 200);
    format(data.breakdown.format, "breakdown.format");
    const items = list(
      data.breakdown.items,
      "breakdown.items",
      LIMITS.breakdown,
      1,
    );
    const seen = new Set();
    items.forEach((item, index) => {
      const path = `breakdown.items[${index}]`;
      if (!known.has(item.formula))
        fail(`${path}.formula references unknown id "${item.formula}".`);
      if (seen.has(item.formula))
        fail(`breakdown.items repeats ${item.formula}.`);
      seen.add(item.formula);
      optionalText(item.label, `${path}.label`, 200);
      color(item.color, `${path}.color`);
    });
  }

  if (data.presets !== undefined) {
    const presets = list(data.presets, "presets", LIMITS.presets, 1);
    const byId = new Map(inputs.map((input) => [input.id, input]));
    presets.forEach((preset, index) => {
      const path = `presets[${index}]`;
      label(preset.label, `${path}.label`);
      if (!isObject(preset.values) || !Object.keys(preset.values).length)
        fail(`${path}.values must be an object with at least one input value.`);
      for (const [id, value] of Object.entries(preset.values)) {
        const input = byId.get(id);
        if (!input) fail(`${path}.values.${id} does not match an input id.`);
        presetValue(input, value, `${path}.values.${id}`);
      }
    });
  }

  if (data.ranking !== undefined) validateRanking(data.ranking, known);
  return data;
}
