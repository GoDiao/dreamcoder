import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Copy, FolderOpen, X } from "../../ui/icons";
import { translator } from "../../i18n";
import messages from "../../i18n/messages/customComponents";
import { isLocalFileLink, localMediaUrl } from "./local-media-link";
import "./custom.css";

interface Grant {
  token: string;
  path: string;
  name: string;
  kind?: "video" | "audio" | "image";
  size: number;
}

type State =
  | { status: "loading" }
  | { status: "ready"; grant: Grant }
  | { status: "error"; message: string };

let open: (() => void) | null = null;

/**
 * Open a local file a component linked to in the workbench player.
 * The component never receives the file: the trusted frame asks its host for a
 * short-lived grant and plays it from the host's media route.
 */
export function openComponentMedia(value: unknown): boolean {
  if (!isLocalFileLink(value) || navigator.userActivation?.isActive !== true)
    return false;
  open?.();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = () => {
    if (open !== close) return;
    open = null;
    root.unmount();
    host.remove();
  };
  open = close;
  root.render(<LocalMediaViewer link={value} onClose={close} />);
  return true;
}

function LocalMediaViewer({ link, onClose }: { link: string; onClose: () => void }) {
  const t = translator(messages);
  const [state, setState] = useState<State>({ status: "loading" });
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [playError, setPlayError] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const bridge = window.showai;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    if (!bridge) setState({ status: "error", message: t("media.unavailable") });
    else
      bridge
        .invoke<Grant>("media:open", { path: link })
        .then((grant) => setState({ status: "ready", grant }))
        .catch((error: unknown) =>
          setState({
            status: "error",
            message:
              (error as { code?: unknown } | null)?.code === "NOT_FOUND"
                ? t("media.notFound")
                : t("media.failed", { error: errorText(error) }),
          }),
        );
    return () => previous?.focus({ preventScroll: true });
  }, []);
  const grant = state.status === "ready" ? state.grant : undefined;
  const path = grant?.path ?? decodeLink(link);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      await bridge?.invoke("clipboard:write", { text: path });
    }
    setCopied(true);
  };
  const src = grant?.kind ? localMediaUrl(grant.token) : undefined;
  return (
    <div
      className="showai-local-media"
      role="dialog"
      aria-modal="true"
      aria-label={grant?.name ?? t("media.title")}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
        if (event.key === "Tab") {
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>("button,video,audio"),
          );
          const first = items[0],
            last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <button
        ref={closeButton}
        type="button"
        className="showai-local-media-close"
        aria-label={t("media.close")}
        onClick={onClose}
      >
        <X size={24} />
      </button>
      <figure>
        {state.status === "loading" && <p className="showai-local-media-note">{t("media.loading")}</p>}
        {state.status === "error" && <p className="showai-local-media-note" role="alert">{state.message}</p>}
        {grant && !grant.kind && <p className="showai-local-media-note">{t("media.unsupported")}</p>}
        {src && playError && <p className="showai-local-media-note" role="alert">{t("media.playFailed")}</p>}
        {src && grant?.kind === "video" && !playError && (
          <video src={src} controls autoPlay playsInline onError={() => setPlayError(true)} />
        )}
        {src && grant?.kind === "audio" && !playError && (
          <audio src={src} controls autoPlay onError={() => setPlayError(true)} />
        )}
        {src && grant?.kind === "image" && !playError && (
          <img src={src} alt={grant.name} onError={() => setPlayError(true)} />
        )}
        <figcaption>
          {grant?.name ?? path.split("/").at(-1)}
          <span className="showai-local-media-path">{path}</span>
          <span className="showai-local-media-actions">
            <button type="button" onClick={() => void copy()}>
              <Copy size={13} />
              {copied ? t("media.copied") : t("media.copyPath")}
            </button>
            {grant && bridge && (
              <button
                type="button"
                onClick={() =>
                  void bridge
                    .invoke("media:reveal", { token: grant.token })
                    .catch((error: unknown) =>
                      setNotice(t("media.failed", { error: errorText(error) })),
                    )
                }
              >
                <FolderOpen size={13} />
                {t("media.reveal")}
              </button>
            )}
          </span>
          {notice && <span role="alert">{notice}</span>}
        </figcaption>
      </figure>
    </div>
  );
}

function decodeLink(link: string): string {
  const path = link.replace(/^file:(\/\/(localhost)?)?/i, "");
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Host errors arrive as Error instances or as plain `{code, message}` objects. */
function errorText(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
}
