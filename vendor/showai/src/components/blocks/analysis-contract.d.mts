export declare const MATRIX_TONES: readonly string[];
export declare const TREE_TONES: readonly string[];
export declare const EXPERIMENT_STATUSES: readonly string[];
export declare const DEFAULT_TREE_STATUSES: {
  id: string;
  label: string;
  tone: "done" | "failed" | "active" | "todo" | "paused";
}[];
export declare function validateAnalysisData(
  kind: string,
  data: unknown,
): Record<string, unknown>;
export declare function differingRows(data: unknown): string[];
export declare function statusCounts(data: unknown): Record<string, number>;
export declare function experimentFrontier(data: unknown): string[];
