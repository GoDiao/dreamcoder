import { BlockSettings } from "./action-host";
import { useState } from "react";
import { Bookmark, Check, ExternalLink, Link2 } from "../../ui/icons";
import { safeImageUrl, safeUrl, text } from "./helpers";
import { BlockHeader, EmptyState, Field } from "./shared";
import type { BlockProps } from "./types";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/references";

export function BookmarkBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    url: "",
    image: "",
  });
  const [error, setError] = useState("");
  const editable = Boolean(onChange && !readOnly);
  const url = safeUrl(data.url);
  const image = safeImageUrl(data.image);
  const hostname = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  const openEditor = () => {
    setDraft({
      title: text(data.title),
      description: text(data.description),
      url: text(data.url),
      image: text(data.image),
    });
    setError("");
    setEditing(!editing);
  };
  const save = () => {
    if (!safeUrl(draft.url.trim())) {
      setError(t("bookmark.invalidUrl"));
      return;
    }
    if (draft.image.trim() && !safeImageUrl(draft.image.trim())) {
      setError(t("bookmark.invalidImage"));
      return;
    }
    onChange?.({
      ...data,
      ...draft,
      url: draft.url.trim(),
      image: draft.image.trim(),
    });
    setEditing(false);
  };
  return (
    <section
      className="sb-block sb-bookmark"
      aria-label={text(data.title) || t("bookmark.label")}
    >
      <BlockHeader
        icon={<Bookmark size={16} />}
        editable={editable}
        editing={editing}
        onEdit={openEditor}
      />
      {editing && (
        <BlockSettings>
          <div className="sb-editor-panel">
            <Field label={t("bookmark.url")}>
              <input
                type="url"
                placeholder="https://…"
                value={draft.url}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    url: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label={t("bookmark.title")}>
              <input
                placeholder={t("bookmark.titlePlaceholder")}
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label={t("bookmark.summary")}>
              <textarea
                rows={3}
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label={t("bookmark.image")}>
              <input
                type="url"
                value={draft.image}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    image: event.target.value,
                  }))
                }
              />
            </Field>
            {error && (
              <p className="sb-error" role="alert">
                {error}
              </p>
            )}
            <div className="sb-panel-footer">
              <button
                type="button"
                className="sb-button sb-primary"
                onClick={save}
              >
                <Check size={14} />
                {t("bookmark.save")}
              </button>
            </div>
          </div>
        </BlockSettings>
      )}
      {url ? (
        <a
          className="sb-bookmark-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <div className="sb-bookmark-copy">
            <strong>{text(data.title) || hostname}</strong>
            {text(data.description) && <p>{text(data.description)}</p>}
            <span className="sb-bookmark-domain">
              <Link2 size={12} />
              {hostname}
              <ExternalLink size={12} />
            </span>
          </div>
          {image && (
            <img
              src={image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          )}
        </a>
      ) : (
        <EmptyState
          icon={<Bookmark size={27} strokeWidth={1.4} />}
          title={t("bookmark.emptyTitle")}
          action={
            editable && !editing ? (
              <button type="button" className="sb-button" onClick={openEditor}>
                <Link2 size={14} />
                {t("bookmark.add")}
              </button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
