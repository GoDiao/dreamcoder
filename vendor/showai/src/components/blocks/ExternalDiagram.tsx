import { componentSelectionScript } from "../custom/selection-bridge";
import { useSelectionFrame } from "../custom/useSelectionFrame";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload } from "../../ui/icons";
import { BlockHeader, Field } from "./shared";
import { BlockSettings } from "./action-host";
import { useViewportLock, ViewportLockButton } from "./ViewportLock";
import { downloadFile, text } from "./helpers";
import {
  diagramDocument,
  diagramExportDocument,
  diagramLicense,
  diagramSource,
  diagramStyledSource,
  listDiagramTemplates,
} from "./diagrams/templates";
import {
  diagramLabels,
  replaceDiagramLabels,
  standaloneDiagramSvg,
} from "./diagrams/source-editing";
import {
  validateDiagramData,
  type DiagramFamily,
} from "./diagrams/contract.mjs";
import type { BlockData, BlockProps } from "./types";
import {
  compactDiagramPresentation,
  originalDiagramPresentation,
  diagramPresentation,
  diagramCaptions,
  diagramPresentationSource,
} from "./diagrams/presentation";
import type { MessageKey } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/diagram";
import "./external-diagram.css";

const names: Record<DiagramFamily, MessageKey<typeof messages>> = {
  archify: "family.archify",
  "diagram-design": "family.diagramDesign",
  "fireworks-tech-graph": "family.fireworks",
};

function ExternalDiagramBlock({
  family,
  data,
  onChange,
  readOnly,
}: BlockProps & { family: DiagramFamily }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [selectionChannel] = useState(() => crypto.randomUUID());
  useSelectionFrame(iframe, selectionChannel);
  const t = useTranslator(messages);
  const name = t(names[family]);
  const templates = useMemo(() => listDiagramTemplates(family), [family]);
  const source = useMemo(() => diagramSource(family, data), [family, data]);
  const presentation = useMemo(() => diagramPresentation(data), [data]);
  const captions = useMemo(() => diagramCaptions(source), [source]);
  const shownSource = useMemo(
    () =>
      diagramPresentationSource(
        diagramStyledSource(family, source),
        presentation,
      ),
    [family, source, presentation],
  );
  const html = useMemo(
    () =>
      diagramDocument(family, shownSource, presentation) +
      `<script>${componentSelectionScript(selectionChannel)}</script>`,
    [family, shownSource, presentation, selectionChannel],
  );
  const outsideTitle =
    presentation.title === "outside"
      ? text(data.title, captions.title)
      : !data.presentation && presentation.title === "inside"
        ? text(data.title)
        : "";
  const outsideDescription =
    presentation.description === "outside"
      ? text(data.description, captions.description)
      : !data.presentation && presentation.description === "inside"
        ? text(data.description)
        : "";
  const lock = useViewportLock(`diagram-${family}`);
  const baseline = useRef("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BlockData>({});
  const [labels, setLabels] = useState<string[]>([]);
  const [labelsChanged, setLabelsChanged] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const editable = Boolean(onChange && !readOnly);
  useEffect(() => setReady(false), [html]);

  const readLabels = (value: string) => {
    try {
      setLabels(diagramLabels(value));
      setLabelsChanged(false);
      setError("");
    } catch (caught) {
      setLabels([]);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const open = () => {
    if (editing) {
      setEditing(false);
      return;
    }
    baseline.current = JSON.stringify(data);
    setDraft({ ...data, source });
    readLabels(source);
    setEditing(true);
  };
  const selectTemplate = (id: string) => {
    if (id === "custom") {
      setDraft((current) => ({ ...current, template: id }));
      return;
    }
    const selected = templates.find((item) => item.id === id)!;
    setDraft((current) => ({
      ...current,
      template: id,
      source: selected.source,
    }));
    readLabels(selected.source);
  };
  const upload = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      setError(t("fileTooLarge"));
      return;
    }
    try {
      const imported = await file.text();
      validateDiagramData(family, { template: "custom", source: imported });
      setDraft((current) => ({
        ...current,
        template: "custom",
        source: imported,
      }));
      readLabels(imported);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const save = () => {
    if (JSON.stringify(data) !== baseline.current) {
      setError(t("changedElsewhere"));
      return;
    }
    try {
      const next = {
        ...draft,
        source: labelsChanged
          ? replaceDiagramLabels(text(draft.source), labels)
          : text(draft.source),
      };
      validateDiagramData(family, next);
      diagramLabels(next.source);
      onChange?.(next);
      setEditing(false);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const exportSvg = () => {
    try {
      const svg = standaloneDiagramSvg(shownSource);
      downloadFile(
        `<!--\n${diagramLicense(family).replaceAll("--", "—")}\n-->${svg}`,
        `${family}.svg`,
        "image/svg+xml",
      );
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <section
      ref={lock.ref}
      className="sb-block sb-external-diagram"
      aria-label={text(data.title, name)}
      data-diagram-family={family}
      data-viewport-lock-scope={`diagram-${family}`}
      data-viewport-locked={lock.locked}
      data-diagram-ready={ready}
    >
      <BlockHeader
        title={outsideTitle || name}
        defaultTitle={name}
        description={outsideDescription}
        editable={editable}
        editing={editing}
        onEdit={open}
      >
        <button
          type="button"
          className="sb-icon-button"
          aria-label={t("downloadSvg")}
          title={t("downloadSvg")}
          onClick={exportSvg}
        >
          <Download size={16} />
        </button>
        <button
          type="button"
          className="sb-icon-button"
          aria-label={t("downloadHtml")}
          title={t("downloadHtml")}
          onClick={() =>
            downloadFile(
              diagramExportDocument(
                html,
                outsideTitle,
                outsideDescription,
                presentation.notes === "details" ? captions.notes : [],
              ),
              `${family}.html`,
              "text/html",
            )
          }
        >
          HTML
        </button>
      </BlockHeader>
      {presentation.notes === "details" && captions.notes.length > 0 && (
        <details className="sb-diagram-notes">
          <summary>{t("presentation.notes")}</summary>
          {captions.notes.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
        </details>
      )}
      <ViewportLockButton
        {...lock}
        label={t("diagram")}
        unlockDescription={t("unlockDescription")}
      />
      {!ready && (
        // Covers the reserved frame area until the diagram document loads.
        <div className="sb-diagram-pending">
          <div role="status" style={{ height: Number(data.height ?? 560) }}>
            <span>{t("loading")}</span>
          </div>
        </div>
      )}
      <iframe
        ref={iframe}
        title={text(data.title, name)}
        className="sb-diagram-frame"
        sandbox="allow-scripts allow-downloads"
        referrerPolicy="no-referrer"
        srcDoc={html}
        style={{
          height: Number(data.height ?? 560),
          pointerEvents: lock.locked ? "none" : "auto",
        }}
        tabIndex={lock.locked ? -1 : 0}
        onLoad={() => setReady(true)}
      />
      {error && !editing && (
        <p className="sb-error" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <BlockSettings>
          <div
            className="sb-diagram-editor"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") setEditing(false);
            }}
          >
            <Field label={t("presentation.label")}>
              <select
                aria-label={t("presentation.label")}
                value={
                  JSON.stringify(diagramPresentation(draft)) ===
                  JSON.stringify(originalDiagramPresentation)
                    ? "original"
                    : JSON.stringify(diagramPresentation(draft)) ===
                        JSON.stringify(compactDiagramPresentation)
                      ? "compact"
                      : "custom"
                }
                onChange={(event) => {
                  if (event.target.value !== "custom")
                    setDraft((current) => ({
                      ...current,
                      presentation:
                        event.target.value === "original"
                          ? originalDiagramPresentation
                          : compactDiagramPresentation,
                    }));
                }}
              >
                <option value="compact">{t("presentation.compact")}</option>
                <option value="original">{t("presentation.original")}</option>
                <option value="custom">{t("presentation.custom")}</option>
              </select>
            </Field>
            <div className="sb-diagram-display-settings">
              {(
                [
                  ["title", "presentation.titlePosition"],
                  ["description", "presentation.descriptionPosition"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={t(label)}>
                  <select
                    aria-label={t(label)}
                    value={diagramPresentation(draft)[key]}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        presentation: {
                          ...diagramPresentation(current),
                          [key]: event.target.value,
                        },
                      }))
                    }
                  >
                    <option value="outside">{t("presentation.outside")}</option>
                    <option value="inside">{t("presentation.inside")}</option>
                    <option value="hidden">{t("presentation.hidden")}</option>
                  </select>
                </Field>
              ))}
              <Field label={t("presentation.notes")}>
                <select
                  aria-label={t("presentation.notesDisplay")}
                  value={diagramPresentation(draft).notes}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      presentation: {
                        ...diagramPresentation(current),
                        notes: event.target.value,
                      },
                    }))
                  }
                >
                  <option value="hidden">{t("presentation.hidden")}</option>
                  <option value="details">{t("presentation.details")}</option>
                  <option value="inline">{t("presentation.inline")}</option>
                </select>
              </Field>
              {(
                [
                  ["legend", "presentation.legend"],
                  ["controls", "presentation.controls"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="sb-diagram-toggle">
                  <input
                    aria-label={t(label)}
                    type="checkbox"
                    checked={diagramPresentation(draft)[key]}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        presentation: {
                          ...diagramPresentation(current),
                          [key]: event.target.checked,
                        },
                      }))
                    }
                  />
                  {t(label)}
                </label>
              ))}
            </div>
            <Field label={t("template")}>
              <select
                aria-label={t("diagramTemplate")}
                value={text(draft.template)}
                onChange={(event) => selectTemplate(event.target.value)}
              >
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
                <option value="custom">{t("customTemplate")}</option>
              </select>
            </Field>
            <div className="sb-diagram-fields">
              <Field label={t("title")}>
                <input
                  aria-label={t("diagramTitle")}
                  value={text(draft.title)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label={t("height")}>
                <input
                  aria-label={t("diagramHeight")}
                  type="number"
                  min={240}
                  max={1200}
                  value={Number(draft.height ?? 560)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      height: Number(event.target.value),
                    }))
                  }
                />
              </Field>
            </div>
            <Field label={t("description")}>
              <textarea
                aria-label={t("diagramDescription")}
                rows={2}
                value={text(draft.description)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </Field>
            <details className="sb-diagram-labels">
              <summary>{t("labelsSummary", { count: labels.length })}</summary>
              <div>
                {labels.map((label, index) => (
                  <Field
                    key={index}
                    label={t("labelField", { index: index + 1 })}
                  >
                    <input
                      aria-label={t("labelInput", { index: index + 1 })}
                      value={label}
                      onChange={(event) => {
                        setLabels((current) =>
                          current.map((value, i) =>
                            i === index ? event.target.value : value,
                          ),
                        );
                        setLabelsChanged(true);
                      }}
                    />
                  </Field>
                ))}
              </div>
            </details>
            <details>
              <summary>{t("source")}</summary>
              <textarea
                aria-label={t("source")}
                className="sb-diagram-source"
                rows={12}
                spellCheck={false}
                value={text(draft.source)}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    source: event.target.value,
                  }));
                  setLabels([]);
                  setLabelsChanged(false);
                }}
              />
              <button
                type="button"
                className="sb-button"
                onClick={() => readLabels(text(draft.source))}
              >
                {t("readLabels")}
              </button>
            </details>
            <label className="sb-button sb-diagram-upload">
              <Upload size={14} />
              {t("importFile")}
              <input
                type="file"
                aria-label={t("importFileInput")}
                accept=".html,.htm,.svg,text/html,image/svg+xml"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = "";
                }}
              />
            </label>
            {error && (
              <p className="sb-error" role="alert">
                {error}
              </p>
            )}
            <div className="sb-editor-footer">
              <button type="button" className="sb-button" onClick={save}>
                {t("save")}
              </button>
              <button
                type="button"
                className="sb-button"
                onClick={() => setEditing(false)}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </BlockSettings>
      )}
    </section>
  );
}

export function ArchifyBlock(props: BlockProps) {
  return <ExternalDiagramBlock {...props} family="archify" />;
}
export function DiagramDesignBlock(props: BlockProps) {
  return <ExternalDiagramBlock {...props} family="diagram-design" />;
}
export function FireworksTechGraphBlock(props: BlockProps) {
  return <ExternalDiagramBlock {...props} family="fireworks-tech-graph" />;
}
