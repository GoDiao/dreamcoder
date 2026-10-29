import { redact } from "../../core/redact";
import type { ProblemDescription } from "./describe";
import { problemRedaction } from "./redaction";

/** Redacted plain text of a problem for 复制详情 and 报告问题; light enough for readers. */
export function problemReportText(problem: ProblemDescription) {
  return redact(
    [problem.title, problem.cause, problem.details].filter(Boolean).join("\n"),
    problemRedaction(),
  );
}
