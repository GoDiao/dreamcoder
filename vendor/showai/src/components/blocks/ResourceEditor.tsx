import { BlockSettings } from "./action-host";
import { CAPACITY, formatBytes } from "../../portable/capacity.mjs";
import { useState } from "react";
import { Check, Upload } from "../../ui/icons";
import { Field } from "./shared";
import {
  fileMime,
  MAX_UPLOAD_BYTES,
  validateResearchData,
} from "./research-contract.mjs";
import { text } from "./helpers";
import type { BlockData } from "./types";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/resourceEditor";
import common from "../../i18n/messages/common";

export function ResourceEditor({
  kind,
  data,
  onSave,
  onClose,
}: {
  kind: "video" | "audio" | "pdf";
  data: BlockData;
  onSave: (next: BlockData) => void;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const [draft, setDraft] = useState(data);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (key: string, value: unknown) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const upload = async (file: File) => {
    setError("");
    const mime = fileMime(kind, file);
    if (!mime) {
      setError(t("wrongType"));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        t("tooLarge", {
          name: file.name,
          size: formatBytes(file.size),
          limit: formatBytes(CAPACITY.resourceBytes),
        }),
      );
      return;
    }
    setLoading(true);
    try {
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(
            String(reader.result).replace(
              /^data:[^;,]*;base64,/,
              `data:${mime};base64,`,
            ),
          );
        reader.onerror = () =>
          reject(reader.error ?? new Error(t("readFailed")));
        reader.readAsDataURL(file);
      });
      setDraft((current) => ({
        ...current,
        src: encoded,
        fileName: file.name,
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("readFailed"));
    } finally {
      setLoading(false);
    }
  };
  const save = () => {
    try {
      validateResearchData(kind, draft);
      onSave(draft);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("invalid"));
    }
  };
  return (
    <BlockSettings>
      <div
        className="sb-editor-panel"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="sb-resource-source">
          <label className="sb-button sb-resource-upload">
            <Upload size={14} />
            {loading ? t("reading") : t("chooseLocal")}
            <input
              type="file"
              aria-label={t("chooseLocal")}
              disabled={loading}
              accept={kind === "pdf" ? ".pdf,application/pdf" : `${kind}/*`}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = "";
              }}
            />
          </label>
          {text(draft.fileName) && (
            <span className="sb-resource-file-name">
              {text(draft.fileName)}
            </span>
          )}
        </div>
        <Field label={t("onlineUrl")}>
          <input
            type="url"
            placeholder="https://…"
            value={text(draft.src).startsWith("data:") ? "" : text(draft.src)}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                src: event.target.value,
                fileName: "",
              }))
            }
          />
        </Field>
        <Field label={t("title")}>
          <input
            value={text(draft.title)}
            onChange={(event) => set("title", event.target.value)}
          />
        </Field>
        <Field label={t("caption")}>
          <textarea
            rows={2}
            value={text(draft.caption)}
            onChange={(event) => set("caption", event.target.value)}
          />
        </Field>
        {kind === "video" && (
          <>
            <Field label={t("aspectRatio")}>
              <select
                value={text(draft.aspectRatio, "16:9")}
                onChange={(event) => set("aspectRatio", event.target.value)}
              >
                {["16:9", "4:3", "1:1", "9:16"].map((ratio) => (
                  <option key={ratio}>{ratio}</option>
                ))}
              </select>
            </Field>
            <Field label={t("poster")}>
              <input
                value={text(draft.poster)}
                onChange={(event) => set("poster", event.target.value)}
              />
            </Field>
          </>
        )}
        {kind === "pdf" && (
          <div className="sb-resource-fields">
            <Field label={t("initialPage")}>
              <input
                type="number"
                min={1}
                value={Number(draft.page ?? 1)}
                onChange={(event) => set("page", event.target.valueAsNumber)}
              />
            </Field>
            <Field label={t("readerHeight")}>
              <input
                type="number"
                min={240}
                max={1200}
                value={Number(draft.height ?? 560)}
                onChange={(event) => set("height", event.target.valueAsNumber)}
              />
            </Field>
          </div>
        )}
        <p className="sb-resource-hint">{t("hint")}</p>
        {error && (
          <p className="sb-error" role="alert">
            {error}
          </p>
        )}
        <div className="sb-panel-footer">
          <button
            className="sb-button sb-primary"
            type="button"
            disabled={loading}
            onClick={save}
          >
            <Check size={14} />
            {tc("save")}
          </button>
        </div>
      </div>
    </BlockSettings>
  );
}
