import { isEditableDrawing } from "./portable-ink.mjs";
import type { JSONContent } from "@tiptap/core";
import { useState } from "react";
import type { BoardTool, DrawingStyle } from "./types";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";
import { useToolbarDock } from "./DockableBoardToolbar";
import { BoardColorPicker } from "./BoardColorPicker";
import { Type } from "../ui/icons";
import {
  DEFAULT_LABEL_SIZE,
  LABEL_SIZES,
  labelCapable,
} from "./drawing-label.mjs";

function StrokeWidthSlider({
  width,
  label,
  onChange,
  min = 0.5,
  max = 12,
}: {
  width: number | undefined;
  label: string;
  onChange: (patch: Partial<DrawingStyle>) => void;
  min?: number;
  max?: number;
}) {
  const t = useTranslator(messages);
  const dock = useToolbarDock();
  const vertical = dock === "left" || dock === "right";
  const [active, setActive] = useState(false);
  const current = Math.min(max, Math.max(min, width ?? 2.5));
  const position = ((current - min) / (max - min)) * 100;
  return (
    <span className="board-stroke-slider" data-active={active || undefined}>
      <svg
        viewBox="0 0 120 24"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="board-stroke-track"
      >
        <path d="M 8 11.5 L 112 7 Q 117 7 117 12 Q 117 17 112 17 L 8 12.5 Q 7 12 8 11.5 Z" />
      </svg>
      <span className="board-stroke-value-rail" aria-hidden="true">
        <output style={{ left: `${position}%` }}>{current}</output>
      </span>
      <input
        type="range"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-label={label}
        aria-valuetext={width === undefined ? t("style.mixed") : undefined}
        min={min}
        max={max}
        step={0.5}
        value={current}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setActive(true);
        }}
        onPointerUp={() => setActive(false)}
        onPointerCancel={() => setActive(false)}
        onLostPointerCapture={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        onKeyDown={() => setActive(true)}
        onKeyUp={() => setActive(false)}
        onChange={(event) =>
          onChange({ strokeWidth: event.currentTarget.valueAsNumber })
        }
      />
    </span>
  );
}

/**
 * Text size for selected shapes and arrows that carry a label. It belongs to
 * the selection's text settings, ahead of object-specific actions.
 */
export function LabelSizeSelect({
  nodes,
  onChange,
}: {
  nodes: JSONContent[];
  onChange: (labelSize: number) => void;
}) {
  const t = useTranslator(messages);
  const labelled = nodes.filter(
    (node) => labelCapable(node) && !!node.attrs?.label,
  );
  if (!labelled.length) return null;
  const sizes = new Set(
    labelled.map((node) => node.attrs?.labelSize ?? DEFAULT_LABEL_SIZE),
  );
  const size = sizes.size === 1 ? [...sizes][0] : undefined;
  return (
    <label className="board-label-size" title={t("style.labelSize")}>
      <Type size={14} aria-hidden="true" />
      <select
        aria-label={t("style.labelSize")}
        value={size ?? ""}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      >
        {size === undefined && (
          <option value="" disabled>
            {t("style.mixed")}
          </option>
        )}
        {LABEL_SIZES.map((value) => (
          <option key={value} value={value}>
            {t(`style.labelSize${value}` as "style.labelSize16")}
          </option>
        ))}
      </select>
    </label>
  );
}

export function BoardStyleControls({
  tool,
  style,
  nodes,
  onChange,
}: {
  tool?: BoardTool | null;
  style: DrawingStyle;
  nodes: JSONContent[];
  onChange: (patch: Partial<DrawingStyle>) => void;
}) {
  const t = useTranslator(messages);
  const drawings = nodes.filter(isEditableDrawing);
  if (!drawings.length && nodes.some((node) => node.attrs?.ink))
    return <span className="board-style-controls">{t("style.inkNotice")}</span>;
  if (!drawings.length && (!tool || ["region", "pan", "lasso"].includes(tool)))
    return null;
  const value = (key: keyof DrawingStyle) => {
    if (!drawings.length) return style[key];
    const applicable =
      key === "fillColor"
        ? drawings.filter((node) =>
            ["rectangle", "ellipse"].includes(node.attrs!.tool),
          )
        : drawings;
    const values = new Set(
      applicable.map(
        (node) =>
          node.attrs?.[key] ?? (key === "fillColor" ? "none" : style[key]),
      ),
    );
    return values.size === 1 ? [...values][0] : undefined;
  };
  const filled = drawings.length
    ? drawings.some((node) =>
        ["rectangle", "ellipse"].includes(node.attrs!.tool),
      )
    : tool === "rectangle" || tool === "ellipse";
  const color = value("color"),
    fill = value("fillColor"),
    width = value("strokeWidth");
  const eraser = !drawings.length && tool === "eraser";
  const pressure = value("pressure") !== false;
  const highlighter = drawings.length
    ? drawings.every((node) => node.attrs!.tool === "highlighter")
    : tool === "highlighter";
  return (
    <div
      className="board-style-controls"
      data-filled={filled || undefined}
      role="group"
      aria-label={drawings.length ? t("style.selection") : t("style.drawing")}
    >
      {!eraser && (
        <div
          className="board-style-section"
          title={color === undefined ? t("style.colorsDiffer") : undefined}
        >
          {filled ? t("style.border") : t("style.color")}
          <BoardColorPicker
            label={filled ? t("style.borderColor") : t("style.penColor")}
            value={color ?? "#252629"}
            allowNone={
              filled &&
              drawings.every((node) =>
                ["rectangle", "ellipse"].includes(node.attrs!.tool),
              )
            }
            onChange={(color) => onChange({ color })}
          />
          {color === undefined && <small>{t("style.mixed")}</small>}
        </div>
      )}
      {!eraser && filled && (
        <div className="board-style-section">
          {t("style.fill")}
          <BoardColorPicker
            label={t("style.fillColor")}
            value={fill ?? "none"}
            allowNone
            onChange={(fillColor) => onChange({ fillColor })}
          />
          {fill === undefined && <small>{t("style.mixed")}</small>}
        </div>
      )}
      <div className="board-style-section board-width-controls">
        <label>
          {t(eraser ? "style.eraserSize" : "style.weight")}
          <StrokeWidthSlider
            width={eraser ? style.strokeWidth : width}
            min={eraser ? 4 : 0.5}
            max={eraser ? 64 : highlighter ? 20 : 12}
            label={
              eraser
                ? t("style.eraserSize")
                : filled
                  ? t("style.borderWeight")
                  : t("style.penWeight")
            }
            onChange={onChange}
          />
          {width === undefined && <small>{t("style.mixed")}</small>}
        </label>
      </div>
      {(drawings.length
          ? drawings.every((node) =>
              ["pen", "highlighter"].includes(node.attrs!.tool),
            )
          : tool === "pen" || tool === "highlighter") && (
          <div className="board-style-section board-pressure-controls">
            <span>{t("style.pressureLabel")}</span>
            <button
              type="button"
              className="board-pressure-toggle"
              aria-label={t("style.pressure")}
              title={t(pressure ? "style.pressureWidth" : "style.fixedWidth")}
              aria-pressed={pressure}
              onClick={() => onChange({ pressure: !pressure })}
            >
              <svg viewBox="0 0 24 20" aria-hidden="true">
                {pressure ? (
                  <path
                    d="M3 14 C7 2 13 7 17 9 C19 10 20 8 21 6 C20 13 16 16 12 11 C8 7 6 7 3 14 Z"
                    fill="currentColor"
                  />
                ) : (
                  <path
                    d="M3 14 C8 2 16 18 21 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                )}
              </svg>
            </button>
          </div>
        )}
    </div>
  );
}
