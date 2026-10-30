import {
  useContext,
  useEffect,
  useMemo,
  useState,
  lazy,
  Suspense,
} from "react";
import type { JSONContent } from "@tiptap/core";
import type { BlockProps } from "../blocks/types";
import type { RichTextEditorProps } from "./RichTextEditor";
const RichTextEditor = /* @__PURE__ */ lazy(() => import("./RichTextEditor"));
import { RichTextNode } from "./RichTextView";
import { RichTextEnvironment } from "./environment";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/richText";
import {
  richTextDocument,
  validateRichTextData,
  richTextStyle,
} from "./model.mjs";
import "../blocks/katex.css";
import { installNoteBubbles } from "../blocks/note-bubble";

export type RichTextHost = Pick<
  RichTextEditorProps,
  | "additionalExtensions"
  | "onEditorReady"
  | "onInsertNative"
  | "onDetachBlock"
  | "retentionKey"
> & {
  continuousPage?: boolean;
  onContentChange?: (
    content: JSONContent,
    options?: { separateHistory?: boolean; historyGroup?: string },
  ) => void;
};
/** One text component for direct typing, catalog insertion, AI input and the SDK. */
export function RichText({
  data,
  onChange,
  readOnly,
  host,
}: BlockProps & { host?: RichTextHost }) {
  const t = useTranslator(messages);
  // Annotated text and formulas show their notes in reading and editing.
  installNoteBubbles();
  validateRichTextData(data);
  const content = useMemo(
    () => richTextDocument(data),
    [data.content, data.format],
  );
  const { renderWidget } = useContext(RichTextEnvironment);
  const editable = !readOnly && !!(onChange || host?.onContentChange);
  const style = richTextStyle(data);
  return (
    <section
      className="sb-primitive sb-text rich-text-component"
      data-component-kind="text"
      aria-label={t("region")}
      style={style}
    >
      {editable ? (
        <Suspense
          fallback={<OpeningEditor label={t("opening")} />}
        >
          <RichTextEditor
            {...host}
            trailingNode={!host?.continuousPage}
            content={content}
            readOnly={false}
            onChange={(next, options) => {
              if (host?.onContentChange) host.onContentChange(next, options);
              else onChange?.({ ...data, content: next, format: "richtext" });
            }}
          />
        </Suspense>
      ) : (
        <div className="sb-rich-text portable-content">
          <RichTextNode
            node={content}
            renderWidget={(kind, data) =>
              renderWidget({ kind, data, readOnly: true })
            }
          />
        </div>
      )}
    </section>
  );
}

/**
 * Shown while the editor code loads; it stays silent for the first 180 ms so
 * fast loads do not flash. (This package cannot import ui/PendingNotice.)
 */
function OpeningEditor({ label }: { label: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 180);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      role="status"
      style={{ minHeight: 120, color: "var(--muted, #6b6b6b)", fontSize: 13 }}
    >
      {visible && label}
    </div>
  );
}
