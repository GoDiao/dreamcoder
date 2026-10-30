import { createContext } from "react";

/**
 * Set by a bound block around its component. A sandboxed component reports
 * the props its change was made from right before the change itself, so the
 * host compares the change with what the component actually showed.
 */
export const BindingBasisContext = createContext<
  ((props: Record<string, unknown>) => void) | null
>(null);
