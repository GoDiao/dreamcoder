import { createTextModel } from "../../surface/text-selection-model";

/** Both sides use the same character offsets; sandbox DOM never leaves its frame. */
export function installComponentSelectionBridge(
  channel: string,
  buildModel: typeof createTextModel,
) {
  const name = "showai-frame-text-" + channel;
  const style = document.createElement("style");
  style.textContent = `::highlight(${name}){background:Highlight;color:HighlightText}`;
  document.head.append(style);
  const api = window as unknown as {
    Highlight?: new (...ranges: Range[]) => unknown;
    CSS: { highlights?: Map<string, unknown> };
  };
  let lastOffset = 0;
  const offsetAt = (x: number, y: number) => {
    const range = document.caretRangeFromPoint(x, y);
    if (!range) return null;
    return buildModel(document.body).offsetAt(
      range.startContainer,
      range.startOffset,
    );
  };
  const sendText = () =>
    parent.postMessage(
      {
        channel,
        type: "showai:text-selection-content",
        text: buildModel(document.body).text.slice(0, 256_000),
      },
      "*",
    );
  const send = (phase: string, x: number, y: number, buttons: number) => {
    const offset = offsetAt(x, y);
    if (offset !== null) lastOffset = offset;
    parent.postMessage(
      {
        channel,
        type: "showai:text-selection-pointer",
        phase,
        x,
        y,
        width: innerWidth,
        height: innerHeight,
        buttons,
        offset: lastOffset,
      },
      "*",
    );
  };
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.channel !== channel) return;
    if (event.data.type === "showai:text-selection-content-request") sendText();
    else if (event.data.type === "showai:text-selection-range") {
      const { from, to } = event.data;
      if (!Number.isFinite(from) || !Number.isFinite(to)) return;
      if (to > from) {
        const model = buildModel(document.body);
        if (api.Highlight && api.CSS.highlights)
          api.CSS.highlights.set(
            name,
            new api.Highlight(
              ...model.ranges(
                Math.max(0, from),
                Math.min(model.text.length, to),
              ),
            ),
          );
        document.getSelection()?.removeAllRanges();
      } else api.CSS.highlights?.delete(name);
    } else if (
      event.data.type === "showai:text-selection-hit" &&
      [event.data.x, event.data.y].every(Number.isFinite)
    )
      send("move", event.data.x, event.data.y, 1);
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.button !== 0 ||
        event.pointerType !== "mouse" ||
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        !(event.target instanceof Element) ||
        event.target.closest(
          'button,input,textarea,select,summary,[role="button"],[role="slider"],[data-surface-ui],.react-flow,[data-surface-gesture="own"]',
        )
      )
        return;
      // Content that opts out of selection, such as a pannable diagram viewport, keeps its drag.
      if (getComputedStyle(event.target).userSelect === "none") return;
      const range = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (
        range?.startContainer.nodeType !== Node.TEXT_NODE ||
        !event.target.contains(range.startContainer)
      )
        return;
      sendText();
      send("down", event.clientX, event.clientY, event.buttons);
    },
    true,
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "mouse" && event.buttons & 1)
        send("move", event.clientX, event.clientY, event.buttons);
    },
    true,
  );
  document.addEventListener(
    "pointerup",
    (event) => send("up", event.clientX, event.clientY, event.buttons),
    true,
  );
  document.addEventListener(
    "pointercancel",
    (event) => send("cancel", event.clientX, event.clientY, event.buttons),
    true,
  );
}
export function componentSelectionScript(channel: string) {
  return `(${installComponentSelectionBridge.toString()})(${JSON.stringify(channel)},${createTextModel.toString()});`;
}
