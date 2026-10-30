import { useRef, useState, type ReactNode } from "react";
import PageIcon from "../components/PageIcon";
import {
  isImageIcon,
  MAX_ICON_LENGTH,
  validatePageIcon,
} from "../lib/page-icon.mjs";
import Dialog from "./Dialog";
import { errorMessage } from "./bridge";
import "./page-icon.css";
import { translator } from "../i18n";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import studioMessages from "../i18n/messages/studio";

const translate = translator(studioMessages);

const emoji = [
  "📄",
  "📚",
  "📝",
  "📊",
  "🧪",
  "🎨",
  "💡",
  "🔬",
  "🌱",
  "🚀",
  "⭐",
  "📌",
  "🎯",
  "🗂️",
  "🏠",
  "💻",
  "🌍",
  "🧠",
  "✨",
  "❤️",
  "🎬",
  "🛠️",
  "📷",
  "🎵",
];

async function readIcon(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type))
    throw new Error(translate("icon.unsupportedType"));
  if (file.size > 8 * 1024 * 1024) throw new Error(translate("icon.tooLarge"));
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new Error(translate("icon.readCancelled")));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = source;
  await image.decode();
  if (
    Math.max(image.naturalWidth, image.naturalHeight) <= 256 &&
    source.length <= MAX_ICON_LENGTH
  )
    return source;
  const scale = Math.min(
    1,
    256 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export default function PageIconDialog({
  value,
  onSave,
  onClose,
  title,
  fallback,
}: {
  value: string;
  title?: string;
  fallback?: ReactNode;
  onSave: (value: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const [selected, setSelected] = useState(value);
  const [text, setText] = useState(isImageIcon(value) ? "" : value);
  const [url, setUrl] = useState(/^https?:/i.test(value) ? value : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const preview =
    isImageIcon(selected) || selected.length <= 64 ? selected : "";
  const save = async (next: string) => {
    setBusy(true);
    setError("");
    try {
      await onSave(validatePageIcon(next.trim()));
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const upload = async (image: File) => {
    const ticket = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await readIcon(image);
      if (ticket === generation.current) setSelected(result);
    } catch (reason) {
      if (ticket === generation.current) setError(errorMessage(reason));
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  };
  return (
    <Dialog title={title ?? t("icon.pageIcon")} onClose={onClose}>
      <form
        className="page-icon-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save(selected);
        }}
      >
        <div className="page-icon-preview">
          <PageIcon value={preview} size={56} fallback={fallback} />
        </div>
        <label>
          {t("icon.text")}
          <input
            aria-label={t("icon.text")}
            value={text}
            maxLength={64}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value);
              setSelected(event.target.value);
              setError("");
            }}
          />
        </label>
        <div className="page-icon-emoji" aria-label={t("icon.common")}>
          {emoji.map((item) => (
            <button
              type="button"
              key={item}
              aria-label={t("icon.use", { icon: item })}
              aria-pressed={selected === item}
              disabled={busy}
              onClick={() => {
                setSelected(item);
                setText(item);
                setError("");
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          hidden
          onChange={(event) => {
            const image = event.target.files?.[0];
            event.target.value = "";
            if (image) void upload(image);
          }}
        />
        <button
          className="studio-button"
          type="button"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          {t("icon.upload")}
        </button>
        <p className="page-icon-help">{t("icon.help")}</p>
        <label>
          {t("icon.url")}
          <input
            inputMode="url"
            aria-label={t("icon.urlAria")}
            placeholder="https://…"
            value={url}
            disabled={busy}
            onChange={(event) => {
              setUrl(event.target.value);
              setSelected(event.target.value.trim());
              setError("");
            }}
          />
        </label>
        {error && (
          <p className="studio-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            className="studio-button"
            disabled={busy || !value}
            onClick={() => void save("")}
          >
            {t("icon.remove")}
          </button>
          <span />
          <button
            className="studio-button"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            {tc("cancel")}
          </button>
          <button
            className="studio-button primary"
            disabled={busy}
            type="submit"
          >
            {busy ? t("icon.processing") : tc("save")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
