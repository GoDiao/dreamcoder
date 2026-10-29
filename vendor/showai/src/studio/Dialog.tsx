import { useEffect, useRef, type ReactNode } from "react";
import { X } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import studioMessages from "../i18n/messages/studio";

export default function Dialog({
  title,
  children,
  onClose,
  wide = false,
  className = "",
  titleAccessory,
  headerContent,
  headerActions,
  dismissible = true,
  initialFocus = "auto",
  returnFocus,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  titleAccessory?: ReactNode;
  headerContent?: ReactNode;
  headerActions?: ReactNode;
  dismissible?: boolean;
  initialFocus?: "auto" | "container";
  returnFocus?: HTMLElement | null;
}) {
  const t = useTranslator(studioMessages);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = dismissible ? onClose : () => {};
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    (initialFocus === "container"
      ? panel.current
      : (panel.current?.querySelector<HTMLElement>(
          className.includes("catalog-")
            ? '[role="tab"][aria-selected="true"]'
            : "input:not([disabled]),textarea:not([disabled]),select:not([disabled])",
        ) ?? panel.current)
    )?.focus();
    const handle = (event: KeyboardEvent) => {
      // A local file picker can sit above a component or publication dialog.
      if (
        panel.current !==
        [...document.querySelectorAll('[role="dialog"]')].at(-1)
      )
        return;
      if (event.key === "Escape") {
        if (
          panel.current?.contains(document.fullscreenElement) ||
          document.querySelector('[role="menu"]')
        )
          return;
        close.current();
      }
      if (event.key === "Tab") {
        const items = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],summary,[tabindex],[contenteditable="true"]',
          ) ?? []),
        ].filter(
          (item) =>
            item.offsetParent !== null &&
            item.tabIndex >= 0 &&
            !item.closest("[inert]"),
        );
        const first = items[0],
          last = items.at(-1);
        if (
          document.activeElement === panel.current ||
          !panel.current?.contains(document.activeElement)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      (returnFocus?.isConnected ? returnFocus : previous)?.focus({
        preventScroll: true,
      });
    };
  }, []);
  return (
    <div
      className="studio-modal-shade"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`studio-modal ${wide ? "wide" : ""} ${className}`}
      >
        <header>
          {titleAccessory ? (
            <div className="studio-modal-title">
              <h2>{title}</h2>
              {titleAccessory}
            </div>
          ) : (
            <h2>{title}</h2>
          )}
          {headerContent}
          {headerActions ? (
            <div className="studio-modal-header-actions">
              {headerActions}{" "}
              {dismissible && (
                <button
                  className="studio-icon"
                  aria-label={t("closeDialog")}
                  data-no-tooltip
                  onClick={onClose}
                >
                  <X size={18} />
                </button>
              )}
            </div>
          ) : (
            <>
              {" "}
              {dismissible && (
                <button
                  className="studio-icon"
                  aria-label={t("closeDialog")}
                  data-no-tooltip
                  onClick={onClose}
                >
                  <X size={18} />
                </button>
              )}
            </>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}
