/**
 * "报告问题" from any problem notice dispatches `showai:report-problem` on
 * `window` as a CustomEvent. The feedback surface (About & feedback) listens
 * for it and opens a prefilled report; until it does, the event has no
 * listener and the notice still offers 复制详情.
 *
 *   window.addEventListener(REPORT_PROBLEM_EVENT, (event) => event.detail.code)
 *
 * `message` is already redacted (home → ~, library → <library>, tokens
 * removed); listeners may show it to the person and include it in a report.
 */
import { recordProblem } from "./problem-log";

export const REPORT_PROBLEM_EVENT = "showai:report-problem";

export interface ReportProblemDetail {
  /** Where the problem was shown, e.g. "studio", "save", "component". */
  source: string;
  /** Most specific code: errno, CoreError code, HTTP_<status> or ERROR. */
  code: string;
  /** Redacted technical details including the original error text. */
  message: string;
  /** ISO time the problem happened. */
  at: string;
  /** Display name of the failed operation, when known. */
  action?: string;
}

declare global {
  interface WindowEventMap {
    [REPORT_PROBLEM_EVENT]: CustomEvent<ReportProblemDetail>;
  }
}

/**
 * Asks the feedback surface to open a prefilled report. Returns false when a
 * listener took it over (called preventDefault), true when nobody did.
 */
export function dispatchReportProblem(detail: ReportProblemDetail): boolean {
  recordProblem(detail);
  return window.dispatchEvent(
    new CustomEvent<ReportProblemDetail>(REPORT_PROBLEM_EVENT, {
      detail,
      cancelable: true,
    }),
  );
}

/** Subscribes to report requests; returns the unsubscribe function. */
export function onReportProblem(
  listener: (detail: ReportProblemDetail) => void,
): () => void {
  const receive = (event: CustomEvent<ReportProblemDetail>) =>
    listener(event.detail);
  window.addEventListener(REPORT_PROBLEM_EVENT, receive);
  return () => window.removeEventListener(REPORT_PROBLEM_EVENT, receive);
}
