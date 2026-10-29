/** Internal actual recursive factory, not a caller-asserted frozen flag. */
export function freezeOwnedJSON<T>(value: T): T;
export function isOwnedJSON(value: unknown): boolean;
export function ownedJSONMetrics(
  value: object,
): { readonly bytes: number; readonly children: readonly object[] } | undefined;
export type CapturedResourceTree =
  Readonly<{ value: string; bytes: number }> | readonly CapturedResourceTree[];
export interface CapturedContentSummary {
  readonly structureBytes: number;
  readonly jsonBytes: number;
  readonly prettyPadding: number;
  readonly prettyDepthFactor: number;
  readonly maximumDepth: number;
  readonly resources: CapturedResourceTree | null;
  readonly bookkeepingBytes: number;
}
/** Read-only evidence from actual capture. Generic recursive freeze has none. */
export function capturedContentSummary(
  value: unknown,
): CapturedContentSummary | undefined;

/** Capture arbitrary external data independently; frozen caller objects are not
 * proof. The optional budget can only lower the defensive new-copy limit;
 * already held immutable branches allocate no defensive copy. Capacity/model
 * validation remains a separate complete gate. */
export function captureOwnedJSON<T>(value: T, maximumNewCopyBytes?: number): T;
/** Exclusively parse and seal the actual JSON graph before it can escape. */
export function parseOwnedJSON(raw: string, base?: unknown): unknown;
/** Exact target values, sharing only independently captured immutable data. */
export function shareCapturedJSON<T>(base: unknown, target: T): T;
