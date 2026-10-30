/**
 * The shared menu surface for sidebar rows, cards and page actions. It lives
 * apart from the sidebar rows so page readers can use it without bundling the
 * workbench navigation.
 */
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./library-row.css";

export interface LibraryMenuPoint {
  x: number;
  y: number;
}

interface LibraryMenuItemBase {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  shortcut?: string;
  checked?: boolean;
  /** One line under the label that says what the action produces. */
  description?: string;
  /** Items sharing a group follow one heading; a new group starts a new section. */
  group?: string;
}
export type LibraryContextMenuItem = LibraryMenuItemBase &
  (
    | { onSelect: () => void; control?: never }
    | { control: ReactNode; onSelect?: never }
  );

export function LibraryMenuControl({ item }: { item: LibraryContextMenuItem }) {
  return (
    <div className="studio-context-menu-control" role="none">
      <div className="studio-context-menu-control-label">
        {item.icon}
        <span>{item.label}</span>
      </div>
      {item.control}
    </div>
  );
}

export interface LibraryContextMenuProps {
  anchor: HTMLElement;
  portalRoot?: HTMLElement;
  point?: LibraryMenuPoint;
  label: string;
  items: LibraryContextMenuItem[];
  onClose: () => void;
}

interface MenuPosition {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
}

function enabledItems(
  menu: HTMLElement,
): (HTMLButtonElement | HTMLInputElement)[] {
  return [
    ...menu.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button[role="menuitem"],button[role="menuitemradio"],input[type="range"]',
    ),
  ].filter((item) => !item.disabled);
}

/** A single menu surface works for sidebar rows, cards and page actions. */
export function LibraryContextMenu({
  anchor,
  portalRoot,
  point,
  label,
  items,
  onClose,
}: LibraryContextMenuProps) {
  const id = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const restoreFocus = useRef(true);
  const focusedOnce = useRef(false);
  const search = useRef({ value: "", time: 0 });
  const [position, setPosition] = useState<MenuPosition | null>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const document = anchor.ownerDocument;
    const window = document.defaultView;
    if (!menu || !window || !anchor.isConnected) {
      latestClose.current();
      return;
    }
    restoreFocus.current = true;
    focusedOnce.current = false;
    const previousExpanded = anchor.getAttribute("aria-expanded");
    const previousControls = anchor.getAttribute("aria-controls");
    anchor.setAttribute("aria-expanded", "true");
    anchor.setAttribute("aria-controls", id);

    const reposition = () => {
      if (!anchor.isConnected) {
        latestClose.current();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (
        rect.bottom < 0 ||
        rect.top > height ||
        rect.right < 0 ||
        rect.left > width
      ) {
        latestClose.current();
        return;
      }
      const margin = 8;
      const gap = point ? 0 : 5;
      const origin = point
        ? { left: point.x, right: point.x, top: point.y, bottom: point.y }
        : rect;
      const maxWidth = Math.max(0, width - margin * 2);
      const menuWidth = Math.min(menu.getBoundingClientRect().width, maxWidth);
      const below = Math.max(0, height - origin.bottom - gap - margin);
      const above = Math.max(0, origin.top - gap - margin);
      const naturalHeight = menu.scrollHeight;
      const flip = naturalHeight > below && above > below;
      const maxHeight = Math.max(
        0,
        Math.min(height - margin * 2, flip ? above : below),
      );
      const visibleHeight = Math.min(naturalHeight, maxHeight);
      let left = origin.left;
      if (left + menuWidth > width - margin) left = origin.right - menuWidth;
      left = Math.max(margin, Math.min(left, width - margin - menuWidth));
      const top = Math.max(
        margin,
        Math.min(
          flip ? origin.top - gap - visibleHeight : origin.bottom + gap,
          height - margin - visibleHeight,
        ),
      );
      const next = { left, top, maxWidth, maxHeight };
      setPosition((previous) =>
        previous &&
        Object.keys(next).every(
          (key) =>
            previous[key as keyof MenuPosition] ===
            next[key as keyof MenuPosition],
        )
          ? previous
          : next,
      );
    };

    const outsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || menu.contains(target) || anchor.contains(target)) return;
      // Let the clicked control receive focus naturally instead of stealing it.
      restoreFocus.current = false;
      latestClose.current();
    };
    const outsideFocus = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (target && !menu.contains(target) && !anchor.contains(target)) {
        restoreFocus.current = false;
        latestClose.current();
      }
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menu.contains(event.target)) return;
      if (point) latestClose.current();
      else reposition();
    };

    reposition();
    document.addEventListener("pointerdown", outsidePointer, true);
    document.addEventListener("focusin", outsideFocus);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", scroll, true);
    const observer = new ResizeObserver(reposition);
    observer.observe(anchor);
    observer.observe(menu);

    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outsidePointer, true);
      document.removeEventListener("focusin", outsideFocus);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", scroll, true);
      if (previousExpanded === null) anchor.removeAttribute("aria-expanded");
      else anchor.setAttribute("aria-expanded", previousExpanded);
      if (previousControls === null) anchor.removeAttribute("aria-controls");
      else anchor.setAttribute("aria-controls", previousControls);
      if (restoreFocus.current && anchor.isConnected)
        anchor.focus({ preventScroll: true });
    };
  }, [anchor, point, id]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!position || !menu || focusedOnce.current) return;
    focusedOnce.current = true;
    (enabledItems(menu)[0] ?? menu).focus({ preventScroll: true });
  }, [position, anchor, point]);

  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    const buttons = enabledItems(menu);
    const document = anchor.ownerDocument;
    const current = buttons.findIndex(
      (button) => button === document.activeElement,
    );
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!buttons.length) return;
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : current < 0
              ? event.key === "ArrowDown"
                ? 0
                : buttons.length - 1
              : (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
      buttons[index].focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      latestClose.current();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const focusable = [
        ...document.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex],iframe,[contenteditable="true"]',
        ),
      ].filter(
        (element) =>
          !menu.contains(element) &&
          element.tabIndex >= 0 &&
          element.getClientRects().length > 0 &&
          !element.closest('[inert],[aria-hidden="true"]'),
      );
      const index = focusable.indexOf(anchor);
      const next =
        index < 0
          ? focusable[event.shiftKey ? focusable.length - 1 : 0]
          : focusable[index + (event.shiftKey ? -1 : 1)];
      restoreFocus.current = false;
      latestClose.current();
      queueMicrotask(() => {
        if (next?.isConnected) next.focus({ preventScroll: true });
        else if (anchor.isConnected) anchor.focus({ preventScroll: true });
      });
      return;
    }
    if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.nativeEvent.isComposing
    ) {
      const now = Date.now();
      const character = event.key.toLocaleLowerCase();
      search.current = {
        value:
          now - search.current.time > 700
            ? character
            : search.current.value + character,
        time: now,
      };
      const ordered = [
        ...buttons.slice(current + 1),
        ...buttons.slice(0, current + 1),
      ];
      const match = ordered.find((button) =>
        button.textContent
          ?.trim()
          .toLocaleLowerCase()
          .startsWith(search.current.value),
      );
      if (match) {
        event.preventDefault();
        match.focus();
      }
    }
  };

  const style: CSSProperties = {
    position: "fixed",
    left: position?.left ?? 0,
    top: position?.top ?? 0,
    maxWidth: position?.maxWidth ?? "calc(100vw - 16px)",
    maxHeight: position?.maxHeight ?? "calc(100vh - 16px)",
    overflowY: "auto",
    visibility: position ? "visible" : "hidden",
  };

  return createPortal(
    <div
      id={id}
      ref={menuRef}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className="studio-context-menu"
      style={style}
      onKeyDown={handleKeyboard}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <div key={`${index}-${item.label}`} role="none">
          {(item.separatorBefore ||
            (!!item.group && item.group !== items[index - 1]?.group)) &&
            index > 0 && (
              <div role="separator" className="studio-context-menu-separator" />
            )}
          {item.group && item.group !== items[index - 1]?.group && (
            <div role="presentation" className="studio-context-menu-group">
              {item.group}
            </div>
          )}
          {item.control ? (
            <LibraryMenuControl item={item} />
          ) : (
            <button
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={item.checked}
              tabIndex={-1}
              className={`studio-context-menu-item${item.danger ? " danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                latestClose.current();
                item.onSelect?.();
              }}
            >
              {item.icon && (
                <span className="studio-context-menu-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              {item.description ? (
                <span className="studio-context-menu-text">
                  <span>{item.label}</span>
                  <span className="studio-context-menu-description">
                    {item.description}
                  </span>
                </span>
              ) : (
                <span>{item.label}</span>
              )}
              {item.shortcut && (
                <span
                  className="studio-context-menu-shortcut"
                  aria-hidden="true"
                >
                  {item.shortcut}
                </span>
              )}
            </button>
          )}
        </div>
      ))}
    </div>,
    portalRoot ?? anchor.ownerDocument.body,
  );
}
