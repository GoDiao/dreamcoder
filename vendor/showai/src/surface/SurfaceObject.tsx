import { isTextPointerTarget } from "./text-selection";
import {
  drawingBounds,
  geometryFrame,
  frameFromGeometry,
} from "./drawing-geometry.mjs";
import type { JSONContent } from "@tiptap/core";
import { resizeFrame, frameHeight, frameBounds } from "./geometry.mjs";
import type { BoardGesture } from "./useBoardInteraction";
import { BlockActionHost } from "../components/blocks/action-host";
import type { MessageKey } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  GripHorizontal,
  LockKeyhole,
  Settings2,
  Maximize2,
} from "../ui/icons";
import type { NodeLayout } from "./types";
import { isBoardShape } from "./board-input.mjs";

import { ObjectContext } from "./object-context";
export { ObjectContext, type ObjectActions } from "./object-context";

export function SurfaceObject({
  id,
  name,
  frame,
  positioned,
  region = false,
  archiveGroup = false,
  container = false,
  drawing = false,
  drawingNode,
  component = false,
  fixedHeight = false,
  rotatable = false,
  resizable = true,
  children,
}: {
  id: string;
  name: string;
  frame?: NodeLayout;
  positioned: boolean;
  region?: boolean;
  archiveGroup?: boolean;
  container?: boolean;
  drawing?: boolean;
  drawingNode?: JSONContent;
  component?: boolean;
  fixedHeight?: boolean;
  rotatable?: boolean;
  resizable?: boolean;
  children: ReactNode;
}) {
  const t = useTranslator(messages);
  const actions = useContext(ObjectContext);
  const board = positioned ? actions.board : undefined;
  const element = useRef<HTMLElement>(null),
    handle = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false),
    [moving, setMoving] = useState(false);
  const latest = useRef({ frame, move: actions.move });
  latest.current = { frame, move: actions.move };
  const pending = useRef<{
    id: number;
    x: number;
    y: number;
    start: NodeLayout;
    next: NodeLayout;
    resize: boolean;
    kind: BoardGesture;
    delegated: boolean;
    scale: number;
  } | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {
        root: element.current!.closest(".surface-scroll"),
        rootMargin: "600px",
      },
    );
    observer.observe(element.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = element.current,
      geometry = actions.geometry;
    if (!node || !geometry || !visible || !positioned || drawing || fixedHeight)
      return;
    const measure = () =>
      geometry.measure(id, node.offsetWidth, node.offsetHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => {
      observer.disconnect();
      geometry.forget(id);
    };
  }, [actions.geometry, id, visible, positioned, drawing, fixedHeight]);
  const apply = (value: NodeLayout) => {
    const node = element.current!;
    node.style.left = `${value.x}px`;
    node.style.top = `${value.y}px`;
    node.style.width =
      container && !positioned
        ? `min(100%, ${value.width}px)`
        : `${value.width}px`;
    if (fixedHeight && value.height) node.style.height = `${value.height}px`;
    if (positioned)
      node.style.transform = value.rotation
        ? `rotate(${value.rotation}deg)`
        : "";
  };
  const cancel = () => {
    const drag = pending.current;
    if (!drag) return;
    if (drag.delegated) board?.cancel();
    pending.current = null;
    setMoving(false);
    if (latest.current.frame) apply(latest.current.frame);
    if (handle.current?.hasPointerCapture(drag.id))
      handle.current.releasePointerCapture(drag.id);
  };
  useEffect(() => {
    if (!moving) return;
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, [moving]);
  useEffect(() => {
    if (!actions.move) cancel();
  }, [actions.move]);
  const start = (
    event: ReactPointerEvent<HTMLElement>,
    resize = false,
    kind: BoardGesture = resize ? "resize" : "move",
  ) => {
    if (
      event.defaultPrevented ||
      (event.pointerType === "pen" && isBoardShape(drawingNode)) ||
      event.button !== 0 ||
      (!positioned && !resize) ||
      !frame ||
      !actions.move
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey && !resize && kind === "move") {
      actions.select(id, true);
      return;
    }
    const delegated = !!board?.start(id, kind, event);
    if (!delegated) actions.select(id);
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    handle.current = event.currentTarget;
    pending.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: frame,
      next: frame,
      resize,
      kind,
      delegated,
      scale:
        element.current!.getBoundingClientRect().width /
          frameBounds({
            ...frame,
            contentSize: undefined,
            height: element.current!.offsetHeight,
          }).width || actions.scale,
    };
    setMoving(true);
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = pending.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.delegated) {
      board?.update(event);
      return;
    }
    if (drag.kind === "rotate") {
      if (
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3 &&
        drag.next === drag.start
      )
        return;
      const rect = element.current!.getBoundingClientRect(),
        cx = rect.left + rect.width / 2,
        cy = rect.top + rect.height / 2;
      let rotation =
        (drag.start.rotation ?? 0) +
        ((Math.atan2(event.clientY - cy, event.clientX - cx) -
          Math.atan2(drag.y - cy, drag.x - cx)) *
          180) /
          Math.PI;
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
      drag.next = { ...drag.start, rotation: ((rotation + 540) % 360) - 180 };
      apply(drag.next);
      return;
    }
    const dx = (event.clientX - drag.x) / drag.scale,
      dy = (event.clientY - drag.y) / drag.scale;
    drag.next = drag.resize
      ? {
          ...drag.start,
          width: Math.max(
            drawing || archiveGroup ? 1 : 120,
            Math.min(10000, drag.start.width + dx),
          ),
          ...(fixedHeight
            ? {
                height: Math.max(
                  container ? 180 : 1,
                  Math.min(1000000, (drag.start.height ?? 420) + dy),
                ),
              }
            : {}),
        }
      : {
          ...drag.start,
          x: Math.max(-1000000, Math.min(1000000, drag.start.x + dx)),
          y: Math.max(-1000000, Math.min(1000000, drag.start.y + dy)),
        };
    apply(drag.next);
  };
  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = pending.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.delegated) {
      board?.update(event);
      board?.finish();
      pending.current = null;
      setMoving(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    move(event);
    const actual = latest.current.frame;
    const unchanged =
      actual &&
      actual.x === drag.start.x &&
      actual.y === drag.start.y &&
      actual.width === drag.start.width &&
      actual.height === drag.start.height &&
      actual.rotation === drag.start.rotation;
    pending.current = null;
    setMoving(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (
      unchanged &&
      (drag.next.x !== drag.start.x ||
        drag.next.y !== drag.start.y ||
        drag.next.width !== drag.start.width ||
        drag.next.height !== drag.start.height ||
        drag.next.rotation !== drag.start.rotation)
    )
      latest.current.move?.(id, drag.next);
    else if (actual) apply(actual);
  };
  const handlers = {
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  };
  const style: CSSProperties =
    positioned && frame
      ? {
          position: "absolute",
          left: frame.x,
          top: frame.y,
          width: frame.width,
          minHeight: frame.height,
          transform: frame.rotation
            ? `rotate(${frame.rotation}deg)`
            : undefined,
        }
      : { position: "relative", minWidth: 0 };
  if (container && !positioned && frame)
    style.width = `min(100%, ${frame.width}px)`;
  if (frame) {
    (style as Record<string, unknown>)["--frame-width"] = `${frame.width}px`;
    (style as Record<string, unknown>)["--frame-x"] = `${frame.x}px`;
    (style as Record<string, unknown>)["--frame-y"] = `${frame.y}px`;
  }
  if (frame?.height)
    (style as Record<string, unknown>)["--frame-height"] = `${frame.height}px`;
  if (fixedHeight) {
    style.height = frame?.height ?? 460;
    style.minHeight = undefined;
  }
  const mount =
    drawing ||
    visible ||
    actions.revealAll ||
    actions.revealed.has(id) ||
    (board?.ids.has(id) ?? actions.selected === id);
  const ink = !actions.nativeScene && drawingNode && drawingBounds(drawingNode);
  const outline =
    ink && drawingNode
      ? {
          left: `${(ink.x / drawingNode.attrs!.extent[0]) * 100}%`,
          top: `${(ink.y / drawingNode.attrs!.extent[1]) * 100}%`,
          width: `${(ink.width / drawingNode.attrs!.extent[0]) * 100}%`,
          height: `${(ink.height / drawingNode.attrs!.extent[1]) * 100}%`,
        }
      : undefined;
  const chrome =
    visible || moving || (board?.ids.has(id) ?? actions.selected === id);
  // A multi-selection shares one set of handles on its group outline.
  const single = !board || board.ids.size <= 1;
  const locked = !!frame?.locked;
  const drawingTool = drawingNode?.attrs?.tool;
  const resizeDirections =
    drawingTool === "arrow"
      ? []
      : drawing
        ? ["nw", "ne", "se", "sw"]
        : fixedHeight
          ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
          : ["e", "w"];
  const drawingHandle = (direction: string) => {
    if (!ink || !drawingNode) return undefined;
    const x =
      ink.x +
      ink.width *
        (direction.includes("w") ? 0 : direction.includes("e") ? 1 : 0.5);
    let y =
      ink.y +
      ink.height *
        (direction.includes("n") ? 0 : direction.includes("s") ? 1 : 0.5);
    return {
      left: `${(x / drawingNode.attrs!.extent[0]) * 100}%`,
      top: `${(y / drawingNode.attrs!.extent[1]) * 100}%`,
    };
  };
  return (
    <section
      ref={element}
      style={style}
      className={`surface-object${region ? " is-region" : ""}${archiveGroup ? " is-ink-archive-group" : ""}${container ? " is-container" : ""}${drawing ? " is-drawing" : ""}${moving ? " is-moving" : ""}${locked ? " is-locked" : ""}${(board?.ids.has(id) ?? actions.selected === id) ? " is-selected" : ""}`}
      data-surface-id={id}
      data-board-drawing={(drawing && positioned && !!board) || undefined}
      data-board-shape={isBoardShape(drawingNode) || undefined}
      data-surface-mounted={mount}
      data-board-fixed-height={fixedHeight}
      data-surface-name={name}
      data-surface-content
      aria-label={name}
      tabIndex={-1}
      onPointerDown={(event) => {
        // A secondary click keeps a multi-selection for its context menu,
        // which selects an unselected object itself. An embedded surface's UI
        // owns its interaction without selecting the outer container object.
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          (event.target as Element).closest("[data-surface-ui]")
        )
          return;
        if (
          isTextPointerTarget(
            event.target as Element,
            event.clientX,
            event.clientY,
          )
        ) {
          actions.select(null);
          return;
        }
        if (event.pointerType === "pen" && isBoardShape(drawingNode)) return;
        if (
          (event.target as Element).closest("[data-surface-id]") ===
          event.currentTarget
        )
          drawing && positioned && !actions.readOnly
            ? start(event)
            : actions.select(id, event.shiftKey);
      }}
      {...(drawing ? handlers : {})}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && pending.current) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      {(drawing || (container && positioned && !!board)) &&
        !actions.readOnly &&
        (board?.ids.has(id) ?? actions.selected === id) && (
          <div
            className={`board-object-outline${container ? " board-selection-drag-area" : ""}`}
            style={drawing ? outline : { inset: 0 }}
            aria-hidden="true"
          />
        )}
      {locked && positioned && board?.ids.has(id) && (
        <span
          className="board-lock-badge"
          data-surface-ui
          aria-label={t("board.lockedBadge", { name })}
          title={t("board.lockedBadgeTitle")}
        >
          <LockKeyhole size={11} aria-hidden="true" />
        </span>
      )}
      {rotatable &&
        drawingTool !== "arrow" &&
        positioned &&
        single &&
        !locked &&
        !actions.readOnly &&
        (board?.ids.has(id) ?? actions.selected === id) && (
          <button
            type="button"
            className="surface-object-rotate"
            data-surface-ui
            data-surface-handle
            aria-label={t("object.rotate", { name })}
            title={t("object.rotateTitle")}
            style={
              ink && drawingNode
                ? {
                    left: `calc(${((ink.x + ink.width / 2) / drawingNode.attrs!.extent[0]) * 100}% - 12px * var(--board-inv, 1))`,
                    top: `calc(${(ink.y / drawingNode.attrs!.extent[1]) * 100}% - 44px * var(--board-inv, 1))`,
                  }
                : undefined
            }
            onPointerDown={(event) => start(event, false, "rotate")}
            {...handlers}
          >
            ↻
          </button>
        )}
      {((!actions.readOnly && chrome && !board && !archiveGroup) ||
        (actions.readOnly && container && mount)) && (
        <div className="surface-object-header" data-surface-ui>
          {actions.readOnly ? (
            <span className="surface-object-grip">{name}</span>
          ) : (
            <button
              type="button"
              className="surface-object-grip"
              data-surface-handle={(positioned && !!actions.move) || undefined}
              aria-label={t("object.move", { name })}
              title={positioned ? t("object.moveTitle") : t("object.select")}
              onPointerDown={(event) =>
                positioned ? start(event) : actions.select(id)
              }
              {...handlers}
              onKeyDown={(event) => {
                if (!positioned || !frame || !actions.move) return;
                const steps: Record<string, [number, number]> = {
                  ArrowLeft: [-1, 0],
                  ArrowRight: [1, 0],
                  ArrowUp: [0, -1],
                  ArrowDown: [0, 1],
                };
                const step = steps[event.key];
                if (!step) return;
                event.preventDefault();
                event.stopPropagation();
                const amount = event.shiftKey ? 50 : 10;
                actions.move(id, {
                  ...frame,
                  x: Math.max(
                    -1000000,
                    Math.min(1000000, frame.x + step[0] * amount),
                  ),
                  y: Math.max(
                    -1000000,
                    Math.min(1000000, frame.y + step[1] * amount),
                  ),
                });
              }}
            >
              <GripHorizontal size={14} />
              <span>{name}</span>
            </button>
          )}
          {container && (
            <button
              type="button"
              aria-label={t("object.expand", { name })}
              onClick={() => actions.expand?.(id)}
            >
              <Maximize2 size={14} />
            </button>
          )}
          {/* Delete lives in the module settings, the context menu and the Delete key;
              the header keeps one entry per action instead of a second trash can. */}
          {!actions.readOnly && (
            <button
              type="button"
              aria-label={t("object.settings", { name })}
              onClick={() => actions.inspect?.(id)}
            >
              <Settings2 size={14} />
            </button>
          )}
        </div>
      )}
      <div className="surface-object-content">
        <BlockActionHost.Provider
          value={
            board && component
              ? {
                  target: actions.componentActionsHost ?? null,
                  selected: board.ids.size === 1 && board.ids.has(id),
                }
              : null
          }
        >
          {mount ? (
            children
          ) : (
            <div
              className="surface-object-placeholder"
              style={{ minHeight: frame?.height ?? (region ? 240 : 160) }}
            />
          )}
        </BlockActionHost.Provider>
      </div>
      {resizable &&
        chrome &&
        single &&
        !locked &&
        !actions.readOnly &&
        positioned &&
        board &&
        resizeDirections.map((direction) => (
          <button
            key={direction}
            type="button"
            className={`board-resize-handle handle-${direction}`}
            data-surface-ui
            data-surface-handle
            data-resize-direction={direction}
            style={drawingHandle(direction)}
            aria-label={t(
              `object.resize.${direction}` as MessageKey<typeof messages>,
              { name },
            )}
            onKeyDown={(event) => {
              const step = (
                {
                  ArrowLeft: [-1, 0],
                  ArrowRight: [1, 0],
                  ArrowUp: [0, -1],
                  ArrowDown: [0, 1],
                } as Record<string, number[]>
              )[event.key];
              if (!step || !frame || !actions.move) return;
              event.preventDefault();
              event.stopPropagation();
              const amount = event.shiftKey ? 10 : 1;
              const measured = {
                ...frame,
                contentSize: undefined,
                height: element.current?.offsetHeight ?? frameHeight(frame),
              };
              const next = resizeFrame(
                drawingNode ? geometryFrame(drawingNode, measured) : measured,
                { x: step[0] * amount, y: step[1] * amount },
                direction,
                { width: drawing || archiveGroup ? 1 : 120, height: container ? 180 : 1 },
              );
              if (!fixedHeight) {
                next.height = frame.height;
                next.y = frame.y;
              }
              actions.move(
                id,
                drawingNode
                  ? frameFromGeometry(drawingNode, frame, next)
                  : next,
              );
            }}
            onPointerDown={(event) => start(event, true, `resize-${direction}`)}
            {...handlers}
          />
        ))}
      {resizable &&
        chrome &&
        !actions.readOnly &&
        (positioned || fixedHeight) &&
        !board && (
          <button
            type="button"
            className="surface-object-resize"
            disabled={!actions.move}
            data-surface-handle
            aria-label={t(
              fixedHeight ? "object.resizeSize" : "object.resizeWidth",
              { name },
            )}
            title={t("object.resizeTitle")}
            onPointerDown={(event) => start(event, true)}
            {...handlers}
            onKeyDown={(event) => {
              if (
                !frame ||
                !actions.move ||
                !["ArrowLeft", "ArrowRight"].includes(event.key)
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              actions.move(id, {
                ...frame,
                width: Math.max(
                  120,
                  Math.min(
                    10000,
                    frame.width + (event.key === "ArrowLeft" ? -20 : 20),
                  ),
                ),
              });
            }}
          >
            ↔
          </button>
        )}
    </section>
  );
}
