import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/primitives";
import { Database } from "../../ui/icons";
import {
  codeLanguages,
  normalizeCodeLanguage,
  supportsCodeLanguage,
} from "./code-highlighting";

/** The workbench's shared data dialog; it is not part of this package, so it answers an event. */
const SHARED_DATA_EVENT = "showai:shared-data";
function sharedDataAvailable() {
  if (typeof window === "undefined") return false;
  const probe = new CustomEvent(SHARED_DATA_EVENT, {
    cancelable: true,
    detail: null,
  });
  window.dispatchEvent(probe);
  return probe.defaultPrevented;
}

/** Component-specific fields join the existing block menu and its lifecycle. */
export function ContentNodeActions({
  editor,
  position,
  onDone,
}: {
  editor: Editor;
  position: number;
  onDone?: () => void;
}) {
  const t = useTranslator(messages);
  const [copyStatus, setCopyStatus] = useState("");
  const node = editor.state.doc.nodeAt(position);
  if (!node || !editor.isEditable) return null;
  const type = node.type.name;
  const update = (key: string, value: unknown) => {
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(position, key, value),
    );
  };
  const field = (key: string, label: string) => (
    <label key={key}>
      {label}
      <input
        value={node.attrs[key] ?? ""}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  );
  const styled = [
    "image",
    "table",
    "codeBlock",
    "callout",
    "toggle",
    "stepper",
    "horizontalRule",
  ].includes(type);
  const style = node.attrs.componentStyle ?? {};
  const updateStyle = (key: string, value: unknown) => {
    const next = { ...style };
    if (value === undefined) delete next[key];
    else next[key] = value;
    update("componentStyle", next);
  };
  if (
    type === "widget" &&
    node.attrs.kind !== "text" &&
    sharedDataAvailable()
  ) {
    const id = node.attrs.id;
    // Applies by block id: the document may change while the dialog is open.
    const apply = (data: Record<string, unknown>) => {
      let at = -1;
      editor.state.doc.descendants((child, offset) => {
        if (at < 0 && child.attrs?.id === id) at = offset;
        return at < 0;
      });
      if (at >= 0)
        editor.view.dispatch(
          editor.state.tr.setNodeAttribute(at, "data", data),
        );
    };
    return (
      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent(SHARED_DATA_EVENT, {
              cancelable: true,
              detail: { kind: node.attrs.kind, data: node.attrs.data, apply },
            }),
          );
          onDone?.();
        }}
      >
        <Database size={15} />
        {t("sharedData")}
      </button>
    );
  }
  return (
    <div className="content-node-fields">
      {type === "image" && (
        <>
          {field("src", t("imageSrc"))}
          {field("alt", t("imageAlt"))}
          {field("caption", t("imageCaption"))}
          {(["width", "height"] as const).map((key) => (
            <label key={key}>
              {t(key)}
              <input
                inputMode="decimal"
                value={node.attrs[key] ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  if (
                    !value ||
                    (/^\d+(?:px|%)?$/.test(value) &&
                      parseInt(value) > 0 &&
                      parseInt(value) <= 10000)
                  )
                    update(
                      key,
                      value
                        ? /^\d+$/.test(value)
                          ? Number(value)
                          : value
                        : null,
                    );
                }}
              />
            </label>
          ))}
          <label>
            {t("fit")}
            <select
              value={node.attrs.fit ?? "contain"}
              onChange={(event) => update("fit", event.target.value)}
            >
              <option value="contain">{t("contain")}</option>
              <option value="cover">{t("cover")}</option>
            </select>
          </label>
        </>
      )}
      {["table", "callout", "toggle"].includes(type) &&
        field("title", t("title"))}
      {type === "codeBlock" && (
        <>
          <label>
            {t("language")}
            <select
              value={normalizeCodeLanguage(node.attrs.language)}
              onChange={(event) => update("language", event.target.value)}
            >
              <option value="plaintext">{t("plainText")}</option>
              {!codeLanguages.includes(
                normalizeCodeLanguage(node.attrs.language),
              ) && (
                <option value={normalizeCodeLanguage(node.attrs.language)}>
                  {node.attrs.language}
                  {supportsCodeLanguage(node.attrs.language)
                    ? ""
                    : ` (${t("plainText")})`}
                </option>
              )}
              {codeLanguages
                .filter((language) => language !== "plaintext")
                .map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
            </select>
          </label>
          <button
            onClick={() => {
              navigator.clipboard
                .writeText(node.textContent)
                .then(() => setCopyStatus(t("copied")))
                .catch((error: Error) => setCopyStatus(error.message));
            }}
          >
            {t("copy")}
          </button>
          {copyStatus && <span role="status">{copyStatus}</span>}
        </>
      )}
      {styled && (
        <details>
          <summary>{t("appearance")}</summary>
          {(["color", "backgroundColor"] as const).map((key) => (
            <label key={key}>
              {t(key)}
              <input
                value={style[key] ?? ""}
                onChange={(event) =>
                  updateStyle(key, event.target.value || undefined)
                }
              />
            </label>
          ))}
          {(["fontSize", "padding", "radius"] as const).map((key) => (
            <label key={key}>
              {t(key)}
              <input
                type="number"
                min={key === "fontSize" ? 8 : 0}
                max="200"
                value={style[key] ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  if (
                    !value ||
                    (Number(value) >= (key === "fontSize" ? 8 : 0) &&
                      Number(value) <= 200)
                  )
                    updateStyle(key, value ? Number(value) : undefined);
                }}
              />
            </label>
          ))}
        </details>
      )}
    </div>
  );
}
