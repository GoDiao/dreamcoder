/**
 * One status card for a component that cannot show its content: 运行出错 /
 * 参数不符 / 组件缺失. Built-in blocks and sandboxed custom components share
 * it. It names the component, says the rest of the page and the data are
 * safe, and offers what can be done here. Readers and exports see the same
 * card without editing actions or technical details.
 */
import { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  Copy,
  FileJson,
  Flag,
  Puzzle,
  TriangleAlert,
} from "../../ui/icons";
import { useTranslator } from "../../i18n/react";
import type { ProblemDescription } from "../../studio/problems/describe";
import messages from "../../i18n/messages/componentStatus";
import widgetMessages from "../../i18n/messages/widget";
import type { AssistantBridge } from "../assistant-context";
// Direct module imports keep the reader bundle free of the workbench notice UI.
import { dispatchReportProblem } from "../../studio/problems/report-event";
import { problemReportText } from "../../studio/problems/report-text";
import { downloadFile } from "./helpers";
import "./component-status.css";

export type ComponentStatusState = "crashed" | "invalid" | "missing";

/** Asks the workbench to open the component library filtered by a query. */
export const FIND_COMPONENT_EVENT = "showai:find-component";

export interface ComponentStatusProps {
  state: ComponentStatusState;
  /** Display name, e.g. 示例图表; falls back to the reference. */
  name: string;
  /** Stable identity: `id@version` for custom components, the kind for built-ins. */
  reference: string;
  /** Library search for a missing component. */
  query?: string;
  /** Original technical message. */
  error?: string;
  stack?: string;
  /** Readable parameter issues (参数不符). */
  issues?: string[];
  /** Replaces the state's title, e.g. when the data cannot be read here. */
  title?: string;
  /** Replaces the default cause sentence. */
  cause?: string;
  integrity?: string;
  /** Block data shown and downloadable in the technical details. */
  data?: unknown;
  /** Readers, exports and read-only pages: no editing actions or details. */
  readOnly?: boolean;
  onRetry?: () => void;
  assistant?: AssistantBridge | null;
  /** The status replaces the component (blank) or sits above it. */
  attached?: boolean;
}

async function writeClipboard(text: string) {
  if (typeof window !== "undefined" && window.showai)
    await window.showai.invoke("clipboard:write", { text });
  else await navigator.clipboard.writeText(text);
}

export function ComponentStatus({
  state,
  name,
  reference,
  query,
  error,
  stack,
  issues = [],
  title: customTitle,
  cause,
  integrity,
  data,
  readOnly = false,
  onRetry,
  assistant,
  attached = false,
}: ComponentStatusProps) {
  const tw = useTranslator(widgetMessages);
  const t = useTranslator(messages);
  const card = useRef<HTMLElement>(null);
  const [copy, setCopy] = useState<"" | "copied" | "failed">("");
  const [renderedAt] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (copy !== "copied") return;
    const timer = setTimeout(() => setCopy(""), 2000);
    return () => clearTimeout(timer);
  }, [copy]);
  const label = name || reference;
  const title = customTitle ?? t(
    state === "crashed"
      ? "status.crashed"
      : state === "invalid"
        ? "status.invalid"
        : "status.missing",
    { name: label },
  );
  const shownIssues = issues.slice(0, 4);
  const reason =
    cause ??
    (state === "crashed"
      ? t("status.crashedCause")
      : state === "missing"
        ? t("status.missingCause", { component: reference })
        : undefined);
  const technical = [
    error,
    stack && stack !== error ? stack.split("\n").slice(0, 8).join("\n") : "",
    `${reference}${integrity ? ` · ${integrity}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
  // Built here rather than through describeError so readers don't bundle the
  // workbench error catalogue.
  const problem: ProblemDescription = {
    code:
      state === "crashed"
        ? "COMPONENT_CRASHED"
        : state === "invalid"
          ? "COMPONENT_INVALID"
          : "COMPONENT_MISSING",
    source: "component",
    at: renderedAt,
    message: error ?? title,
    actions: [],
    title,
    cause: [reason, ...issues].filter(Boolean).join("\n"),
    details: technical,
  };
  const copyText = (text: string) =>
    writeClipboard(text).then(
      () => setCopy("copied"),
      () => setCopy("failed"),
    );
  const blockId = () => {
    const owner = card.current?.closest<HTMLElement>(
      "[data-block-id],[data-surface-id]",
    );
    return owner?.dataset.blockId ?? owner?.dataset.surfaceId;
  };
  const askAgent = (prompt: string) => {
    const rect = card.current?.getBoundingClientRect();
    const anchor = rect
      ? { left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom }
      : undefined;
    const id = blockId();
    assistant?.open(
      id && anchor
        ? { kind: "blocks", blockIds: [id], anchor, prompt }
        : { kind: "page", anchor, prompt },
    );
  };
  const agentError = [error, ...issues].filter(Boolean).join("; ") || title;
  const editable = !readOnly;
  const actions: { label: string; onSelect: () => void; icon?: boolean }[] = [];
  if (state === "crashed" && onRetry)
    actions.push({ label: t("status.retry"), onSelect: onRetry });
  if (state !== "missing" && editable && assistant)
    actions.push({
      label: t("status.askAgent"),
      onSelect: () =>
        askAgent(
          t(state === "crashed" ? "status.promptCrashed" : "status.promptInvalid", {
            name: label,
            component: reference,
            error: agentError,
          }),
        ),
    });
  if (state !== "missing")
    actions.push({
      label: copy === "copied" ? t("status.copied") : t("status.copyDetails"),
      onSelect: () => void copyText(problemReportText(problem)),
      icon: true,
    });
  if (state === "missing") {
    if (editable && typeof window !== "undefined" && window.showai)
      actions.push({
        label: t("status.findInLibrary"),
        onSelect: () =>
          window.dispatchEvent(
            new CustomEvent(FIND_COMPONENT_EVENT, {
              detail: { query: query ?? reference },
            }),
          ),
      });
    if (editable && assistant)
      actions.push({
        label: t("status.askAgentInstall"),
        onSelect: () =>
          askAgent(t("status.promptMissing", { component: reference })),
      });
    actions.push({
      label: copy === "copied" ? t("status.copied") : t("status.copyId"),
      onSelect: () => void copyText(reference),
      icon: true,
    });
  }
  const tone = state === "crashed" ? "error" : "warning";
  const Icon =
    state === "missing" ? Puzzle : state === "crashed" ? CircleAlert : TriangleAlert;
  return (
    <section
      ref={card}
      className={`sb-block sb-unavailable component-status problem-notice tone-${tone}${attached ? " is-attached" : ""}`}
      role="alert"
      aria-label={title}
      data-component-status={state}
    >
      <span className="problem-notice-icon">
        <Icon size={16} aria-hidden />
      </span>
      <div className="problem-notice-body">
        <strong className="problem-notice-title">{title}</strong>
        <p className="problem-notice-safety">{t("status.safety")}</p>
        {reason && <p className="problem-notice-cause">{reason}</p>}
        {!!shownIssues.length && (
          <ul className="component-status-issues">
            {shownIssues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
            {issues.length > shownIssues.length && (
              <li className="component-status-more">
                {t("status.moreIssues", {
                  count: issues.length - shownIssues.length,
                })}
              </li>
            )}
          </ul>
        )}
        <div className="problem-notice-actions">
          {actions.map((action, index) => (
            <button
              key={action.label}
              type="button"
              className={index === 0 && !action.icon ? "is-primary" : undefined}
              onClick={action.onSelect}
            >
              {action.icon && <Copy size={13} aria-hidden />}
              {action.label}
            </button>
          ))}
        </div>
        {copy === "failed" && (
          <p className="problem-notice-copy-error" role="status">
            {t("status.copyFailed")}
          </p>
        )}
        {editable && (
          <details className="problem-notice-details">
            <summary>{t("status.details")}</summary>
            <pre>{technical}</pre>
            {data !== undefined && (
              <details className="component-status-data">
                <summary>{tw("viewData")}</summary>
                <pre>{JSON.stringify(data, null, 2)}</pre>
              </details>
            )}
            <div className="problem-notice-detail-actions">
              {data !== undefined && (
                <button
                  type="button"
                  onClick={() =>
                    downloadFile(
                      JSON.stringify({ component: reference, data }, null, 2),
                      `${reference.replace(/[^\w.@-]+/g, "-")}.json`,
                      "application/json",
                    )
                  }
                >
                  <FileJson size={13} />
                  {tw("downloadData")}
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  dispatchReportProblem({
                    source: problem.source,
                    code: problem.code,
                    message: problemReportText(problem),
                    at: problem.at,
                  })
                }
              >
                <Flag size={13} />
                {t("status.reportProblem")}
              </button>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
