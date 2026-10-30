export declare const STEP_LAYOUTS: readonly string[];
export declare const SEGMENT_KINDS: readonly string[];
export declare function validateDocReferenceData(
  kind: string,
  data: unknown,
): Record<string, unknown>;

export { plainInline } from "./inline-markup.mjs";

export declare function stepTimeline(
  steps: {
    segments?: { start: number; minutes: number; kind: "active" | "wait" }[];
  }[],
): { active: number; wait: number; total: number };
export declare function timelineTicks(total: number): number[];

export declare function searchTerms(query: string): string[];
export declare function commandMatches(
  command: {
    command: string;
    summary: string;
    params?: { name: string; meaning: string }[];
  },
  terms: string[],
): boolean;
export declare function matchRanges(
  source: string,
  terms: string[],
): [number, number][];
