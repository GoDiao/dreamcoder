import { useEffect, useRef, useState, type RefObject } from "react";
import type { Camera } from "./model";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";

type Box = { x: number; y: number; width: number; height: number };
const WIDTH = 180,
  HEIGHT = 120;

/** Object outlines and the visible area; click or drag to move the view there. */
export function BoardMinimap({
  root,
  world,
  camera,
  layoutKey,
  onNavigate,
}: {
  root: RefObject<HTMLDivElement | null>;
  world: RefObject<HTMLDivElement | null>;
  camera: RefObject<Camera>;
  layoutKey: unknown;
  onNavigate: (camera: Camera) => void;
}) {
  const t = useTranslator(messages);
  const [state, setState] = useState<{ boxes: Box[]; view: Box } | null>(null);
  const frame = useRef(0);
  const measure = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const layer = world.current,
        viewport = root.current,
        c = camera.current;
      if (!layer || !viewport || !c) return;
      const boxes = [...layer.children].flatMap((child) =>
        child instanceof HTMLElement && child.dataset.surfaceId
          ? [
              {
                x: child.offsetLeft,
                y: child.offsetTop,
                width: child.offsetWidth,
                height: child.offsetHeight,
              },
            ]
          : [],
      );
      setState({
        boxes,
        view: {
          x: -c.x / c.scale,
          y: -c.y / c.scale,
          width: viewport.clientWidth / c.scale,
          height: viewport.clientHeight / c.scale,
        },
      });
    });
  };
  useEffect(() => {
    measure();
    const element = root.current;
    element?.addEventListener("showai:viewport-change", measure);
    return () => {
      cancelAnimationFrame(frame.current);
      element?.removeEventListener("showai:viewport-change", measure);
    };
  }, [layoutKey]);
  if (!state) return null;
  const all = [...state.boxes, state.view];
  const left = Math.min(...all.map((b) => b.x)),
    top = Math.min(...all.map((b) => b.y));
  const right = Math.max(...all.map((b) => b.x + b.width)),
    bottom = Math.max(...all.map((b) => b.y + b.height));
  const ratio = Math.min(
    WIDTH / Math.max(1, right - left),
    HEIGHT / Math.max(1, bottom - top),
  );
  const navigate = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = left + (event.clientX - rect.left) / ratio,
      y = top + (event.clientY - rect.top) / ratio;
    const c = camera.current!;
    onNavigate({
      ...c,
      x: -(x - state.view.width / 2) * c.scale,
      y: -(y - state.view.height / 2) * c.scale,
    });
  };
  const rect = (b: Box, className: string, key?: number) => (
    <rect
      key={key}
      className={className}
      x={(b.x - left) * ratio}
      y={(b.y - top) * ratio}
      width={Math.max(1, b.width * ratio)}
      height={Math.max(1, b.height * ratio)}
    />
  );
  return (
    <svg
      className="board-minimap"
      data-surface-ui
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={t("board.minimap")}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        navigate(event);
      }}
      onPointerMove={(event) => event.buttons && navigate(event)}
    >
      {state.boxes.map((b, i) => rect(b, "board-minimap-object", i))}
      {rect(state.view, "board-minimap-view")}
    </svg>
  );
}
