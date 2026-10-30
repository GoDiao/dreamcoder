export declare const DATABASE_COLUMN_TYPES: readonly string[];
export declare const DATABASE_VIEWS: readonly string[];
export declare const CALENDAR_MODES: readonly string[];
export declare const MAX_HEATMAP_WEEKS: number;
export declare const MAX_SPAN_DAYS: number;

export interface CalendarSettings {
  dateColumn: string;
  endDateColumn?: string;
  startTimeColumn?: string;
  endTimeColumn?: string;
  doneColumn?: string;
}
export interface CalendarEntry<Row = Record<string, unknown>> {
  row: Row;
  start: number;
  end: number;
  startMinute: number | null;
  endMinute: number | null;
  done: boolean;
}
export interface HeatmapCell {
  day: number;
  count: number;
  level: number;
}
export interface HeatmapSummary {
  from: number;
  to: number;
  cells: HeatmapCell[];
  max: number;
  current: number;
  longest: number;
  activeDays: number;
  elapsedDays: number;
}

export declare function parseDay(value: unknown): number | null;
export declare function formatDay(day: number): string;
export declare function localDay(date?: Date): number;
export declare function weekdayOf(day: number): number;
export declare function startOfWeek(day: number, weekStartsOn?: number): number;
export declare function normalizeDate(value: unknown): string;
export declare function parseTime(value: unknown): number | null;
export declare function validateDatabaseData(
  data: unknown,
): Record<string, unknown>;
export declare function calendarEntries<Row extends Record<string, unknown>>(
  rows: Row[],
  settings: CalendarSettings,
): CalendarEntry<Row>[];
export declare function entriesByDay<Row>(
  entries: CalendarEntry<Row>[],
  from: number,
  to: number,
): Map<number, CalendarEntry<Row>[]>;
export declare function timeLanes<Row>(entries: CalendarEntry<Row>[]): {
  placed: { entry: CalendarEntry<Row>; lane: number; end: number }[];
  laneCount: number;
};
export declare function heatmapSummary<Row>(
  entries: CalendarEntry<Row>[],
  options: {
    endDay: number;
    today: number;
    weeks?: number;
    weekStartsOn?: number;
    countDone?: boolean;
  },
): HeatmapSummary;
