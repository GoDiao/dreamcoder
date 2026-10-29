export const STAGE_STATES: readonly ["ok", "warn", "bad", "idle", "active"];
export function validateFlowchartData(
  data: Record<string, unknown>,
): Record<string, unknown>;
export function journeyStepEdges(
  flow: { edges: { id: string; source: string; target: string }[] },
  journey: { steps: { node: string; edge?: string }[] },
): (string | undefined)[];
