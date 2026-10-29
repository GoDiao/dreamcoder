import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import { useContext, useEffect, useRef, useState } from "react";
import type { Camera } from "./model";
import type { CubicPaintChunk } from "./portable-cubic-worker-model";
import { PortablePointerInput } from "./portable-pointer-input";
import { PortableCubicContext } from "./PortableCubicContext";
import type { PortableInputContact } from "./portable-input-scope";
import { fingerNavigatesBoard } from "./board-input.mjs";
import { portableInkColor } from "./portable-ink.mjs";

/** All vector fitting and changed-suffix preparation belongs to the actual
 * Worker. This view only retains the producer's immutable analytic chunks. */
export function PortableCubicDrawingInput({
  pageId,
  boardId,
  tool,
  color,
  width,
  pressure,
  camera,
  panHeld,
  ruler,
  point,
  name,
}: {
  pageId: string;
  boardId: string;
  tool: "pen" | "highlighter";
  color: string;
  width: number;
  pressure: boolean;
  camera: { current: Camera };
  panHeld: { current: boolean };
  ruler: boolean;
  point: (x: number, y: number) => { x: number; y: number };
  name: string;
}) {
  const scope = useContext(PortableCubicContext);
  if (!scope)
    throw new Error("Editable cubic input requires its actual source owner");
  const surface = useRef<SVGSVGElement>(null),
    gesture = useRef<{
      adapter: PortablePointerInput;
      contact: PortableInputContact;
      raw: boolean;
      id: string;
      origin: { x: number; y: number };
      chunks: CubicPaintChunk[];
      generation: number;
      color: string;
      opacity: number;
    } | null>(null);
  const [, refresh] = useState(0),
    raf = useRef(0);
  const paint = () => {
    if (!raf.current)
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        refresh((v) => v + 1);
      });
  };
  const finish = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    g.contact.finish();
    if (surface.current?.hasPointerCapture(g.adapter.pointerId))
      surface.current.releasePointerCapture(g.adapter.pointerId);
    paint();
  };
  const current = useRef({
    point,
    color,
    width,
    pressure,
    tool,
    ruler,
    camera,
    name,
    finish,
  });
  current.current = {
    point,
    color,
    width,
    pressure,
    tool,
    ruler,
    camera,
    name,
    finish,
  };
  useEffect(() => {
    const element = surface.current!;
    const raw = (rawEvent: Event) => {
      const event = rawEvent as globalThis.PointerEvent;
      const g = gesture.current;
      if (!g || event.pointerId !== g.adapter.pointerId) return;
      g.raw = true;
      g.contact.push(g.adapter.batch(event));
    };
    const blurred = () => current.current.finish();
    element.addEventListener("pointerrawupdate", raw);
    window.addEventListener("blur", blurred);
    return () => {
      element.removeEventListener("pointerrawupdate", raw);
      window.removeEventListener("blur", blurred);
      current.current.finish();
      cancelAnimationFrame(raf.current);
    };
  }, []);
  const moved = (event: globalThis.PointerEvent) => {
    const g = gesture.current;
    if (g?.adapter.pointerId === event.pointerId)
      g.contact.push(g.adapter.batch(event, !g.raw));
  };
  return (
    <>
      <svg
        ref={surface}
        className="board-drawing-input"
        data-board-drawing-input
        data-cubic-input="2"
        data-drawing-active={!!gesture.current}
        aria-label={name}
        tabIndex={0}
        onPointerDown={(event) => {
          if (
            !scope.owner ||
            scope.owner.disposed ||
            event.defaultPrevented ||
            event.button !== 0 ||
            panHeld.current ||
            gesture.current ||
            fingerNavigatesBoard(event.pointerType)
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          const o = current.current,
            adapter = new PortablePointerInput(
              event.nativeEvent,
              o.point,
              o.ruler,
            ),
            id = crypto.randomUUID();
          const contact = scope.begin(
            {
              strokeId: id,
              pageId,
              boardId,
              tool: o.tool,
              color: o.color,
              width: o.width,
              pressure: o.pressure,
              creationZoom: o.camera.current.scale,
              origin: adapter.worldOrigin,
              name: o.name,
            },
            adapter.batch(event.nativeEvent),
          );
          gesture.current = {
            adapter,
            contact,
            raw: false,
            id,
            origin: adapter.worldOrigin,
            chunks: [],
            color: o.color,
            opacity: o.tool === "highlighter" ? 0.35 : 1,
            generation: 0,
          };
          paint();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && gesture.current) {
            event.preventDefault();
            event.stopPropagation();
            const g = gesture.current;
            gesture.current = null;
            g.contact.cancel();
            if (event.currentTarget.hasPointerCapture(g.adapter.pointerId))
              event.currentTarget.releasePointerCapture(g.adapter.pointerId);
            paint();
          }
        }}
        onPointerMove={(event) => moved(event.nativeEvent)}
        onPointerUp={(event) => {
          if (gesture.current?.adapter.pointerId !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          gesture.current.contact.push(
            gesture.current.adapter.batch(event.nativeEvent, true),
          );
          finish();
        }}
        onPointerCancel={(event) => {
          if (gesture.current?.adapter.pointerId === event.pointerId) finish();
        }}
        onLostPointerCapture={(event) => {
          if (
            gesture.current?.adapter.pointerId === event.pointerId &&
            !event.currentTarget.hasPointerCapture(event.pointerId)
          )
            finish();
        }}
      ></svg>
    </>
  );
}

export function PortableCubicPreview({
  boardId,
  camera,
}: {
  boardId: string;
  camera: { current: Camera };
}) {
  const t = useTranslator(commonMessages);
  const scope = useContext(PortableCubicContext),
    surface = useRef<SVGSVGElement>(null),
    [, refresh] = useState(0);
  useEffect(() => {
    if (!scope) return;
    let raf = 0;
    const change = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          refresh((v) => v + 1);
        });
    };
    const stop = scope.subscribe(change),
      root = surface.current?.closest(".page-surface");
    root?.addEventListener("showai:viewport-change", change);
    return () => {
      stop();
      cancelAnimationFrame(raf);
      root?.removeEventListener("showai:viewport-change", change);
    };
  }, [scope]);
  if (!scope) return null;
  const error = scope.error(boardId);
  return (
    <>
      <svg
        ref={surface}
        className="board-drawing-input"
        data-cubic-preview="2"
        style={{ pointerEvents: "none" }}
        aria-hidden="true"
      >
        <g
          transform={`translate(${camera.current.x} ${camera.current.y}) scale(${camera.current.scale})`}
        >
          {scope.previews(boardId).map(({ options, chunks }) => (
            <g
              key={options.strokeId}
              transform={`translate(${options.origin.x} ${options.origin.y})`}
              opacity={options.tool === "highlighter" ? 0.35 : 1}
            >
              {[false, true].map((dark) => (
                <g
                  key={String(dark)}
                  className={dark ? "board-ink-dark" : "board-ink-light"}
                  fill={portableInkColor(options.color, dark)}
                  stroke="none"
                >
                  {chunks.map((chunk) => (
                    <path key={chunk.start} d={chunk.path} />
                  ))}
                </g>
              ))}
            </g>
          ))}
        </g>
      </svg>
      {error && (
        <div className="surface-save-error" role="alert" data-surface-ui>
          {String(error)}{" "}
          <button
            onClick={() => {
              void scope
                .retry()
                .catch((reason) =>
                  console.error("Retained cubic input retry failed", reason),
                );
            }}
          >
            {t("retry")}
          </button>
        </div>
      )}
    </>
  );
}
