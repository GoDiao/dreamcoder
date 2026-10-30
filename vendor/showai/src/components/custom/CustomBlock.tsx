import { componentSelectionScript } from "./selection-bridge";
import { useSelectionFrame } from "./useSelectionFrame";
import { CAPACITY, assertContent } from "../../portable/capacity.mjs";
import { installIconTooltips } from "../../ui/icon-tooltip.mjs";
import { componentSandboxPolicy } from "./sandbox-policy.mjs";
import { useAppearanceTheme } from "../../design/useAppearanceTheme";
import {
  appearanceTokens,
  installSandboxTheme,
} from "../../design/sandbox-theme";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Settings2, Sparkles } from "../../ui/icons";
import type { BlockProps } from "../blocks/types";
import {
  viewportLockKey,
  readViewportLock,
  writeViewportLock,
} from "../blocks/ViewportLock";
import { injectComponentBootstrap, readCustomBlockData } from "./contract";
import type { CompiledComponent } from "./types";
import { InlineComponent } from "./InlineComponent";
import { findComponent, indexComponents } from "./component-index";
import { installComponentLinks, openComponentLink } from "./external-links";
import { openComponentMedia } from "./LocalMediaViewer";
import { installComponentActivity } from "./activity";
import { useLocale, useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/customComponents";
import common from "../../i18n/messages/common";
import { AssistantContext } from "../assistant-context";
import {
  componentContextIssue,
  componentViewStateIssue,
} from "./component-context.mjs";
import { useReaderStateScope } from "../../surface/reader-state";
import {
  navigationTarget,
  parsePageLink,
  requestNavigation,
} from "../../portable/page-link.mjs";
import { BindingBasisContext } from "../../datasets/basis";
import { ComponentStatus } from "../blocks/ComponentStatus";
import widgetMessages from "../../i18n/messages/widget";
import { PendingNotice } from "../../ui/PendingNotice";
import {
  installFrameErrorReporter,
  readFrameRuntimeError,
  repeatsRuntimeError,
  type FrameRuntimeError,
} from "./frame-errors";
import { readableValidation } from "./validation-messages";
import "./custom.css";

const ComponentsContext = createContext<ReadonlyMap<string, CompiledComponent>>(
  new Map(),
);
const InlineHostContext = createContext<HTMLElement | null>(null);
export const useInlineComponentHost = () => useContext(InlineHostContext);

export function CustomComponentsProvider({
  components,
  children,
  inlineHost = null,
}: {
  components: CompiledComponent[];
  children: ReactNode;
  inlineHost?: HTMLElement | null;
}) {
  const value = useMemo(() => indexComponents(components), [components]);
  return (
    <ComponentsContext.Provider value={value}>
      <InlineHostContext.Provider value={inlineHost}>
        {children}
      </InlineHostContext.Provider>
    </ComponentsContext.Provider>
  );
}

export function useAvailableComponents() {
  const components = useContext(ComponentsContext);
  return useMemo(() => [...components.values()], [components]);
}

export function AdditionalComponentsProvider({
  components,
  children,
}: {
  components: CompiledComponent[];
  children: ReactNode;
}) {
  const current = useContext(ComponentsContext),
    inlineHost = useContext(InlineHostContext);
  const merged = useMemo(
    () => [...current.values(), ...components],
    [current, components],
  );
  return (
    <CustomComponentsProvider components={merged} inlineHost={inlineHost}>
      {children}
    </CustomComponentsProvider>
  );
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function jsonObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const visit = (entry: unknown, depth = 0): boolean => {
    if (depth > 40) return false;
    if (
      entry === null ||
      typeof entry === "boolean" ||
      typeof entry === "string"
    )
      return true;
    if (typeof entry === "number") return Number.isFinite(entry);
    if (Array.isArray(entry))
      return entry.every((item) => visit(item, depth + 1));
    return (
      !!entry &&
      typeof entry === "object" &&
      Object.getPrototypeOf(entry) === Object.prototype &&
      Object.entries(entry).every(
        ([key, item]) =>
          !["__proto__", "constructor", "prototype"].includes(key) &&
          visit(item, depth + 1),
      )
    );
  };
  return visit(value);
}

export function CustomBlock({ data, onChange, readOnly }: BlockProps) {
  const parsed = readCustomBlockData(data);
  const components = useContext(ComponentsContext);
  const inlineHost = useContext(InlineHostContext);
  const component = findComponent(components, parsed);
  const assistant = useContext(AssistantContext);
  const reference = `${parsed.componentId}@${parsed.version}`;
  return component && inlineHost ? (
    <InlineComponent
      key={component.integrity}
      component={component}
      data={parsed.props}
      host={inlineHost}
    />
  ) : component ? (
    <SandboxComponent
      key={component.integrity}
      component={component}
      data={data}
      onChange={onChange}
      readOnly={readOnly}
    />
  ) : (
    <ComponentStatus
      state="missing"
      name={parsed.componentId}
      reference={reference}
      query={parsed.componentId}
      integrity={parsed.integrity}
      data={parsed.props}
      readOnly={!!readOnly || !onChange}
      assistant={readOnly || !onChange ? null : assistant}
    />
  );
}

function SandboxComponent({
  component,
  data,
  onChange,
  readOnly,
}: BlockProps & { component: CompiledComponent }) {
  const parsed = readCustomBlockData(data);
  const iframe = useRef<HTMLIFrameElement>(null);
  const theme = useAppearanceTheme();
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const tw = useTranslator(widgetMessages);
  const locale = useLocale();
  const initialTheme = useRef(theme);
  const [channel] = useState(() => crypto.randomUUID());
  useSelectionFrame(iframe, channel);
  const [height, setHeight] = useState(180);
  // The last height the frame measured; an empty root reports about 2px.
  const [measured, setMeasured] = useState<number | null>(null);
  // Parameter validation text from the runtime (参数不符), cleared once props apply.
  const [error, setError] = useState("");
  // A render, handler or promise failure inside the frame (运行出错).
  const [crash, setCrash] = useState<FrameRuntimeError | null>(null);
  const crashRef = useRef<FrameRuntimeError | null>(null);
  crashRef.current = crash;
  // Retrying mounts a fresh frame; the old React root does not recover.
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [validating, setValidating] = useState(false);
  // Raw JSON is the advanced path; without an agent it is the only one, so it starts open.
  const [jsonOpen, setJsonOpen] = useState(false);
  const draftBase = useRef("");
  const settingsButton = useRef<HTMLButtonElement>(null);
  const pendingValidation = useRef<{
    id: string;
    props: Record<string, unknown>;
    timeout: number;
  } | null>(null);
  // Present in the workbench page; readers and exports have no conversation.
  const assistant = useContext(AssistantContext);
  const latest = useRef({ data, parsed, onChange, readOnly, assistant });
  const initial = useRef({
    props: parsed.props,
    readOnly: !!readOnly || !onChange,
  });
  // A page block in the App keeps the reader's view of it on this device.
  const readerScope = useReaderStateScope();
  const readerView = useRef({
    scope: readerScope,
    slot: `component:${parsed.componentId}`,
  });
  readerView.current = {
    scope: readerScope,
    slot: `component:${parsed.componentId}`,
  };
  latest.current = { data, parsed, onChange, readOnly, assistant };
  // A bound block asks which props each change started from. The frame posts
  // showai:valid after applying each props message, in order.
  const basisContext = useContext(BindingBasisContext);
  const basisReporter = useRef(basisContext);
  basisReporter.current = basisContext;
  const reportBasis = (props: Record<string, unknown>) =>
    basisReporter.current?.(props);
  const frameProps = useRef(initial.current.props);
  const unconfirmed = useRef<Record<string, unknown>[]>([]);
  /** The page block this instance renders, for state handed to the conversation. */
  const blockId = () => {
    const owner = iframe.current?.closest<HTMLElement>(
      "[data-block-id],[data-surface-id]",
    );
    return owner?.dataset.blockId ?? owner?.dataset.surfaceId;
  };
  const editable = !!onChange && !readOnly;
  const cancelValidation = () => {
    if (pendingValidation.current)
      window.clearTimeout(pendingValidation.current.timeout);
    pendingValidation.current = null;
    setValidating(false);
  };
  const closeEditor = () => {
    cancelValidation();
    setEditing(false);
    requestAnimationFrame(() => settingsButton.current?.focus());
  };
  const openEditor = () => {
    setJsonOpen(!latest.current.assistant);
    draftBase.current = JSON.stringify(latest.current.parsed.props);
    setDraft(JSON.stringify(latest.current.parsed.props, null, 2));
    setDraftError("");
    setEditing(true);
  };
  const saveDraft = () => {
    let next: unknown;
    try {
      next = JSON.parse(draft);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : t("invalidJson"));
      return;
    }
    if (!jsonObject(next)) {
      setDraftError(t("notJsonObject"));
      return;
    }
    try {
      assertContent(
        next,
        "Component instance data",
        CAPACITY.componentPropsBytes,
      );
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : t("dataTooLarge"));
      return;
    }
    if (JSON.stringify(latest.current.parsed.props) !== draftBase.current) {
      setDraftError(t("dataChanged"));
      return;
    }
    cancelValidation();
    setDraftError("");
    const id = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      pendingValidation.current = null;
      setValidating(false);
      setDraftError(t("validationTimeout"));
    }, 5000);
    pendingValidation.current = { id, props: next, timeout };
    setValidating(true);
    iframe.current?.contentWindow?.postMessage(
      { channel, type: "showai:validate", requestId: id, props: next },
      "*",
    );
  };
  const html = useMemo(() => {
    // A portable package is executable user content. Enforce the policy before
    // parsing any of its markup, even if its own document omits or changes CSP.
    const policy = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${componentSandboxPolicy}">`;
    return (
      policy +
      injectComponentBootstrap(
        component.html,
        // Built-in blocks compiled into the package start in the workbench language.
        `<style>body{color:var(--text)}</style><script>(${installFrameErrorReporter.toString()})(${safeJson(channel)});</script><script>document.documentElement.lang=document.documentElement.dataset.showaiLocale=${safeJson(locale)};(${installComponentActivity.toString()})(${safeJson(channel)});(${installSandboxTheme.toString()})(${safeJson(channel)},${safeJson(initialTheme.current)},${safeJson(appearanceTokens())});</script><script id="showai-component-data" type="application/json">${safeJson({ channel, ...initial.current, ...savedView() })}</script>`,
      ) +
      `<script>${componentSelectionScript(channel)}(${installIconTooltips.toString()})(document);(${installComponentLinks.toString()})(${safeJson(channel)});</script>` +
      // A changed document reloads the same frame element after 重试.
      (attempt ? `<!--retry ${attempt}-->` : "")
    );
  }, [component.html, channel, locale, attempt]);

  /** Read when the frame is built, so 重试 starts from the latest view. */
  function savedView() {
    const { scope, slot } = readerView.current;
    if (!scope?.block) return {};
    const value = scope.store.read(scope.page, scope.block, slot);
    return {
      view: true,
      viewState: componentViewStateIssue(value) ? undefined : value,
    };
  }
  const sendProps = () => {
    const current = latest.current;
    unconfirmed.current.push(current.parsed.props);
    if (unconfirmed.current.length > 64) unconfirmed.current.shift();
    iframe.current?.contentWindow?.postMessage(
      {
        channel,
        type: "showai:props",
        props: current.parsed.props,
        readOnly: !!current.readOnly || !current.onChange,
        // Previews and dialogs are not page blocks, so they cannot hand over state.
        context: !!current.assistant && !!blockId(),
      },
      "*",
    );
  };
  useEffect(() => {
    const frame = iframe.current;
    const activate = () =>
      frame?.contentWindow?.postMessage(
        { channel, type: "showai:activity", active: true },
        "*",
      );
    activate();
    frame?.addEventListener("load", activate);
    return () => {
      frame?.removeEventListener("load", activate);
      frame?.contentWindow?.postMessage(
        { channel, type: "showai:activity", active: false },
        "*",
      );
    };
  }, [channel]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        !event.data ||
        event.data.channel !== channel
      )
        return;
      if (event.data.type === "showai:ready") {
        frameProps.current = initial.current.props;
        unconfirmed.current = [];
        sendProps();
        // State still waiting in the conversation input returns to its component.
        const id = blockId();
        const pending = id
          ? latest.current.assistant?.pendingComponentContext(id)
          : undefined;
        if (pending)
          iframe.current?.contentWindow?.postMessage(
            { channel, type: "showai:context-restore", snapshot: pending },
            "*",
          );
      }
      if (event.data.type === "showai:view-state") {
        const { scope, slot } = readerView.current;
        const value = event.data.clear === true ? undefined : event.data.state;
        // The runtime checks this too; the host never trusts the frame.
        if (!scope?.block || componentViewStateIssue(value)) return;
        scope.store.write(scope.page, scope.block, slot, value);
        return;
      }
      if (event.data.type === "showai:context") {
        const snapshot = event.data.snapshot;
        const id = blockId();
        // The runtime checks this too; the host never trusts the frame.
        if (!id || componentContextIssue(snapshot)) return;
        latest.current.assistant?.componentContext({
          ...snapshot,
          blockId: id,
          componentId: latest.current.parsed.componentId,
          name: component.name,
        });
        return;
      }
      if (
        event.data.type === "showai:navigate" ||
        (event.data.type === "showai:open-url" && parsePageLink(event.data.url))
      ) {
        const target = navigationTarget(
          event.data.type === "showai:navigate"
            ? event.data.target
            : event.data.url,
        );
        if (!target) {
          console.warn(
            `${component.name}: goTo needs a ShowAI page link, "#blockId" or {pageId, blockId, projectId}.`,
          );
          return;
        }
        if (navigator.userActivation && !navigator.userActivation.isActive)
          return;
        requestNavigation(iframe.current!, target);
        return;
      }
      if (event.data.type === "showai:open-url") {
        // The page around the block may open its own links in place, such as the built-in docs.
        const link = new CustomEvent("showai:component-link", {
          bubbles: true,
          cancelable: true,
          detail: { url: event.data.url },
        });
        if (iframe.current?.dispatchEvent(link) !== false)
          openComponentLink(event.data.url);
        return;
      }
      if (event.data.type === "showai:open-media") {
        openComponentMedia(event.data.url);
        return;
      }
      if (
        event.data.type === "showai:height" &&
        typeof event.data.height === "number" &&
        Number.isFinite(event.data.height)
      ) {
        setHeight(Math.min(4000, Math.max(48, Math.ceil(event.data.height))));
        setMeasured(event.data.height);
      }
      const runtime = readFrameRuntimeError(
        event,
        iframe.current?.contentWindow,
        channel,
      );
      if (runtime) {
        // Keep the first failure: later ones usually follow from it.
        setCrash((current) => current ?? runtime);
        setError((current) =>
          repeatsRuntimeError(current, runtime) ? "" : current,
        );
        return;
      }
      if (
        event.data.type === "showai:error" &&
        !repeatsRuntimeError(String(event.data.message), crashRef.current)
      )
        setError(
          String(event.data.message || t("cannotDisplay")).slice(0, 2000),
        );
      if (event.data.type === "showai:valid") {
        setError("");
        frameProps.current = unconfirmed.current.shift() ?? frameProps.current;
      }
      if (
        ["showai:viewport-lock-get", "showai:viewport-lock-set"].includes(
          event.data.type,
        ) &&
        typeof event.data.scope === "string" &&
        /^[a-z0-9-]+:\d{1,4}$/.test(event.data.scope)
      ) {
        const scope = event.data.scope;
        const key = viewportLockKey(iframe.current!, scope);
        let locked = true,
          error = "";
        try {
          if (
            event.data.type === "showai:viewport-lock-set" &&
            typeof event.data.locked === "boolean"
          )
            writeViewportLock(key, event.data.locked);
          locked = readViewportLock(key);
        } catch (caught) {
          error = t("viewportLockFailed", { error: String(caught) });
        }
        iframe.current?.contentWindow?.postMessage(
          { channel, type: "showai:viewport-lock-state", scope, locked, error },
          "*",
        );
      }
      if (
        event.data.type === "showai:reading-wheel" &&
        [event.data.deltaX, event.data.deltaY, event.data.deltaMode].every(
          Number.isFinite,
        )
      ) {
        const frame = iframe.current!;
        const wheel = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: event.data.deltaX,
          deltaY: event.data.deltaY,
          deltaMode: event.data.deltaMode,
          ctrlKey: event.data.ctrlKey === true,
          metaKey: event.data.metaKey === true,
          shiftKey: event.data.shiftKey === true,
        });
        if (frame.dispatchEvent(wheel) && !wheel.ctrlKey && !wheel.metaKey) {
          let remaining =
            wheel.deltaY *
            (wheel.deltaMode === 1
              ? 16
              : wheel.deltaMode === 2
                ? frame.clientHeight
                : 1);
          for (
            let element = frame.parentElement;
            element && remaining;
            element = element.parentElement
          ) {
            if (!/auto|scroll/.test(getComputedStyle(element).overflowY))
              continue;
            const before = element.scrollTop;
            element.scrollTop += remaining;
            remaining -= element.scrollTop - before;
          }
        }
      }
      const current = latest.current;
      const pending = pendingValidation.current;
      if (
        event.data.type === "showai:validation" &&
        pending &&
        pending.id === event.data.requestId
      ) {
        cancelValidation();
        if (event.data.valid !== true) {
          const message = String(event.data.message || "");
          setDraftError(
            message
              ? readableValidation(message).join("\n")
              : t("invalidProps"),
          );
        } else if (JSON.stringify(current.parsed.props) !== draftBase.current) {
          setDraftError(t("dataChanged"));
        } else if (!current.readOnly && current.onChange) {
          reportBasis(current.parsed.props);
          current.onChange({ ...current.data, props: pending.props });
          closeEditor();
        }
      }
      if (
        event.data.type === "showai:change" &&
        !current.readOnly &&
        current.onChange &&
        jsonObject(event.data.props)
      ) {
        try {
          assertContent(
            event.data.props,
            "Component instance data",
            CAPACITY.componentPropsBytes,
          );
        } catch (error) {
          setDraftError(
            error instanceof Error ? error.message : t("dataTooLarge"),
          );
          return;
        }
        reportBasis(frameProps.current);
        frameProps.current = event.data.props;
        current.onChange({ ...current.data, props: event.data.props });
      }
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      if (pendingValidation.current)
        window.clearTimeout(pendingValidation.current.timeout);
    };
  }, [channel]);
  const retry = () => {
    setCrash(null);
    setError("");
    setMeasured(null);
    setAttempt((value) => value + 1);
  };
  // New data after a crash gets a fresh frame, like a built-in block's boundary.
  const crashedProps = useRef<unknown>(null);
  useEffect(() => {
    if (!crash) {
      crashedProps.current = null;
      return;
    }
    if (crashedProps.current === null) crashedProps.current = parsed.props;
    else if (crashedProps.current !== parsed.props) retry();
  }, [crash, parsed.props]);
  // Callback identity is host plumbing; only data and edit permission cross the sandbox.
  useEffect(sendProps, [
    parsed.props,
    readOnly,
    editable,
    channel,
    !!assistant,
  ]);
  useEffect(() => {
    const sendTheme = () =>
      iframe.current?.contentWindow?.postMessage(
        { channel, type: "showai:theme", theme, tokens: appearanceTokens() },
        "*",
      );
    const frame = iframe.current;
    frame?.addEventListener("load", sendTheme);
    sendTheme();
    return () => frame?.removeEventListener("load", sendTheme);
  }, [theme, channel]);

  // No height since the (re)load counts as empty: a failed first render may never resize.
  const blank = !!(crash || error) && (measured === null || measured <= 4);
  // The frame reports its first height once the component has rendered.
  const starting = measured === null && !crash && !error;
  return (
    <section
      className="showai-custom-block"
      aria-label={component.name}
      style={{ margin: "18px 0" }}
    >
      {editable && !editing && (
        <button
          ref={settingsButton}
          type="button"
          className="custom-props-trigger"
          aria-label={t("editData")}
          title={t("editData")}
          onClick={openEditor}
        >
          <Settings2 size={15} />
        </button>
      )}
      {editable && editing && (
        <div
          className="custom-props-editor"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closeEditor();
            }
          }}
        >
          <p className="custom-props-note">{t("noManualEditing")}</p>
          {assistant && (
            <button
              type="button"
              className="custom-props-agent"
              onClick={(event) => {
                const id = blockId();
                if (!id) return;
                const rect = event.currentTarget.getBoundingClientRect();
                closeEditor();
                assistant.open({
                  kind: "blocks",
                  blockIds: [id],
                  anchor: {
                    left: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                  },
                });
              }}
            >
              <Sparkles size={14} aria-hidden="true" />
              {t("askAgentToEdit")}
            </button>
          )}
          <details
            className="custom-props-advanced"
            open={jsonOpen}
            onToggle={(event) => setJsonOpen(event.currentTarget.open)}
          >
          <summary>{t("advancedJson")}</summary>
          <label htmlFor={`${channel}-props`}>{t("data")}</label>
          <textarea
            id={`${channel}-props`}
            aria-label={t("propsJson")}
            value={draft}
            spellCheck={false}
            rows={Math.max(5, Math.min(14, draft.split("\n").length))}
            autoFocus
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftError("");
            }}
            disabled={validating}
          />
          {draftError && (
            <p role="alert" className="custom-props-error">
              {draftError}
            </p>
          )}
          </details>
          <div className="custom-props-actions">
            <button type="button" onClick={closeEditor}>
              {tc("cancel")}
            </button>
            {jsonOpen && (
              <button
                type="button"
                className="is-primary"
                disabled={validating}
                onClick={saveDraft}
              >
                {validating ? t("validating") : t("apply")}
              </button>
            )}
          </div>
        </div>
      )}
      {!editing && draftError && (
        <p role="alert" className="custom-props-error">
          {draftError}
        </p>
      )}
      {(crash || error) && (
        <ComponentStatus
          state={crash ? "crashed" : "invalid"}
          name={component.name}
          reference={`${component.id}@${component.version}`}
          error={crash?.message ?? error}
          stack={crash?.stack}
          cause={
            crash?.kind === "rejection" ? tw("status.rejectionCause") : undefined
          }
          issues={crash ? [] : readableValidation(error)}
          data={parsed.props}
          readOnly={!editable}
          assistant={editable ? assistant : null}
          onRetry={retry}
          attached={!blank}
        />
      )}
      <PendingNotice
        active={starting}
        overlay
        label={tw("loading")}
        minHeight={height}
      />
      <iframe
        ref={iframe}
        title={component.name}
        srcDoc={html}
        sandbox="allow-scripts allow-forms allow-downloads"
        referrerPolicy="no-referrer"
        onLoad={sendProps}
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
        style={{
          width: "100%",
          height,
          border: 0,
          // An empty frame after a failure would only leave a blank area.
          display: blank ? "none" : "block",
          background: "transparent",
        }}
      />
    </section>
  );
}
