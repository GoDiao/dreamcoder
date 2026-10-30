export type NativeSourcePath = (string | number)[];
export type NativeSourceEdit =
  | { op: "set"; path: NativeSourcePath; value: unknown }
  | { op: "remove"; path: NativeSourcePath }
  | { op: "resize"; path: NativeSourcePath; length: number }
  | { op: "splice"; path: NativeSourcePath; index: number; deleteCount: number; items: unknown[] };
export function diffNativeSource(base: unknown, next: unknown): NativeSourceEdit[];
/** Result is private transport data; never let its mutable subtrees escape to UI. */
export function applyNativeSourceDelta<T>(base: T, edits: NativeSourceEdit[]): T;
/** Independent sealed COW result; caller freezing never grants capture proof. */
export function applyCapturedSourceDelta<T>(base: T, edits: NativeSourceEdit[]): T;
export function shareNativeSource<T>(previous: T, normalized: T): T;
