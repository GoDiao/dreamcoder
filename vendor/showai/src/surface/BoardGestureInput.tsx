import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { JSONContent } from "@tiptap/core";
import type { BoardInteraction } from "./useBoardInteraction";
import { fingerNavigatesBoard } from "./board-input.mjs";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";

type Point = { x: number; y: number };
/** Common stroke eraser and freeform selection for every Board renderer. */
export function BoardGestureInput({
  tool,
  size,
  board,
  onDelete,
  onExit,
}: {
  tool: "eraser" | "lasso";
  size: number;
  board: BoardInteraction;
  onDelete: (ids: string[]) => void;
  onExit: () => void;
}) {
  const t = useTranslator(messages),
    [preview, setPreview] = useState<Point[]>([]);
  const cursor = useRef<SVGCircleElement>(null);
  const pendingCursor = useRef<Point | null>(null);
  const cursorFrame = useRef(0);
  const moveCursor = (point: Point | null) => {
    pendingCursor.current = point;
    if (cursorFrame.current) return;
    cursorFrame.current = requestAnimationFrame(() => {
      cursorFrame.current = 0;
      const element = cursor.current,
        point = pendingCursor.current;
      if (!element) return;
      const display = point ? "" : "none";
      if (element.style.display !== display) element.style.display = display;
      if (point) {
        const p = local(point);
        element.setAttribute("cx", String(p.x));
        element.setAttribute("cy", String(p.y));
      }
    });
  };
  const svg = useRef<SVGSVGElement>(null);
  const local = (p: Point) => {
    const m = svg.current?.getScreenCTM();
    return m ? new DOMPoint(p.x, p.y).matrixTransform(m.inverse()) : p;
  };
  const gesture = useRef<{
    id: number;
    hitTest: BoardInteraction["hitTest"];
    points: Point[];
    erased: Set<string>;
    hidden: Set<HTMLElement>;
    pointerType: string;
    last: Point;
  } | null>(null);
  const isInk = (node: JSONContent) =>
    node.type === "drawing" ||
    !!(node.attrs?.nativeInk ?? node.attrs?.data?.nativeInk);
  const restore = (value: NonNullable<typeof gesture.current>) => {
    for (const element of value.hidden) delete element.dataset.erasing;
  };
  const cancel = () => {
    const value = gesture.current;
    gesture.current = null;
    if (value) restore(value);
    setPreview([]);
    if (value && svg.current?.hasPointerCapture(value.id))
      svg.current.releasePointerCapture(value.id);
  };
  useEffect(() => {
    const root = svg.current?.closest(".page-surface");
    root?.addEventListener("showai-board-pinch", cancel);
    root?.addEventListener("showai:viewport-change", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      cancelAnimationFrame(cursorFrame.current);
      root?.removeEventListener("showai-board-pinch", cancel);
      root?.removeEventListener("showai:viewport-change", cancel);
      window.removeEventListener("blur", cancel);
      const value = gesture.current;
      if (value) restore(value);
    };
  }, []);
  const erase = (p: Point) => {
    const value = gesture.current;
    const hit = value?.hitTest(p.x, p.y, false);
    if (
      value &&
      hit &&
      isInk(hit.node) &&
      !hit.element.classList.contains("is-locked")
    ) {
      value.erased.add(hit.id);
      value.hidden.add(hit.element);
      hit.element.dataset.erasing = "true";
    }
  };
  const add = (p: Point) => {
    const value = gesture.current;
    if (!value) return;
    if (tool === "eraser") {
      const n = Math.ceil(
        Math.hypot(p.x - value.last.x, p.y - value.last.y) / 4,
      );
      for (let i = 0; i <= n; i++)
        erase({
          x: value.last.x + ((p.x - value.last.x) * i) / (n || 1),
          y: value.last.y + ((p.y - value.last.y) * i) / (n || 1),
        });
    } else if (Math.hypot(p.x - value.last.x, p.y - value.last.y) >= 2) {
      value.points.push(p);
      setPreview([...value.points]);
    }
    value.last = p;
  };
  const finish = () => {
    const value = gesture.current;
    if (!value) return;
    gesture.current = null;
    setPreview([]);
    if (tool === "eraser") {
      if (value.erased.size)
        flushSync(() => {
          board.selectIds([...board.ids].filter((id) => !value.erased.has(id)));
          onDelete([...value.erased]);
        });
      restore(value);
      return;
    }
    if (value.points.length >= 2) board.selectIds(board.lassoHit(value.points));
  };
  return (
    <svg
      ref={svg}
      className="board-drawing-input"
      data-board-drawing-input
      data-drawing-active={!!gesture.current}
      aria-label={t(tool === "eraser" ? "tool.eraser" : "tool.lasso")}
      tabIndex={0}
      onPointerDown={(e) => {
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          fingerNavigatesBoard(e.pointerType) ||
          gesture.current
        )
          return;
        const hit = board.hitTest(e.clientX, e.clientY);
        if (
          tool === "lasso" &&
          (board.selectionHit(e.clientX, e.clientY) ||
            (hit && board.ids.has(hit.id)))
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = { x: e.clientX, y: e.clientY };
        gesture.current = {
          id: e.pointerId,
          hitTest: board.createHitTest(size / 2),
          points: [p],
          erased: new Set(),
          hidden: new Set(),
          pointerType: e.pointerType,
          last: p,
        };
        if (tool === "eraser") erase(p);
        else setPreview([p]);
      }}
      onPointerMove={(e) => {
        if (tool === "eraser") moveCursor({ x: e.clientX, y: e.clientY });
        if (gesture.current?.id === e.pointerId) {
          e.preventDefault();
          add({ x: e.clientX, y: e.clientY });
        }
      }}
      onPointerUp={(e) => {
        if (gesture.current?.id !== e.pointerId) return;
        e.preventDefault();
        add({ x: e.clientX, y: e.clientY });
        finish();
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onPointerLeave={() => {
        if (!gesture.current) moveCursor(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
          onExit();
        }
      }}
    >
      {tool === "eraser" && (
        <circle
          ref={cursor}
          className="board-eraser-cursor"
          style={{ display: "none" }}
          r={size / 2}
        />
      )}
      {preview.length > 1 && (
        <path
          d={
            preview
              .map((p, i) => `${i ? "L" : "M"}${local(p).x},${local(p).y}`)
              .join(" ") + " Z"
          }
          fill="#7194ff18"
          stroke="#7194ff"
          strokeDasharray="4 3"
        />
      )}
    </svg>
  );
}
