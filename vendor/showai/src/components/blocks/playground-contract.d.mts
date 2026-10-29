export type ExpressionNode =
  | { type: "num"; value: number }
  | { type: "ref"; id: string }
  | { type: "unary"; op: "-" | "+"; arg: ExpressionNode }
  | { type: "binary"; op: string; left: ExpressionNode; right: ExpressionNode }
  | { type: "call"; name: string; args: ExpressionNode[] };

export interface NumberFormat {
  prefix?: string;
  suffix?: string;
  decimals?: number;
  divisor?: number;
  signed?: boolean;
}
export interface PlaygroundOption {
  label: string;
  value: number;
  note?: string;
}
export interface PlaygroundInput {
  id: string;
  label: string;
  type?: "slider" | "stepper" | "toggle" | "choice";
  /** Required for slider and stepper. */
  min?: number;
  max?: number;
  /** Required for slider; stepper defaults to 1. */
  step?: number;
  /** Required for slider and stepper; choice defaults to its first option, toggle to 0. */
  value?: number;
  unit?: string;
  hint?: string;
  options?: PlaygroundOption[];
}
export interface PlaygroundFormula {
  id: string;
  expr: string;
  label?: string;
  unit?: string;
  format?: NumberFormat;
}
export interface PlaygroundTarget {
  value: number | string;
  label?: string;
  above?: string;
  below?: string;
}
export interface PlaygroundOutput {
  formula: string;
  label?: string;
  unit?: string;
  hint?: string;
  format?: NumberFormat;
  target?: PlaygroundTarget;
}
export interface PlaygroundBreakdown {
  title?: string;
  format?: NumberFormat;
  items: { formula: string; label?: string; color?: string }[];
}
export interface PlaygroundPreset {
  label: string;
  values: Record<string, number>;
}
export interface RankingCriterion {
  id: string;
  label: string;
  hint?: string;
  color?: string;
  weight?: number | string;
}
export interface RankingItem {
  id: string;
  label: string;
  note?: string;
  scores: Record<string, number>;
}
export interface PlaygroundRanking {
  title?: string;
  scale?: number;
  decimals?: number;
  criteria: RankingCriterion[];
  items: RankingItem[];
}
export interface PlaygroundData {
  title?: string;
  description?: string;
  note?: string;
  inputs: PlaygroundInput[];
  operation?: "sum" | "product" | "average";
  resultLabel?: string;
  unit?: string;
  formulas?: PlaygroundFormula[];
  outputs?: PlaygroundOutput[];
  breakdown?: PlaygroundBreakdown;
  presets?: PlaygroundPreset[];
  ranking?: PlaygroundRanking;
}
export interface CompiledFormula {
  id: string;
  tree: ExpressionNode;
}
export interface RankedItem {
  item: RankingItem;
  index: number;
  parts: { id: string; value: number }[];
  score: number;
}

export declare const OPERATIONS: readonly string[];
export declare const INPUT_TYPES: readonly string[];
export declare const EXPRESSION_FUNCTIONS: readonly string[];
export declare const LIMITS: Readonly<Record<string, number>>;
export declare function parseExpression(source: string): ExpressionNode;
export declare function expressionRefs(tree: ExpressionNode): string[];
export declare function evaluateExpression(
  tree: ExpressionNode,
  scope: Record<string, number>,
): number;
export declare function inputType(
  input: PlaygroundInput,
): "slider" | "stepper" | "toggle" | "choice";
export declare function inputDefault(input: PlaygroundInput): number;
export declare function clampInput(
  input: PlaygroundInput,
  value: number,
): number;
export declare function isLegacyPlayground(
  data: Record<string, unknown>,
): boolean;
export declare function compilePlayground(
  data: Record<string, unknown>,
): CompiledFormula[];
export declare function evaluatePlayground(
  data: Record<string, unknown>,
  values?: Record<string, number>,
  compiled?: CompiledFormula[],
): Record<string, number>;
export declare function breakdownParts(
  data: Record<string, unknown>,
  scope: Record<string, number>,
): {
  formula: string;
  label?: string;
  color?: string;
  value: number;
  share: number;
}[];
export declare function rankItems(
  ranking: PlaygroundRanking,
  scope: Record<string, number>,
): RankedItem[];
export declare function formatNumber(
  value: number,
  format?: NumberFormat,
  locale?: string,
): string;
export declare function validatePlaygroundData(data: unknown): PlaygroundData;
