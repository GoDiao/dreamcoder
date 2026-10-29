export function validatePrimitiveData(
  kind: string,
  data: Record<string, unknown>,
): void;

export function tableColumnAlignment(
  data: Record<string, unknown>,
  column: number,
): "left" | "center" | "right" | "justify";
export function alignTableData(
  data: Record<string, unknown>,
  column: number | null,
  alignment: "left" | "center" | "right",
): Record<string, unknown>;
export declare const MAX_STEPS: number;
