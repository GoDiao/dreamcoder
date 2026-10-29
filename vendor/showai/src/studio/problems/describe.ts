/**
 * Turns any thrown value (CoreError results from IPC, Node system errors,
 * CAPACITY_EXCEEDED, fetch failures, HTTP statuses) into the parts of a
 * problem notice: what happened, whether content is safe, why, what to do,
 * and the original text as technical details.
 */
import { translator, type MessageKey } from "../../i18n";
import messages from "../../i18n/messages/errors";

const t = translator(messages);

/** Fixed answer to "is my content safe?". */
export type ProblemSafety = "saved" | "draftKept" | "windowOnly";

/** Suggested follow-ups; the caller binds the ones it can perform. */
export type ProblemActionId =
  | "retry"
  | "reload"
  | "librarySpace"
  | "reveal"
  | "chooseLocation"
  | "openSettings";

export interface ProblemContext {
  /** Display name of the operation, e.g. 导出网站 / Export site. */
  action?: string;
  /** Display name of the object, e.g. a page title. */
  object?: string;
  /** Whether the person's content is safe; only the caller knows this. */
  safety?: ProblemSafety;
  /** Version line for the details, e.g. "0.10.0 (6d8d3b9)". */
  app?: string;
  /** Where the problem was raised, e.g. "studio" or "save". */
  source?: string;
}

export interface ProblemFacts {
  code?: string;
  errno?: string;
  path?: string;
  syscall?: string;
  kind?: string;
  actualBytes?: number;
  limitBytes?: number;
  status?: number;
  /** The fetch/network layer failed before any response. */
  network?: boolean;
  message: string;
}

export interface ProblemDescription {
  title: string;
  safety?: ProblemSafety;
  /** Human sentence about the cause; absent when unknown. */
  cause?: string;
  /** Suggested follow-ups, most useful first. */
  actions: ProblemActionId[];
  /** Multi-line technical details with the original text. */
  details: string;
  /** Most specific machine code: errno, CoreError code or HTTP_<status>. */
  code: string;
  /** Original error text. */
  message: string;
  action?: string;
  source: string;
  /** ISO time the problem was described. */
  at: string;
}

type ErrorKey = MessageKey<typeof messages>;

function field<T>(value: unknown, key: string, type: string): T | undefined {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === type ? (item as T) : undefined;
}

/** Reads the structured fields that survive IPC from any thrown value. */
export function problemFacts(error: unknown): ProblemFacts {
  const message =
    typeof error === "string"
      ? error
      : (field<string>(error, "message", "string") ?? String(error));
  const rawCode = field<string>(error, "code", "string");
  const isErrno = (value?: string) => !!value && /^E[A-Z0-9]+$/.test(value);
  const cause = field<object>(error, "cause", "object");
  const errno =
    field<string>(error, "errno", "string") ??
    (isErrno(rawCode) ? rawCode : undefined) ??
    (isErrno(field<string>(cause, "code", "string"))
      ? field<string>(cause, "code", "string")
      : undefined);
  const network =
    rawCode === "NETWORK" ||
    (error instanceof TypeError &&
      /failed to fetch|networkerror|load failed|fetch failed/i.test(message));
  return {
    message,
    ...(rawCode && !isErrno(rawCode) ? { code: rawCode } : {}),
    ...(errno ? { errno } : {}),
    ...(field<string>(error, "path", "string")
      ? { path: field<string>(error, "path", "string") }
      : field<string>(cause, "path", "string")
        ? { path: field<string>(cause, "path", "string") }
        : {}),
    ...(field<string>(error, "syscall", "string")
      ? { syscall: field<string>(error, "syscall", "string") }
      : {}),
    ...(field<string>(error, "kind", "string")
      ? { kind: field<string>(error, "kind", "string") }
      : {}),
    ...(field<number>(error, "actualBytes", "number") !== undefined
      ? { actualBytes: field<number>(error, "actualBytes", "number") }
      : {}),
    ...(field<number>(error, "limitBytes", "number") !== undefined
      ? { limitBytes: field<number>(error, "limitBytes", "number") }
      : {}),
    ...(field<number>(error, "status", "number") !== undefined
      ? { status: field<number>(error, "status", "number") }
      : {}),
    ...(network ? { network: true } : {}),
  };
}

const ERRNO: Record<string, { cause: ErrorKey; actions: ProblemActionId[] }> = {
  ENOSPC: { cause: "cause.diskFull", actions: ["librarySpace", "retry"] },
  EDQUOT: { cause: "cause.diskFull", actions: ["librarySpace", "retry"] },
  EACCES: { cause: "cause.permission", actions: ["reveal", "chooseLocation"] },
  EPERM: { cause: "cause.permission", actions: ["reveal", "chooseLocation"] },
  EROFS: { cause: "cause.readOnly", actions: ["chooseLocation"] },
  ENOENT: { cause: "cause.notFound", actions: ["retry"] },
  EEXIST: { cause: "cause.exists", actions: ["chooseLocation"] },
  ENOTEMPTY: { cause: "cause.notEmpty", actions: ["chooseLocation"] },
  EISDIR: { cause: "cause.wrongType", actions: ["chooseLocation"] },
  ENOTDIR: { cause: "cause.wrongType", actions: ["chooseLocation"] },
  ENAMETOOLONG: { cause: "cause.nameTooLong", actions: ["chooseLocation"] },
  EMFILE: { cause: "cause.tooManyFiles", actions: ["retry"] },
  ENFILE: { cause: "cause.tooManyFiles", actions: ["retry"] },
  EBUSY: { cause: "cause.busy", actions: ["retry"] },
  EAGAIN: { cause: "cause.busy", actions: ["retry"] },
  EIO: { cause: "cause.io", actions: ["retry"] },
  ECONNREFUSED: { cause: "cause.connection", actions: ["retry"] },
  ECONNRESET: { cause: "cause.connection", actions: ["retry"] },
  ENOTFOUND: { cause: "cause.connection", actions: ["retry"] },
  EAI_AGAIN: { cause: "cause.connection", actions: ["retry"] },
  ENETUNREACH: { cause: "cause.connection", actions: ["retry"] },
  ETIMEDOUT: { cause: "cause.timeout", actions: ["retry"] },
};

const CODES: Record<string, { cause: ErrorKey; actions: ProblemActionId[] }> = {
  LOCKED: { cause: "cause.busy", actions: ["retry"] },
  NOT_FOUND: { cause: "cause.notFound", actions: [] },
  CONFLICT: { cause: "cause.conflict", actions: [] },
  INVALID_DATA: { cause: "cause.invalidData", actions: [] },
  INVALID_PATH: { cause: "cause.invalidPath", actions: [] },
  SNAPSHOT_EXPIRED: { cause: "cause.snapshotExpired", actions: ["retry"] },
  MISSING_BASELINE: { cause: "cause.missingBaseline", actions: ["retry"] },
  SOURCE_UNAVAILABLE: { cause: "cause.sourceUnavailable", actions: [] },
  CONFIRMATION_REQUIRED: { cause: "cause.confirmationRequired", actions: [] },
};

function httpCause(status: number): { cause: ErrorKey; actions: ProblemActionId[] } | undefined {
  if (status === 401) return { cause: "cause.unauthorized", actions: ["reload"] };
  if (status === 403) return { cause: "cause.forbidden", actions: [] };
  if (status === 404) return { cause: "cause.notFound", actions: [] };
  if (status === 409) return { cause: "cause.conflict", actions: [] };
  if (status === 413) return { cause: "cause.tooLarge", actions: [] };
  if (status === 429) return { cause: "cause.rateLimited", actions: ["retry"] };
  if (status >= 500) return { cause: "cause.server", actions: ["retry"] };
  return undefined;
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Most specific code for reports and de-duplication. */
export function problemCode(facts: ProblemFacts): string {
  if (facts.errno) return facts.errno;
  if (facts.network) return "NETWORK";
  if (facts.code && facts.code !== "ERROR" && facts.code !== "HTTP_ERROR")
    return facts.code;
  if (facts.status) return `HTTP_${facts.status}`;
  return facts.code ?? "ERROR";
}

export function describeError(
  error: unknown,
  context: ProblemContext = {},
): ProblemDescription {
  const facts = problemFacts(error);
  const code = problemCode(facts);
  let cause: string | undefined;
  let actions: ProblemActionId[] = [];
  const known =
    (facts.errno ? ERRNO[facts.errno] : undefined) ??
    (facts.network ? { cause: "cause.network" as const, actions: ["retry" as const] } : undefined) ??
    (facts.code ? CODES[facts.code] : undefined) ??
    (facts.status ? httpCause(facts.status) : undefined);
  if (facts.code === "CAPACITY_EXCEEDED") {
    cause =
      facts.actualBytes !== undefined && facts.limitBytes !== undefined
        ? t("cause.capacity", {
            actual: formatSize(facts.actualBytes),
            limit: formatSize(facts.limitBytes),
          })
        : t("cause.capacityUnknown");
  } else if (known) {
    cause = t(known.cause, { status: facts.status ?? "" });
    actions = [...known.actions];
  }
  // Revealing needs a path; choosing another location only fits writes the
  // caller can redirect, which it signals by binding the action.
  if (!facts.path) actions = actions.filter((item) => item !== "reveal");
  const title = context.action
    ? context.object
      ? t("actionFailedObject", { action: context.action, object: context.object })
      : t("actionFailed", { action: context.action })
    : (cause ?? t("genericTitle"));
  if (!context.action && cause) cause = undefined;
  const at = new Date().toISOString();
  const lines: [ErrorKey, string | number | undefined][] = [
    ["detail.action", context.action],
    ["detail.object", context.object],
    ["detail.code", facts.code && facts.code !== code ? `${code} (${facts.code})` : code],
    ["detail.errno", facts.errno && facts.syscall ? `${facts.errno} · ${facts.syscall}` : undefined],
    ["detail.path", facts.path],
    ["detail.status", facts.status],
    [
      "detail.kind",
      facts.kind
        ? facts.actualBytes !== undefined && facts.limitBytes !== undefined
          ? `${facts.kind} · ${facts.actualBytes} / ${facts.limitBytes} bytes`
          : facts.kind
        : undefined,
    ],
    ["detail.time", at],
    ["detail.app", context.app],
    ["detail.message", facts.message],
  ];
  return {
    title,
    ...(context.safety ? { safety: context.safety } : {}),
    ...(cause ? { cause } : {}),
    actions,
    details: lines
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => `${t(key)}: ${value}`)
      .join("\n"),
    code,
    message: facts.message,
    ...(context.action ? { action: context.action } : {}),
    source: context.source ?? "studio",
    at,
  };
}

/** Sentence for a ProblemSafety value. */
export function safetyText(safety: ProblemSafety): string {
  return t(`safety.${safety}`);
}

// The workbench sets the platform of the machine holding its files (the
// browser workbench's server, not the browser), so 显示所在位置 names the
// file manager the person will actually see, as the save banners do.
let problemPlatform: string | undefined;

export function configureProblemPlatform(platform: string | undefined) {
  problemPlatform = platform;
}

/** Label for revealing a path in the platform's file manager. */
export function revealLabel(platform = problemPlatform): string {
  return platform === "darwin" || platform === "win32" || platform === "linux"
    ? t(`action.reveal.${platform}`)
    : t("action.reveal");
}

/** Label for a suggested action. */
export function actionLabel(action: ProblemActionId): string {
  return action === "reveal" ? revealLabel() : t(`action.${action}`);
}
