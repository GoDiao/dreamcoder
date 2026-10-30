import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./toolbar-panel.css";

/** Secondary controls stay in the owning toolbar's DOM and keyboard scope. */
export function ToolbarPanel({
  children,
  className = "",
  onDismiss,
}: {
  children: ReactNode;
  className?: string;
  onDismiss: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useLayoutEffect(() => {
    const element = panel.current!;
    const toolbar = element.parentElement?.closest<HTMLElement>(
      ".editor-bubble, .editor-toolbar",
    );
    if (!toolbar) return;
    const place = () => {
      const bounds = toolbar.getBoundingClientRect();
      const { width, height } = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(bounds.left + (bounds.width - width) / 2, innerWidth - width - 8))}px`;
      const above = bounds.top - height - 8;
      element.style.top = `${Math.max(8, Math.min(above >= 8 ? above : bounds.bottom + 8, innerHeight - height - 8))}px`;
    };
    element.showPopover();
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    observer.observe(toolbar);
    const movement = new MutationObserver(place);
    movement.observe(toolbar, { attributes: true, attributeFilter: ["style"] });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target))
        dismiss.current();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      movement.disconnect();
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      if (element.matches(":popover-open")) element.hidePopover();
    };
  }, []);
  return (
    <div
      ref={panel}
      popover="manual"
      className={`editor-toolbar-panel ${className}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismiss.current();
        }
      }}
    >
      {children}
    </div>
  );
}
