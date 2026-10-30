import {
  StrictMode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PageIcon from "../components/PageIcon";
import { installIconTooltips } from "../ui/icon-tooltip.mjs";
import { createRoot } from "react-dom/client";
import { Download, Moon, MoreHorizontal, Printer, Sun } from "../ui/icons";
import { parseArtifact, serializeArtifact } from "./validation.mjs";
import type { ShowArtifact, ShowDocument } from "../types";
import { loadRemoteComponents } from "./remote.mjs";
import type { CompiledComponent } from "../components/custom/types";
import { SurfaceReader } from "./SurfaceReader";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import {
  conversationPage,
  useConversationReference,
} from "./ConversationReference";
import {
  installReaderLinks,
  parseSiteRoutes,
  revealLinkedBlock,
} from "./reader-links";
import { resolveLocale, setLocale, translator } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/reader";
import common from "../i18n/messages/common";
import "./portable.css";
import "../design/tokens.css";
import "../design/content.css";

/** Where the reader finds its page and applies its theme. */
export interface ReaderHost {
  /** Set only by trusted inline hosts. Ordinary readers and the desktop app
   * keep individual sandboxed iframes for custom code. */
  inlineHost: HTMLElement | null;
  readArtifact: () => string | null | undefined;
  readOptions: () => string | null | undefined;
  /** Site exports list their pages so page links open the exported files. */
  readSite?: () => string | null | undefined;
  setTheme: (theme: "dark" | "light") => void;
}

const translate = translator(messages);

/**
 * Remote loader errors carry a code so the reader can explain them in its own
 * language. Readers see what they can do; the publisher-facing reason (CORS,
 * checksums) stays in the collapsed technical details.
 */
function remoteErrorMessage(error: unknown): { summary: string; detail: string } {
  const { code, params } = (error ?? {}) as {
    code?: string;
    params?: { component?: string; reason?: string };
  };
  const component = params?.component ?? "";
  if (code === "INTEGRITY_UNAVAILABLE")
    return {
      summary: translate("contentUnavailable"),
      detail: translate("integrityUnavailable"),
    };
  if (code === "COMPONENT_FETCH_FAILED")
    return {
      summary: translate("contentUnavailable"),
      detail: translate("componentFetchFailed", {
        component,
        reason: params?.reason || translate("networkFailed"),
      }),
    };
  if (code === "COMPONENT_CHECKSUM_FAILED")
    return {
      summary: translate("contentUnverified"),
      detail: translate("componentChecksumFailed", { component }),
    };
  return {
    summary: translate("contentUnavailable"),
    detail:
      error instanceof Error ? error.message : translate("remoteLoadFailed"),
  };
}

function downloadSource(
  document: ShowDocument,
  components: ShowArtifact["components"],
  remoteComponents: ShowArtifact["remoteComponents"],
  presentation: ShowArtifact["presentation"],
  selection: ShowArtifact["selection"],
) {
  const url = URL.createObjectURL(
    new Blob(
      [
        serializeArtifact(
          document,
          components,
          remoteComponents,
          presentation,
          selection,
        ),
      ],
      {
        type: "application/json",
      },
    ),
  );
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${document.title.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "page"}.showai.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ArtifactReader({
  artifact,
  host,
}: {
  artifact: ShowArtifact;
  host: ReaderHost;
}) {
  const { inlineHost } = host;
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const { document } = artifact;
  const draftPreview = useMemo(() => {
    const options = host.readOptions();
    return options ? JSON.parse(options).draft === true : false;
  }, [host]);
  const [dark, setDark] = useState(() => {
    const reading = host.readOptions();
    return reading
      ? JSON.parse(reading).theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  // Only a conversation host that accepts model context names the saved page.
  const conversation = useMemo(
    () => conversationPage(host.readOptions()),
    [host],
  );
  const references = useConversationReference(appRef, document, conversation);
  const site = useMemo(() => parseSiteRoutes(host.readSite?.()), [host]);
  useEffect(
    () =>
      installReaderLinks(
        appRef.current!,
        { pageId: document.id, projectId: conversation?.projectId },
        site,
      ),
    [document.id, conversation, site],
  );
  useEffect(() => revealLinkedBlock(appRef.current!), []);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [remote, setRemote] = useState<CompiledComponent[]>([]);
  const [remoteError, setRemoteError] = useState<{
    summary: string;
    detail?: string;
  } | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(
    !!artifact.remoteComponents?.length,
  );
  useEffect(() => {
    if (!artifact.remoteComponents?.length) return;
    if (inlineHost) {
      setRemoteError({ summary: t("remoteInlineBlocked") });
      setRemoteLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setRemoteLoading(true);
    void loadRemoteComponents(artifact.remoteComponents, {
      signal: controller.signal,
    })
      .then((components) => {
        if (active) {
          setRemote(components);
          setRemoteError(null);
        }
      })
      .catch((error) => {
        if (active) setRemoteError(remoteErrorMessage(error));
      })
      .finally(() => {
        if (active) setRemoteLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [artifact.remoteComponents]);
  useEffect(() => {
    host.setTheme(dark ? "dark" : "light");
  }, [dark, host]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.document.addEventListener("pointerdown", closeOnPointer);
    window.document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.document.removeEventListener("pointerdown", closeOnPointer);
      window.document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <div
      ref={appRef}
      className={`portable-app${artifact.selection ? " portable-partial" : ""}${artifact.selection?.chrome === "none" ? " portable-component" : ""}`}
    >
      {draftPreview && (
        <div className="portable-draft-note" role="status">
          {t("draftNote")}
        </div>
      )}
      <div
        className="portable-options"
        ref={menuRef}
        hidden={artifact.selection?.chrome === "none"}
      >
        <button
          ref={menuButtonRef}
          className="portable-options-trigger"
          aria-label={tc("pageOptions")}
          aria-expanded={menuOpen}
          aria-controls="page-options"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <MoreHorizontal size={19} />
        </button>
        {menuOpen && (
          <div className="portable-options-menu" id="page-options">
            <button
              onClick={() => {
                downloadSource(
                  document,
                  artifact.components,
                  artifact.remoteComponents,
                  artifact.presentation,
                  artifact.selection,
                );
                setMenuOpen(false);
              }}
            >
              <Download size={15} />{" "}
              {draftPreview
                ? t("downloadOriginalSource")
                : tc("downloadSource")}
            </button>
            <button
              onClick={() => {
                setDark(!dark);
                setMenuOpen(false);
              }}
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
              {dark ? tc("lightAppearance") : tc("darkAppearance")}
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                window.print();
              }}
            >
              <Printer size={15} /> {tc("print")}
            </button>
          </div>
        )}
      </div>
      {references.contextMenu}
      {references.status}
      <CustomComponentsProvider
        components={[...(artifact.components ?? []), ...remote]}
        inlineHost={inlineHost}
      >
        <SurfaceReader
          document={document}
          presentation={artifact.presentation}
          partial={!!artifact.selection}
          heading={
            <>
              {!inlineHost &&
                !artifact.selection &&
                (document.icon || document.title) && (
                  <div className="portable-page-heading">
                    {document.icon && (
                      <div className="portable-page-icon">
                        <PageIcon value={document.icon} size={48} />
                      </div>
                    )}
                    {document.title && (
                      <h1 className="portable-title">{document.title}</h1>
                    )}
                  </div>
                )}
              {!!artifact.remoteComponents?.length && (
                <p className="portable-network-note">
                  {remoteLoading ? t("remoteLoading") : t("remoteRequired")}
                </p>
              )}
              {remoteError && (
                <div role="alert" className="portable-network-error">
                  <p>{remoteError.summary}</p>
                  {remoteError.detail && (
                    <details>
                      <summary>{tc("details")}</summary>
                      <p>{remoteError.detail}</p>
                    </details>
                  )}
                </div>
              )}
            </>
          }
        />
      </CustomComponentsProvider>
    </div>
  );
}

function App({ host }: { host: ReaderHost }) {
  const t = useTranslator(messages);
  useLayoutEffect(() => installIconTooltips(window.document), []);
  const result = useMemo(() => {
    const raw = host.readArtifact();
    if (!raw || raw.trim() === "null") return { error: translate("emptyPage") };
    try {
      return { artifact: parseArtifact(raw) };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : translate("unreadablePage"),
      };
    }
  }, [host]);
  if (!result.artifact)
    return (
      <main className="portable-error">
        <h1>{t("openFailed")}</h1>
        <p>{result.error}</p>
      </main>
    );
  return <ArtifactReader artifact={result.artifact} host={host} />;
}

/** Mounts the reader into `target` and returns a function that unmounts it. */
export function mountReader(target: HTMLElement, host: ReaderHost) {
  // The exporter records its language on <html lang> (or the inline root);
  // older exports default to zh-CN.
  setLocale(
    resolveLocale(
      host.inlineHost?.lang ||
        window.document.documentElement.lang ||
        navigator.language,
    ),
  );
  const root = createRoot(target);
  root.render(
    <StrictMode>
      <App host={host} />
    </StrictMode>,
  );
  return () => root.unmount();
}
