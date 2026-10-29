import { useEffect, useId, useRef, useState } from "react";

export interface HoveredTable {
  table: HTMLTableElement;
  cell: HTMLTableCellElement | null;
  context: { left: number; top: number } | null;
}

const acceptAll = () => true;

/** Keep the table and its detached controls in a single pointer interaction region. */
export function useTableHover(
  root: HTMLElement | null,
  options: {
    keepOpen?: boolean;
    accept?: (table: HTMLTableElement) => boolean;
    onDismiss?: () => void;
  } = {},
) {
  const owner = useId();
  const [target, setTarget] = useState<HoveredTable | null>(null);
  const [, refresh] = useState(0);
  const latest = useRef({ target, options });
  latest.current = { target, options };
  const accept = options.accept ?? acceptAll;

  useEffect(() => {
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const keep = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const owned = (element: Element | null) =>
      element
        ?.closest("[data-table-controls-owner]")
        ?.getAttribute("data-table-controls-owner") === owner;
    const dismiss = () => {
      keep();
      setTarget(null);
      latest.current.options.onDismiss?.();
    };
    const hide = () => {
      if (
        timer ||
        latest.current.options.keepOpen ||
        latest.current.target?.context ||
        owned(document.activeElement)
      )
        return;
      timer = setTimeout(dismiss, 220);
    };
    const find = (element: Element): HoveredTable | null => {
      const table = element.closest("table");
      if (
        !(table instanceof HTMLTableElement) ||
        !root.contains(table) ||
        !accept(table)
      )
        return null;
      const cell = element.closest("td, th") as HTMLTableCellElement | null;
      return {
        table,
        cell: cell?.parentElement === table.rows[0] ? cell : null,
        context: null,
      };
    };
    const enter = (next: HoveredTable) => {
      keep();
      setTarget((previous) =>
        previous?.table === next.table &&
        previous.cell === next.cell &&
        !previous.context
          ? previous
          : next,
      );
    };
    const move = (event: PointerEvent) => {
      const element = event.target as Element;
      if (owned(element)) {
        keep();
        return;
      }
      if (latest.current.options.keepOpen || latest.current.target?.context) {
        keep();
        return;
      }
      const current = latest.current.target;
      if (current?.cell?.isConnected) {
        const cell = current.cell.getBoundingClientRect();
        const column = tableControlPositions(current, 0).column;
        // Keep the header's controls while crossing the gap below it, even over a body cell.
        if (
          event.clientX >= Math.min(cell.left, column.left) &&
          event.clientX <= Math.max(cell.right, column.left + 88) &&
          event.clientY >= cell.bottom &&
          event.clientY <= column.top
        ) {
          keep();
          return;
        }
      }
      const next = find(element);
      if (next) {
        enter(next);
        return;
      }
      if (current?.table.isConnected) {
        const rect = current.table.getBoundingClientRect();
        // The controls float immediately above the border; crossing that gap must not hide them.
        if (
          event.clientX >= rect.left - 8 &&
          event.clientX <= rect.right + 8 &&
          event.clientY >= rect.top - 44 &&
          event.clientY <= rect.bottom + 8
        ) {
          keep();
          return;
        }
      }
      hide();
    };
    const down = (event: PointerEvent) => {
      const element = event.target as Element;
      if (owned(element)) {
        keep();
        return;
      }
      const next = find(element);
      if (next) {
        latest.current.options.onDismiss?.();
        enter(next);
      } else dismiss();
    };
    const context = (event: MouseEvent) => {
      const next = find(event.target as Element);
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      keep();
      latest.current.options.onDismiss?.();
      setTarget({
        ...next,
        cell: null,
        context: {
          left: Math.max(8, Math.min(event.clientX, window.innerWidth - 140)),
          top: Math.max(8, Math.min(event.clientY, window.innerHeight - 42)),
        },
      });
    };
    const focus = (event: FocusEvent) => {
      if (owned(event.target as Element)) keep();
      else {
        const next = find(event.target as Element);
        if (next) enter(next);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const viewport = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.contains(root))
        dismiss();
    };
    const update = () => refresh((value) => value + 1);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerdown", down);
    document.addEventListener("focusin", focus);
    document.addEventListener("keydown", key);
    root.addEventListener("contextmenu", context);
    window.addEventListener("blur", dismiss);
    window.addEventListener("showai:viewport-change", viewport);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      keep();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("keydown", key);
      root.removeEventListener("contextmenu", context);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("showai:viewport-change", viewport);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [root, accept, owner]);
  return { target, setTarget, owner };
}

export function tableControlPositions(
  target: HoveredTable,
  globalWidth: number,
) {
  const rect = target.table.getBoundingClientRect();
  const scroll = target.table
    .closest(".tableWrapper, .sb-table-scroll")
    ?.getBoundingClientRect();
  const right = Math.min(
    rect.right,
    scroll?.right ?? rect.right,
    window.innerWidth - 8,
  );
  const globalLeft = Math.max(8, right - globalWidth);
  const top = Math.max(8, rect.top - 36);
  const cell = target.cell?.getBoundingClientRect();
  const columnLeft = cell ? (cell.left + cell.right - 88) / 2 : globalLeft;
  return {
    global: target.context ?? {
      left: Math.max(globalWidth + 8, right),
      top,
      transform: "translateX(-100%)",
    },
    column: {
      left: Math.max(8, Math.min(columnLeft, right - 88)),
      top: cell ? cell.bottom + 4 : top,
    },
  };
}
