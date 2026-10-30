import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type RefObject,
  type PointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";
import {
  readToolbarDock,
  toolbarSnapTarget,
  toolbarPanelRect,
  toolbarRectSnapTarget,
  toolbarEdgeGap,
  toolbarCenter,
  constrainToolbarPoint,
  type DockEdge,
  type ToolbarDock,
} from "./toolbar-dock";
import "./toolbar-dock.css";
import { toolbarPopovers } from "./toolbar-popovers";

const ToolbarDockContext = createContext<DockEdge>("bottom");
export const useToolbarDock = () => useContext(ToolbarDockContext);
const horizontal = (edge: DockEdge) => edge === "top" || edge === "bottom";
type Point = { x: number; y: number };

export function DockableBoardToolbar({
  children,
  actions,
  properties,
  root,
  enabled,
}: {
  children: ReactNode;
  actions?: ReactNode;
  properties?: ReactNode;
  root: RefObject<HTMLDivElement | null>;
  enabled: boolean;
}) {
  const t = useTranslator(messages);
  const mobile =
    typeof document !== "undefined" &&
    document.documentElement.dataset.native === "ios";
  const preference = `showai:board-toolbar:${mobile ? "mobile" : "desktop"}`;
  const [dock, setDock] = useState(() => {
    try {
      const saved = readToolbarDock(localStorage.getItem(preference));
      return mobile
        ? { edge: saved.edge, position: 0.5 }
        : saved;
    } catch {
      return readToolbarDock(null);
    }
  });
  const [edge, setEdge] = useState(dock.edge),
    [dragging, setDragging] = useState(false);
  const [geometry, setGeometry] = useState({
    bounds: { width: 0, height: 0 },
    size: { width: 0, height: 0 },
  });
  const outer = useRef<HTMLDivElement>(null),
    primary = useRef<HTMLDivElement>(null);
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const drag = useRef<{
    id: number;
    start: Point;
    pointer: Point;
    along: number;
    across: number;
    edge: DockEdge;
    snapped: DockEdge | null;
    snapOrigin: { pointer: Point; gap: number } | null;
    active: boolean;
    origin: ToolbarDock;
  } | null>(null);
  const position = useRef<Point | null>(null),
    frame = useRef(0),
    suppressClick = useRef(false);
  const paintRef = useRef<() => void>(() => {});
  const schedule = () => {
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        paintRef.current();
      });
  };
  useEffect(() => {
    const surface = root.current!,
      element = primary.current!;
    const measure = () => {
      const next = {
        bounds: { width: surface.clientWidth, height: surface.clientHeight },
        size: { width: element.offsetWidth, height: element.offsetHeight },
      };
      geometryRef.current = next;
      setGeometry((previous) =>
        previous.bounds.width === next.bounds.width &&
        previous.bounds.height === next.bounds.height &&
        previous.size.width === next.size.width &&
        previous.size.height === next.size.height
          ? previous
          : next,
      );
      if (drag.current?.active) schedule();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [root]);
  useEffect(
    () =>
      mobile && outer.current ? toolbarPopovers(outer.current) : undefined,
    [mobile],
  );
  const restore = (origin: ToolbarDock) => {
    flushSync(() => {
      setDock(origin);
      setEdge(origin.edge);
    });
    const element = primary.current;
    const measured = {
      bounds: geometryRef.current.bounds,
      size: element
        ? { width: element.offsetWidth, height: element.offsetHeight }
        : geometryRef.current.size,
    };
    geometryRef.current = measured;
    setGeometry(measured);
    const point = toolbarCenter(origin, measured.bounds, measured.size);
    if (outer.current) {
      outer.current.style.left = `${point.x}px`;
      outer.current.style.top = `${point.y}px`;
    }
  };
  const save = (next: ToolbarDock) => {
    setDock(next);
    setEdge(next.edge);
    try {
      localStorage.setItem(
        preference,
        `${next.edge}:${next.position}${next.floating ? `:${next.floating.x}:${next.floating.y}` : ""}`,
      );
    } catch {
      /* Personal placement remains usable when storage is unavailable. */
    }
  };
  const pointer = (event: PointerEvent) => {
    const rect = root.current!.getBoundingClientRect(),
      bounds = geometryRef.current.bounds;
    return {
      x: ((event.clientX - rect.left) * bounds.width) / rect.width,
      y: ((event.clientY - rect.top) * bounds.height) / rect.height,
    };
  };
  const secondaryVisible = () =>
    !!outer.current
      ?.querySelector<HTMLElement>(":scope > .board-toolbar-secondary")
      ?.getClientRects().length;
  const freePosition = () => {
    const current = drag.current!,
      { bounds, size } = geometryRef.current;
    const raw = horizontal(current.edge)
      ? {
          x: current.pointer.x + (0.5 - current.along) * size.width,
          y: current.pointer.y + (0.5 - current.across) * size.height,
        }
      : {
          x: current.pointer.x + (0.5 - current.across) * size.width,
          y: current.pointer.y + (0.5 - current.along) * size.height,
        };
    return constrainToolbarPoint(raw, bounds, size);
  };
  const locate = () => {
    const current = drag.current!,
      { bounds, size } = geometryRef.current;
    const point = freePosition();
    const target: ToolbarDock = {
      edge: current.edge,
      position: mobile && current.snapped ? 0.5 : horizontal(current.edge)
        ? point.x / Math.max(1, bounds.width)
        : point.y / Math.max(1, bounds.height),
    };
    if (!current.snapped)
      target.floating = {
        x: point.x / Math.max(1, bounds.width),
        y: point.y / Math.max(1, bounds.height),
      };
    return {
      target,
      point: current.snapped ? toolbarCenter(target, bounds, size) : point,
    };
  };
  paintRef.current = () => {
    if (!drag.current?.active || !outer.current) return;
    const next = locate().point;
    position.current = next;
    outer.current.style.left = `${next.x}px`;
    outer.current.style.top = `${next.y}px`;
  };
  const advance = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current?.id !== event.pointerId) return;
    if (
      !current.active &&
      Math.hypot(
        event.clientX - current.start.x,
        event.clientY - current.start.y,
      ) < 6
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (!current.active) {
      // Until actual movement, the browser owns the pressed control's native
      // focus/click. Taking capture on pointerdown retargets that click and
      // breaks buttons inside an embedded editor's NodeView.
      event.currentTarget.setPointerCapture(event.pointerId);
      current.active = true;
      position.current = toolbarCenter(
        dock,
        geometryRef.current.bounds,
        geometryRef.current.size,
      );
      setDragging(true);
    }
    current.pointer = pointer(event);
    const bounds = geometryRef.current.bounds,
      scale = bounds.width / root.current!.getBoundingClientRect().width;
    let snapped: ToolbarDock | null;
    if (mobile) {
      const band = 96 * scale;
      const rect = toolbarPanelRect(
        freePosition(),
        geometryRef.current.size,
        current.edge,
        secondaryVisible(),
      );
      const origin = current.snapOrigin,
        attached = current.snapped;
      const pull =
        !origin || !attached
          ? Infinity
          : attached === "left"
            ? current.pointer.x - origin.pointer.x
            : attached === "right"
              ? origin.pointer.x - current.pointer.x
              : attached === "top"
                ? current.pointer.y - origin.pointer.y
                : origin.pointer.y - current.pointer.y;
      // Keep the entry geometry while attached: rotating a long strip into a
      // side dock must not detach it on the very next pointer sample.
      if (origin && attached && origin.gap + pull <= band * 1.4)
        snapped = { edge: attached, position: 0.5 };
      else {
        snapped = toolbarRectSnapTarget(rect, bounds, band);
        current.snapOrigin = snapped
          ? {
              pointer: { ...current.pointer },
              gap: toolbarEdgeGap(rect, bounds, snapped.edge),
            }
          : null;
      }
    } else
      snapped = toolbarSnapTarget(
        current.pointer,
        bounds,
        current.snapped,
        44 * scale,
      );
    current.snapped = snapped?.edge ?? null;
    const next =
      snapped?.edge ??
      (horizontal(current.edge)
        ? current.pointer.y < bounds.height / 2
          ? "top"
          : "bottom"
        : current.pointer.x < bounds.width / 2
          ? "left"
          : "right");
    if (next !== current.edge) {
      current.edge = next;
      // Orientation changes resize the strip. Measure that layout before
      // the next sample/up so the grabbed control stays under the finger.
      flushSync(() => setEdge(next));
      const element = primary.current!;
      const measured = {
        bounds: geometryRef.current.bounds,
        size: {
          width: element.offsetWidth,
          height: element.offsetHeight,
        },
      };
      geometryRef.current = measured;
      setGeometry(measured);
    }
    schedule();
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = drag.current;
    if (current?.id !== event.pointerId) return;
    if (!cancel) advance(event);
    if (current.active) {
      if (!cancel && (!mobile || current.snapped)) {
        current.pointer = pointer(event);
        save(locate().target);
      } else restore(current.origin);
      setDragging(false);
    }
    suppressClick.current = current.active;
    drag.current = null;
    position.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const center =
    dragging && position.current
      ? position.current
      : toolbarCenter(dock, geometry.bounds, geometry.size);
  return (
    <ToolbarDockContext.Provider value={edge}>
      <div
        ref={outer}
        className="surface-toolbar board-dockable-toolbar"
        data-dock={edge}
        data-mobile={mobile || undefined}
        data-floating={!!dock.floating || undefined}
        data-dragging={dragging || undefined}
        data-surface-ui
        role="group"
        aria-label={t("board.tools")}
        tabIndex={enabled ? 0 : undefined}
        style={
          {
            left: center.x,
            top: center.y,
            bottom: "auto",
            "--board-properties-reserve": "0px",
            "--board-toolbar-height": `${geometry.bounds.height}px`,
            "--board-toolbar-width": `${geometry.bounds.width}px`,
          } as CSSProperties
        }
        onContextMenu={(event) => {
          if (primary.current?.contains(event.target as Node))
            event.preventDefault();
        }}
        onPointerDownCapture={(event) => {
          suppressClick.current = false;
          if (
            !enabled ||
            event.button !== 0 ||
            !event.isPrimary ||
            (event.target as Element).closest(
              'input,select,textarea,[role="slider"],[contenteditable="true"],.board-color-menu,.surface-navigation,.board-align-options,.board-component-settings',
            ) ||
            (mobile && !primary.current?.contains(event.target as Node))
          )
            return;
          const rect = primary.current!.getBoundingClientRect(),
            along = horizontal(edge)
              ? (event.clientX - rect.left) / rect.width
              : (event.clientY - rect.top) / rect.height,
            across = horizontal(edge)
              ? (event.clientY - rect.top) / rect.height
              : (event.clientX - rect.left) / rect.width;
          // Record drag intent without cancelling a button's native tap.
          // Capture begins only when advance observes real pointer movement.
          drag.current = {
            id: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            pointer: pointer(event),
            along,
            across,
            edge,
            snapped: dock.floating ? null : edge,
            snapOrigin: dock.floating
              ? null
              : {
                  pointer: pointer(event),
                  gap: toolbarEdgeGap(
                    toolbarPanelRect(
                      toolbarCenter(
                        dock,
                        geometryRef.current.bounds,
                        geometryRef.current.size,
                      ),
                      geometryRef.current.size,
                      edge,
                      secondaryVisible(),
                    ),
                    geometryRef.current.bounds,
                    edge,
                  ),
                },
            active: false,
            origin: dock,
          };
        }}
        onPointerMove={advance}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) finish(event, true);
        }}
        onClickCapture={(event) => {
          if (suppressClick.current && event.detail !== 0) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onKeyDown={(event) => {
          if (
            !enabled ||
            (event.target !== event.currentTarget && !event.altKey)
          )
            return;
          if (event.key === "Escape" && drag.current) {
            const current = drag.current;
            drag.current = null;
            position.current = null;
            cancelAnimationFrame(frame.current);
            frame.current = 0;
            setDragging(false);
            restore(current.origin);
            if (event.currentTarget.hasPointerCapture(current.id))
              event.currentTarget.releasePointerCapture(current.id);
            return;
          }
          const next = (
            {
              ArrowUp: "top",
              ArrowDown: "bottom",
              ArrowLeft: "left",
              ArrowRight: "right",
            } as Record<string, DockEdge>
          )[event.key];
          if (next) {
            event.preventDefault();
            event.stopPropagation();
            save({ edge: next, position: 0.5 });
          }
        }}
      >
        <div ref={primary} className="board-toolbar-primary">
          {children}
          {!mobile && properties && (
            <div className="board-toolbar-inline-properties" data-surface-ui>
              {properties}
            </div>
          )}
        </div>
        {mobile ? (
          <div className="board-toolbar-secondary" data-surface-ui>
            <div className="board-toolbar-settings">{properties}</div>
            <div className="board-toolbar-actions" data-surface-ui>
              {actions}
            </div>
          </div>
        ) : (
          actions && (
            <div className="board-toolbar-actions" data-surface-ui>
              {actions}
            </div>
          )
        )}
      </div>
    </ToolbarDockContext.Provider>
  );
}
