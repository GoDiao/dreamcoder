import type {
  BuiltinComponentMetadata,
  ComponentCategory,
  ComponentMetadata,
} from "../components/custom/types";

export const componentCategories = [
  { id: "text", label: "文本" },
  { id: "image", label: "图片" },
  { id: "table", label: "表格" },
  { id: "data", label: "数据" },
  { id: "flow", label: "流程" },
  { id: "surface", label: "页面与白板" },
  { id: "outline", label: "页面目录" },
  { id: "other", label: "其他" },
] as const satisfies readonly { id: ComponentCategory; label: string }[];

export const builtinCategories: Record<string, ComponentCategory> = {
  text: "text",
  callout: "text",
  toggle: "text",
  stepper: "text",
  divider: "text",
  code: "text",
  bookmark: "text",
  references: "text",
  video: "other",
  audio: "other",
  pdf: "other",
  image: "image",
  gallery: "image",
  table: "table",
  database: "table",
  chart: "data",
  metrics: "data",
  playground: "data",
  "step-walkthrough": "flow",
  "comparison-matrix": "table",
  "status-tree": "flow",
  "experiment-tracker": "data",
  "scene-3d": "image",
  "event-timeline": "data",
  waterfall: "data",
  roadmap: "flow",
  "card-grid": "other",
  "structure-browser": "data",
  "command-reference": "text",
  "step-guide": "flow",
  "layer-diagram": "flow",
  "sequence-diagram": "flow",
  flowchart: "flow",
  archify: "flow",
  "diagram-design": "flow",
  "fireworks-tech-graph": "flow",
  mindmap: "flow",
  page: "surface",
  board: "surface",
};

export type CatalogCustomComponent = ComponentMetadata & {
  projectId?: string;
  projectName?: string;
};
export type CatalogComponent =
  BuiltinComponentMetadata | CatalogCustomComponent;
export type ComponentFilter = "all" | "builtin" | "custom";
export type ComponentGroup = (typeof componentCategories)[number] & {
  items: CatalogComponent[];
};

export function componentCategory(item: CatalogComponent): ComponentCategory {
  if (!("kind" in item) && item.role === "page-outline") return "outline";
  if ("kind" in item)
    return item.kind.startsWith("g2-")
      ? "data"
      : (builtinCategories[item.kind] ?? "other");
  if (item.category) return item.category;
  return builtinCategories[item.id.replace(/^my-/, "")] ?? "other";
}

/** Discovery lists show the newest version within each component's library. */
export function latestComponentVersions<T extends CatalogComponent>(
  items: T[],
): T[] {
  const key = (item: CatalogCustomComponent) =>
    JSON.stringify([
      item.scope,
      item.scope === "project" ? item.projectId : null,
      item.id,
    ]);
  const newest = new Map<string, CatalogCustomComponent>();
  for (const item of items) {
    if ("kind" in item) continue;
    const identity = key(item),
      previous = newest.get(identity);
    const [base, pre] = item.version.split("-"),
      [oldBase, oldPre] = (previous?.version ?? "0.0.0-legacy").split("-");
    const order =
      base.localeCompare(oldBase, undefined, { numeric: true }) ||
      (!pre && oldPre
        ? 1
        : pre && !oldPre
          ? -1
          : (pre ?? "").localeCompare(oldPre ?? "", undefined, {
              numeric: true,
            }));
    if (!previous || order > 0) newest.set(identity, item);
  }
  // Equal versions with different integrity remain explicit rather than choosing a copy.
  return items.filter(
    (item) => "kind" in item || newest.get(key(item))?.version === item.version,
  );
}

export function groupComponents(
  catalog: {
    builtin: BuiltinComponentMetadata[];
    custom: CatalogCustomComponent[];
  },
  filter: ComponentFilter,
): ComponentGroup[] {
  const items = latestComponentVersions([
    ...(filter === "custom" ? [] : catalog.builtin),
    ...(filter === "builtin" ? [] : catalog.custom),
  ]);
  return componentCategories.map((category) => ({
    ...category,
    items: items.filter((item) => componentCategory(item) === category.id),
  }));
}
