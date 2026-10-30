import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/richText";
import noteMessages from "../../i18n/messages/richTextNotes";
import {
  AlignCenter,
  AlignLeft,
  AlignJustify,
  AlignRight,
  Bold,
  ChevronDown,
  Code,
  Highlighter,
  Italic,
  Link2,
  MessageSquareText,
  Strikethrough,
  Type,
  Underline,
} from "../../ui/icons";
import "./format-controls.css";
import { ToolbarPanel } from "../../editor/ToolbarPanel";

const textColors = [
  "#292733",
  "#787774",
  "#a85b3c",
  "#c44343",
  "#bd861e",
  "#448361",
  "#3979bf",
  "#8864b4",
];
const highlightColors = [
  "#e8eed0",
  "#f9e7a0",
  "#f8d8bb",
  "#f4cfd2",
  "#e9d8f1",
  "#d3e5f7",
  "#cde9df",
  "#e5e5e5",
];

/** Shared formatting actions for the document bar and the selection menu. */
export function FormatControls({
  editor,
  onLink,
  onNote,
}: {
  editor: Editor;
  onLink: () => void;
  /** Opens the hover-note editor for the selected text or formula. */
  onNote?: () => void;
}) {
  const t = useTranslator(messages);
  const tn = useTranslator(noteMessages);
  const [colorPanel, setColorPanel] = useState<"text" | "highlight" | null>(
    null,
  );
  const root = useRef<HTMLDivElement>(null);
  const colorButton = useRef<HTMLButtonElement>(null);
  const highlightButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const textColor = editor.getAttributes("textStyle").color ?? "#292733";
  const highlightColor = editor.getAttributes("highlight").color ?? "#e8eed0";
  const highlightMode = editor.getAttributes("highlight").mode ?? "lower";
  const alignment =
    editor.getAttributes(editor.isActive("heading") ? "heading" : "paragraph")
      .textAlign ?? "left";
  const AlignmentIcon =
    alignment === "center"
      ? AlignCenter
      : alignment === "right"
        ? AlignRight
        : alignment === "justify"
          ? AlignJustify
          : AlignLeft;

  useEffect(() => {
    if (!colorPanel) return;
    const close = () => setColorPanel(null);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      (colorPanel === "highlight"
        ? highlightButton
        : colorButton
      ).current?.focus();
    };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", outside);
    editor.on("selectionUpdate", close);
    return () => {
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerdown", outside);
      editor.off("selectionUpdate", close);
    };
  }, [colorPanel, editor]);

  const action = (
    label: string,
    icon: ReactNode,
    active: boolean,
    run: () => void,
  ) => (
    <button
      type="button"
      className={`editor-tool${active ? " is-active" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );
  const select = (label: string, children: ReactNode, className = "") => (
    <label className={`rich-format-select ${className}`} title={label}>
      {children}
      <ChevronDown size={11} aria-hidden="true" />
    </label>
  );

  return (
    <div
      ref={root}
      className="rich-format-controls"
      onKeyDown={(event) => {
        if (colorPanel && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setColorPanel(null);
          (colorPanel === "highlight"
            ? highlightButton
            : colorButton
          ).current?.focus();
        }
      }}
      onClickCapture={(event) => {
        if (
          !(event.target as Element).closest(
            ".rich-format-colors-toggle, .rich-format-color-panel",
          )
        )
          setColorPanel(null);
      }}
    >
      <div
        className="rich-format-group"
        role="group"
        aria-label={t("format.textStyle")}
      >
        {select(
          t("format.textStyle"),
          <select
            aria-label={t("format.textStyle")}
            value={
              editor.isActive("heading")
                ? String(editor.getAttributes("heading").level)
                : "paragraph"
            }
            onChange={(event) =>
              event.target.value === "paragraph"
                ? editor.chain().focus().setParagraph().run()
                : editor
                    .chain()
                    .focus()
                    .setHeading({
                      level: Number(event.target.value) as
                        1 | 2 | 3 | 4 | 5 | 6,
                    })
                    .run()
            }
          >
            <option value="paragraph">{t("block.text")}</option>
            {[1, 2, 3, 4, 5, 6].map((level) => (
              <option key={level} value={level}>
                {t("block.heading", { level })}
              </option>
            ))}
          </select>,
          "rich-format-block",
        )}
        {select(
          t("format.font"),
          <select
            aria-label={t("format.font")}
            value={editor.getAttributes("textStyle").fontFamily ?? ""}
            onChange={(event) =>
              editor
                .chain()
                .focus()
                .setMark("textStyle", {
                  fontFamily: event.target.value || null,
                })
                .run()
            }
          >
            <option value="">{t("format.fontCompact")}</option>
            <option value="sans-serif">{t("format.fontSans")}</option>
            <option value="serif">{t("format.fontSerif")}</option>
            <option value="monospace">{t("format.fontMono")}</option>
          </select>,
          "rich-format-font",
        )}
        {select(
          t("format.fontSize"),
          <select
            aria-label={t("format.fontSize")}
            value={editor.getAttributes("textStyle").fontSize ?? ""}
            onChange={(event) =>
              editor
                .chain()
                .focus()
                .setMark("textStyle", { fontSize: event.target.value || null })
                .run()
            }
          >
            <option value="">{t("format.sizeCompact")}</option>
            {[12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map((size) => (
              <option key={size} value={`${size}px`}>
                {size}
              </option>
            ))}
          </select>,
          "rich-format-size",
        )}
      </div>
      <span className="rich-format-divider" aria-hidden="true" />
      <div
        className="rich-format-group"
        role="group"
        aria-label={t("format.characterStyle")}
      >
        {action(
          t("format.bold"),
          <Bold size={16} />,
          editor.isActive("bold"),
          () => editor.chain().focus().toggleBold().run(),
        )}
        {action(
          t("format.italic"),
          <Italic size={16} />,
          editor.isActive("italic"),
          () => editor.chain().focus().toggleItalic().run(),
        )}
        {action(
          t("format.underline"),
          <Underline size={16} />,
          editor.isActive("underline"),
          () => editor.chain().focus().toggleUnderline().run(),
        )}
        {action(
          t("format.strike"),
          <Strikethrough size={16} />,
          editor.isActive("strike"),
          () => editor.chain().focus().toggleStrike().run(),
        )}
        {action(
          t("format.inlineCode"),
          <Code size={16} />,
          editor.isActive("code"),
          () => editor.chain().focus().toggleCode().run(),
        )}
      </div>
      <span className="rich-format-divider" aria-hidden="true" />
      <div
        className="rich-format-group"
        role="group"
        aria-label={t("format.colors")}
      >
        <button
          ref={colorButton}
          type="button"
          className={`rich-format-colors-toggle${colorPanel === "text" ? " is-active" : ""}`}
          aria-label={t("format.textColor")}
          title={t("format.textColor")}
          aria-expanded={colorPanel === "text"}
          aria-controls={colorPanel === "text" ? panelId : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setColorPanel(colorPanel === "text" ? null : "text")}
        >
          <span className="rich-format-color-icon">
            <Type size={16} />
            <i style={{ background: textColor }} />
          </span>
          <ChevronDown size={11} />
        </button>
        <button
          ref={highlightButton}
          type="button"
          className={`rich-format-colors-toggle${colorPanel === "highlight" ? " is-active" : ""}`}
          aria-label={t("format.highlightColor")}
          title={t("format.highlightColor")}
          aria-expanded={colorPanel === "highlight"}
          aria-controls={colorPanel === "highlight" ? panelId : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() =>
            setColorPanel(colorPanel === "highlight" ? null : "highlight")
          }
        >
          <span className="rich-format-color-icon">
            <Highlighter size={16} />
            <i style={{ background: highlightColor }} />
          </span>
          <ChevronDown size={11} />
        </button>
      </div>
      <span className="rich-format-divider" aria-hidden="true" />
      <div
        className="rich-format-group"
        role="group"
        aria-label={t("format.alignment")}
      >
        {select(
          t("format.alignment"),
          <>
            <AlignmentIcon size={16} aria-hidden="true" />
            <select
              aria-label={t("format.alignment")}
              value={alignment}
              onChange={(event) =>
                editor.chain().focus().setTextAlign(event.target.value).run()
              }
            >
              <option value="left">{t("format.alignLeft")}</option>
              <option value="center">{t("format.alignCenter")}</option>
              <option value="right">{t("format.alignRight")}</option>
              <option value="justify">{t("format.alignJustify")}</option>
            </select>
          </>,
          "rich-format-alignment",
        )}
        {action(
          t("format.addLink"),
          <Link2 size={16} />,
          editor.isActive("link"),
          onLink,
        )}
        {onNote &&
          action(
            tn("format.note"),
            <MessageSquareText size={16} />,
            editor.isActive("annotation") ||
              /^\s*\\note\b/.test(
                String(
                  editor.state.selection.$from.nodeAfter?.attrs.latex ?? "",
                ),
              ),
            onNote,
          )}
      </div>
      {colorPanel && (
        <ToolbarPanel
          key={colorPanel}
          className="rich-format-color-panel"
          onDismiss={() => setColorPanel(null)}
        >
          <div
            id={panelId}
            role="group"
            aria-label={t(
              colorPanel === "text"
                ? "format.textColor"
                : "format.highlightColor",
            )}
          >
            {[colorPanel].map((kind) => {
              const isText = kind === "text";
              const current = isText ? textColor : highlightColor;
              const label = isText
                ? t("format.textColor")
                : t("format.highlightColor");
              const apply = (color: string) =>
                isText
                  ? editor.chain().focus().setMark("textStyle", { color }).run()
                  : editor
                      .chain()
                      .focus()
                      .setMark("highlight", { color, mode: highlightMode })
                      .run();
              return (
                <div className="rich-format-palette" key={kind}>
                  <div className="rich-format-swatches">
                    {(isText ? textColors : highlightColors).map((color) => (
                      <button
                        type="button"
                        key={color}
                        className={`rich-format-swatch${current === color ? " is-active" : ""}`}
                        style={{ background: color }}
                        aria-label={`${label} ${color}`}
                        title={color}
                        aria-pressed={current === color}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => apply(color)}
                      />
                    ))}
                    <label
                      className="rich-format-custom-color"
                      title={t("format.customColor")}
                    >
                      <input
                        type="color"
                        aria-label={label}
                        value={current}
                        onChange={(event) => apply(event.target.value)}
                      />
                    </label>
                  </div>
                  {!isText && (
                    <button
                      type="button"
                      className="rich-format-clear-highlight"
                      disabled={!editor.isActive("highlight")}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        editor.chain().focus().unsetHighlight().run()
                      }
                    >
                      {t("format.removeHighlight")}
                    </button>
                  )}
                  {!isText && (
                    <div
                      className="rich-format-highlight-modes"
                      role="group"
                      aria-label={t("format.highlightMode")}
                    >
                      {(["lower", "full"] as const).map((mode) => (
                        <button
                          type="button"
                          key={mode}
                          aria-pressed={highlightMode === mode}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() =>
                            editor
                              .chain()
                              .focus()
                              .setMark("highlight", {
                                color: highlightColor,
                                mode,
                              })
                              .run()
                          }
                        >
                          <span
                            className={`rich-format-highlight-preview is-${mode}`}
                            style={
                              {
                                "--highlight-preview": highlightColor,
                              } as React.CSSProperties
                            }
                          >
                            Aa
                          </span>
                          {t(
                            mode === "lower"
                              ? "format.highlightLower"
                              : "format.highlightFull",
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ToolbarPanel>
      )}
    </div>
  );
}
