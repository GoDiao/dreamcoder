import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

export const DropCursorCleanup = Extension.create({
  name: "dropCursorCleanup",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view(view) {
          const document = view.dom.ownerDocument;
          const window = document.defaultView;
          const clear = () => {
            // The stock drop cursor only listens inside the editor. Block handles
            // live outside it, and our drop capture handler stops propagation.
            // Use its dragleave lifecycle to clear both the overlay and position
            // before a drop transaction can redraw the old indicator.
            const event = document.createEvent("Event");
            event.initEvent("dragleave", false, false);
            view.dom.dispatchEvent(event);
          };
          document.addEventListener("drop", clear, true);
          document.addEventListener("dragend", clear, true);
          window?.addEventListener("blur", clear);
          return {
            destroy() {
              document.removeEventListener("drop", clear, true);
              document.removeEventListener("dragend", clear, true);
              window?.removeEventListener("blur", clear);
            },
          };
        },
      }),
    ];
  },
});
