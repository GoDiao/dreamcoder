import type { RedactOptions } from "../../core/redact";

// The workbench sets the open library once it knows it, so every
// 复制详情 / 报告问题 replaces it with <library> without threading props.
let current: RedactOptions = {};

export function configureProblemRedaction(options: RedactOptions) {
  current = { ...options };
}

export function problemRedaction(): RedactOptions {
  return current;
}
