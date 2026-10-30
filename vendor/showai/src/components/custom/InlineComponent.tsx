import { installIconTooltips } from "../../ui/icon-tooltip.mjs";
import * as ReactRuntime from "react";
import * as DomRuntime from "react-dom";
import * as ClientRuntime from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import * as JsxDevRuntime from "react/jsx-dev-runtime";
import { useEffect, useRef, useState } from "react";
import type { CompiledComponent } from "./types";
import type { PageOutlineComponentProps } from "../../surface/page-outline.mjs";
import { ComponentStatus } from "../blocks/ComponentStatus";
import { isValidationMessage, readableValidation } from "./validation-messages";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/customComponents";
import {
  componentContextIssue,
  type ComponentContextSnapshot,
} from "./component-context.mjs";
import {
  navigationTarget,
  requestNavigation,
} from "../../portable/page-link.mjs";

interface MountedComponent {
  update(
    data: Record<string, unknown>,
    outline?: PageOutlineComponentProps,
  ): void;
  destroy(): void;
}
interface InlineModule {
  mount(
    target: HTMLElement,
    options: {
      data: Record<string, unknown>;
      onError: (message: string) => void;
      onContext?: (snapshot: ComponentContextSnapshot) => boolean;
      context?: ComponentContextSnapshot;
      outline?: PageOutlineComponentProps;
      goTo: (target: unknown) => boolean;
    },
  ): MountedComponent;
}

/** The conversation reader listens for this; detail.result settles its delivery. */
export const conversationContextEvent = "showai:conversation-context";
// Handed-over states return to their block if the reader mounts it again.
const handedOver = new Map<string, ComponentContextSnapshot>();

/** Only the portable reader enables this inside an existing conversation sandbox.
 * Shadow DOM isolates styling; the host iframe is the JavaScript security boundary.
 */
export function InlineComponent({
  component,
  data,
  host,
  outline,
  onError,
}: {
  component: CompiledComponent;
  data: Record<string, unknown>;
  host: HTMLElement;
  outline?: PageOutlineComponentProps;
  onError?: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mounted = useRef<MountedComponent | null>(null);
  const currentData = useRef(data);
  const [error, setError] = useState("");
  const t = useTranslator(messages);
  currentData.current = data;
  const currentOutline = useRef(outline);
  currentOutline.current = outline;
  useEffect(() => onError?.(error), [error, onError]);
  useEffect(() => {
    if (
      !container.current ||
      !host.hasAttribute("data-showai-inline-root") ||
      !host.contains(container.current) ||
      window.showai
    ) {
      setError(t("inlineOnlyInConversation"));
      return;
    }
    if (!component.inline) {
      setError(
        t("inlineUnavailable", {
          component: `${component.id}@${component.version}`,
        }),
      );
      return;
    }
    const shadow =
      container.current.shadowRoot ??
      container.current.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent =
      ":host{display:block;font:14px/1.6 system-ui,sans-serif;color:inherit}*{box-sizing:border-box}button,input,select,textarea{font:inherit}.component-root{display:flow-root;overflow-wrap:anywhere}" +
      component.inline.styles.replace(
        /:root\b|(?<![\w-])(?:html|body)(?=\s*[{,])/g,
        ":host",
      );
    const root = document.createElement("div");
    root.className = "component-root";
    shadow.replaceChildren(style, root);
    const removeTooltips = installIconTooltips(shadow);
    const globals = globalThis as unknown as Record<string, unknown>;
    const previousHost = globals.__SHOWAI_COMPONENT_HOST__;
    const callbackKey = `__showai_mount_${crypto.randomUUID().replaceAll("-", "")}`;
    globals.__SHOWAI_COMPONENT_HOST__ = {
      react: ReactRuntime,
      client: ClientRuntime,
      dom: DomRuntime,
      jsx: JsxRuntime,
      jsxDev: JsxDevRuntime,
    };
    // Only a conversation host that accepts model context offers onContext.
    const owner = container.current.closest<HTMLElement>(
      "[data-block-id],[data-surface-id]",
    );
    const blockId = owner?.dataset.blockId ?? owner?.dataset.surfaceId;
    const conversation =
      !!blockId && !!host.closest("[data-showai-conversation]");
    const onContext = (snapshot: ComponentContextSnapshot) => {
      const issue = componentContextIssue(snapshot);
      if (issue) throw new Error(`onContext: ${issue}`);
      if (navigator.userActivation && !navigator.userActivation.isActive)
        return false;
      const copy = JSON.parse(JSON.stringify(snapshot));
      handedOver.set(blockId!, copy);
      container.current?.dispatchEvent(
        new CustomEvent(conversationContextEvent, {
          bubbles: true,
          composed: true,
          detail: {
            blockId,
            componentId: component.id,
            name: component.name,
            snapshot: copy,
          },
        }),
      );
      return true;
    };
    // The reader around the component follows page links and in-page targets.
    const goTo = (value: unknown) => {
      const target = navigationTarget(value);
      if (!target)
        throw new Error(
          'goTo needs a ShowAI page link, "#blockId" or {pageId, blockId, projectId}.',
        );
      if (navigator.userActivation && !navigator.userActivation.isActive)
        return false;
      return requestNavigation(container.current ?? host, target);
    };
    globals[callbackKey] = (module: InlineModule) => {
      mounted.current = module.mount(root, {
        data: currentData.current,
        outline: currentOutline.current,
        onError: setError,
        goTo,
        ...(conversation
          ? { onContext, context: handedOver.get(blockId!) }
          : {}),
      });
    };
    const script = document.createElement("script");
    // This is a normal inline script in the host's pre-existing sandbox. It never
    // enters the desktop document, and neither eval nor arbitrary HTML is used.
    script.textContent = `(()=>{${component.inline.script}\nglobalThis[${JSON.stringify(callbackKey)}](ShowAIInlineComponent);})();`;
    try {
      host.appendChild(script);
      if (!mounted.current) setError(t("inlineBlocked"));
    } finally {
      script.remove();
      delete globals[callbackKey];
      if (previousHost === undefined) delete globals.__SHOWAI_COMPONENT_HOST__;
      else globals.__SHOWAI_COMPONENT_HOST__ = previousHost;
    }
    return () => {
      removeTooltips();
      const instance = mounted.current;
      mounted.current = null;
      queueMicrotask(() => instance?.destroy());
    };
  }, [component.integrity, host]);
  useEffect(() => mounted.current?.update(data, outline), [data, outline]);
  return (
    <section aria-label={component.name} style={{ margin: "18px 0" }}>
      <div ref={container} />
      {error && (
        <ComponentStatus
          state={isValidationMessage(error) ? "invalid" : "crashed"}
          name={component.name}
          reference={`${component.id}@${component.version}`}
          error={error}
          issues={
            isValidationMessage(error)
              ? readableValidation(error)
              : []
          }
          readOnly
        />
      )}
    </section>
  );
}
