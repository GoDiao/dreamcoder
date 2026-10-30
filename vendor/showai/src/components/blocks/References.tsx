import { BlockSettings } from "./action-host";
import { useState } from "react";
import { BookOpen, Check, ExternalLink, Plus, Trash2 } from "../../ui/icons";
import { text, uid } from "./helpers";
import { referenceUrl, validateResearchData } from "./research-contract.mjs";
import { BlockHeader, EmptyState, Field, blockLabel } from "./shared";
import type { BlockProps } from "./types";
import "./research-media.css";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/references";
import common from "../../i18n/messages/common";

type Reference = {
  id: string;
  title: string;
  authors?: string;
  year?: string;
  venue?: string;
  doi?: string;
  url?: string;
  note?: string;
};
export function ReferencesBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data);
  const [error, setError] = useState("");
  const editable = Boolean(onChange && !readOnly);
  const items = (data.items ?? []) as Reference[];
  const draftItems = (draft.items ?? []) as Reference[];
  const open = () => {
    setDraft(data);
    setError("");
    setEditing(!editing);
  };
  const change = (id: string, key: string, value: string) =>
    setDraft((current) => ({
      ...current,
      items: (current.items as Reference[]).map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      ),
    }));
  const save = () => {
    try {
      validateResearchData("references", draft);
      onChange?.(draft);
      setEditing(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("invalid"));
    }
  };
  return (
    <section
      className="sb-block sb-references"
      aria-label={blockLabel(data.title, t("references"))}
    >
      <BlockHeader
        title={text(data.title)}
        defaultTitle={t("references")}
        editable={editable}
        editing={editing}
        onEdit={open}
      />
      {editing && (
        <BlockSettings>
          <div
            className="sb-editor-panel"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") setEditing(false);
            }}
          >
            <Field label={t("title")}>
              <input
                value={text(draft.title)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </Field>
            {draftItems.map((item, index) => (
              <fieldset className="sb-reference-editor" key={item.id}>
                <legend>{t("entry", { index: index + 1 })}</legend>
                <Field label={t("entryTitle")}>
                  <input
                    value={item.title}
                    onChange={(event) =>
                      change(item.id, "title", event.target.value)
                    }
                  />
                </Field>
                <Field label={t("authors")}>
                  <input
                    placeholder={t("authorsPlaceholder")}
                    value={item.authors ?? ""}
                    onChange={(event) =>
                      change(item.id, "authors", event.target.value)
                    }
                  />
                </Field>
                <div className="sb-resource-fields">
                  <Field label={t("year")}>
                    <input
                      value={item.year ?? ""}
                      onChange={(event) =>
                        change(item.id, "year", event.target.value)
                      }
                    />
                  </Field>
                  <Field label={t("venue")}>
                    <input
                      value={item.venue ?? ""}
                      onChange={(event) =>
                        change(item.id, "venue", event.target.value)
                      }
                    />
                  </Field>
                </div>
                <Field label="DOI">
                  <input
                    placeholder="10.xxxx/…"
                    value={item.doi ?? ""}
                    onChange={(event) =>
                      change(item.id, "doi", event.target.value)
                    }
                  />
                </Field>
                <Field label={t("url")}>
                  <input
                    type="url"
                    value={item.url ?? ""}
                    onChange={(event) =>
                      change(item.id, "url", event.target.value)
                    }
                  />
                </Field>
                <Field label={t("note")}>
                  <textarea
                    rows={2}
                    value={item.note ?? ""}
                    onChange={(event) =>
                      change(item.id, "note", event.target.value)
                    }
                  />
                </Field>
                <button
                  type="button"
                  className="sb-button"
                  aria-label={t("deleteEntry", { index: index + 1 })}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      items: (current.items as Reference[]).filter(
                        (entry) => entry.id !== item.id,
                      ),
                    }))
                  }
                >
                  <Trash2 size={14} />
                  {tc("delete")}
                </button>
              </fieldset>
            ))}
            {error && (
              <p className="sb-error" role="alert">
                {error}
              </p>
            )}
            <div className="sb-panel-footer">
              <button
                type="button"
                className="sb-button"
                disabled={draftItems.length >= 500}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    items: [
                      ...(current.items as Reference[]),
                      { id: uid(), title: "" },
                    ],
                  }))
                }
              >
                <Plus size={14} />
                {t("addEntry")}
              </button>
              <button
                type="button"
                className="sb-button sb-primary"
                onClick={save}
              >
                <Check size={14} />
                {tc("save")}
              </button>
            </div>
          </div>
        </BlockSettings>
      )}
      {items.length ? (
        <ol className="sb-reference-list">
          {items.map((item, index) => {
            const url = referenceUrl(item);
            return (
              <li key={item.id} id={`ref-${item.id}`}>
                <span className="sb-reference-number">[{index + 1}]</span>
                <div className="sb-reference-entry">
                  <div className="sb-reference-meta">
                    {[item.authors, item.year].filter(Boolean).join(" · ")}
                  </div>
                  {url ? (
                    <a
                      className="sb-reference-title"
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.title}
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <strong className="sb-reference-title">{item.title}</strong>
                  )}
                  {item.venue && (
                    <div className="sb-reference-venue">{item.venue}</div>
                  )}
                  {item.doi && (
                    <a
                      className="sb-reference-doi"
                      href={referenceUrl({ doi: item.doi })}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      doi:
                      {item.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")}
                    </a>
                  )}
                  {item.note && (
                    <p className="sb-reference-note">{item.note}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState
          icon={<BookOpen size={28} strokeWidth={1.4} />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            editable && !editing ? (
              <button type="button" className="sb-button" onClick={open}>
                <Plus size={14} />
                {t("addEntry")}
              </button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
