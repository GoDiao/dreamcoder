import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  referenceRequest,
  referencePicked,
  referenceDisplay,
  type CanvasReference,
} from "./agent-reference";
import { useTranslator } from "../i18n/react";
import strings from "../i18n/messages/assistant";
import { registerReferencePicker } from "./reference-availability";

export function CanvasReferencePicker({
  pageId,
  surfaceId,
  enabled,
  root,
  world,
  point,
}: {
  pageId: string;
  surfaceId: string;
  enabled: boolean;
  root: RefObject<HTMLDivElement | null>;
  world: RefObject<HTMLDivElement | null>;
  point(x: number, y: number): { x: number; y: number };
}) {
  const t = useTranslator(strings);
  const [request, setRequest] = useState<string | null>(null);
  const [preview, setPreview] = useState<CanvasReference | null>(null);
  const [drag, setDrag] = useState<{
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null>(null);
  useEffect(() => {
    if (!enabled) {
      setRequest(null);
      setDrag(null);
      return;
    }
    const start = (event: Event) => {
      const value = (event as CustomEvent).detail;
      if (event.defaultPrevented || value?.pageId !== pageId) return;
      event.preventDefault();
      setPreview(null);
      setRequest(value.id);
    };
    const display = (event: Event) => {
      const value = (event as CustomEvent).detail;
      if (value?.pageId === pageId)
        setPreview(
          value.reference?.surfaceId === surfaceId ? value.reference : null,
        );
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRequest(null);
        setDrag(null);
      }
    };
    window.addEventListener(referenceRequest, start);
    window.addEventListener(referenceDisplay, display);
    window.addEventListener("keydown", escape);
    const unregister = registerReferencePicker(pageId);
    return () => {
      window.removeEventListener(referenceRequest, start);
      window.removeEventListener(referenceDisplay, display);
      window.removeEventListener("keydown", escape);
      unregister();
    };
  }, [enabled, pageId, surfaceId]);
  const local = (x: number, y: number) => {
    const bounds = root.current!.getBoundingClientRect();
    return { x: x - bounds.left, y: y - bounds.top };
  };
  return (
    <>
      {preview &&
        world.current &&
        createPortal(
          <svg
            className="agent-reference-preview"
            width="1"
            height="1"
            aria-hidden="true"
          >
            {preview.kind === "region" ? (
              <rect
                x={preview.x}
                y={preview.y}
                width={preview.width}
                height={preview.height}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <g transform={`translate(${preview.x},${preview.y})`}>
                <circle r="12" vectorEffect="non-scaling-stroke" />
                <path d="M-18 0H18M0-18V18" vectorEffect="non-scaling-stroke" />
              </g>
            )}
          </svg>,
          world.current,
        )}
      {enabled && request && (
        <div
          className="agent-reference-picker"
          data-surface-ui
          role="region"
          aria-label={t("reference.pick")}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            const p = { x: event.clientX, y: event.clientY };
            setDrag({ start: p, end: p });
          }}
          onPointerMove={(event) => {
            if (drag)
              setDrag({ ...drag, end: { x: event.clientX, y: event.clientY } });
          }}
          onPointerCancel={() => {
            setDrag(null);
            setRequest(null);
          }}
          onPointerUp={(event) => {
            if (!drag) return;
            event.preventDefault();
            event.stopPropagation();
            const a = point(drag.start.x, drag.start.y),
              b = point(event.clientX, event.clientY);
            const region =
              Math.hypot(
                event.clientX - drag.start.x,
                event.clientY - drag.start.y,
              ) > 8;
            const value: CanvasReference = region
              ? {
                  surfaceId,
                  kind: "region",
                  x: Math.min(a.x, b.x),
                  y: Math.min(a.y, b.y),
                  width: Math.abs(b.x - a.x),
                  height: Math.abs(b.y - a.y),
                }
              : { surfaceId, kind: "point", ...a };
            setPreview(value);
            window.dispatchEvent(
              new CustomEvent(referencePicked, {
                detail: { id: request, pageId, reference: value },
              }),
            );
            setDrag(null);
            setRequest(null);
          }}
        >
          <span className="agent-reference-hint">
            {t("reference.pickHint")}
          </span>
          {drag && (
            <span
              className="agent-reference-marquee"
              style={{
                left: Math.min(
                  local(drag.start.x, drag.start.y).x,
                  local(drag.end.x, drag.end.y).x,
                ),
                top: Math.min(
                  local(drag.start.x, drag.start.y).y,
                  local(drag.end.x, drag.end.y).y,
                ),
                width: Math.abs(drag.end.x - drag.start.x),
                height: Math.abs(drag.end.y - drag.start.y),
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
