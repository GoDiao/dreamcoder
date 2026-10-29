import { useEffect, type RefObject } from "react";
import {
  receiveSelectionFrameText,
  registerSelectionFrame,
  relayComponentSelectionPointer,
} from "../../surface/text-selection";

/** Validate opaque iframe messages at their owning host before relaying them. */
export function useSelectionFrame(
  ref: RefObject<HTMLIFrameElement | null>,
  channel: string,
) {
  useEffect(() => {
    const frame = ref.current!;
    const unregister = registerSelectionFrame(frame, channel);
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.data?.channel !== channel
      )
        return;
      if (event.data.type === "showai:text-selection-pointer")
        relayComponentSelectionPointer(frame, event.data);
      if (event.data.type === "showai:text-selection-content")
        receiveSelectionFrameText(frame, event.data.text);
    };
    window.addEventListener("message", receive);
    return () => {
      unregister();
      window.removeEventListener("message", receive);
    };
  }, [channel, ref]);
}
