import type { CompiledComponent } from "./types";
import { componentSandboxPolicy } from "./sandbox-policy.mjs";
import { injectComponentBootstrap } from "./contract";

/** Run the package's compiled validator under the same CSP as its normal runtime.
 * Browser settings must never compile JSON schemas with eval/new Function. */
export function validateInFrame(
  component: CompiledComponent,
  props: Record<string, unknown>,
): Promise<void> {
  const channel = crypto.randomUUID(),
    requestId = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.setAttribute("sandbox", "allow-scripts");
  const data = JSON.stringify({
    channel,
    props: component.defaultData,
    readOnly: true,
  }).replace(/</g, "\\u003c");
  frame.srcdoc =
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="${componentSandboxPolicy}">` +
    injectComponentBootstrap(
      component.html,
      `<script id="showai-component-data" type="application/json">${data}</script>`,
    );
  let cleanup = () => {};
  const result = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Component parameter validation timed out.")),
      5000,
    );
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.data?.channel !== channel
      )
        return;
      if (event.data.type === "showai:ready")
        frame.contentWindow?.postMessage(
          { channel, type: "showai:validate", requestId, props },
          "*",
        );
      if (
        event.data.type === "showai:validation" &&
        event.data.requestId === requestId
      ) {
        if (event.data.valid === true) resolve();
        else
          reject(
            new Error(
              String(event.data.message || "Invalid component parameters."),
            ),
          );
      }
    };
    cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      frame.remove();
    };
    window.addEventListener("message", receive);
    document.body.append(frame);
  });
  return result.finally(cleanup);
}
