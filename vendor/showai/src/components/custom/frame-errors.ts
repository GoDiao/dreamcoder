/**
 * Errors raised inside a sandboxed component frame. Readable parameter
 * validation lives in ./validation-messages so readers can leave it out.
 *
 * The frame and the host share only a random per-instance channel. The host
 * accepts a report when it comes from its own iframe window on that channel
 * and has the expected shape; everything else is ignored.
 */

export const FRAME_RUNTIME_ERROR = "showai:runtime-error";

export interface FrameRuntimeError {
  /** `error`: thrown while rendering or in a handler; `rejection`: an unhandled promise. */
  kind: "error" | "rejection";
  message: string;
  stack?: string;
}

/**
 * Installed into the frame before the component script (stringified, so it
 * must stay self-contained). React reports uncaught render errors as window
 * `error` events, so render failures, handler errors and rejections all pass
 * here. The capture listener runs before the component runtime's own one.
 */
export function installFrameErrorReporter(channel: string) {
  let sent = 0;
  const report = (
    kind: "error" | "rejection",
    error: unknown,
    fallback: string,
  ) => {
    const value = error as { message?: unknown; stack?: unknown } | null;
    const message = String(
      (value && typeof value === "object" && value.message) ||
        fallback ||
        error ||
        "",
    ).slice(0, 2000);
    // Browser layout notices are not component failures.
    if (!message || /^ResizeObserver loop/.test(message) || sent >= 20) return;
    sent++;
    parent.postMessage(
      {
        channel,
        type: "showai:runtime-error",
        kind,
        message,
        ...(value &&
        typeof value === "object" &&
        typeof value.stack === "string"
          ? { stack: value.stack.slice(0, 4000) }
          : {}),
      },
      "*",
    );
  };
  window.addEventListener(
    "error",
    (event) => report("error", event.error, event.message),
    true,
  );
  window.addEventListener(
    "unhandledrejection",
    (event) => report("rejection", event.reason, ""),
    true,
  );
}

/** A runtime error report from this instance's frame, or null for anything else. */
export function readFrameRuntimeError(
  event: { source: unknown; data: unknown },
  frame: unknown,
  channel: string,
): FrameRuntimeError | null {
  if (!frame || event.source !== frame) return null;
  const data = event.data as Record<string, unknown> | null;
  if (
    !data ||
    typeof data !== "object" ||
    data.channel !== channel ||
    data.type !== FRAME_RUNTIME_ERROR ||
    (data.kind !== "error" && data.kind !== "rejection") ||
    typeof data.message !== "string" ||
    !data.message.trim()
  )
    return null;
  return {
    kind: data.kind,
    message: data.message.trim().slice(0, 2000),
    ...(typeof data.stack === "string" && data.stack
      ? { stack: data.stack.slice(0, 4000) }
      : {}),
  };
}

/** Whether a legacy `showai:error` repeats a runtime error already reported. */
export function repeatsRuntimeError(
  message: string,
  error: FrameRuntimeError | null,
) {
  return !!error && message.includes(error.message);
}
