import { ReaderBlock, useReaderState } from "../../surface/reader-state";
import { ownSourceValue } from "../../surface/source-runtime";
import { isTextPointerTarget } from "../../surface/text-selection";
import { clearWidgetSelection } from "./widget-selection";
import { ImageContent } from "./ImageContent";
import { richTextStyle } from "./model.mjs";
import { mathHtml } from "../blocks/markdown-math.mjs";
import { installNoteBubbles } from "../blocks/note-bubble";
import {
  useEffect,
  useState,
  useContext,
  type PointerEvent,
  type MouseEvent,
} from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import { ChevronRight } from "../../ui/icons";
import { TextSelection } from "@tiptap/pm/state";
import { MAX_STEPS, StepperBar, stepTitle } from "./Stepper";
import { RichTextEnvironment } from "./environment";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/richText";

export function WidgetView({
  node,
  updateAttributes,
  editor,
  selected,
  getPos,
}: NodeViewProps) {
  const { renderWidget } = useContext(RichTextEnvironment);
  const editable = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });
  return (
    <NodeViewWrapper
      className={`document-widget${selected && editable ? " is-selected" : ""}`}
      data-widget-kind={node.attrs.kind}
      data-block-id={node.attrs.id ?? undefined}
      onPointerDownCapture={(event: PointerEvent<HTMLDivElement>) => {
        if (
          !editable ||
          event.button !== 0 ||
          event.shiftKey ||
          event.metaKey ||
          event.ctrlKey
        )
          return;
        if (
          isTextPointerTarget(
            event.target as Element,
            event.clientX,
            event.clientY,
          )
        ) {
          const transaction = clearWidgetSelection(editor.state);
          if (transaction) editor.view.dispatch(transaction);
          return;
        }
        const position = getPos();
        if (!selected && typeof position === "number")
          editor.commands.setNodeSelection(position);
      }}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        if (
          !editable ||
          event.button !== 0 ||
          event.shiftKey ||
          event.metaKey ||
          event.ctrlKey
        )
          return;
        if (
          isTextPointerTarget(
            event.target as Element,
            event.clientX,
            event.clientY,
          ) ||
          (event.target as Element).closest('[data-text-selection="true"]')
        ) {
          event.stopPropagation();
          return;
        }
        const position = getPos();
        if (typeof position !== "number") return;
        editor.commands.setNodeSelection(position);
        // The atom owns the click; ProseMirror must not move its selection to nearby text.
        event.stopPropagation();
      }}
    >
      <ReaderBlock id={node.attrs.id}>
        {renderWidget({
          kind: node.attrs.kind,
          data: node.attrs.data,
          onChange: (data) => {
            if (editor.isEditable) updateAttributes({ data: ownSourceValue(data) });
          },
          readOnly: !editable,
        })}
      </ReaderBlock>
    </NodeViewWrapper>
  );
}

const icons = ["💡", "🌱", "📌", "✨", "⚠️", "🔎"];
const tones = ["sage", "sand", "blue", "rose"];

export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const t = useTranslator(messages);
  const editable = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });
  return (
    <NodeViewWrapper
      style={richTextStyle(node.attrs.componentStyle)}
      className={`document-callout tone-${node.attrs.tone}`}
      data-block-id={node.attrs.id ?? undefined}
    >
      <div className="callout-decoration" contentEditable={false}>
        <button
          className="callout-icon"
          disabled={!editable}
          title={t("callout.changeIcon")}
          aria-label={t("callout.changeIconLabel")}
          onClick={() =>
            updateAttributes({
              icon: icons[(icons.indexOf(node.attrs.icon) + 1) % icons.length],
            })
          }
        >
          {node.attrs.icon}
        </button>
        {editable && (
          <button
            className="callout-color"
            title={t("callout.changeColor")}
            aria-label={t("callout.changeColorLabel")}
            onClick={() =>
              updateAttributes({
                tone: tones[
                  (tones.indexOf(node.attrs.tone) + 1) % tones.length
                ],
              })
            }
          />
        )}
      </div>
      <div>
        {node.attrs.title && <strong>{node.attrs.title}</strong>}
        <NodeViewContent className="callout-content" />
      </div>
    </NodeViewWrapper>
  );
}

export function ToggleView({ node, updateAttributes, editor }: NodeViewProps) {
  const t = useTranslator(messages);
  const editable = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });
  // Editing saves the open state into the page; reading keeps it for this reader.
  const [editingOpen, setOpen] = useState(Boolean(node.attrs.open));
  useEffect(() => setOpen(Boolean(node.attrs.open)), [node.attrs.open]);
  const [readingOpen, setReadingOpen] = useReaderState(
    "open",
    Boolean(node.attrs.open),
    { block: node.attrs.id ?? null, accept: (value) => typeof value === "boolean" },
  );
  const open = editable ? editingOpen : readingOpen;
  return (
    <NodeViewWrapper
      style={richTextStyle(node.attrs.componentStyle)}
      className={`document-toggle${open ? " is-open" : ""}`}
      data-block-id={node.attrs.id ?? undefined}
    >
      <div className="toggle-heading" contentEditable={false}>
        <button
          aria-label={open ? t("toggle.collapse") : t("toggle.expand")}
          aria-expanded={open}
          onClick={() => {
            if (!editor.isEditable) return setReadingOpen(!open);
            setOpen(!open);
            updateAttributes({ open: !open });
          }}
        >
          <ChevronRight size={16} />
        </button>
        {editable ? (
          <input
            aria-label={t("toggle.titleLabel")}
            value={node.attrs.title}
            onChange={(event) =>
              updateAttributes({ title: event.target.value })
            }
            placeholder={t("toggle.titlePlaceholder")}
          />
        ) : (
          <span>{node.attrs.title}</span>
        )}
      </div>
      <div className="toggle-body" hidden={!open}>
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  );
}

export function StepperView({ node, editor, getPos }: NodeViewProps) {
  const t = useTranslator(messages);
  const editable = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });
  const [active, setActive] = useReaderState("step", 0, {
    block: node.attrs.id ?? null,
    accept: Number.isInteger,
  });
  const count = node.childCount;
  const current = Math.min(active, count - 1);
  const titles = Array.from({ length: count }, (_, index) =>
    stepTitle(node.child(index).attrs.title, index),
  );
  const start = () => {
    const pos = getPos();
    if (typeof pos !== "number") throw new Error("The stepper is detached.");
    return pos + 1;
  };
  const stepPos = (index: number) => {
    let pos = start();
    for (let k = 0; k < index; k += 1) pos += node.child(k).nodeSize;
    return pos;
  };
  // A caret moved into another step (arrow keys, search, undo) opens that step.
  useEffect(() => {
    const follow = () => {
      const pos = getPos();
      // Read the stepper from the current document: this runs before React
      // re-renders the view with the updated node.
      const stepper =
        typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
      if (!stepper || stepper.type.name !== "stepper") return;
      const { from } = editor.state.selection;
      if (from <= pos! || from >= pos! + stepper.nodeSize) return;
      let edge = pos! + 1;
      for (let k = 0; k < stepper.childCount; k += 1) {
        edge += stepper.child(k).nodeSize;
        if (from < edge) return setActive(k);
      }
    };
    editor.on("selectionUpdate", follow);
    return () => {
      editor.off("selectionUpdate", follow);
    };
  }, [editor, getPos]);
  const edit = (change: (tr: typeof editor.state.tr) => number) => {
    const { tr } = editor.state;
    const next = change(tr);
    editor.view.dispatch(tr);
    setActive(next);
    return next;
  };
  const rename = (title: string) =>
    edit((tr) => {
      tr.setNodeMarkup(stepPos(current), undefined, {
        ...node.child(current).attrs,
        title,
      });
      return current;
    });
  // A new step takes the caret so typing continues inside it.
  const add = () => {
    edit((tr) => {
      const { schema } = editor.state;
      const at = stepPos(current) + node.child(current).nodeSize;
      tr.insert(
        at,
        schema.nodes.step.create(
          { title: "" },
          schema.nodes.paragraph.create(),
        ),
      );
      tr.setSelection(TextSelection.create(tr.doc, at + 2));
      return current + 1;
    });
    editor.view.focus();
  };
  const remove = () =>
    edit((tr) => {
      const from = stepPos(current);
      tr.delete(from, from + node.child(current).nodeSize);
      return Math.max(0, current - 1);
    });
  const move = (delta: -1 | 1) =>
    edit((tr) => {
      const target = current + delta;
      const step = node.child(current);
      const from = stepPos(current);
      // Moving later lands after the following step; earlier, before the previous one.
      const at =
        delta < 0
          ? stepPos(target)
          : stepPos(target) + node.child(target).nodeSize;
      tr.delete(from, from + step.nodeSize);
      tr.insert(tr.mapping.map(at), step);
      return target;
    });
  return (
    <NodeViewWrapper
      style={richTextStyle(node.attrs.componentStyle)}
      className="document-stepper"
      data-block-id={node.attrs.id ?? undefined}
    >
      <StepperBar titles={titles} active={current} onSelect={setActive} />
      {editable && (
        <div className="stepper-edit" contentEditable={false}>
          <input
            aria-label={t("stepper.titleLabel")}
            placeholder={t("stepper.titlePlaceholder")}
            value={node.child(current).attrs.title ?? ""}
            onChange={(event) => rename(event.target.value)}
          />
          <button
            type="button"
            title={t("stepper.moveEarlier")}
            aria-label={t("stepper.moveEarlier")}
            disabled={current === 0}
            onClick={() => move(-1)}
          >
            ↤
          </button>
          <button
            type="button"
            title={t("stepper.moveLater")}
            aria-label={t("stepper.moveLater")}
            disabled={current === count - 1}
            onClick={() => move(1)}
          >
            ↦
          </button>
          <button
            type="button"
            title={t("stepper.add")}
            aria-label={t("stepper.add")}
            disabled={count >= MAX_STEPS}
            onClick={add}
          >
            +
          </button>
          <button
            type="button"
            title={t("stepper.remove")}
            aria-label={t("stepper.remove")}
            disabled={count <= 1}
            onClick={remove}
          >
            ×
          </button>
        </div>
      )}
      <NodeViewContent className="stepper-steps" data-active={current} />
    </NodeViewWrapper>
  );
}

export function MathView({
  node,
  updateAttributes,
  editor,
  selected,
}: NodeViewProps) {
  const t = useTranslator(messages);
  const display = node.type.name === "mathBlock" || node.attrs.display;
  installNoteBubbles();
  return (
    <NodeViewWrapper
      as={display ? "div" : "span"}
      className={display ? "sb-math-display" : "sb-math-inline"}
      contentEditable={false}
    >
      <span
        dangerouslySetInnerHTML={{
          __html: mathHtml(node.attrs.latex, display),
        }}
      />
      {selected && editor.isEditable && (
        <input
          aria-label={t("math.source")}
          value={node.attrs.latex}
          onChange={(event) => updateAttributes({ latex: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              editor.commands.focus();
            }
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

export function ImageView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper
      data-block-id={node.attrs.id}
      data-drag-handle
      contentEditable={false}
    >
      <ImageContent attrs={node.attrs} />
    </NodeViewWrapper>
  );
}
