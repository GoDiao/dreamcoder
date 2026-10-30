export interface ComponentContextSnapshot {
  /** Visible to the Agent with the next message. */
  model: unknown;
  /** Returned only to the same component instance, never to the Agent. */
  private?: unknown;
  /** Short text for the conversation chip. */
  label?: string;
}
export const componentContextLimits: Readonly<{
  modelBytes: number;
  totalBytes: number;
  labelChars: number;
  depth: number;
  perMessage: number;
}>;
export function componentContextIssue(
  snapshot: unknown,
  limits?: {
    modelBytes: number;
    totalBytes: number;
    labelChars: number;
    depth: number;
  },
): string;
export const componentViewStateLimits: Readonly<{ bytes: number; depth: number }>;
export function componentViewStateIssue(
  value: unknown,
  limits?: { bytes: number; depth: number },
): string;
