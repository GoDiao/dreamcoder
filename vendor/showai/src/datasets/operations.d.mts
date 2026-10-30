export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type PathSegment = string | number | { id: string | number };
export type DataPath = PathSegment[];

export type DatasetOperation =
  | {
      op: "set";
      path: DataPath;
      value: unknown;
      /** The value the writer started from; a different current value conflicts. */
      before?: unknown;
      /** The writer started from a missing value. */
      absent?: true;
    }
  | { op: "remove"; path: DataPath; before?: unknown }
  | {
      op: "insert";
      path: DataPath;
      value: unknown;
      /** Insert after this record id; null inserts first; omitted appends. */
      after?: string | number | null;
      index?: number;
    }
  | {
      op: "move";
      path: DataPath;
      after: string | number | null;
      from?: string | number | null;
    };

export interface DatasetConflict {
  op: DatasetOperation["op"];
  path: DataPath;
  reason: "changed" | "removed" | "missing" | "exists" | "invalid";
  base?: unknown;
  mine?: unknown;
  theirs?: unknown;
}

export declare const MAX_OPERATIONS: number;
export declare function isPlainObject(
  value: unknown,
): value is Record<string, unknown>;
export declare function cloneValue<T>(value: T): T;
export declare function equalValues(a: unknown, b: unknown): boolean;
export declare function recordId(value: unknown): string | undefined;
export declare function isKeyedArray(value: unknown): boolean;
export declare function validatePath(path: unknown, label?: string): DataPath;
export declare function formatPath(path: DataPath): string;
export declare function parsePath(input: unknown): DataPath;
export declare function valueAt(root: unknown, path: DataPath): unknown;
export declare function hasPath(root: unknown, path: DataPath): boolean;
export declare function diffValues(
  base: unknown,
  next: unknown,
  path?: DataPath,
): DatasetOperation[];
export declare function validateOperations(
  operations: unknown,
): DatasetOperation[];
export declare function applyOperations(
  root: unknown,
  operations: DatasetOperation[],
  options?: { atomic?: boolean },
): {
  value: unknown;
  conflicts: DatasetConflict[];
  changed: boolean;
  applied: number;
};
export declare function refineOperations(
  operations: DatasetOperation[],
  base: unknown,
): DatasetOperation[];
export declare function pathWithin(path: DataPath, prefix: DataPath): boolean;
export declare function pathKey(path: DataPath): string;
