import type { ComponentSource } from "../components/custom/types";
import type { ShowDocument } from "../types";
export type TemplateStage = "intent" | "material" | "logic" | "design";
export type LegacyTemplateStage =
  | "intent"
  | "evidence"
  | "understanding"
  | "design"
  | "authoring"
  | "review";
export interface TemplateBundleSource {
  format: 1;
  files: Record<string, string>;
  assets?: Record<string, string>;
}
export interface TemplateBundleMetadata {
  format: "showai-template";
  schemaVersion: 1 | 2 | 3;
  id: string;
  name: string;
  version: string;
  description: string;
  scenarios: string[];
  /** Four stages for schemaVersion 3; six legacy stages for schemaVersion 1–2. */
  guides: Record<string, string | null>;
  components: { id: string; path: string }[];
  /** Legacy schemaVersion 1 only. */
  page?: string | null;
}
export interface ParsedTemplateBundle {
  metadata: TemplateBundleMetadata;
  body: string;
  guides: Partial<Record<TemplateStage, { path: string; markdown: string }>>;
  components: { id: string; path: string; source: ComponentSource }[];
  document?: Partial<ShowDocument>;
  /** True for schemaVersion 1–2 bundles whose six stages are mapped onto the current four. */
  legacy: boolean;
  source: TemplateBundleSource;
}
export const TEMPLATE_STAGES: readonly TemplateStage[];
export const TEMPLATE_SCHEMA_VERSION: 3;
export const LEGACY_TEMPLATE_STAGES: readonly LegacyTemplateStage[];
export const SYSTEM_TEMPLATE_ID: "system-presentation";
export const TEMPLATE_WORKFLOW_CAPABILITIES: Readonly<{
  protocol: "showai-template-workflow-v2";
  bundleFormat: 1;
  schemaVersion: 3;
  legacySchemaVersions: number[];
  stages: readonly TemplateStage[];
  systemBaselineRequired: true;
  contextBinding: string;
  stageDisclosure: string;
  directoryImport: string;
  portableBundleInput: string;
  compactResponses: string[];
}>;
export function templateFilePath(value: unknown): string;
export function stageGuidePath(
  metadata: TemplateBundleMetadata,
  stage: TemplateStage,
): string | null;
export function parseTemplateReadme(source: unknown): {
  metadata: TemplateBundleMetadata;
  body: string;
};
export function parseTemplateBundle(source: unknown): ParsedTemplateBundle;
