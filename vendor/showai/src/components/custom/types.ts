import type { ShowDocument } from "../../types";
import type { JSONContent } from "@tiptap/core";

export type CatalogScope = "builtin" | "global" | "published" | "project";
export type JsonSchema = Record<string, unknown> | boolean;

export interface PackageRevisionRef {
  kind: "component" | "template";
  id: string;
  version: string;
  integrity: string;
  /** Selection hints; identity is kind/id/version/integrity. */
  scope?: CatalogScope;
  projectId?: string;
}
export interface CatalogReadOptions {
  scope?: CatalogScope | "all";
  version?: string;
  integrity?: string;
}
export interface RelatedPackage {
  kind: "component" | "template";
  id: string;
  version?: string;
  purpose: string;
}
export interface TemplateExample {
  name: string;
  request: string;
  steps: RelatedPackage[];
}
export type TemplatePart =
  | {
      type: "content";
      content: JSONContent;
      layout?: ShowDocument["layout"];
      views?: ShowDocument["views"];
      surfaceViews?: ShowDocument["surfaceViews"];
    }
  | { type: "template"; ref: PackageRevisionRef; title?: string };
export type TemplatePartInput =
  | {
      type: "content";
      content: JSONContent;
      layout?: ShowDocument["layout"];
      views?: ShowDocument["views"];
      surfaceViews?: ShowDocument["surfaceViews"];
    }
  | {
      type: "template";
      ref: Omit<PackageRevisionRef, "integrity"> & { integrity?: string };
      title?: string;
    };

export interface TemplateMetadata {
  id: string;
  name: string;
  description: string;
  scope: CatalogScope;
  updatedAt: string;
  version: string;
  integrity: string;
  scenarios: string[];
  contentGuide: { title: string; instructions: string[] }[];
  related: RelatedPackage[];
  examples: TemplateExample[];
  dependencies: PackageRevisionRef[];
  parents?: PackageRevisionRef[];
  mergeBase?: PackageRevisionRef;
  legacy?: boolean;
  workflow?: {
    format: 1;
    /** Declared by the bundle: four current stages, or six for legacy schemaVersion 1–2. */
    stages: (
      | import("../../portable/template-bundle.mjs").TemplateStage
      | import("../../portable/template-bundle.mjs").LegacyTemplateStage
    )[];
    components: { id: string; ref: PackageRevisionRef }[];
  };
}

export interface TemplateRecord extends TemplateMetadata {
  document: ShowDocument;
  composition?: TemplatePart[];
  bundle?: import("../../portable/template-bundle.mjs").TemplateBundleSource;
}

export interface SaveTemplateInput {
  id?: string;
  version?: string;
  name?: string;
  description?: string;
  bundle?: import("../../portable/template-bundle.mjs").TemplateBundleSource;
  document?: ShowDocument;
  scenarios?: string[];
  contentGuide?: { title: string; instructions: string[] }[];
  related?: RelatedPackage[];
  examples?: TemplateExample[];
  composition?: TemplatePartInput[];
  parents?: PackageRevisionRef[];
  mergeBase?: PackageRevisionRef;
}

export interface ComponentExample {
  name: string;
  data: Record<string, unknown>;
  request?: string;
  description?: string;
}

/** User packages contain manifest.json, props.schema.json and a local React entry. */
export type ComponentCategory =
  | "text"
  | "image"
  | "table"
  | "data"
  | "flow"
  | "surface"
  | "outline"
  | "other";

export interface ComponentManifest {
  role?: "page-outline";
  pageOutlineProtocol?: 1;
  /** Versioned use/development contract. Older packages remain explicitly undocumented. */
  documentation?: import("./documentation").ComponentDocumentation;
  id: string;
  name: string;
  version: string;
  description: string;
  category?: ComponentCategory;
  scenarios: string[];
  effects?: string[];
  /** Exact component revisions imported through showai:component/<id>. */
  dependencies?: PackageRevisionRef[];
  entry: string;
  /** Named, synchronous JSON read model evaluated in the component browser sandbox. */
  reader?: "readData";
  defaultData: Record<string, unknown>;
  examples: ComponentExample[];
  parents?: PackageRevisionRef[];
  mergeBase?: PackageRevisionRef;
}

export interface ComponentMetadata extends ComponentManifest {
  scope: CatalogScope;
  integrity: string;
  updatedAt: string;
  /** One-line type summary of the props schema, derived when the package is projected. */
  signature?: string;
  parents?: PackageRevisionRef[];
  mergeBase?: PackageRevisionRef;
}

/** Browser-safe portable payload; a page stores only the component reference and props. */
export interface CompiledComponent extends ComponentMetadata {
  html: string;
  schema: JsonSchema;
  /** Mount code for an already sandboxed conversation host; never used by desktop. */
  inline?: { script: string; styles: string };
}

export interface ComponentSource {
  manifest: ComponentManifest;
  schema: JsonSchema;
  source: string;
  files: Record<string, string>;
  /** Base64-encoded local images/fonts preserved when saving an edited version. */
  assets?: Record<string, string>;
  parents?: PackageRevisionRef[];
  mergeBase?: PackageRevisionRef;
}

export interface BuiltinComponentMetadata {
  documentation?: import("./documentation").ComponentDocumentation;
  insertion?: { nodeType: "surface"; surfaceKind: "page" | "board" };
  kind: string;
  replacedBy?: string;
  name: string;
  description: string;
  scenarios: string[];
  effects?: string[];
  version?: string;
  defaultData: Record<string, unknown>;
  propsSchema: JsonSchema;
  examples: ComponentExample[];
  /** How the component fits a conversation column, measured at chat widths. */
  conversation?: InlineReadiness;
}

export interface InlineReadiness {
  status: "ready" | "limited" | "unsuitable";
  note?: string;
}

export interface CustomComponentRef {
  componentId: string;
  version: string;
  integrity?: string;
  scope?: CatalogScope;
}

export interface CustomBlockData extends CustomComponentRef {
  props: Record<string, unknown>;
}

export interface PackageBundle {
  format: "showai-catalog-bundle";
  version: 1;
  root: PackageRevisionRef;
  components: { component: CompiledComponent; source?: ComponentSource }[];
  templates: TemplateRecord[];
}
export type EditablePackage =
  | ({ kind: "component" } & ComponentSource)
  | { kind: "template"; template: SaveTemplateInput };
export interface MergeConflict {
  path: string;
  kind: "text" | "value";
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
}
export interface PackageMergeInput {
  projectId: string;
  base: PackageRevisionRef;
  ours: PackageRevisionRef;
  theirs: PackageRevisionRef;
}
export interface PackageMergePreview extends PackageMergeInput {
  kind: "component" | "template";
  merged: EditablePackage;
  conflicts: MergeConflict[];
}

/** The only SDK available to custom React components. No host or filesystem API. */
export interface CustomComponentProps<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  data: T;
  onChange?: (data: T) => void;
  readOnly: boolean;
}

export type {
  PageOutlineComponentProps,
  PageOutlineItem,
  PageOutlineData,
} from "../../surface/page-outline.mjs";
