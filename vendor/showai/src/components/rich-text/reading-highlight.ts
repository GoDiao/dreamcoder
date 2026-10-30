import Highlight from "@tiptap/extension-highlight";
import type { Attributes } from "@tiptap/core";

/** Store the colour and coverage mode without an inline full-height background. */
export const ReadingHighlight = Highlight.extend({
  addAttributes() {
    const attributes: Attributes = {
      ...this.parent?.(),
      mode: {
        default: "lower",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-highlight-mode") === "full"
            ? "full"
            : "lower",
        renderHTML: ({ mode }: Record<string, unknown>) => ({
          "data-highlight-mode": mode === "full" ? "full" : "lower",
        }),
      },
    };
    if (!this.options.multicolor) return attributes;
    return {
      ...attributes,
      color: {
        ...attributes.color,
        renderHTML: ({ color }) =>
          color
            ? {
                "data-color": color,
                style: `--showai-highlight-color: ${color}`,
              }
            : {},
      },
    };
  },
});
