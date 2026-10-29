import type { ReactNode } from "react";

/** Claims a complete viewport gesture for an embedded component. */
export function GestureBoundary({
  children,
  axes = ["x", "y", "zoom"],
}: {
  children: ReactNode;
  axes?: ("x" | "y" | "zoom")[];
}) {
  return <div data-surface-gesture={axes.join(" ")}>{children}</div>;
}
