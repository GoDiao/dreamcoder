import { useEffect, useState } from "react";

/** Waits this long before a loading placeholder speaks, so fast loads never flash. */
export const PENDING_DELAY_MS = 180;

/**
 * Reports `true` once `active` has stayed on for `delay` ms, and `false` as
 * soon as it turns off. Returns the cleanup that cancels a pending report.
 */
export function scheduleDelayedFlag(
  active: boolean,
  delay: number,
  report: (visible: boolean) => void,
): () => void {
  if (!active) {
    report(false);
    return () => {};
  }
  if (delay <= 0) {
    report(true);
    return () => {};
  }
  const timer = setTimeout(() => report(true), delay);
  return () => clearTimeout(timer);
}

/** `active`, but only after it has lasted `delay` ms. */
export function useDelayedFlag(active: boolean, delay = PENDING_DELAY_MS) {
  const [visible, setVisible] = useState(false);
  useEffect(
    () => scheduleDelayedFlag(active, delay, setVisible),
    [active, delay],
  );
  return active && visible;
}
