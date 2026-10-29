import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A container may host an object's existing actions without recreating its commands. */
export const BlockActionHost = createContext<{
  target: HTMLElement | null;
  selected: boolean;
  closeSettings?: () => void;
} | null>(null);

/**
 * Items a host maps into a component from elsewhere (e.g. shared dataset
 * records), by item id: their source and the fields that cannot change here.
 */
export interface BlockItemSource {
  label?: string;
  readOnly: readonly string[];
  removable: boolean;
}
export const BlockItemSources = createContext<ReadonlyMap<
  string,
  BlockItemSource
> | null>(null);

export function BlockActions({ children }: { children: ReactNode }) {
  const host = useContext(BlockActionHost);
  if (!host) return children;
  return host.selected && host.target
    ? createPortal(children, host.target)
    : null;
}

export function BlockSettings({ children }: { children: ReactNode }) {
  const host = useContext(BlockActionHost);
  if (!host) return children;
  // Keep the component and its draft mounted when selection changes.
  return host.target
    ? createPortal(
        <div
          className="board-component-settings"
          data-surface-ui
          hidden={!host.selected}
          onKeyDown={(event) => {
            if (event.key === "Escape" && host.closeSettings) {
              event.preventDefault();
              event.stopPropagation();
              host.closeSettings();
              // The settings toggle is the last header action and is active while open.
              host.target
                ?.querySelector<HTMLButtonElement>(
                  ".sb-actions > button.sb-icon-button.is-active:last-child",
                )
                ?.focus({ preventScroll: true });
            }
          }}
        >
          {children}
        </div>,
        host.target,
      )
    : null;
}
