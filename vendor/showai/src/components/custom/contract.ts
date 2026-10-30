import { CAPACITY, assertContent } from "../../portable/capacity.mjs";
import type { ShowDocument } from "../../types";
import type {
  CompiledComponent,
  CustomBlockData,
  CustomComponentRef,
} from "./types";

export const COMPONENT_ID = /^[a-z][a-z0-9-]{0,79}$/;
export const COMPONENT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?$/;
export const COMPONENT_DATA_MARKER = "<!--SHOWAI_COMPONENT_DATA-->";

/** Insert serialized user content literally, including JavaScript replacement tokens. */
export function injectComponentBootstrap(
  html: string,
  bootstrap: string,
): string {
  if (!html.includes(COMPONENT_DATA_MARKER))
    throw new Error("组件缺少运行入口。"); // i18n-exempt: shared contract validation text (CLI/MCP)
  return html.replace(COMPONENT_DATA_MARKER, () => bootstrap);
}

/** Browser-safe JSON validation; schema compilation stays in the component runtime. */
export function assertJsonValue(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error("Component data is nested too deeply.");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item) => assertJsonValue(item, depth + 1));
    return;
  }
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new Error("Component data contains a reserved property.");
      assertJsonValue(item, depth + 1);
    }
    return;
  }
  throw new Error("Component data must contain only JSON values.");
}

export function componentWidgetData(
  component: Pick<
    CompiledComponent,
    "id" | "version" | "integrity" | "defaultData"
  >,
  props: Record<string, unknown> = component.defaultData,
): Record<string, unknown> {
  assertJsonValue(props);
  assertContent(props, "Component instance data", CAPACITY.componentPropsBytes);
  return {
    ...readCustomBlockData({
      componentId: component.id,
      version: component.version,
      integrity: component.integrity,
      props: structuredClone(props),
    }),
  };
}

export function componentKey(id: string, version: string): string {
  return `${id}@${version}`;
}

export function readCustomBlockData(value: unknown): CustomBlockData {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Custom block data must be an object.");
  const data = value as Record<string, unknown>;
  if (
    typeof data.componentId !== "string" ||
    !COMPONENT_ID.test(data.componentId)
  )
    throw new Error("A custom block needs a valid componentId.");
  if (typeof data.version !== "string" || !COMPONENT_VERSION.test(data.version))
    throw new Error("A custom block needs an exact component version.");
  if (
    data.integrity !== undefined &&
    (typeof data.integrity !== "string" ||
      !/^sha256-[a-f0-9]{64}$/.test(data.integrity))
  )
    throw new Error("Invalid component integrity hash.");
  if (
    data.scope !== undefined &&
    !["project", "global", "published", "builtin"].includes(String(data.scope))
  )
    throw new Error("Invalid component scope.");
  if (
    !data.props ||
    typeof data.props !== "object" ||
    Array.isArray(data.props)
  )
    throw new Error("Custom block props must be an object.");
  assertJsonValue(data.props);
  assertContent(
    data.props,
    "Component instance data",
    CAPACITY.componentPropsBytes,
  );
  return {
    componentId: data.componentId,
    version: data.version,
    props: data.props as Record<string, unknown>,
    ...(data.integrity ? { integrity: data.integrity as string } : {}),
    ...(data.scope ? { scope: data.scope as CustomComponentRef["scope"] } : {}),
  };
}

export function collectCustomComponentRefs(
  document: ShowDocument,
): CustomComponentRef[] {
  const refs = new Map<string, CustomComponentRef>();
  const visit = (node: typeof document.content) => {
    if (node.type === "widget" && node.attrs?.kind === "custom") {
      const { componentId, version, integrity, scope } = readCustomBlockData(
        node.attrs.data,
      );
      const key = `${componentKey(componentId, version)}:${integrity ?? scope ?? "unpinned"}`;
      const previous = refs.get(key);
      refs.set(key, {
        componentId,
        version,
        integrity: integrity ?? previous?.integrity,
        ...(scope ? { scope } : {}),
      });
    }
    const renderer =
      node.type === "surface" && node.attrs?.kind === "page"
        ? node.attrs?.outline?.renderer
        : undefined;
    if (renderer) {
      const ref = readCustomBlockData(renderer);
      refs.set(
        `${componentKey(ref.componentId, ref.version)}:${ref.integrity}`,
        ref,
      );
    }
    node.content?.forEach(visit);
  };
  visit(document.content);
  return [...refs.values()];
}
