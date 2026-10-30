export type EventTimelineTone =
  "neutral" | "info" | "good" | "warn" | "bad" | "accent";
export interface EventTimelineAxis {
  type: "number" | "clock" | "date";
  start?: number | string;
  step?: number;
  count?: number;
  label?: string;
  prefix?: string;
  unit?: string;
}
export interface EventTimelineSeries {
  id: string;
  label: string;
  unit?: string;
  tone?: EventTimelineTone;
  color?: string;
  area?: boolean;
  dashed?: boolean;
  axis?: "left" | "right";
  min?: number;
  max?: number;
  values: (number | null)[];
}
export interface EventTimelinePhase {
  from: number;
  to: number;
  label: string;
  tone?: EventTimelineTone;
}
export interface EventTimelineKind {
  id: string;
  label: string;
  tone?: EventTimelineTone;
  color?: string;
}
export interface EventTimelineEvent {
  at: number;
  title: string;
  detail?: string;
  kind?: string;
}
export interface EventTimelineStat {
  label: string;
  value: string;
  tone?: EventTimelineTone;
}
export interface EventTimelineData {
  title?: string;
  description?: string;
  note?: string;
  axis: EventTimelineAxis;
  series?: EventTimelineSeries[];
  phases?: EventTimelinePhase[];
  kinds?: EventTimelineKind[];
  events: EventTimelineEvent[];
  summary?: EventTimelineStat[];
  initialAt?: number;
}
export declare const EVENT_TIMELINE_TONES: readonly EventTimelineTone[];
export declare const EVENT_TIMELINE_AXIS_TYPES: readonly string[];
export declare const EVENT_TIMELINE_LIMITS: Readonly<Record<string, number>>;
export declare function validateEventTimelineData(
  data: unknown,
): Record<string, unknown>;
export declare function pointCount(data: EventTimelineData): number;
export declare function eventAt(
  events: EventTimelineEvent[],
  point: number,
): number;
export declare function phaseAt(
  phases: EventTimelinePhase[] | undefined,
  point: number,
): number;
export declare function initialPoint(data: EventTimelineData): number;
export declare function axisPointLabel(
  axis: EventTimelineAxis,
  point: number,
  locale?: string,
): string;
