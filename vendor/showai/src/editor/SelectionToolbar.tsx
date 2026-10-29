import "./selection-toolbar.css";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/editor";

/** One selection menu container; object-specific actions append to its children. */
export function SelectionToolbar({
  id,
  anchor,
  anchorElement,
  children,
  onEscape,
  label,
  keyboardScope,
  viewportTop = 8,
  className,
}: {
  id: string;
  label?: string;
  keyboardScope?: string;
  anchor: { left: number; top: number; bottom?: number };
  viewportTop?: number;
  className?: string;
  anchorElement?: HTMLElement | null;
  children: ReactNode;
  onEscape: () => void;
}) {
  const t = useTranslator(messages);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);
  useLayoutEffect(() => {
    const element = menu.current!;
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      const bounds = anchorElement?.isConnected
        ? anchorElement.getBoundingClientRect()
        : null;
      const point = bounds
        ? {
            left: (bounds.left + bounds.right) / 2,
            top: bounds.top,
            bottom: bounds.bottom,
          }
        : anchor;
      const panel = element.querySelector<HTMLElement>(".editor-toolbar-panel");
      const panelHeight = panel?.getBoundingClientRect().height ?? 0;
      // Reserve space above the bar for its independent secondary panel.
      const minimumTop =
        panelHeight && viewportTop + panelHeight + height + 24 < innerHeight
          ? viewportTop + panelHeight + 8
          : viewportTop;
      const next = {
        left: Math.max(
          8,
          Math.min(point.left - width / 2, window.innerWidth - width - 8),
        ),
        top: Math.max(
          minimumTop,
          Math.min(
            point.top - height - 8 >= viewportTop
              ? point.top - height - 8
              : (point.bottom ?? point.top) + 8,
            window.innerHeight - height - 8,
          ),
        ),
      };
      setPosition((previous) =>
        previous.left === next.left && previous.top === next.top
          ? previous
          : next,
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    const panels = new MutationObserver(() => {
      element
        .querySelectorAll(".editor-toolbar-panel")
        .forEach((panel) => observer.observe(panel));
      place();
    });
    panels.observe(element, { childList: true, subtree: true });
    // Ancestors can move the anchor while the anchor's own size stays unchanged.
    if (anchorElement)
      for (
        let ancestor: HTMLElement | null = anchorElement;
        ancestor;
        ancestor = ancestor.parentElement
      )
        observer.observe(ancestor);
    window.addEventListener("resize", place);
    if (anchorElement) window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      panels.disconnect();
      window.removeEventListener("resize", place);
      if (anchorElement) window.removeEventListener("scroll", place, true);
    };
  }, [anchor.left, anchor.top, anchor.bottom, anchorElement, viewportTop]);
  return createPortal(
    <div
      ref={menu}
      id={id}
      className={`editor-bubble${className ? ` ${className}` : ""}`}
      data-editor-menu-trigger="selection"
      data-editor-keyboard-scope={keyboardScope}
      role="toolbar"
      aria-label={label ?? t("selectionToolbar")}
      style={position}
      onMouseDown={(event) => {
        if (!(event.target as Element).closest("input,select,textarea"))
          event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onEscape();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
