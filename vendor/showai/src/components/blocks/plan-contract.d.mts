export type RoadmapTone = "done" | "active" | "todo" | "blocked";
export type WaterfallKind = "total" | "up" | "down";

export declare const ROADMAP_TONES: readonly RoadmapTone[];
export declare const WATERFALL_KINDS: readonly WaterfallKind[];
export declare const DEFAULT_ROADMAP_STATUSES: {
  id: string;
  label: string;
  tone: RoadmapTone;
}[];

export declare function validatePlanData(
  kind: string,
  data: unknown,
): Record<string, unknown>;

export declare function dayNumber(value: string | undefined): number;
export declare function dayText(day: number): string;
export declare function itemDays(item: { start: string; end: string }): number;
export declare function roadmapWindow(data: unknown): {
  start: number;
  end: number;
};
export declare function ownerWorkload(
  data: unknown,
): Record<string, { scheduled: number; open: number; items: number }>;
export declare function itemLinks(
  data: unknown,
  id: string,
): { depends: string[]; unblocks: string[] };

export declare function waterfallBridge(
  steps: { id: string; kind: WaterfallKind; value: number }[],
): {
  spans: [number, number][];
  end: number;
  mismatches: { id: string; stated: number; computed: number }[];
};
export declare function waterfallMismatches(
  data: unknown,
): { id: string; stated: number; computed: number }[];
