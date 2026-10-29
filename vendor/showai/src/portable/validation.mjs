import {freezeOwnedJSON,isOwnedJSON,captureOwnedJSON,capturedContentSummary,shareCapturedJSON} from "./owned-json.mjs";
import {shareNativeSource} from "../surface/native-source-delta.mjs";
import { validateInkArchiveGroup } from "../surface/ink-archive-group.mjs";
import { isResource } from "../surface/containers.mjs";
import { validatePageIcon } from "../lib/page-icon.mjs";
import { parsePageLink } from "./page-link.mjs";
import { artifactVersion, assignSurfaceIds } from "../surface/document.mjs";
import { validateSurface } from "../surface/validation.mjs";
import {
  MAX_STEPS,
  validatePrimitiveData,
} from "../components/blocks/primitive-contract.mjs";
import { validateMindmapData } from "../components/blocks/mindmap-contract.mjs";
import { validateFlowchartData } from "../components/blocks/flowchart-contract.mjs";
import {
  validateDiagramData,
  diagramTemplates,
} from "../components/blocks/diagrams/contract.mjs";
import { validateG2Data } from "../components/blocks/g2/contract.mjs";
import { validateWalkthroughData } from "../components/blocks/walkthrough-contract.mjs";
import { validateAnalysisData } from "../components/blocks/analysis-contract.mjs";
import { validateScene3dData } from "../components/blocks/scene3d-contract.mjs";
import { validateDocDiagramData } from "../components/blocks/doc-diagrams-contract.mjs";
import { validateDocReferenceData } from "../components/blocks/doc-reference-contract.mjs";
import { validateDocBrowseData } from "../components/blocks/doc-browse-contract.mjs";
import { validatePlanData } from "../components/blocks/plan-contract.mjs";
import { validateEventTimelineData } from "../components/blocks/event-timeline-contract.mjs";
import { validatePlaygroundData } from "../components/blocks/playground-contract.mjs";
import { validateDatabaseData } from "../components/blocks/database-contract.mjs";
import { validateResearchData } from "../components/blocks/research-contract.mjs";
// Kept local so readers do not carry the binding engine; stores check bindings fully.
const BINDING_KEY = "$binding";
import {
  NOTE_MAX,
  invalidNoteMark,
} from "../components/blocks/note-markup.mjs";
// Shared by the browser importer and the dependency-free artifact command.
import { validateRemoteComponents } from "./remote.mjs";
import {
  CAPACITY,
  assertBytes,
  assertContent,
  assertContentSizes,
  CapacityError,
  assertCompiledComponent,
  utf8Bytes,
  measureContent,
  contentMeasurementDepth,
  nonResourceReplacementDoesNotGrow,
} from "./capacity.mjs";
// Compatibility export for artifact importers; never a page or resource limit.
export const MAX_ARTIFACT_BYTES = CAPACITY.artifactBytes;
export const ARTIFACT_DATA_ID = "showai-data";
const MAX_NODES = 12000;
const MAX_DEPTH = 48;
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const nodeTypes = new Set([
  "doc",
  "surface",
  "drawing",
  "region",
  "richText",
  "paragraph",
  "text",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "hardBreak",
  "mathInline",
  "mathBlock",
  "horizontalRule",
  "image",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "callout",
  "toggle",
  "stepper",
  "step",
  "widget",
]);
const markTypes = new Set([
  "bold",
  "italic",
  "strike",
  "code",
  "underline",
  "link",
  "highlight",
  "textStyle",
  "annotation",
]);
const nodeAttributes = new Set([
  "id",
  "level",
  "textAlign",
  "align",
  "type",
  "start",
  "checked",
  "language",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "colspan",
  "rowspan",
  "colwidth",
  "backgroundColor",
  "open",
  "summary",
  "icon",
  "tone",
  "kind",
  "data",
  "canvas",
  "name",
  "frameless",
  "latex",
  "display",
  "componentStyle",
  "caption",
  "fit",
  "nativeInk",
]);
const markAttributes = new Set([
  "href",
  "title",
  "target",
  "rel",
  "class",
  "color",
  "backgroundColor",
  "fontFamily",
  "fontSize",
  "mode",
  "note",
]);

function object(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  return value;
}

function string(value, path, limit = 1000000) {
  if (typeof value !== "string" || value.length > limit)
    throw new Error(`${path} must be text, at most ${limit} characters.`);
  return value;
}

export function isSafeUrl(value, image = false) {
  if (typeof value !== "string") return false;
  if (
    image &&
    /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(value)
  )
    return true;
  if (!image && (value.startsWith("#") || parsePageLink(value))) return true;
  if (/^[\u0000-\u0020]|[\u0000-\u001f]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (
      image ? ["http:", "https:"] : ["http:", "https:", "mailto:", "tel:"]
    ).includes(parsed.protocol);
  } catch {
    return false;
  }
}

// A successful JSON check is context-independent except for the containing
// depth. Only this module's successful check of an actual exclusive capture
// can populate this weak cache; recursive freeze/caller flags never grant it.
// Schema, model, capacity and cross-node validation still run on every body.
const validatedCapturedJSON = new WeakSet();
function validateJson(value, path, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error(`${path} is nested too deeply.`);
  if (value && typeof value === "object" && validatedCapturedJSON.has(value)) {
    const summary = capturedContentSummary(value);
    if (summary && depth + summary.maximumDepth <= MAX_DEPTH) return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(`${path} must be a finite number.`);
    return;
  }
  if (typeof value === "string") {
    string(value, path, CAPACITY.authoringRequestBytes);
    return;
  }
  if (Array.isArray(value)) {
    // Model nodes have their own shared total counter below. Geometry samples,
    // pressure knots and forward-compatible JSON data are not document nodes;
    // their real bytes/depth and typed schema budgets still apply in full.
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) throw new Error(`${path} must contain dense JSON arrays.`);
      validateJson(value[i], `${path}[${i}]`, depth + 1);
    }
    if (capturedContentSummary(value)) validatedCapturedJSON.add(value);
    return;
  }
  object(value, path);
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error(`${path} must contain plain JSON objects.`);
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKeys.has(key))
      throw new Error(`${path} contains a reserved key.`);
    validateJson(item, `${path}.${key}`, depth + 1);
  }
  if (capturedContentSummary(value)) validatedCapturedJSON.add(value);
}

function validateAttrs(attrs, path, permitted, surfaceIcon = false) {
  object(attrs, path);
  for (const [key, value] of Object.entries(attrs)) {
    if (!permitted.has(key))
      throw new Error(`Unsupported attribute ${path}.${key}.`);
    if (value === null || value === undefined) continue;
    if (key === "href" && !isSafeUrl(value))
      throw new Error(`${path}.href must be a safe web, email, anchor or ShowAI page URL.`);
    if (key === "src" && value !== "" && !isSafeUrl(value, true))
      throw new Error(
        `${path}.src must be a web URL or embedded raster image.`,
      );
    if (
      ["textAlign", "align"].includes(key) &&
      !["left", "center", "right", "justify"].includes(value)
    )
      throw new Error(`${path}.${key} is not supported.`);
    if (key === "level" && ![1, 2, 3, 4, 5, 6].includes(value))
      throw new Error(`${path}.level must be 1 through 6.`);
    if (key === "type" && !["1", "a", "A", "i", "I"].includes(value))
      throw new Error(`${path}.type must be an ordered-list marker style.`);
    if (["open", "checked"].includes(key) && typeof value !== "boolean")
      throw new Error(`${path}.${key} must be true or false.`);
    if (
      ["colspan", "rowspan", "start"].includes(key) &&
      (!Number.isInteger(value) || value < 1 || value > 10000)
    )
      throw new Error(`${path}.${key} must be a positive integer.`);
    if (
      [
        "id",
        "language",
        "alt",
        "title",
        "summary",
        "icon",
        "tone",
        "kind",
        "target",
        "rel",
        "class",
      ].includes(key)
    )
      string(
        value,
        `${path}.${key}`,
        key === "icon" && surfaceIcon ? 1_000_000 : 10000,
      );
    if (
      ["width", "height"].includes(key) &&
      !(
        typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0 &&
        value <= 10000
      ) &&
      !(typeof value === "string" && /^\d{1,5}(?:px|%)?$/.test(value))
    )
      throw new Error(`${path}.${key} must be a positive image dimension.`);
    if (
      key === "colwidth" &&
      (!Array.isArray(value) ||
        value.length > 100 ||
        !value.every(
          (width) => Number.isInteger(width) && width >= 0 && width <= 10000,
        ))
    )
      throw new Error(
        `${path}.colwidth must contain non-negative column widths.`,
      );
    if (
      ["color", "backgroundColor"].includes(key) &&
      (typeof value !== "string" ||
        !/^(?:#[a-f\d]{3,8}|[a-z]{1,24}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i.test(
          value,
        ))
    )
      throw new Error(`${path}.${key} must be a CSS color.`);
  }
}

function validateWidgetData(kind, data, path) {
  if (Object.hasOwn(data, BINDING_KEY)) {
    // The block stores a dataset binding and its own values; the component
    // props are resolved from the dataset and checked where they are rendered.
    const binding = data[BINDING_KEY];
    object(binding, `${path}.${BINDING_KEY}`);
    string(binding.dataset, `${path}.${BINDING_KEY}.dataset`, 128);
    if (kind === "custom") {
      object(data.props, `${path}.props`);
      assertContent(
        data.props,
        "Component instance data",
        CAPACITY.componentPropsBytes,
      );
    }
    if (data[BINDING_KEY].props) return;
    const { [BINDING_KEY]: _binding, ...local } = data;
    data = local;
  }
  if (Object.hasOwn(diagramTemplates, kind)) {
    validateDiagramData(kind, data);
    return;
  }
  if (kind === "step-walkthrough") {
    validateWalkthroughData(data);
    return;
  }
  if (
    ["comparison-matrix", "status-tree", "experiment-tracker"].includes(kind)
  ) {
    validateAnalysisData(kind, data);
    return;
  }
  if (kind === "custom")
    assertContent(
      data.props,
      "Component instance data",
      CAPACITY.componentPropsBytes,
    );
  if (["video", "audio", "pdf", "references"].includes(kind)) {
    validateResearchData(kind, data);
    return;
  }
  if (kind.startsWith("g2-")) {
    validateG2Data(data);
    return;
  }
  if (kind === "mindmap") {
    validateMindmapData(data);
    return;
  }
  if (kind === "flowchart") {
    validateFlowchartData(data);
    return;
  }
  if (kind === "scene-3d") {
    validateScene3dData(data);
    return;
  }
  if (kind === "sequence-diagram" || kind === "layer-diagram") {
    validateDocDiagramData(kind, data);
    return;
  }
  if (kind === "step-guide" || kind === "command-reference") {
    validateDocReferenceData(kind, data);
    return;
  }
  if (kind === "structure-browser" || kind === "card-grid") {
    validateDocBrowseData(kind, data);
    return;
  }
  if (kind === "roadmap" || kind === "waterfall") {
    validatePlanData(kind, data);
    return;
  }
  if (kind === "event-timeline") {
    validateEventTimelineData(data);
    return;
  }
  if (kind === "playground") {
    validatePlaygroundData(data);
    return;
  }
  if (kind === "database") {
    validateDatabaseData(data);
    return;
  }
  if (
    [
      "text",
      "image",
      "table",
      "callout",
      "toggle",
      "stepper",
      "divider",
      "code",
    ].includes(kind)
  ) {
    validatePrimitiveData(kind, data);
    if ((kind === "text" && typeof data.content === "object") || data.document)
      validateNode(data.document ?? data.content, `${path}.content`, {
        count: 0,
        surface: false,
        resource: false,
      });
    if (kind === "image" && data.src && !isSafeUrl(data.src, true))
      throw new Error(`${path}.src must be a safe raster image URL.`);
    return;
  }
  if (
    ![
      "chart",
      "database",
      "metrics",
      "playground",
      "gallery",
      "bookmark",
    ].includes(kind)
  )
    return;
  const list = (key, limit) => {
    if (data[key] === undefined) return [];
    if (!Array.isArray(data[key]) || data[key].length > limit)
      throw new Error(
        `${path}.${key} must be an array of at most ${limit} items.`,
      );
    return data[key];
  };
  const label = (value, name) => {
    if (value !== undefined) string(value, `${path}.${name}`, 10000);
  };
  const rows = (items, requireId = false) => {
    const ids = new Set();
    for (const [i, item] of items.entries()) {
      object(item, `${path}[${i}]`);
      if (requireId) {
        string(item.id, `${path}[${i}].id`, 200);
        if (!item.id || ids.has(item.id) || forbiddenKeys.has(item.id))
          throw new Error(`${path} requires unique, non-reserved IDs.`);
        ids.add(item.id);
      }
    }
    return items;
  };
  label(data.title, "title");
  label(data.description, "description");
  if (kind === "chart") {
    const labels = list("labels", 500),
      series = rows(list("series", 20));
    for (const value of labels) string(value, `${path}.labels`, 1000);
    if (data.type !== undefined && !["line", "bar"].includes(data.type))
      throw new Error(`${path}.type must be line or bar.`);
    for (const item of series) {
      string(item.name, `${path}.series.name`, 1000);
      if (
        !Array.isArray(item.values) ||
        item.values.length !== labels.length ||
        !item.values.every(
          (value) => typeof value === "number" && Number.isFinite(value),
        )
      )
        throw new Error(
          `${path}.series values must be finite numbers matching labels.`,
        );
      if (
        item.color !== undefined &&
        (typeof item.color !== "string" ||
          !/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(
            item.color,
          ))
      )
        throw new Error(`${path}.series color must be a hex color.`);
    }
    label(data.unit, "unit");
  }
  if (kind === "metrics")
    for (const item of rows(list("items", 100))) {
      string(item.label, `${path}.item.label`, 1000);
      if (!["string", "number"].includes(typeof item.value))
        throw new Error(`${path}.item.value must be text or a number.`);
      label(item.unit, "item.unit");
      label(item.detail, "item.detail");
      if (
        item.trend !== undefined &&
        (typeof item.trend !== "number" || !Number.isFinite(item.trend))
      )
        throw new Error(`${path}.item.trend must be a finite number.`);
    }
  if (kind === "gallery") {
    if (data.columns !== undefined && ![1, 2, 3].includes(data.columns))
      throw new Error(`${path}.columns must be 1, 2, or 3.`);
    for (const item of rows(list("images", 100), true)) {
      if (item.src !== "" && !isSafeUrl(item.src, true))
        throw new Error(`${path}.image.src must be a safe raster image URL.`);
      label(item.alt, "image.alt");
      label(item.caption, "image.caption");
    }
  }
  if (kind === "bookmark") {
    if (data.url !== undefined && data.url !== "" && !isSafeUrl(data.url))
      throw new Error(`${path}.url must be a safe URL.`);
    if (
      data.image !== undefined &&
      data.image !== "" &&
      !isSafeUrl(data.image, true)
    )
      throw new Error(`${path}.image must be a safe raster image URL.`);
  }
}

function validateNode(value, path, counter, depth = 0, parentType = null) {
  if (++counter.count > MAX_NODES)
    throw new Error(`Document exceeds ${MAX_NODES} nodes.`);
  if (depth > MAX_DEPTH) throw new Error("Document is nested too deeply.");
  const node = object(value, path);
  // Component validators are intentionally opaque here. Never infer an output
  // capacity bound across component/data-binding normalization.
  if (node.type === "widget") counter.capacityMayGrow = true;
  if (
    !counter.resource &&
    node.type === "surface" &&
    node.attrs &&
    Object.keys(node.attrs).length
  )
    throw new Error(
      "Whiteboard root metadata belongs on the page, not the content node.",
    );
  if (
    node.attrs?.name !== undefined &&
    (typeof node.attrs.name !== "string" || node.attrs.name.length > 200)
  )
    throw new Error("Content names must contain at most 200 characters.");
  if (!counter.resource && node.type === "surface" && depth !== 0)
    throw new Error("A whiteboard root cannot be nested.");
  if (
    node.type === "region" &&
    (!["surface", "region"].includes(parentType) || !counter.surface)
  )
    throw new Error(`${node.type} requires a whiteboard or region parent.`);
  if (counter.surface && node.attrs?.canvas != null)
    throw new Error("Whiteboard layout must be stored outside content.");
  if (!nodeTypes.has(node.type))
    throw new Error(`Unsupported block type at ${path}: ${String(node.type)}.`);
  for (const key of Object.keys(node))
    if (!["type", "attrs", "content", "marks", "text"].includes(key))
      throw new Error(`Unsupported node field ${path}.${key}.`);
  if (node.type === "text") {
    string(node.text, `${path}.text`);
    if (!node.text.length) throw new Error(`${path}.text cannot be empty.`);
  } else if (node.text !== undefined)
    throw new Error(`Only text nodes can have a text field: ${path}.`);
  if (node.attrs !== undefined)
    validateAttrs(
      node.attrs,
      `${path}.attrs`,
      node.type === "drawing"
        ? new Set([
            "id",
            "name",
            "tool",
            "color",
            "fillColor",
            "strokeWidth",
            "pressure",
            "extent",
            "points",
            "bindings",
            "ink",
            "inkFragments",
            "inkInput",
            "label",
            "labelSize",
          ])
        : node.type === "surface"
          ? new Set([...nodeAttributes, "widthMode", "inkState", "outline"])
          : node.type === "region"
            ? new Set([...nodeAttributes, "inkArchiveGroup"])
            : nodeAttributes,
      node.type === "surface",
    );
  validateInkArchiveGroup(node);
  if (
    node.attrs?.frameless !== undefined &&
    (node.type !== "surface" ||
      node.attrs.kind !== "page" ||
      typeof node.attrs.frameless !== "boolean")
  )
    throw new Error(`${path}.attrs.frameless requires a Page and a boolean.`);
  if (node.type === "surface" && node.attrs?.icon !== undefined)
    validatePageIcon(node.attrs.icon, `${path}.attrs.icon`);
  if (node.attrs?.canvas != null) {
    if (depth !== 1 || node.type !== "callout")
      throw new Error(
        `${path}.attrs.canvas is only supported on top-level callouts.`,
      );
    string(node.attrs.id, `${path}.attrs.id`, 200);
    if (!node.attrs.id.trim())
      throw new Error(`${path} needs a stable canvas id.`);
    const position = object(node.attrs.canvas, `${path}.attrs.canvas`);
    if (Object.keys(position).some((key) => !["x", "y", "width"].includes(key)))
      throw new Error(`${path}.attrs.canvas contains an unsupported field.`);
    for (const key of ["x", "y"])
      if (
        typeof position[key] !== "number" ||
        !Number.isFinite(position[key]) ||
        Math.abs(position[key]) > 1000000
      )
        throw new Error(
          `${path}.attrs.canvas.${key} must be finite and within ±1000000.`,
        );
    if (
      typeof position.width !== "number" ||
      !Number.isFinite(position.width) ||
      position.width < 240 ||
      position.width > 1600
    )
      throw new Error(
        `${path}.attrs.canvas.width must be between 240 and 1600.`,
      );
  }
  if (
    node.type === "image" &&
    node.attrs?.src !== "" &&
    !isSafeUrl(node.attrs?.src, true)
  )
    throw new Error(`${path} requires a safe image src.`);
  if (node.type === "image")
    validatePrimitiveData(
      "image",
      Object.fromEntries(
        Object.entries({ ...node.attrs.componentStyle, ...node.attrs }).filter(
          ([key, value]) => value != null && !["width", "height"].includes(key),
        ),
      ),
    );
  if (node.attrs?.nativeInk != null && node.type !== "image")
    throw new Error(`${path}.nativeInk requires an image node.`);
  if (node.attrs?.componentStyle) {
    object(node.attrs.componentStyle, `${path}.componentStyle`);
    validatePrimitiveData("divider", node.attrs.componentStyle);
  }
  if (node.type === "richText")
    validatePrimitiveData("text", {
      ...node.attrs?.data,
      content: { type: "doc", content: node.content ?? [] },
      format: "richtext",
    });
  if (node.type === "widget") {
    string(node.attrs?.kind, `${path}.attrs.kind`, 80);
    if (!/^[a-z][a-z0-9-]*$/.test(node.attrs.kind))
      throw new Error(
        "Widget kind must use lowercase letters, numbers, and hyphens.",
      );
    object(node.attrs?.data, `${path}.attrs.data`);
    validateWidgetData(node.attrs.kind, node.attrs.data, `${path}.attrs.data`);
  }
  if (node.marks !== undefined) {
    if (!["text", "hardBreak"].includes(node.type))
      throw new Error(`${path} cannot have inline marks.`);
    if (!Array.isArray(node.marks))
      throw new Error(`${path}.marks must be an array.`);
    for (const [i, mark] of node.marks.entries()) {
      object(mark, `${path}.marks[${i}]`);
      for (const key of Object.keys(mark))
        if (!["type", "attrs"].includes(key))
          throw new Error(`Unsupported mark field: ${key}.`);
      if (!markTypes.has(mark.type))
        throw new Error(`Unsupported text mark: ${String(mark.type)}.`);
      if (mark.attrs !== undefined)
        validateAttrs(mark.attrs, `${path}.marks[${i}].attrs`, markAttributes);
      if (
        mark.attrs?.mode != null &&
        (mark.type !== "highlight" ||
          !["lower", "full"].includes(mark.attrs.mode))
      )
        throw new Error("Highlight mode must be lower or full.");
      if (mark.type === "link" && !isSafeUrl(mark.attrs?.href))
        throw new Error("Links require a safe href.");
      if (invalidNoteMark(mark))
        throw new Error(
          `Annotations require a note of 1–${NOTE_MAX} characters.`,
        );
    }
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content))
      throw new Error(`${path}.content must be an array.`);
    if (
      [
        "text",
        "image",
        "widget",
        "drawing",
        "hardBreak",
        "horizontalRule",
      ].includes(node.type)
    )
      throw new Error(`${path} cannot contain child blocks.`);
    node.content.forEach((child, i) =>
      validateNode(
        child,
        `${path}.content[${i}]`,
        counter,
        depth + 1,
        node.type,
      ),
    );
  }
  const children = node.content ?? [];
  const blockTypes = [
    "richText",
    "paragraph",
    "heading",
    "mathBlock",
    "blockquote",
    "bulletList",
    "orderedList",
    "taskList",
    "codeBlock",
    "horizontalRule",
    "image",
    "table",
    "callout",
    "toggle",
    "stepper",
    "widget",
  ];
  const allowed = {
    doc: blockTypes,
    surface: [
      ...blockTypes,
      "region",
      "richText",
      ...(counter.resource ? ["surface", "drawing"] : []),
    ],
    region: [
      ...blockTypes,
      "region",
      "richText",
      ...(counter.resource ? ["surface", "drawing"] : []),
    ],
    richText: blockTypes,
    paragraph: ["text", "hardBreak", "mathInline"],
    heading: ["text", "hardBreak", "mathInline"],
    codeBlock: ["text"],
    blockquote: blockTypes,
    callout: blockTypes,
    toggle: blockTypes,
    stepper: ["step"],
    step: blockTypes,
    bulletList: ["listItem"],
    orderedList: ["listItem"],
    listItem: blockTypes,
    taskList: ["taskItem"],
    taskItem: blockTypes,
    table: ["tableRow"],
    tableRow: ["tableCell", "tableHeader"],
    tableCell: blockTypes,
    tableHeader: blockTypes,
  }[node.type];
  if (allowed && children.some((child) => !allowed.includes(child.type)))
    throw new Error(`${path} contains an invalid child block.`);
  if (node.type === "stepper" && children.length > MAX_STEPS)
    throw new Error(`${path} must contain at most ${MAX_STEPS} steps.`);
  if (
    [
      "blockquote",
      "callout",
      "toggle",
      "stepper",
      "step",
      "bulletList",
      "orderedList",
      "listItem",
      "taskList",
      "taskItem",
      "table",
      "tableRow",
      "tableCell",
      "tableHeader",
    ].includes(node.type) &&
    !children.length
  )
    throw new Error(`${path} must contain at least one child block.`);
  if (
    ["listItem", "taskItem"].includes(node.type) &&
    children[0]?.type !== "paragraph"
  )
    throw new Error(`${path} must start with a paragraph.`);
  if (
    node.type === "codeBlock" &&
    children.some((child) => child.marks?.length)
  )
    throw new Error(`${path} cannot contain formatted code.`);
}

/** The same timestamp rule is used for full documents and the source owner's
 * sole-field storage acknowledgment proof. This does not validate a document. */
export function isDocumentTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

// Canonicalization copies these maps, adds IDs/frames and updates view arrays.
// Preserve their real preimages before consuming validation may fill them.
function capacityPreimage(document) {
  const plain = value => value && typeof value === "object" && !Array.isArray(value);
  const view = value => plain(value) ? {...value, ...(Object.hasOwn(value, "readingOrder") && Array.isArray(value.readingOrder) ? {readingOrder: [...value.readingOrder]} : {})} : value;
  return {...document,
    ...(Object.hasOwn(document, "layout") && plain(document.layout) ? {layout: {...document.layout}} : {}),
    ...(Object.hasOwn(document, "views") && plain(document.views) ? {views: view(document.views)} : {}),
    ...(Object.hasOwn(document, "surfaceViews") && plain(document.surfaceViews) ? {surfaceViews: Object.fromEntries(Object.entries(document.surfaceViews).map(([id, value]) => [id, view(value)]))} : {}),
  };
}
// A subset retaining the same leaves can only remove syntax/resources. This
// never subtracts individual data URLs from their global deduplicated total.
function shrinkingProjection(before, after) {
  if (before === after) return true;
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) !== Array.isArray(after)) return false;
  if (Array.isArray(after)) return after.length <= before.length && after.every((value, index) => shrinkingProjection(before[index], value));
  return Object.keys(after).every(key => Object.hasOwn(before, key) && shrinkingProjection(before[key], after[key]));
}
const documentCapacity = new WeakMap();
function canonicalCapacity(before, after, sizes, opaque) {
  const added = {};
  let scan = opaque;
  for (const [key, value] of Object.entries(after)) {
    if (!Object.hasOwn(before, key)) Object.defineProperty(added, key, {value, enumerable: true});
    else if (!shrinkingProjection(before[key], value)) scan = true;
  }
  const addition = measureContent(added);
  // New resources can coincide with URLs elsewhere, so only the full official
  // measure can decide that case. Structural fills also take this fallback.
  if (addition.resourceCount) scan = true;
  const overhead = count => 2 + Math.max(0, count - 1);
  const addedCount = Object.keys(added).length, beforeCount = Object.keys(before).length, afterCount = Object.keys(after).length;
  const payload = addition.structureBytes - overhead(addedCount);
  const separators = overhead(afterCount) - overhead(beforeCount);
  const prettyOverhead = count => overhead(count) + (count ? 4 * count + 1 : 0);
  const upper = {...sizes, structureBytes: sizes.structureBytes + payload + separators, jsonBytes: sizes.jsonBytes + payload + separators,
    prettyJsonBytes: sizes.prettyJsonBytes + addition.prettyJsonBytes - prettyOverhead(addedCount) + prettyOverhead(afterCount) - prettyOverhead(beforeCount)};
  let result,maximumDepth=Math.max(contentMeasurementDepth(sizes) ?? 64,contentMeasurementDepth(addition) ?? 64);
  if (scan) {result = assertContent(after);maximumDepth=contentMeasurementDepth(result);}
  else {
    try { result = assertContentSizes(upper); }
    catch (error) { if (!(error instanceof CapacityError)) throw error; result = assertContent(after);maximumDepth=contentMeasurementDepth(result); }
  }
  documentCapacity.set(after, {before: sizes, upper: result, maximumDepth});
}

export function validateDocument(value) {
  return validateDocumentValue(value, true);
}

function validationStage(observer, name, operation) {
  if (!observer) return operation();
  const now = () => globalThis.performance?.now?.() ?? Date.now(), start = now();
  try { return operation(); } finally { observer(name, now() - start); }
}
function validateDocumentValue(value, independent, observer, inputCapacity) {
  validationStage(observer, "json", () => validateJson(value, "document"));
  const sizes = validationStage(observer, "capacity", () => inputCapacity?.document === value
    ? assertContentSizes(inputCapacity.sizes) : assertContent(value));
  const source = object(value, "document");
  const document = independent ? structuredClone(source) : capacityPreimage(source);
  const capacityBefore = validationStage(observer, "capacityPreimage", () => capacityPreimage(document));
  let templateContext;
  if (document.templateContext !== undefined) {
    const context = object(
      document.templateContext,
      "document.templateContext",
    );
    if (
      context.format !== 1 ||
      !Array.isArray(context.templates) ||
      context.templates.length > 8
    )
      throw new Error("Invalid page template context.");
    const reference = (value) => {
      const ref = object(value, "Template reference");
      if (
        ref.kind !== "template" ||
        typeof ref.id !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(ref.id) ||
        typeof ref.version !== "string" ||
        !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(ref.version) ||
        !/^sha256-[a-f0-9]{64}$/.test(ref.integrity) ||
        (ref.scope !== undefined &&
          !["builtin", "project", "global", "published"].includes(ref.scope))
      )
        throw new Error(
          "Page template references require exact id/version/integrity.",
        );
      return {
        kind: "template",
        id: ref.id,
        version: ref.version,
        integrity: ref.integrity,
        ...(ref.scope ? { scope: ref.scope } : {}),
      };
    };
    const system = reference(context.system),
      templates = context.templates.map(reference);
    if (
      system.id !== "system-presentation" ||
      system.scope !== "builtin" ||
      new Set(templates.map((ref) => ref.id)).size !== templates.length
    )
      throw new Error(
        "Page template context requires the builtin system baseline and distinct templates.",
      );
    templateContext = { format: 1, system, templates };
  }
  string(document.id, "document.id", 200);
  string(document.title, "document.title", 1000);
  if (!document.id) throw new Error("Document id is required.");
  if (!["doc", "surface"].includes(document.content?.type))
    throw new Error("Page content must be a doc or surface node.");
  const surface = document.content.type === "surface";
  const resource = isResource(document);
  if (surface) validationStage(observer, "surfaceIds", () => assignSurfaceIds(document));
  else if (
    document.layout !== undefined ||
    document.views !== undefined ||
    document.surfaceViews !== undefined
  )
    throw new Error("Layout and views require a surface root.");
  const validation = {count: 0, surface, resource, capacityMayGrow: false};
  validationStage(observer, "nodes", () => validateNode(document.content, "document.content", validation));
  if (surface) validationStage(observer, "surface", () => validateSurface(document));
  const canvasIds = new Set(
    (document.content.content ?? [])
      .filter((node) => node.attrs?.canvas != null)
      .map((node) => node.attrs.id),
  );
  if (canvasIds.size) {
    const seen = new Set();
    const checkCanvasIds = (node) => {
      const id = node.attrs?.id;
      if (canvasIds.has(id)) {
        if (seen.has(id)) throw new Error(`Duplicate canvas id: ${id}.`);
        seen.add(id);
      }
      node.content?.forEach(checkCanvasIds);
    };
    checkCanvasIds(document.content);
  }
  const now = new Date().toISOString();
  for (const key of ["createdAt", "updatedAt"])
    if (
      document[key] !== undefined &&
      !isDocumentTimestamp(document[key])
    )
      throw new Error(`document.${key} must be an ISO date string.`);
  if (document.parentId != null)
    string(document.parentId, "document.parentId", 200);
  for (const key of ["favorite", "archived"])
    if (document[key] !== undefined && typeof document[key] !== "boolean")
      throw new Error(`document.${key} must be true or false.`);
  if (document.comments !== undefined && !Array.isArray(document.comments))
    throw new Error("document.comments must be an array.");
  const comments = (document.comments ?? []).map((comment, i) => {
    object(comment, `comments[${i}]`);
    string(comment.id, "comment.id", 200);
    string(comment.text, "comment.text", 10000);
    if (
      typeof comment.createdAt !== "string" ||
      !Number.isFinite(Date.parse(comment.createdAt))
    )
      throw new Error("comment.createdAt must be an ISO date string.");
    if (typeof comment.resolved !== "boolean")
      throw new Error("comment.resolved must be true or false.");
    return {
      ...comment,
      id: comment.id,
      text: comment.text,
      createdAt: comment.createdAt,
      resolved: comment.resolved,
    };
  });
  const canonical = {
    // Full JSON has already passed validation. Preserve forward-compatible
    // fields while the explicitly validated known fields retain authority.
    ...document,
    id: document.id,
    title: document.title,
    icon:
      document.icon === undefined
        ? "✦"
        : validatePageIcon(document.icon, "document.icon"),
    cover:
      document.cover === undefined
        ? "none"
        : string(document.cover, "document.cover", 2000),
    parentId: document.parentId ?? null,
    favorite: document.favorite ?? false,
    archived: document.archived ?? false,
    createdAt: document.createdAt ?? now,
    updatedAt: document.updatedAt ?? now,
    // `document` is already this call's private clone.
    content: document.content,
    ...(resource
      ? { layout: document.layout, surfaceViews: document.surfaceViews }
      : surface
        ? { layout: document.layout, views: document.views }
        : {}),
    comments,
    ...(templateContext ? { templateContext } : {}),
  };
  validationStage(observer, "canonicalCapacity", () => canonicalCapacity(capacityBefore, canonical, sizes, validation.capacityMayGrow));
  return canonical;
}

function validateComponents(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 100)
    throw new Error("components must be an array of at most 100 packages.");
  validateJson(input, "components");
  assertBytes(
    "Embedded components JSON",
    measureContent(input).jsonBytes,
    CAPACITY.artifactBytes,
  );
  const seen = new Set();
  return input.map((item, i) => {
    object(item, `components[${i}]`);
    string(item.id, "component.id", 80);
    string(item.name, "component.name", 200);
    string(item.version, "component.version", 80);
    string(item.html, "component.html", CAPACITY.authoringRequestBytes);
    string(item.integrity, "component.integrity", 200);
    if (
      !/^[a-z][a-z0-9-]*$/.test(item.id) ||
      !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(item.version)
    )
      throw new Error("Invalid component identity.");
    const key = `${item.id}@${item.version}#${item.integrity}`;
    if (seen.has(key)) throw new Error(`Duplicate embedded component: ${key}`);
    seen.add(key);
    if (typeof item.schema !== "boolean")
      object(item.schema, "component.schema");
    if (item.inline !== undefined) {
      object(item.inline, "component.inline");
      string(
        item.inline.script,
        "component.inline.script",
        CAPACITY.authoringRequestBytes,
      );
      string(
        item.inline.styles,
        "component.inline.styles",
        CAPACITY.authoringRequestBytes,
      );
    }
    assertCompiledComponent(item);
    return structuredClone(item);
  });
}

function validateSelection(selection, document) {
  object(selection, "selection");
  const ids = new Set();
  const visit = (node) => {
    if (node.attrs?.id && !["doc", "text"].includes(node.type))
      ids.add(node.attrs.id);
    node.content?.forEach(visit);
  };
  visit(document.content);
  const blocks = selection.blockIds;
  if (
    !Array.isArray(blocks) ||
    !blocks.length ||
    blocks.some((id) => typeof id !== "string" || !ids.has(id)) ||
    new Set(blocks).size !== blocks.length
  )
    throw new Error(
      "Artifact selection must reference unique existing block ids.",
    );
  if (selection.chrome !== undefined && selection.chrome !== "none")
    throw new Error('Artifact selection chrome must be "none".');
  return {
    blockIds: [...blocks],
    ...(selection.chrome ? { chrome: selection.chrome } : {}),
  };
}

const ownedDocumentCapacity = new WeakMap();
/** Read-only internal diagnostic; never grants a receipt to a caller object. */
export const hasSourceSnapshotCapacity = (body) =>
  isOwnedJSON(body) && ownedDocumentCapacity.has(body);
function rememberOwnedCapacity(document, sizes, maximumDepth) {
  if (!isOwnedJSON(document))
    throw new Error(
      "Capacity receipt requires an actual recursively owned body.",
    );
  ownedDocumentCapacity.set(
    document,
    Object.freeze({ sizes: Object.freeze({ ...sizes }), maximumDepth }),
  );
}
function captureOwnedArtifact(artifact) {
  const proof = documentCapacity.get(artifact.document);
  if (!proof)
    throw new Error("Canonical document capacity receipt is missing.");
  const document = captureOwnedJSON(artifact.document);
  rememberOwnedCapacity(document, proof.upper, proof.maximumDepth);
  return { ...artifact, document };
}
/** Internal source factory. Public parseArtifact keeps its mutable independent
 * capture semantics; only this synchronous validation+ownership step mints proof. */
export function parseArtifactForSourceSnapshot(input) {
  return parseArtifactConsumingForSourceSnapshot(input);
}
export function parseArtifactConsumingForSourceSnapshot(input, observer) {
  // This closed synchronous factory owns the actual normalization graph. One
  // real document traversal supplies both its page gate and the enclosing
  // artifact byte gate; wrapper fields retain their own complete traversal.
  // Capture before any measurement or observer can run. Neither a wrapper
  // accessor nor a reentrant observer can mutate the measured private graph.
  const captured = typeof input === "string" ? input : captureOwnedJSON(input);
  const measured = validationStage(observer, "input.capacity", () =>
    measureSourceArtifactInput(captured),
  );
  return captureOwnedArtifact(
    parseArtifactDocument(
      captured,
      (value) => validateDocumentValue(value, false, observer, measured),
      undefined,
      measured,
    ),
  );
}
/** Source owner only: exact COW sharing preserves the complete canonical target,
 * then actual recursive ownership seals the mixed graph before it escapes. */
export function shareSourceSnapshotDocument(base, canonical) {
  const receipt = ownedDocumentCapacity.get(canonical);
  if (receipt && (!isOwnedJSON(base) || !isOwnedJSON(canonical)))
    throw new Error("Source capacity sharing requires actual owned graphs.");
  const result = capturedContentSummary(base)&&capturedContentSummary(canonical)
    ? shareCapturedJSON(base,canonical) : shareNativeSource(base, canonical);
  if (!receipt) return result;
  const held = captureOwnedJSON(result);
  rememberOwnedCapacity(held, receipt.sizes, receipt.maximumDepth);
  return held;
}
/** Existing actual timestamp-only COW rule, with a quantified conservative
 * receipt. A caller's field list or shallow freeze cannot mint this proof. */
export function inheritSourceSnapshotTimestampCapacity(base, body) {
  const receipt = ownedDocumentCapacity.get(base);
  if (
    !receipt ||
    !isOwnedJSON(base) ||
    !isOwnedJSON(body) ||
    !Object.hasOwn(base, "updatedAt") ||
    !isDocumentTimestamp(base.updatedAt) ||
    !isDocumentTimestamp(body.updatedAt)
  )
    return false;
  const keys = Object.keys(base);
  if (
    keys.length !== Object.keys(body).length ||
    !keys.every(
      (key) =>
        Object.hasOwn(body, key) &&
        (key === "updatedAt" || base[key] === body[key]),
    ) ||
    !nonResourceReplacementDoesNotGrow(base.updatedAt, body.updatedAt)
  )
    return false;
  rememberOwnedCapacity(body, receipt.sizes, receipt.maximumDepth);
  return true;
}
/** Trusted actual-save adapter only. Model validation preceded that backend
 * result; this always performs the official final-byte gate, never a skip flag. */
export function assertOwnedSourceDocumentCapacity(body) {
  if (!isOwnedJSON(body))
    throw new Error("Actual saved capacity requires an owned body.");
  const sizes = assertContent(body);
  rememberOwnedCapacity(body, sizes, contentMeasurementDepth(sizes));
  return sizes;
}
function artifactCapacityBytes(artifact, heldDocument) {
  const receipt =
    heldDocument && artifact.document === heldDocument
      ? ownedDocumentCapacity.get(heldDocument)
      : null;
  if (
    receipt &&
    isOwnedJSON(heldDocument) &&
    receipt.maximumDepth !== null &&
    receipt.maximumDepth + 1 <= 64
  ) {
    const upper =
      measureContent({ ...artifact, document: null }).jsonBytes -
      4 +
      receipt.sizes.jsonBytes;
    if (upper <= CAPACITY.artifactBytes) return upper;
  }
  return measureContent(artifact).jsonBytes;
}

function measureSourceArtifactInput(input) {
  if (typeof input === "string") return null;
  const artifact = object(input, "artifact"),
    document = artifact.document;
  const sizes = measureContent(document),
    depth = contentMeasurementDepth(sizes);
  // Keep the full official traversal for an unprovable embedding. The ordinary
  // mutable parser never receives a captured measurement from a caller.
  if (depth === null || depth + 1 > 64) return null;
  const wrapper = measureContent({ ...artifact, document: null });
  return {
    input,
    document,
    sizes,
    jsonBytes: wrapper.jsonBytes - 4 + sizes.jsonBytes,
  };
}
function parseArtifactDocument(
  input,
  documentParser,
  heldDocument,
  inputCapacity,
) {
  const inputBytes =
    typeof input === "string"
      ? utf8Bytes(input)
      : inputCapacity?.input === input
        ? inputCapacity.jsonBytes
        : artifactCapacityBytes(input, heldDocument);
  assertBytes("Artifact JSON", inputBytes, CAPACITY.artifactBytes);
  const artifact = object(
    typeof input === "string" ? JSON.parse(input) : input,
    "artifact",
  );
  if (artifact.format !== "showai" || ![1, 2, 3].includes(artifact.version))
    throw new Error(
      'Expected a ShowAI artifact with format "showai" and version 1, 2 or 3.',
    );
  if (
    artifact.presentation !== undefined &&
    !["spatial", "reading"].includes(artifact.presentation)
  )
    throw new Error("Unknown page presentation.");
  const document = documentParser(artifact.document);
  if (artifact.version !== artifactVersion(document))
    throw new Error("Artifact version does not match its page model.");
  const result = {
    format: "showai",
    version: artifact.version,
    document,
    ...(artifact.presentation ? { presentation: artifact.presentation } : {}),
    ...(artifact.selection === undefined
      ? {}
      : {
          selection: validateSelection(artifact.selection, document),
        }),
    ...(artifact.components === undefined
      ? {}
      : { components: validateComponents(artifact.components) }),
    ...(artifact.remoteComponents === undefined
      ? {}
      : {
          remoteComponents: validateRemoteComponents(artifact.remoteComponents),
        }),
  };
  const proof = documentCapacity.get(document);
  const documentGrowth = document === artifact.document && !proof ? 0 : proof ? Math.max(0, proof.upper.jsonBytes - proof.before.jsonBytes) : null;
  const selectionGrowth = result.selection ? Math.max(0, measureContent(result.selection).jsonBytes - measureContent(artifact.selection).jsonBytes) : 0;
  const remoteGrowth = result.remoteComponents ? Math.max(0, measureContent(result.remoteComponents).jsonBytes - measureContent(artifact.remoteComponents).jsonBytes) : 0;
  if(heldDocument&&document===heldDocument&&ownedDocumentCapacity.has(document))
    assertBytes("Artifact JSON",artifactCapacityBytes(result,heldDocument),CAPACITY.artifactBytes);
  else if (documentGrowth === null || inputBytes + documentGrowth + selectionGrowth + remoteGrowth > CAPACITY.artifactBytes)
    assertBytes("Artifact JSON", measureContent(result).jsonBytes, CAPACITY.artifactBytes);
  return result;
}

export function parseArtifact(input) {
  return parseArtifactDocument(input, validateDocument);
}

/** Internal parser adapter for a JSON.parse result exclusively owned by the
 * calling backend. All JSON, model, ink, capacity and wrapper validation still
 * runs; only the redundant defensive copy of that private graph is omitted. */
export function parseArtifactConsumingDocument(input) {
  return parseArtifactDocument(input, value => validateDocumentValue(value, false));
}

/** Trusted backend adapter only. The source registry must first return its
 * actual held body after an exact complete-body comparison. Public imports
 * always use parseArtifact and cannot supply a skip-validation flag. */
export function parseArtifactWithValidatedDocument(input, heldDocument) {
  return parseArtifactDocument(input, document => {
    if (document !== heldDocument)
      throw new Error("Artifact document is not the actual registered body.");
    return heldDocument;
  },heldDocument);
}

export function serializeArtifact(
  document,
  components,
  remoteComponents,
  presentation,
  selection,
) {
  if (
    presentation !== undefined &&
    !["spatial", "reading"].includes(presentation)
  )
    throw new Error("Unknown page presentation.");
  const artifact = {
    format: "showai",
    version: artifactVersion(document),
    document: validateDocument(document),
    ...(presentation ? { presentation } : {}),
    ...(selection ? { selection: validateSelection(selection, document) } : {}),
    ...(components?.length
      ? { components: validateComponents(components) }
      : {}),
    ...(remoteComponents?.length
      ? { remoteComponents: validateRemoteComponents(remoteComponents) }
      : {}),
  };
  assertBytes(
    "Artifact JSON",
    measureContent(artifact).prettyJsonBytes,
    CAPACITY.artifactBytes,
  );
  const result = JSON.stringify(artifact, null, 2);
  assertBytes("Artifact JSON", utf8Bytes(result), CAPACITY.artifactBytes);
  return result;
}

export function escapeJsonForHtml(value) {
  assertBytes(
    "Embedded artifact JSON",
    measureContent(value).jsonBytes,
    CAPACITY.artifactBytes,
  );
  const json = JSON.stringify(value);
  let bytes = utf8Bytes(json);
  for (let index = 0; index < json.length; index++) {
    const code = json.charCodeAt(index);
    if (code === 60 || code === 62 || code === 38) bytes += 5;
    else if (code === 0x2028 || code === 0x2029) bytes += 3;
  }
  assertBytes("HTML-escaped artifact JSON", bytes, CAPACITY.artifactBytes);
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function injectArtifactIntoHtml(
  template,
  document,
  components,
  remoteComponents,
  presentation,
  selection,
) {
  if (
    presentation !== undefined &&
    !["spatial", "reading"].includes(presentation)
  )
    throw new Error("Unknown page presentation.");
  const artifact = {
    format: "showai",
    version: artifactVersion(document),
    document: validateDocument(document),
    ...(presentation ? { presentation } : {}),
    ...(selection ? { selection: validateSelection(selection, document) } : {}),
    ...(components?.length
      ? { components: validateComponents(components) }
      : {}),
    ...(remoteComponents?.length
      ? { remoteComponents: validateRemoteComponents(remoteComponents) }
      : {}),
  };
  const serialized = escapeJsonForHtml(artifact);
  assertBytes(
    "Embedded artifact JSON",
    utf8Bytes(serialized),
    CAPACITY.artifactBytes,
  );
  const dataTag =
    /<script\b(?=[^>]*\bid=["']showai-data["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>[\s\S]*?<\/script>/i;
  if (!dataTag.test(template))
    throw new Error(
      "Viewer template is missing its ShowAI data placeholder. Run npm run build:portable first.",
    );
  const title = document.title.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
  const html = template
    .replace(
      dataTag,
      () =>
        `<script id="${ARTIFACT_DATA_ID}" type="application/json">${serialized}</script>`,
    )
    .replace(
      /<title>[\s\S]*?<\/title>/i,
      () => `<title>${title} · ShowAI</title>`,
    );
  assertBytes("Exported HTML", utf8Bytes(html), CAPACITY.htmlBytes);
  return html;
}
