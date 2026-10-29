import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { injectComponentBootstrap } from "../components/custom/contract";
import { InlineComponent } from "../components/custom/InlineComponent";
import { useInlineComponentHost } from "../components/custom/CustomBlock";
import { componentSandboxPolicy } from "../components/custom/sandbox-policy.mjs";
import type { CompiledComponent } from "../components/custom/types";
import { appearanceTokens, installSandboxTheme } from "../design/sandbox-theme";
import type { PageOutlineComponentProps } from "./page-outline.mjs";

const json = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
/** Same compiler and sandbox as content packages, with a dedicated, read-only host bridge. */
export function OutlineRenderer({
  component,
  contract,
  onError,
}: {
  component: CompiledComponent;
  contract: PageOutlineComponentProps;
  onError: (message: string) => void;
}) {
  const inlineHost = useInlineComponentHost();
  return (
    <OutlineBoundary onError={onError}>
      {inlineHost ? (
        <InlineComponent
          component={component}
          data={contract.props}
          outline={contract}
          host={inlineHost}
          onError={onError}
        />
      ) : (
        <OutlineFrame
          component={component}
          contract={contract}
          onError={onError}
        />
      )}
    </OutlineBoundary>
  );
}
class OutlineBoundary extends Component<
  { onError: (message: string) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(
      String(error?.message ?? error ?? "Outline renderer failed.").slice(
        0,
        500,
      ),
    );
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
function OutlineFrame({
  component,
  contract,
  onError,
}: {
  component: CompiledComponent;
  contract: PageOutlineComponentProps;
  onError: (message: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const current = useRef({ contract, onError });
  current.current = { contract, onError };
  const html = useMemo(
    () =>
      `<!doctype html><meta http-equiv="Content-Security-Policy" content="${componentSandboxPolicy}">` +
      injectComponentBootstrap(
        component.html,
        `<script>(${installSandboxTheme.toString()})(${json(channel)},${json(contract.outline.theme)},${json(appearanceTokens())});window.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();parent.postMessage({channel:${json(channel)},type:'showai:outline-action',action:'collapse'},'*');}},true);</script><script id="showai-component-data" type="application/json">${json({ channel, props: contract.props, readOnly: true, outline: contract.outline })}</script>`,
      ),
    [component.html, channel],
  );
  const send = () => {
    const value = current.current.contract;
    frame.current?.contentWindow?.postMessage(
      { channel, type: "showai:props", props: value.props, readOnly: true },
      "*",
    );
    frame.current?.contentWindow?.postMessage(
      { channel, type: "showai:outline", outline: value.outline },
      "*",
    );
    frame.current?.contentWindow?.postMessage(
      {
        channel,
        type: "showai:theme",
        theme: value.outline.theme,
        tokens: appearanceTokens(),
      },
      "*",
    );
  };
  useEffect(() => {
    const timer = window.setTimeout(
      () => current.current.onError("Outline component did not become ready."),
      8000,
    );
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== channel
      )
        return;
      const data = event.data,
        value = current.current.contract;
      if (data.type === "showai:ready") {
        clearTimeout(timer);
        send();
      }
      if (data.type === "showai:error")
        current.current.onError(String(data.message).slice(0, 500));
      if (data.type !== "showai:outline-action") return;
      if (data.action === "collapse") value.collapse();
      if (data.action === "navigate" && typeof data.itemId === "string")
        value.navigate(data.itemId);
      if (
        data.action === "branch" &&
        typeof data.itemId === "string" &&
        typeof data.expanded === "boolean"
      )
        value.setBranchExpanded(data.itemId, data.expanded);
    };
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
  }, [channel]);
  useEffect(send, [contract, channel]);
  return (
    <iframe
      ref={frame}
      className="page-outline-frame"
      title={component.name}
      sandbox="allow-scripts"
      srcDoc={html}
      onLoad={send}
    />
  );
}
