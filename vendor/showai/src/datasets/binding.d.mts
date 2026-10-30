import type { DataPath, DatasetOperation } from "./operations.mjs";

export type FieldMapping =
  | string
  | {
      from: string;
      /** Shown value (as text key) → stored value, e.g. { "true": "done" }. */
      map?: Record<string, unknown>;
      /** Shown when the stored value matches no map entry. */
      otherwise?: unknown;
      /** Clearing the shown value removes the stored field, or stores "". */
      empty?: "remove" | "keep";
    };
export type Derivation =
  | string
  | { from: string }
  | { value: unknown }
  | { template: string }
  | { lookup: string; by: string; key?: string; field: string };
export interface Condition {
  field: string;
  exists?: boolean;
  equals?: unknown;
  notEquals?: unknown;
  in?: unknown[];
}
export interface CollectionMapping {
  key: string;
  into: string;
  from: string;
  idField?: string;
  where?: Condition | Condition[];
  fields?: Record<string, FieldMapping>;
  derived?: Record<string, Derivation>;
  defaults?: Record<string, unknown>;
  label?: string;
}
export interface DatasetBinding {
  dataset: string;
  project?: string;
  props?: { path?: DataPath | string; local?: string[] };
  collections?: CollectionMapping[];
  overlay?: Record<string, Record<string, unknown>>;
}
export interface CompiledCollection {
  key: string;
  into: string;
  from: string;
  idField: string;
  label?: string;
  fields: { target: string; path: DataPath; empty: "remove" | "keep" }[];
  derived: { target: string }[];
  defaults: Record<string, unknown>;
}
export interface CompiledBinding {
  dataset: string;
  project?: string;
  props?: { path: DataPath; local: Set<string> };
  collections: CompiledCollection[];
  overlay: Record<string, Record<string, unknown>>;
}
export interface BindingIssue {
  level: "warning" | "error";
  message: string;
  collection?: string;
}
export interface ProjectedItem {
  id: string;
  into: string;
  row: Record<string, unknown>;
  source: DataPath | null;
  label?: string;
  collection: CompiledCollection;
  /** Fields written back to the source record. */
  writable: string[];
  /** Fields shown from the source that cannot be changed here. */
  readOnly: string[];
}
export interface BindingRejection {
  id?: string;
  field?: string;
  reason: "removed" | "derived" | "read-only" | "unmapped" | "not-a-list";
  value?: unknown;
}

export declare const BINDING_KEY: "$binding";
export declare const MAX_COLLECTIONS: number;
export declare const MAX_PROJECTED_ITEMS: number;
export declare function readBinding(data: unknown): DatasetBinding | undefined;
export declare function hasBinding(data: unknown): boolean;
export declare function componentProps(
  kind: string,
  data: unknown,
): Record<string, unknown>;
export declare function withComponentProps(
  kind: string,
  data: unknown,
  props: Record<string, unknown>,
  binding?: DatasetBinding | null,
): Record<string, unknown>;
export declare function parseCollectionPath(from: string): DataPath[];
export declare function parseReference(
  reference: string,
  levels?: number,
): { up: number; path: DataPath };
export declare function compileBinding(binding: unknown): CompiledBinding;
export declare function validateBinding(binding: unknown): DatasetBinding;
export declare function resolveBinding(
  kind: string,
  data: unknown,
  value: unknown,
  compiled?: CompiledBinding,
): {
  props: Record<string, unknown>;
  projected: Map<string, ProjectedItem>;
  issues: BindingIssue[];
  compiled: CompiledBinding;
};
export declare function splitBindingChange(input: {
  kind: string;
  data: unknown;
  value: unknown;
  nextProps: Record<string, unknown>;
  basis?: { value: unknown; props?: Record<string, unknown> };
}): {
  operations: DatasetOperation[];
  rejected: BindingRejection[];
  data: Record<string, unknown>;
};
export declare function snapshotBinding(
  kind: string,
  data: unknown,
  value: unknown,
): Record<string, unknown>;
export declare function shareBlock(
  kind: string,
  data: unknown,
  datasetId: string,
  local?: string[],
): {
  value: Record<string, unknown>;
  data: Record<string, unknown>;
  binding: DatasetBinding;
};
export declare function defaultLocalKeys(kind: string): string[];
export declare function findCollections(
  value: unknown,
  limit?: number,
): { from: string; count: number; fields: Record<string, string[]> }[];
export declare function suggestCollections(
  value: unknown,
  columns: { id: string; type: string; name?: string }[],
): (CollectionMapping & { count: number })[];
export declare function bindingTargetIssues(
  compiled: CompiledBinding,
  columns: unknown,
): BindingIssue[];
export { validatePath } from "./operations.mjs";
export declare function retargetBindings<T extends { content: unknown }>(
  document: T,
  sourceProjectId: string,
  destinationProjectId: string,
): T;
