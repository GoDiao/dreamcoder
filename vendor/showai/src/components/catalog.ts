import primitives from "../../resources/catalog/primitives.json";
import components from "../../resources/catalog/components.json";
import surfaces from "../../resources/catalog/surfaces.json";
import g2 from "../../resources/catalog/g2.json";
import diagrams from "../../resources/catalog/diagrams.json";
import diagramDocumentation from "../../resources/catalog/diagram-documentation.json";
import documentation from "../../resources/catalog/component-documentation.json";
import type { ComponentDocumentation } from "./custom/documentation";
import type { BuiltinComponentMetadata } from "./custom/types";
/** Shared discovery data for the workspace, standalone editor and Agent. */
export function builtinComponentCatalog({
  includeLegacy = false,
}: { includeLegacy?: boolean } = {}) {
  const items = structuredClone([
    ...primitives,
    ...components,
    ...g2,
    ...diagrams,
    ...surfaces,
  ]).map((item) => ({
    ...item,
    documentation: (
      { ...documentation, ...diagramDocumentation } as unknown as Record<
        string,
        ComponentDocumentation
      >
    )[item.kind],
  })) as BuiltinComponentMetadata[];
  return includeLegacy ? items : items.filter((item) => !item.replacedBy);
}
export function builtinComponent(kind: string) {
  return builtinComponentCatalog({ includeLegacy: true }).find(
    (item) => item.kind === kind,
  );
}
