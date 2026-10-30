import {
  TextBlock,
  ImageBlock,
  TableBlock,
  CalloutBlock,
  ToggleBlock,
  StepperBlock,
  DividerBlock,
  CodeBlock,
  validatePrimitiveData,
} from "./Primitives";
import { createElement, lazy } from "react";
import primitiveMetadata from "../../../resources/catalog/primitives.json";
import componentMetadata from "../../../resources/catalog/components.json";
import { BookmarkBlock } from "./Bookmark";
import { VideoBlock, AudioBlock } from "./Media";
import { PdfBlock } from "./Pdf";
import { ReferencesBlock } from "./References";
import { validateResearchData } from "./research-contract.mjs";
import { StepWalkthroughBlock } from "./StepWalkthrough";
import { validateWalkthroughData } from "./walkthrough-contract.mjs";
import { ChartBlock } from "./Chart";
import { DatabaseBlock } from "./Database";
import { GalleryBlock } from "./Gallery";
import { MetricsBlock } from "./Metrics";
import { PlaygroundBlock } from "./Playground";
const FlowchartBlock = /* @__PURE__ */ lazy(() =>
  import("./Flowchart").then((module) => ({ default: module.FlowchartBlock })),
);
import { validateFlowchartData } from "./flowchart-contract.mjs";
import { validateMindmapData } from "./mindmap-contract.mjs";
const MindmapBlock = /* @__PURE__ */ lazy(() =>
  import("./Mindmap").then((module) => ({ default: module.MindmapBlock })),
);
import { validateAnalysisData } from "./analysis-contract.mjs";
const ComparisonMatrixBlock = /* @__PURE__ */ lazy(() =>
  import("./ComparisonMatrix").then((module) => ({
    default: module.ComparisonMatrixBlock,
  })),
);
const StatusTreeBlock = /* @__PURE__ */ lazy(() =>
  import("./StatusTree").then((module) => ({
    default: module.StatusTreeBlock,
  })),
);
const ExperimentTrackerBlock = /* @__PURE__ */ lazy(() =>
  import("./ExperimentTracker").then((module) => ({
    default: module.ExperimentTrackerBlock,
  })),
);
import { validateScene3dData } from "./scene3d-contract.mjs";
const Scene3DBlock = /* @__PURE__ */ lazy(() =>
  import("./Scene3D").then((module) => ({ default: module.Scene3DBlock })),
);
import { validateDocDiagramData } from "./doc-diagrams-contract.mjs";
import { validateDocReferenceData } from "./doc-reference-contract.mjs";
import { validateDocBrowseData } from "./doc-browse-contract.mjs";
import { validatePlanData } from "./plan-contract.mjs";
import { validateEventTimelineData } from "./event-timeline-contract.mjs";
import { validatePlaygroundData } from "./playground-contract.mjs";
import { validateDatabaseData } from "./database-contract.mjs";
const SequenceDiagramBlock = /* @__PURE__ */ lazy(() =>
  import("./SequenceDiagram").then((module) => ({
    default: module.SequenceDiagramBlock,
  })),
);
const LayerDiagramBlock = /* @__PURE__ */ lazy(() =>
  import("./LayerDiagram").then((module) => ({
    default: module.LayerDiagramBlock,
  })),
);
const StepGuideBlock = /* @__PURE__ */ lazy(() =>
  import("./StepGuide").then((module) => ({ default: module.StepGuideBlock })),
);
const CommandReferenceBlock = /* @__PURE__ */ lazy(() =>
  import("./CommandReference").then((module) => ({
    default: module.CommandReferenceBlock,
  })),
);
const StructureBrowserBlock = /* @__PURE__ */ lazy(() =>
  import("./StructureBrowser").then((module) => ({
    default: module.StructureBrowserBlock,
  })),
);
const CardGridBlock = /* @__PURE__ */ lazy(() =>
  import("./CardGrid").then((module) => ({ default: module.CardGridBlock })),
);
const RoadmapBlock = /* @__PURE__ */ lazy(() =>
  import("./Roadmap").then((module) => ({ default: module.RoadmapBlock })),
);
const WaterfallBlock = /* @__PURE__ */ lazy(() =>
  import("./Waterfall").then((module) => ({ default: module.WaterfallBlock })),
);
const EventTimelineBlock = /* @__PURE__ */ lazy(() =>
  import("./EventTimeline").then((module) => ({
    default: module.EventTimelineBlock,
  })),
);
import { parseChartData } from "./helpers";
import g2Metadata from "../../../resources/catalog/g2.json";
const G2ChartBlock = /* @__PURE__ */ lazy(() =>
  import("./G2Chart").then((module) => ({ default: module.G2ChartBlock })),
);
import { validateG2Data } from "./g2/contract.mjs";
import diagramMetadata from "../../../resources/catalog/diagrams.json";
import { validateDiagramData } from "./diagrams/contract.mjs";
const diagramRenderers = {
  archify: /* @__PURE__ */ lazy(() =>
    import("./ExternalDiagram").then((m) => ({ default: m.ArchifyBlock })),
  ),
  "diagram-design": /* @__PURE__ */ lazy(() =>
    import("./ExternalDiagram").then((m) => ({
      default: m.DiagramDesignBlock,
    })),
  ),
  "fireworks-tech-graph": /* @__PURE__ */ lazy(() =>
    import("./ExternalDiagram").then((m) => ({
      default: m.FireworksTechGraphBlock,
    })),
  ),
};
import { CustomBlock } from "../custom/CustomBlock";
import { readCustomBlockData } from "../custom/contract";
import type { BlockData, BlockDefinition, BlockRegistration } from "./types";

export type {
  BlockData,
  BlockDefinition,
  BlockProps,
  BlockRegistration,
} from "./types";

/** Register before mounting the editor. Existing readers also update if a renderer is added later. */
export const blockDefinitions: BlockDefinition[] = [];
const allBlockDefinitions: BlockDefinition[] = [];
const listeners = new Set<() => void>();
let revision = 0;
export const subscribeToBlocks = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getRegistryRevision = () => revision;

export function registerBlock(
  input: BlockDefinition | BlockRegistration,
): void {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(input.kind))
    throw new Error(
      "Block kind must use lowercase letters, numbers, and hyphens.",
    );
  if (getBlockDefinition(input.kind))
    throw new Error(`Block "${input.kind}" is already registered.`);
  const definition: BlockDefinition =
    "Component" in input
      ? {
          kind: input.kind,
          title: input.label,
          description: input.description,
          icon: input.icon ?? "◇",
          defaultData: input.createData(),
          createData: input.createData,
          renderer: input.Component,
          validate: input.validate,
        }
      : { ...input };
  if (!definition.title.trim()) throw new Error("Block title is required.");
  definition.defaultData = cloneBlockData(definition.defaultData);
  definition.validate?.(definition.defaultData);
  allBlockDefinitions.push(definition);
  if (!definition.replacedBy) blockDefinitions.push(definition);
  revision++;
  for (const listener of listeners) listener();
}

export function getBlockDefinition(kind: string): BlockDefinition | undefined {
  return allBlockDefinitions.find((definition) => definition.kind === kind);
}

function cloneBlockData(data: BlockData): BlockData {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Block data must be a JSON object.");
  // structuredClone catches executable values; the JSON check prevents silent loss on export.
  const cloned = structuredClone(data);
  const assertJson = (value: unknown, depth = 0): void => {
    if (depth > 40) throw new Error("Block data is nested too deeply.");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
      value.forEach((item) => assertJson(item, depth + 1));
      return;
    }
    if (
      value &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype
    ) {
      for (const [key, item] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key))
          throw new Error("Block data contains a reserved key.");
        assertJson(item, depth + 1);
      }
      return;
    }
    throw new Error(
      "Block data must contain only finite, serializable JSON values.",
    );
  };
  assertJson(cloned);
  return cloned;
}

export function createBlockData(kind: string): BlockData {
  const definition = getBlockDefinition(kind);
  if (!definition) throw new Error(`Unknown block kind: ${kind}`);
  const data = cloneBlockData(
    definition.createData?.() ?? definition.defaultData,
  );
  definition.validate?.(data);
  return data;
}

function objectArray(data: BlockData, key: string): Record<string, unknown>[] {
  if (data[key] === undefined) return [];
  if (
    !Array.isArray(data[key]) ||
    data[key].some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  )
    throw new Error(`${key} 必须是对象数组。`);
  return data[key];
}

for (const item of primitiveMetadata) {
  registerBlock({
    kind: item.kind,
    title: item.name,
    description: item.description,
    icon: (
      {
        text: "T",
        image: "▧",
        table: "▦",
        callout: "!",
        toggle: "⌄",
        stepper: "⇥",
        divider: "—",
        code: "{}",
      } as Record<string, string>
    )[item.kind],
    defaultData: item.defaultData as BlockData,
    renderer: {
      text: TextBlock,
      image: ImageBlock,
      table: TableBlock,
      callout: CalloutBlock,
      toggle: ToggleBlock,
      stepper: StepperBlock,
      divider: DividerBlock,
      code: CodeBlock,
    }[
      item.kind as
        | "text"
        | "image"
        | "table"
        | "callout"
        | "toggle"
        | "stepper"
        | "divider"
        | "code"
    ],
    validate: (data) => validatePrimitiveData(item.kind, data),
  });
}

registerBlock({
  kind: "mindmap",
  title: "思维导图",
  description: "自动排布的主题分支，支持快捷键创建与编辑节点",
  icon: "⑂",
  defaultData: componentMetadata.find((item) => item.kind === "mindmap")!
    .defaultData as BlockData,
  renderer: MindmapBlock,
  validate: validateMindmapData,
});
for (const item of diagramMetadata) {
  registerBlock({
    kind: item.kind,
    title: item.name,
    description: item.description,
    icon: "◇",
    defaultData: item.defaultData as BlockData,
    renderer: diagramRenderers[item.kind as keyof typeof diagramRenderers],
    validate: (data) => validateDiagramData(item.kind, data),
  });
}
registerBlock({
  kind: "flowchart",
  title: "交互流程图",
  description: "节点分支、路线讲解与阶段回放",
  icon: "⌘",
  defaultData: componentMetadata.find((item) => item.kind === "flowchart")!
    .defaultData as BlockData,
  renderer: FlowchartBlock,
  validate: validateFlowchartData,
});
registerBlock({
  kind: "chart",
  title: "数据图表",
  description: "交互式折线图、柱状图与原始数据",
  icon: "↗",
  defaultData: {
    title: "数据图表",
    type: "line",
    labels: [],
    series: [],
    unit: "",
  },
  renderer: ChartBlock,
  validate: (data) => {
    parseChartData(
      JSON.stringify({
        ...data,
        labels: data.labels ?? [],
        series: data.series ?? [],
      }),
    );
  },
});
registerBlock({
  kind: "database",
  title: "数据库",
  description: "表格、看板、日历、筛选和排序",
  icon: "▦",
  defaultData: {
    title: "数据库",
    columns: [
      { id: "name", name: "名称", type: "text" },
      {
        id: "status",
        name: "状态",
        type: "select",
        options: ["待开始", "进行中", "已完成"],
      },
    ],
    rows: [],
  },
  renderer: DatabaseBlock,
  validate: (data) => {
    validateDatabaseData(data);
  },
});
registerBlock({
  kind: "metrics",
  title: "关键指标",
  description: "数值、变化率与简洁说明",
  icon: "◴",
  defaultData: { title: "关键指标", items: [] },
  renderer: MetricsBlock,
  validate: (data) => {
    objectArray(data, "items");
  },
});
registerBlock({
  kind: "playground",
  title: "交互计算",
  description: "调参数，看公式结果、构成与排名",
  icon: "⌁",
  defaultData: {
    title: "交互计算",
    inputs: [],
    operation: "sum",
    resultLabel: "计算结果",
    unit: "",
  },
  renderer: PlaygroundBlock,
  validate: (data) => {
    validatePlaygroundData(data);
  },
});
registerBlock({
  kind: "gallery",
  title: "图片画廊",
  description: "本地图片、图注与全屏预览",
  icon: "▧",
  defaultData: { title: "图片画廊", columns: 2, images: [] },
  renderer: GalleryBlock,
  validate: (data) => {
    objectArray(data, "images");
  },
});
registerBlock({
  kind: "bookmark",
  title: "来源书签",
  description: "保存网页、论文和项目出处",
  icon: "↗",
  defaultData: { title: "", description: "", url: "", image: "" },
  renderer: BookmarkBlock,
});

registerBlock({
  kind: "video",
  title: "视频",
  description: componentMetadata.find((item) => item.kind === "video")!
    .description,
  icon: "▷",
  defaultData: componentMetadata.find((item) => item.kind === "video")!
    .defaultData as BlockData,
  renderer: VideoBlock,
  validate: (data) => validateResearchData("video", data),
});
registerBlock({
  kind: "audio",
  title: "音频",
  description: componentMetadata.find((item) => item.kind === "audio")!
    .description,
  icon: "♫",
  defaultData: componentMetadata.find((item) => item.kind === "audio")!
    .defaultData as BlockData,
  renderer: AudioBlock,
  validate: (data) => validateResearchData("audio", data),
});
registerBlock({
  kind: "pdf",
  title: "PDF 文档",
  description: componentMetadata.find((item) => item.kind === "pdf")!
    .description,
  icon: "▤",
  defaultData: componentMetadata.find((item) => item.kind === "pdf")!
    .defaultData as BlockData,
  renderer: PdfBlock,
  validate: (data) => validateResearchData("pdf", data),
});
registerBlock({
  kind: "references",
  title: "参考文献",
  description: componentMetadata.find((item) => item.kind === "references")!
    .description,
  icon: "[1]",
  defaultData: componentMetadata.find((item) => item.kind === "references")!
    .defaultData as BlockData,
  renderer: ReferencesBlock,
  validate: (data) => validateResearchData("references", data),
});

registerBlock({
  kind: "custom",
  title: "自定义组件",
  description: "使用项目中安装的 React 组件",
  icon: "◇",
  defaultData: {
    componentId: "value-slider",
    version: "1.0.0",
    props: { label: "数值", value: 0, min: 0, max: 100 },
  },
  renderer: CustomBlock,
  validate: (data) => {
    readCustomBlockData(data);
  },
});

for (const item of g2Metadata) {
  registerBlock({
    kind: item.kind,
    title: item.name,
    description: item.description,
    icon: "↗",
    defaultData: item.defaultData as BlockData,
    renderer: (props) =>
      createElement(G2ChartBlock, { ...props, chartType: item.kind.slice(3) }),
    validate: validateG2Data,
  });
}

// Keep literal registrations: the portable reader removes unused kinds and metadata together.
registerBlock({
  kind: "step-walkthrough",
  title: "分步演示",
  description: "逐步展示实际操作与各部分的具体内容变化",
  icon: "⇄",
  defaultData: componentMetadata.find(
    (item) => item.kind === "step-walkthrough",
  )!.defaultData as BlockData,
  renderer: StepWalkthroughBlock,
  validate: (data) => {
    validateWalkthroughData(data);
  },
});
registerBlock({
  kind: "comparison-matrix",
  title: "对比矩阵",
  description: "按维度逐行对比多个方案，突出差异与自己的方案",
  icon: "▦",
  defaultData: componentMetadata.find(
    (item) => item.kind === "comparison-matrix",
  )!.defaultData as BlockData,
  renderer: ComparisonMatrixBlock,
  validate: (data) => {
    validateAnalysisData("comparison-matrix", data);
  },
});
registerBlock({
  kind: "status-tree",
  title: "状态树",
  description: "按类别展开条目，区分走通、没走通与进行中",
  icon: "⑂",
  defaultData: componentMetadata.find((item) => item.kind === "status-tree")!
    .defaultData as BlockData,
  renderer: StatusTreeBlock,
  validate: (data) => {
    validateAnalysisData("status-tree", data);
  },
});
registerBlock({
  kind: "experiment-tracker",
  title: "实验追踪",
  description: "实验散点与最优前沿、运行列表、资源与训练曲线",
  icon: "◎",
  defaultData: componentMetadata.find(
    (item) => item.kind === "experiment-tracker",
  )!.defaultData as BlockData,
  renderer: ExperimentTrackerBlock,
  validate: (data) => {
    validateAnalysisData("experiment-tracker", data);
  },
});
registerBlock({
  kind: "scene-3d",
  title: "3D 场景",
  description: "可旋转的三维模型，带标注、坐标箭头与参数驱动的动作",
  icon: "◈",
  defaultData: componentMetadata.find((item) => item.kind === "scene-3d")!
    .defaultData as BlockData,
  renderer: Scene3DBlock,
  validate: (data) => {
    validateScene3dData(data);
  },
});
registerBlock({
  kind: "sequence-diagram",
  title: "时序图",
  description: "参与者之间逐步播放的消息往返",
  icon: "⇄",
  defaultData: componentMetadata.find(
    (item) => item.kind === "sequence-diagram",
  )!.defaultData as BlockData,
  renderer: SequenceDiagramBlock,
  validate: (data) => {
    validateDocDiagramData("sequence-diagram", data);
  },
});
registerBlock({
  kind: "layer-diagram",
  title: "分层架构图",
  description: "自上而下的分层与可点选模块",
  icon: "☰",
  defaultData: componentMetadata.find((item) => item.kind === "layer-diagram")!
    .defaultData as BlockData,
  renderer: LayerDiagramBlock,
  validate: (data) => {
    validateDocDiagramData("layer-diagram", data);
  },
});
registerBlock({
  kind: "step-guide",
  title: "操作步骤",
  description: "编号步骤、可复制代码与计时",
  icon: "①",
  defaultData: componentMetadata.find((item) => item.kind === "step-guide")!
    .defaultData as BlockData,
  renderer: StepGuideBlock,
  validate: (data) => {
    validateDocReferenceData("step-guide", data);
  },
});
registerBlock({
  kind: "command-reference",
  title: "命令参考",
  description: "可搜索的分组命令与参数",
  icon: "⌘",
  defaultData: componentMetadata.find(
    (item) => item.kind === "command-reference",
  )!.defaultData as BlockData,
  renderer: CommandReferenceBlock,
  validate: (data) => {
    validateDocReferenceData("command-reference", data);
  },
});
registerBlock({
  kind: "structure-browser",
  title: "结构浏览器",
  description: "可展开的目录或字段树，附说明与示例",
  icon: "⊟",
  defaultData: componentMetadata.find(
    (item) => item.kind === "structure-browser",
  )!.defaultData as BlockData,
  renderer: StructureBrowserBlock,
  validate: (data) => {
    validateDocBrowseData("structure-browser", data);
  },
});
registerBlock({
  kind: "card-grid",
  title: "卡片导航",
  description: "带图标与说明的入口卡片，可整卡链接",
  icon: "▤",
  defaultData: componentMetadata.find((item) => item.kind === "card-grid")!
    .defaultData as BlockData,
  renderer: CardGridBlock,
  validate: (data) => {
    validateDocBrowseData("card-grid", data);
  },
});
registerBlock({
  kind: "roadmap",
  title: "路线图",
  description: "按日期阅读计划、依赖与负责人",
  icon: "▤",
  defaultData: componentMetadata.find((item) => item.kind === "roadmap")!
    .defaultData as BlockData,
  renderer: RoadmapBlock,
  validate: (data) => {
    validatePlanData("roadmap", data);
  },
});
registerBlock({
  kind: "waterfall",
  title: "瀑布桥图",
  description: "期初到期末的逐项增减与构成",
  icon: "▥",
  defaultData: componentMetadata.find((item) => item.kind === "waterfall")!
    .defaultData as BlockData,
  renderer: WaterfallBlock,
  validate: (data) => {
    validatePlanData("waterfall", data);
  },
});
registerBlock({
  kind: "event-timeline",
  title: "事件时间线",
  description: "曲线、阶段与事件同轴回放",
  icon: "⌖",
  defaultData: componentMetadata.find((item) => item.kind === "event-timeline")!
    .defaultData as BlockData,
  renderer: EventTimelineBlock,
  validate: (data) => {
    validateEventTimelineData(data);
  },
});
