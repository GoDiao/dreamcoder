import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Minus,
  Plus,
} from "../../ui/icons";
import { text } from "./helpers";
import { safeResourceUrl } from "./research-contract.mjs";
import { BlockHeader, EmptyState } from "./shared";
import { ResourceEditor } from "./ResourceEditor";
import type { BlockProps } from "./types";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/pdf";
import "./research-media.css";
import { isIndex, useReaderState } from "../../surface/reader-state";

function PdfReader({
  src,
  initialPage,
  height,
  name,
}: {
  src: string;
  initialPage: number;
  height: number;
  name: string;
}) {
  const t = useTranslator(messages);
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useReaderState("page", initialPage, {
    accept: (value) => isIndex(value) && value >= 1,
  });
  const [zoom, setZoom] = useReaderState("zoom", 1, {
    accept: (value) => typeof value === "number" && value >= 0.5 && value <= 3,
  });
  const [width, setWidth] = useState(600);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);
  const [pageText, setPageText] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pageInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof import("./pdf-engine").loadPdf> | undefined;
    import("./pdf-engine")
      .then((engine) => {
        if (!active) return;
        task = engine.loadPdf(src);
        return task.promise.then((document) => {
          if (!active) return;
          setPdf(document);
          setPage((current) => Math.min(current, document.numPages));
        });
      })
      .catch((failure) => {
        if (active) {
          setError(
            t("loadFailed", {
              error:
                failure instanceof Error ? failure.message : String(failure),
            }),
          );
          setPending(false);
        }
      });
    return () => {
      active = false;
      void task?.destroy();
    };
  }, [src]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true;
    let render: RenderTask | undefined;
    const target = canvas.current;
    setPending(true);
    setError("");
    setPageText("");
    pdf
      .getPage(page)
      .then(async (sheet) => {
        if (!active) return;
        const base = sheet.getViewport({ scale: 1 });
        const scale = (Math.max(120, width - 40) / base.width) * zoom;
        const view = sheet.getViewport({ scale });
        const density = Math.min(2, window.devicePixelRatio || 1);
        target.width = Math.ceil(view.width * density);
        target.height = Math.ceil(view.height * density);
        target.style.width = `${view.width}px`;
        target.style.height = `${view.height}px`;
        render = sheet.render({
          canvas: target,
          viewport: view,
          transform: [density, 0, 0, density, 0, 0],
        });
        await render.promise;
        const content = await sheet.getTextContent();
        if (active) {
          setPageText(
            content.items
              .map((item) =>
                "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
              )
              .join(""),
          );
          setPending(false);
        }
      })
      .catch((failure) => {
        if (active) {
          setError(
            t("pageFailed", {
              error:
                failure instanceof Error ? failure.message : String(failure),
            }),
          );
          setPending(false);
        }
      });
    return () => {
      active = false;
      render?.cancel();
    };
  }, [pdf, page, width, zoom]);
  return (
    <div
      className="sb-pdf-reader"
      data-surface-gesture="own"
      aria-busy={pending}
    >
      <div className="sb-pdf-toolbar" role="group" aria-label={t("controls")}>
        <div className="sb-pdf-pagination">
          <button
            type="button"
            className="sb-icon-button"
            aria-label={t("previousPage")}
            disabled={!pdf || page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <label className="sb-pdf-page">
            <input
              ref={pageInput}
              key={page}
              type="number"
              aria-label={t("pageNumber")}
              min={1}
              max={pdf?.numPages ?? 1}
              defaultValue={page}
              disabled={!pdf}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              onBlur={(event) => {
                const value = event.target.valueAsNumber;
                if (pdf && Number.isInteger(value))
                  setPage(Math.min(pdf.numPages, Math.max(1, value)));
                event.currentTarget.value = String(
                  Number.isInteger(value) && pdf
                    ? Math.min(pdf.numPages, Math.max(1, value))
                    : page,
                );
              }}
            />
            <span>/ {pdf?.numPages ?? "—"}</span>
          </label>
          <button
            type="button"
            className="sb-icon-button"
            aria-label={t("nextPage")}
            disabled={!pdf || page >= pdf.numPages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="sb-pdf-zoom">
          <button
            type="button"
            className="sb-icon-button"
            aria-label={t("zoomOut")}
            disabled={zoom <= 0.5}
            onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="sb-pdf-fit"
            title={t("fitWidth")}
            aria-label={t("fitWidthLabel")}
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="sb-icon-button"
            aria-label={t("zoomIn")}
            disabled={zoom >= 3}
            onClick={() => setZoom(Math.min(3, zoom + 0.25))}
          >
            <Plus size={14} />
          </button>
        </div>
        <a
          className="sb-icon-button"
          aria-label={t("download")}
          href={src}
          download={name || "document.pdf"}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Download size={15} />
        </a>
      </div>
      <div
        className="sb-pdf-viewport"
        ref={viewport}
        style={{ height }}
        tabIndex={0}
        aria-label={t("viewportLabel", { page })}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.target !== event.currentTarget || !pdf) return;
          if (event.key === "ArrowRight" && page < pdf.numPages) {
            event.preventDefault();
            setPage(page + 1);
          }
          if (event.key === "ArrowLeft" && page > 1) {
            event.preventDefault();
            setPage(page - 1);
          }
        }}
      >
        {pending && (
          <p className="sb-pdf-status" role="status">
            {t("loading")}
          </p>
        )}
        {error && (
          <p className="sb-pdf-status sb-error" role="alert">
            {error}{" "}
            <a
              href={src}
              download={name || "document.pdf"}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("openOriginal")}
            </a>
          </p>
        )}
        <canvas
          ref={canvas}
          aria-label={t("pageContent", { page })}
          style={{ visibility: pending || error ? "hidden" : "visible" }}
        />
      </div>
      {pageText && (
        <details className="sb-pdf-text">
          <summary>{t("pageText")}</summary>
          <p>{pageText}</p>
        </details>
      )}
    </div>
  );
}

export function PdfBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  const [editing, setEditing] = useState(false);
  const src = safeResourceUrl("pdf", data.src);
  const editable = Boolean(onChange && !readOnly);
  return (
    <section
      className="sb-block sb-pdf"
      aria-label={text(data.title) || t("document")}
    >
      <BlockHeader
        title={text(data.title)}
        defaultTitle={t("document")}
        editable={editable}
        editing={editing}
        onEdit={() => setEditing(!editing)}
      />
      {editing && (
        <ResourceEditor
          kind="pdf"
          data={data}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            onChange?.(next);
            setEditing(false);
          }}
        />
      )}
      {src ? (
        <PdfReader
          key={`${src}-${data.page}`}
          src={src}
          initialPage={Number(data.page ?? 1)}
          height={Number(data.height ?? 560)}
          name={text(data.fileName)}
        />
      ) : (
        <EmptyState
          icon={<FileText size={28} strokeWidth={1.4} />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            editable && !editing ? (
              <button
                type="button"
                className="sb-button"
                onClick={() => setEditing(true)}
              >
                {t("choose")}
              </button>
            ) : undefined
          }
        />
      )}
      {src && text(data.caption) && (
        <p className="sb-resource-caption">{text(data.caption)}</p>
      )}
    </section>
  );
}
