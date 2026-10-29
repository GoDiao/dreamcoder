import { redact } from "../../core/redact";
import { problemRedaction } from "./redaction";

/** One problem the workbench showed or someone asked to report. */
export interface LoggedProblem {
  at: string;
  source: string;
  code: string;
  /** Redacted; at most a few hundred characters. */
  message: string;
}

const LIMIT = 20;
const MESSAGE_LIMIT = 400;
const entries: LoggedProblem[] = [];

/**
 * Keeps the latest problems of this window in memory for 诊断信息. Nothing is
 * written to disk; the same problem (time, source and code) is kept once.
 */
export function recordProblem(problem: LoggedProblem): void {
  const message = redact(problem.message, {
    ...problemRedaction(),
    truncateIds: true,
  })
    .replace(/\s+/g, " ")
    .trim();
  const entry = {
    at: problem.at,
    source: problem.source,
    code: problem.code,
    message:
      message.length > MESSAGE_LIMIT
        ? `${message.slice(0, MESSAGE_LIMIT)}…`
        : message,
  };
  const index = entries.findIndex(
    (item) =>
      item.at === entry.at &&
      item.source === entry.source &&
      item.code === entry.code,
  );
  if (index >= 0) entries.splice(index, 1);
  entries.push(entry);
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
}

/** Newest last. */
export function recentProblems(): LoggedProblem[] {
  return entries.map((item) => ({ ...item }));
}

export function clearProblemLog(): void {
  entries.length = 0;
}
