export type DiagramFamily =
  "archify" | "diagram-design" | "fireworks-tech-graph";
export const diagramTemplates: Readonly<Record<DiagramFamily, string[]>>;
export function validateDiagramData(
  kind: string,
  data: Record<string, unknown>,
): void;
