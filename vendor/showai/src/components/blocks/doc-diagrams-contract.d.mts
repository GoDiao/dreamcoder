export type DiagramTone =
  "accent" | "teal" | "orange" | "violet" | "rose" | "slate";
export declare const DIAGRAM_TONES: readonly DiagramTone[];
export declare const LAYER_TONE_ORDER: readonly DiagramTone[];
export declare const STEP_KINDS: readonly ("call" | "reply" | "note")[];
export declare const SEQUENCE_LIMITS: { actors: number; steps: number };
export declare const LAYER_LIMITS: { layers: number; modules: number };
export declare function validateDocDiagramData(
  kind: string,
  data: unknown,
): Record<string, unknown>;
export declare function detailParagraphs(source: unknown): string[];
