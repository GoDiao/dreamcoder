import { createContext, type ComponentType, type ReactNode } from "react";
import type { BlockProps } from "../components/blocks/types";

/**
 * The workbench's renderers for blocks bound to shared data. Readers and
 * exports have no host: their documents carry a snapshot instead of bindings.
 */
export const BoundWidgetHost = createContext<{
  Bound: ComponentType<
    BlockProps & {
      kind: string;
      render: (props: BlockProps & { kind: string }) => ReactNode;
    }
  >;
  Action: ComponentType<BlockProps & { kind: string }>;
} | null>(null);

/** Whether block data carries a shared data binding (see binding.mjs). */
export function hasBinding(data: unknown): boolean {
  const binding =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>).$binding
      : undefined;
  return !!binding && typeof binding === "object" && !Array.isArray(binding);
}
