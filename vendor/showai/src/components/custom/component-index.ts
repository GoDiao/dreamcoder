import type { CompiledComponent, CustomComponentRef } from "./types";
import { translator } from "../../i18n";
import messages from "../../i18n/messages/customComponents";

const t = translator(messages);

const exactKey = (id: string, version: string, integrity: string) =>
  `${id}@${version}#${integrity}`;

export function indexComponents(
  components: CompiledComponent[],
): ReadonlyMap<string, CompiledComponent> {
  const result = new Map<string, CompiledComponent>();
  for (const component of components) {
    const key = exactKey(component.id, component.version, component.integrity);
    const previous = result.get(key);
    if (
      previous &&
      (previous.html !== component.html ||
        JSON.stringify(previous.schema) !== JSON.stringify(component.schema) ||
        JSON.stringify(previous.inline) !== JSON.stringify(component.inline))
    )
      throw new Error(
        `Conflicting component payloads claim the same fingerprint: ${key}.`,
      );
    if (!previous) result.set(key, component);
  }
  return result;
}

export function findComponent(
  index: ReadonlyMap<string, CompiledComponent>,
  ref: CustomComponentRef,
): CompiledComponent | undefined {
  if (ref.integrity)
    return index.get(exactKey(ref.componentId, ref.version, ref.integrity));
  const candidates = [...index.values()].filter(
    (component) =>
      component.id === ref.componentId &&
      component.version === ref.version &&
      (!ref.scope || component.scope === ref.scope),
  );
  if (candidates.length > 1)
    throw new Error(
      t("ambiguousVersion", { component: `${ref.componentId}@${ref.version}` }),
    );
  return candidates[0];
}
