/**
 * Development-only logging helpers.
 *
 * `console.warn` / `console.error` calls in production builds add weight to
 * bundles (string literals, argument formatting) and contribute noise to
 * end-user devtools. In DEV mode they remain valuable for diagnostics.
 *
 * Use these helpers instead of bare `console.warn` for non-actionable
 * developer hints. Real production errors should still surface via toast,
 * telemetry, or thrown errors — not console.
 */

const IS_DEV = import.meta.env.DEV

export function devWarn(...args: unknown[]): void {
  if (!IS_DEV) return
  if (typeof console === 'undefined') return
  console.warn(...args)
}

export function devError(...args: unknown[]): void {
  if (!IS_DEV) return
  if (typeof console === 'undefined') return
  console.error(...args)
}

export function devLog(...args: unknown[]): void {
  if (!IS_DEV) return
  if (typeof console === 'undefined') return
  console.log(...args)
}
